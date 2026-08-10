// ============================================================
// Geometry: organic paths (Catmull-Rom + wobble, boundary-aware)
// ============================================================
import { polygonBBox, clampPointToBBox, pointInPoly, gaussian, segmentsIntersect, polygonCentroid } from "./geometryUtils";

export function catmullRom(points, samplesPerSeg = 16) {
  const pts = points;
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n - 1)];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(pts[n - 1]);
  return out;
}

function maxOffsetInDirection(base, dir, bounds) {
  const { xMin, xMax, yMin, yMax } = bounds;
  let s = 1e12;
  if (dir[0] > 1e-9) s = Math.min(s, (xMax - base[0]) / dir[0]);
  else if (dir[0] < -1e-9) s = Math.min(s, (xMin - base[0]) / dir[0]);
  if (dir[1] > 1e-9) s = Math.min(s, (yMax - base[1]) / dir[1]);
  else if (dir[1] < -1e-9) s = Math.min(s, (yMin - base[1]) / dir[1]);
  return Math.max(s, 0);
}

function rayEdgeIntersectT(base, dir, a, b) {
  // parametric intersection of ray (base + t*dir, t>0) with segment a->b; returns t or null
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const denom = dir[0] * ey - dir[1] * ex;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a[0] - base[0]) * ey - (a[1] - base[1]) * ex) / denom;
  const u = ((a[0] - base[0]) * dir[1] - (a[1] - base[1]) * dir[0]) / denom;
  if (t > 1e-6 && u >= 0 && u <= 1) return t;
  return null;
}
export function maxOffsetInDirectionPoly(base, dir, poly) {
  // same purpose as maxOffsetInDirection, but against an arbitrary (possibly non-convex)
  // boundary polygon instead of an axis-aligned rectangle -- cast a ray and find the
  // nearest edge it would cross.
  let minT = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const t = rayEdgeIntersectT(base, dir, a, b);
    if (t !== null && t < minT) minT = t;
  }
  return Number.isFinite(minT) ? minT : 0;
}
function maxOffsetBeforeEnteringPolygon(base, dir, poly) {
  // base assumed OUTSIDE poly (a wobble step starting from a point already clear of the
  // obstacle) -- returns the smallest t>0 where the ray would enter it, or Infinity if it
  // never does (unlimited room in that direction, as far as this obstacle is concerned).
  let minT = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const t = rayEdgeIntersectT(base, dir, a, b);
    if (t !== null && t < minT) minT = t;
  }
  return minT;
}
function maxOffsetAvoiding(base, dir, boundaryPoly, exclusionPolys) {
  let avail = maxOffsetInDirectionPoly(base, dir, boundaryPoly);
  for (const poly of exclusionPolys) avail = Math.min(avail, maxOffsetBeforeEnteringPolygon(base, dir, poly));
  return avail;
}

export function makeOrganicPath(a, b, wobble, rng, boundaryPoly, exclusionPolys = []) {
  // Control points are kept inside the (possibly irregular) boundary polygon, AND outside
  // every exclusion zone, via ray-cast clamping in whichever random direction was drawn. The
  // final sampled curve gets a light bounding-box safety clamp too, in case of minor spline
  // overshoot between control points near a non-convex notch -- exact, but only approximate
  // near sharply concave corners (a known limitation, not a silent bug).
  const bbox = polygonBBox(boundaryPoly);
  const d = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(d[0], d[1]) + 1e-9;
  const normal = [-d[1] / len, d[0] / len];
  const nCtrl = 2;
  const ctrls = [a];
  for (let i = 1; i <= nCtrl; i++) {
    const t = i / (nCtrl + 1);
    const base = [a[0] + d[0] * t, a[1] + d[1] * t];
    const z = gaussian(rng);
    const dir = z >= 0 ? normal : [-normal[0], -normal[1]];
    const avail = maxOffsetAvoiding(base, dir, boundaryPoly, exclusionPolys);
    const mag = Math.min(Math.abs(z) * wobble, avail * 0.95);
    ctrls.push([base[0] + dir[0] * mag, base[1] + dir[1] * mag]);
  }
  ctrls.push(b);
  const poly = catmullRom(ctrls, 20);
  return poly.map((p) => clampPointToBBox(p, bbox));
}

// ============================================================
// Obstacle-avoiding routing: visibility graph + Dijkstra, then organic wobble applied
// per-segment (not once across the whole span) so the smoothing can't reintroduce a
// collision with the very obstacle the route just went around.
// ============================================================
function inflatePolygonFromCentroid(poly, amount) {
  // simple, always-correct-direction approximation of a polygon offset: push each vertex
  // directly away from the shape's centroid. Not a true geometric buffer (would understate
  // clearance on a very concave shape's inner corners) but robust for the rectangles/simple
  // house-shapes this is meant for, without needing polygon winding-order bookkeeping.
  const [cx, cy] = polygonCentroid(poly);
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * amount, y + (dy / len) * amount];
  });
}
function segmentCrossesPolygon(p1, p2, poly) {
  for (let i = 0; i < poly.length; i++) {
    if (segmentsIntersect(p1, p2, poly[i], poly[(i + 1) % poly.length])) return true;
  }
  const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  return pointInPoly(mid, poly); // catches a diagonal that passes fully through without crossing an edge
}
function routeAroundObstacles(start, end, exclusionPolysInflated) {
  if (exclusionPolysInflated.length === 0) return [start, end];
  const blocked = exclusionPolysInflated.some((poly) => segmentCrossesPolygon(start, end, poly));
  if (!blocked) return [start, end]; // direct line is already clear -- don't bother routing

  const nodes = [start, end];
  exclusionPolysInflated.forEach((poly) => poly.forEach((v) => nodes.push(v)));
  const n = nodes.length;
  const clear = (i, j) => !exclusionPolysInflated.some((poly) => segmentCrossesPolygon(nodes[i], nodes[j], poly));

  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (clear(i, j)) {
        const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
        adj[i].push([j, d]); adj[j].push([i, d]);
      }
    }
  }
  const dist = new Array(n).fill(Infinity); dist[0] = 0;
  const prev = new Array(n).fill(-1);
  const visited = new Array(n).fill(false);
  for (let iter = 0; iter < n; iter++) {
    let u = -1, best = Infinity;
    for (let k = 0; k < n; k++) if (!visited[k] && dist[k] < best) { best = dist[k]; u = k; }
    if (u === -1) break;
    visited[u] = true;
    if (u === 1) break;
    for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  if (!Number.isFinite(dist[1])) return [start, end]; // fully enclosed / unreachable -- fall back rather than crash
  const path = [];
  let cur = 1;
  while (cur !== -1) { path.push(nodes[cur]); cur = prev[cur]; }
  path.reverse();
  return path;
}
export function makeOrganicRoutedPath(a, b, wobble, rng, boundaryPoly, exclusionZones, clearanceMm = 300) {
  if (!exclusionZones || exclusionZones.length === 0) return makeOrganicPath(a, b, wobble, rng, boundaryPoly, []);
  const inflated = exclusionZones.map((z) => inflatePolygonFromCentroid(z.poly, clearanceMm));
  const waypoints = routeAroundObstacles(a, b, inflated);
  if (waypoints.length <= 2) return makeOrganicPath(a, b, wobble, rng, boundaryPoly, inflated);
  // multiple straight legs around one or more corners -- wobble each leg independently
  // (smaller budget than a single unobstructed span would get) so smoothing stays local and
  // can't wander back into the obstacle it just went around
  let full = [waypoints[0]];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const legPoly = makeOrganicPath(waypoints[i], waypoints[i + 1], wobble * 0.4, rng, boundaryPoly, inflated);
    full = full.concat(legPoly.slice(1));
  }
  return full;
}

export function makePatioBlob(center, baseRadius, rng, jitter = 0.24, nPts = 16, boundaryPoly = null) {
  // same boundary-aware capping as makeOrganicPath's control points -- without this, a
  // patio anchor placed near an edge can have its jittered outline poke straight through
  // the boundary (paved tiles stay correctly excluded either way since tile generation is
  // filtered independently, but the outline itself would be visually wrong).
  const pts = [];
  for (let i = 0; i < nPts; i++) {
    const angle = (2 * Math.PI * i) / nPts;
    const r = baseRadius * (1 + (rng() * 2 - 1) * jitter);
    const dir = [Math.cos(angle), Math.sin(angle)];
    let finalR = r;
    if (boundaryPoly) {
      const avail = maxOffsetInDirectionPoly(center, dir, boundaryPoly);
      finalR = Math.min(r, avail * 0.95);
    }
    pts.push([center[0] + finalR * Math.cos(angle), center[1] + finalR * Math.sin(angle)]);
  }
  return pts;
}

export function sampleAlongPolyline(poly, frac) {
  const segLens = [];
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    segLens.push(d);
    total += d;
  }
  const target = Math.min(Math.max(frac, 0), 1) * total;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const t = (target - acc) / (segLens[i] || 1e-9);
      return [poly[i][0] + t * (poly[i + 1][0] - poly[i][0]), poly[i][1] + t * (poly[i + 1][1] - poly[i][1])];
    }
    acc += segLens[i];
  }
  return poly[poly.length - 1];
}

// ---- drag-to-define patio presets: all reduce to a plain polygon, same representation
// as a freeform-drawn shape, so nothing downstream needs to know these are "presets" ----
export function squarePolygonFromDrag(start, current) {
  const dx = current[0] - start[0], dy = current[1] - start[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  if (side < 20) return null; // degenerate -- essentially a click, not a drag
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  const x2 = start[0] + sx * side, y2 = start[1] + sy * side;
  const xMin = Math.min(start[0], x2), xMax = Math.max(start[0], x2);
  const yMin = Math.min(start[1], y2), yMax = Math.max(start[1], y2);
  return [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]];
}
export function rectPolygonFromDrag(start, current) {
  const xMin = Math.min(start[0], current[0]), xMax = Math.max(start[0], current[0]);
  const yMin = Math.min(start[1], current[1]), yMax = Math.max(start[1], current[1]);
  if (xMax - xMin < 20 || yMax - yMin < 20) return null;
  return [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]];
}
export function circlePolygonFromDrag(center, edge, nPts = 32) {
  const r = Math.hypot(edge[0] - center[0], edge[1] - center[1]);
  if (r < 20) return null;
  const pts = [];
  for (let i = 0; i < nPts; i++) {
    const a = (2 * Math.PI * i) / nPts;
    pts.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
  }
  return pts;
}
