import React, { useState, useMemo, useRef, useCallback } from "react";
import { Delaunay } from "d3-delaunay";
import { Plus, Trash2, RefreshCw, Home, Circle as CircleIcon, Square } from "lucide-react";

// ============================================================
// Palette -- carried over from the earlier static-render prototype
// so the tool and its output stay visually consistent.
// ============================================================
const PALETTE = ["#C9A574", "#6B7A80", "#BE6A47", "#7C8A63", "#D9CFB8", "#565349"];
const INK = "#3A362E";
const INK_SOFT = "#6B6152";
const PAPER = "#FBFAF6";
const PANEL_BORDER = "#DCD5C4";
const APP_BG = "#E4E0D3";
const PLANT_BG = "#DCE0CC";
const ACCENT = "#BE6A47";

// ============================================================
// Geometry: tiles
// ============================================================
function hexSizeFromPaver(acrossFlatsMm) {
  return acrossFlatsMm / Math.sqrt(3); // circumradius, mm
}

function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}

function makeHexGrid(size, boundaryPoly) {
  const bbox = polygonBBox(boundaryPoly);
  const { xMin, xMax, yMin, yMax } = bbox;
  const w = xMax - xMin, h = yMax - yMin;
  const cx0 = (xMin + xMax) / 2, cy0 = (yMin + yMax) / 2;
  const tiles = [];
  const qRange = Math.ceil(w / (1.5 * size)) + 2;
  const rRange = Math.ceil(h / (Math.sqrt(3) * size)) + 2;
  for (let q = -qRange; q <= qRange; q++) {
    for (let r = -rRange; r <= rRange; r++) {
      const gx = size * 1.5 * q;
      const gy = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
      const cx = gx + cx0, cy = gy + cy0;
      if (pointInPoly([cx, cy], boundaryPoly)) tiles.push([cx, cy]);
    }
  }
  return tiles;
}

function squareCorners(cx, cy, size, rotDeg) {
  return rectCorners(cx, cy, size, size, rotDeg);
}

function rectCorners(cx, cy, width, height, rotDeg = 0) {
  const hw = width / 2, hh = height / 2;
  let local = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  if (rotDeg) {
    const a = (rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    local = local.map(([x, y]) => [x * c - y * s, y * c + x * s]);
  }
  return local.map(([x, y]) => [x + cx, y + cy]);
}

function makeRectGrid(width, height, bond, rotDeg, boundaryPoly) {
  const bbox = polygonBBox(boundaryPoly);
  const { xMin, xMax, yMin, yMax } = bbox;
  const cx0 = (xMin + xMax) / 2, cy0 = (yMin + yMax) / 2;
  const halfDiag = 0.5 * Math.hypot(xMax - xMin, yMax - yMin) + Math.max(width, height);
  const local = [];
  let y = -halfDiag, row = 0;
  while (y <= halfDiag) {
    const offset = bond === "running" && row % 2 === 1 ? width / 2 : 0;
    let x = -halfDiag + offset;
    while (x <= halfDiag) {
      local.push([x, y]);
      x += width;
    }
    y += height;
    row++;
  }
  const a = (rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const tiles = [];
  for (const [lx, ly] of local) {
    const px = lx * c - ly * s + cx0, py = lx * s + ly * c + cy0;
    if (pointInPoly([px, py], boundaryPoly)) tiles.push([px, py]);
  }
  return tiles;
}

// ============================================================
// Geometry: organic paths (Catmull-Rom + wobble, boundary-aware)
// ============================================================
function catmullRom(points, samplesPerSeg = 16) {
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
function maxOffsetInDirectionPoly(base, dir, poly) {
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
function polygonBBox(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
}
function clampPointToBBox(p, bbox) {
  return [Math.min(Math.max(p[0], bbox.xMin), bbox.xMax), Math.min(Math.max(p[1], bbox.yMin), bbox.yMax)];
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeOrganicPath(a, b, wobble, rng, boundaryPoly, exclusionPolys = []) {
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
function segmentsIntersect(p1, p2, p3, p4) {
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
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
function makeOrganicRoutedPath(a, b, wobble, rng, boundaryPoly, exclusionZones, clearanceMm = 300) {
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

function makePatioBlob(center, baseRadius, rng, jitter = 0.24, nPts = 16, boundaryPoly = null) {
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

function pointSegDist(p, a, b) {
  const ap = [p[0] - a[0], p[1] - a[1]];
  const ab = [b[0] - a[0], b[1] - a[1]];
  const denom = ab[0] * ab[0] + ab[1] * ab[1] + 1e-9;
  let t = (ap[0] * ab[0] + ap[1] * ab[1]) / denom;
  t = Math.min(Math.max(t, 0), 1);
  const proj = [a[0] + t * ab[0], a[1] + t * ab[1]];
  return Math.hypot(p[0] - proj[0], p[1] - proj[1]);
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function signedDistanceToPolygon(p, poly) {
  // positive = depth inside the polygon (this IS the paving 'margin' for a patio, whether
  // it's a jittered circular blob or a freeform user-drawn shape -- both are just polygons
  // by this point, so both get the same treatment instead of a special-cased circle formula).
  const inside = pointInPoly(p, poly);
  let minDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    minDist = Math.min(minDist, pointSegDist(p, a, b));
  }
  return inside ? minDist : -minDist;
}

// ---- drag-to-define patio presets: all reduce to a plain polygon, same representation
// as a freeform-drawn shape, so nothing downstream needs to know these are "presets" ----
function squarePolygonFromDrag(start, current) {
  const dx = current[0] - start[0], dy = current[1] - start[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  if (side < 20) return null; // degenerate -- essentially a click, not a drag
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  const x2 = start[0] + sx * side, y2 = start[1] + sy * side;
  const xMin = Math.min(start[0], x2), xMax = Math.max(start[0], x2);
  const yMin = Math.min(start[1], y2), yMax = Math.max(start[1], y2);
  return [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]];
}
function rectPolygonFromDrag(start, current) {
  const xMin = Math.min(start[0], current[0]), xMax = Math.max(start[0], current[0]);
  const yMin = Math.min(start[1], current[1]), yMax = Math.max(start[1], current[1]);
  if (xMax - xMin < 20 || yMax - yMin < 20) return null;
  return [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]];
}
function circlePolygonFromDrag(center, edge, nPts = 32) {
  const r = Math.hypot(edge[0] - center[0], edge[1] - center[1]);
  if (r < 20) return null;
  const pts = [];
  for (let i = 0; i < nPts; i++) {
    const a = (2 * Math.PI * i) / nPts;
    pts.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
  }
  return pts;
}

// ============================================================
// Voronoi zones (mirror-point rectangle clip + Lloyd relaxation)
// ============================================================
function boundedVoronoiPolygons(points, bounds) {
  const { xMin, xMax, yMin, yMax } = bounds;
  const n = points.length;
  const all = [...points];
  for (const [x, y] of points) all.push([2 * xMin - x, y]);
  for (const [x, y] of points) all.push([2 * xMax - x, y]);
  for (const [x, y] of points) all.push([x, 2 * yMin - y]);
  for (const [x, y] of points) all.push([x, 2 * yMax - y]);
  const delaunay = Delaunay.from(all);
  const voronoi = delaunay.voronoi([xMin, yMin, xMax, yMax]);
  const polys = [];
  for (let i = 0; i < n; i++) {
    const cell = voronoi.cellPolygon(i);
    polys.push(cell ? cell.slice(0, -1) : null);
  }
  return polys;
}

function polygonCentroid(pts) {
  let x = 0, y = 0, area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [x / (6 * area), y / (6 * area)];
}

function relaxPoints(points, iters, bounds) {
  let pts = points;
  for (let it = 0; it < iters; it++) {
    const polys = boundedVoronoiPolygons(pts, bounds);
    pts = pts.map((p, i) => {
      const poly = polys[i];
      if (!poly) return p;
      const [cx, cy] = polygonCentroid(poly);
      return [Math.min(Math.max(cx, bounds.xMin), bounds.xMax), Math.min(Math.max(cy, bounds.yMin), bounds.yMax)];
    });
  }
  return pts;
}

// ============================================================
// Path width validation
// ============================================================
const MIN_PEDESTRIAN_WIDTH_MM = 400;
const MIN_TILES_ACROSS = 2;
function validatePathWidth(widthMm, acrossMm) {
  const required = Math.max(MIN_PEDESTRIAN_WIDTH_MM, MIN_TILES_ACROSS * acrossMm);
  const clamped = Math.max(widthMm, required);
  return { clamped, wasClamped: clamped !== widthMm, required };
}

// ============================================================
// Main component
// ============================================================
let uidCounter = 1;
const nextUid = () => `a${uidCounter++}`;

export default function GardenPavingDesigner() {
  // --- garden ---
  const [gardenW, setGardenW] = useState(9000);
  const [gardenH, setGardenH] = useState(6500);
  const marginMm = 300;

  // --- tiles ---
  const [tileShape, setTileShape] = useState("hexagon");
  const [paverAcrossFlats, setPaverAcrossFlats] = useState(200);
  const [paverSize, setPaverSize] = useState(200);
  const [paverWidth, setPaverWidth] = useState(300);
  const [paverHeight, setPaverHeight] = useState(150);
  const [rectBond, setRectBond] = useState("running");
  const [rotationDeg, setRotationDeg] = useState(0);

  // --- garden boundary & exclusion (house) zones ---
  const [gardenBoundary, setGardenBoundary] = useState(() => [
    [marginMm, marginMm], [gardenW - marginMm, marginMm],
    [gardenW - marginMm, gardenH - marginMm], [marginMm, gardenH - marginMm],
  ]);
  const [exclusionZones, setExclusionZones] = useState([]); // [{id, label, poly}] -- house footprint etc.

  // --- anchors & connections ---
  const [anchors, setAnchors] = useState(() => [
    { id: "back_door", label: "back_door", type: "door", x: 900, y: 900 },
    { id: "side_gate", label: "side_gate", type: "door", x: 8300, y: 1600 },
    { id: "front_exit", label: "front_exit", type: "door", x: 800, y: 5900 },
    { id: "patio", label: "patio", type: "patio", x: 3200, y: 4600, radius: 1000 },
  ]);
  const [connections, setConnections] = useState(() => [
    { a: "back_door", b: "patio", widthMm: 400 },
    { a: "patio", b: "side_gate", widthMm: 400 },
    { a: "patio", b: "front_exit", widthMm: 400 },
  ]);

  // placeMode: null | 'door' | 'patio' | 'draw-patio' | 'draw-square' | 'draw-rect' | 'draw-circle'
  //            | 'draw-boundary' | 'draw-exclusion' | 'draw-exclusion-rect'
  const [placeMode, setPlaceMode] = useState(null);
  const [drawPoints, setDrawPoints] = useState([]); // vertices while freeform-drawing (patio/boundary/exclusion)
  const [shapeDragStart, setShapeDragStart] = useState(null); // drag-to-define presets: square/rect/circle
  const [shapeDragCurrent, setShapeDragCurrent] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [connFrom, setConnFrom] = useState("");
  const [connTo, setConnTo] = useState("");
  const [connWidth, setConnWidth] = useState(400);

  // --- zones / organics ---
  const [zoneCount, setZoneCount] = useState(30);
  const [relaxIters, setRelaxIters] = useState(1);
  const [wobbleMm, setWobbleMm] = useState(450);
  const [seed, setSeed] = useState(7);

  // --- scatter (kept simple/fixed-ish, still exposed) ---
  const [scatterDensity, setScatterDensity] = useState(0.7);
  const [scatterMaxMm, setScatterMaxMm] = useState(700);

  // --- layer toggles ---
  const [showZones, setShowZones] = useState(true);
  const [showTiles, setShowTiles] = useState(true);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [showCenterlines, setShowCenterlines] = useState(true);
  const [showPlanting, setShowPlanting] = useState(true);

  const svgRef = useRef(null);

  const boundaryBBox = useMemo(() => polygonBBox(gardenBoundary), [gardenBoundary]);

  // ---- tile geometry ----
  const geom = useMemo(() => {
    if (tileShape === "hexagon") {
      const size = hexSizeFromPaver(paverAcrossFlats);
      return { shape: "hexagon", size, acrossMm: paverAcrossFlats };
    } else if (tileShape === "square") {
      return { shape: "square", size: paverSize, acrossMm: paverSize };
    } else {
      return { shape: "rectangle", width: paverWidth, height: paverHeight, rotationDeg, bond: rectBond, acrossMm: Math.min(paverWidth, paverHeight) };
    }
  }, [tileShape, paverAcrossFlats, paverSize, paverWidth, paverHeight, rotationDeg, rectBond]);

  const tileCenters = useMemo(() => {
    let raw;
    if (geom.shape === "hexagon") raw = makeHexGrid(geom.size, gardenBoundary);
    else if (geom.shape === "square") raw = makeRectGrid(geom.size, geom.size, "grid", 0, gardenBoundary);
    else raw = makeRectGrid(geom.width, geom.height, geom.bond, geom.rotationDeg, gardenBoundary);
    // exclude tiles whose center falls inside any marked house/exclusion zone
    if (exclusionZones.length === 0) return raw;
    return raw.filter((pt) => !exclusionZones.some((z) => pointInPoly(pt, z.poly)));
  }, [geom, gardenBoundary, exclusionZones]);

  const tileCornersFn = useCallback((cx, cy, scale = 0.98) => {
    if (geom.shape === "hexagon") return hexCorners(cx, cy, geom.size * scale);
    if (geom.shape === "square") return squareCorners(cx, cy, geom.size * scale, 0);
    return rectCorners(cx, cy, geom.width * scale, geom.height * scale, geom.rotationDeg);
  }, [geom]);

  // ---- main paths ----
  const rng = useMemo(() => mulberry32(seed * 9973 + 17), [seed]);
  const anchorById = useMemo(() => Object.fromEntries(anchors.map((a) => [a.id, a])), [anchors]);

  const { pathPolys, clampReport, patioBlobs, exclusionWarnings } = useMemo(() => {
    const localRng = mulberry32(seed * 9973 + 17);
    const polys = [];
    const report = [];
    const warnings = [];
    for (const c of connections) {
      const a = anchorById[c.a], b = anchorById[c.b];
      if (!a || !b) continue;
      const { clamped, wasClamped, required } = validatePathWidth(c.widthMm, geom.acrossMm);
      const poly = makeOrganicRoutedPath([a.x, a.y], [b.x, b.y], wobbleMm, localRng, gardenBoundary, exclusionZones);
      polys.push({ poly, widthMm: clamped, from: a.label, to: b.label });
      report.push({ from: a.label, to: b.label, requestedMm: c.widthMm, usedMm: clamped, requiredMm: required, clamped: wasClamped });
      // flag (not fix) any path whose centerline dips into a marked house/exclusion zone --
      // auto-routing a path around an obstacle is a real pathfinding problem (same class as
      // the meander/fork system), not solved here; this just makes the conflict visible.
      for (const z of exclusionZones) {
        if (poly.some((p) => pointInPoly(p, z.poly))) {
          warnings.push(`${a.label} → ${b.label} crosses "${z.label}"`);
          break;
        }
      }
    }
    const blobs = anchors.filter((a) => a.type === "patio").map((a) => ({
      poly: a.customPolygon && a.customPolygon.length >= 3 ? a.customPolygon : makePatioBlob([a.x, a.y], a.radius || 1000, localRng, 0.24, 16, gardenBoundary),
      label: a.label,
    }));
    return { pathPolys: polys, clampReport: report, patioBlobs: blobs, exclusionWarnings: warnings };
  }, [connections, anchorById, wobbleMm, seed, gardenBoundary, geom.acrossMm, anchors, exclusionZones]);

  // ---- zones ----
  const zoneSeeds = useMemo(() => {
    const localRng = mulberry32(seed * 131 + 5);
    const pts = [];
    let attempts = 0;
    while (pts.length < zoneCount && attempts < zoneCount * 60) {
      attempts++;
      const cand = [
        boundaryBBox.xMin + localRng() * (boundaryBBox.xMax - boundaryBBox.xMin),
        boundaryBBox.yMin + localRng() * (boundaryBBox.yMax - boundaryBBox.yMin),
      ];
      if (pointInPoly(cand, gardenBoundary) && !exclusionZones.some((z) => pointInPoly(cand, z.poly))) pts.push(cand);
    }
    return relaxPoints(pts, relaxIters, boundaryBBox);
  }, [zoneCount, relaxIters, seed, boundaryBBox, gardenBoundary, exclusionZones]);

  const zoneDelaunay = useMemo(() => Delaunay.from(zoneSeeds), [zoneSeeds]);
  const zonePolys = useMemo(() => boundedVoronoiPolygons(zoneSeeds, boundaryBBox), [zoneSeeds, boundaryBBox]);

  // ---- tile paving selection: core (on path/patio) + scatter (fringe) ----
  const paved = useMemo(() => {
    const scatterRng = mulberry32(seed * 7919 + 3);
    const result = [];
    for (const [cx, cy] of tileCenters) {
      let margin = -1e9;
      for (const { poly, widthMm } of pathPolys) {
        for (let k = 0; k < poly.length - 1; k++) {
          const d = pointSegDist([cx, cy], poly[k], poly[k + 1]);
          const m = widthMm / 2 - d;
          if (m > margin) margin = m;
        }
      }
      for (const { poly: patioPoly } of patioBlobs) {
        const m = signedDistanceToPolygon([cx, cy], patioPoly);
        if (m > margin) margin = m;
      }
      let reason = null;
      if (margin > 0) reason = "core";
      else {
        const distOut = -margin;
        if (distOut <= scatterMaxMm) {
          const prob = scatterDensity * (1 - distOut / scatterMaxMm);
          if (scatterRng() < prob) reason = "scatter";
        }
      }
      if (reason) {
        const idx = zoneDelaunay.find(cx, cy);
        result.push({ cx, cy, reason, zoneIdx: idx });
      }
    }
    return result;
  }, [tileCenters, pathPolys, patioBlobs, scatterMaxMm, scatterDensity, seed, zoneDelaunay]);

  const materialCounts = useMemo(() => {
    const counts = new Array(PALETTE.length).fill(0);
    for (const t of paved) counts[t.zoneIdx % PALETTE.length]++;
    return counts;
  }, [paved]);

  // ---- SVG viewbox / scale ----
  const VB_W = 900;
  const scale = VB_W / gardenW;
  const VB_H = gardenH * scale;

  // ---- interactions: click-to-place, drag-to-move ----
  const svgPointFromEvent = useCallback((evt) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    const xFrac = (clientX - rect.left) / rect.width;
    const yFrac = (clientY - rect.top) / rect.height;
    return [xFrac * gardenW, yFrac * gardenH];
  }, [gardenW, gardenH]);

  const FREEFORM_MODES = ["draw-patio", "draw-boundary", "draw-exclusion"];
  const SHAPE_PRESET_MODES = ["draw-square", "draw-rect", "draw-circle", "draw-exclusion-rect"];

  const handleCanvasClick = (evt) => {
    if (!placeMode) return;
    const [x, y] = svgPointFromEvent(evt);
    if (FREEFORM_MODES.includes(placeMode)) {
      setDrawPoints((prev) => [...prev, [Math.round(x), Math.round(y)]]);
      return;
    }
    if (SHAPE_PRESET_MODES.includes(placeMode)) return; // those are drag-driven, not click-driven
    const id = nextUid();
    const label = placeMode === "patio" ? `patio_${id}` : `door_${id}`;
    const newAnchor = { id, label, type: placeMode, x: Math.round(x), y: Math.round(y), ...(placeMode === "patio" ? { radius: 1000 } : {}) };
    setAnchors((prev) => [...prev, newAnchor]);
    setPlaceMode(null);
  };

  const addPatioFromPolygon = (poly) => {
    if (!poly) return;
    const id = nextUid();
    const rounded = poly.map(([x, y]) => [Math.round(x), Math.round(y)]);
    const [cx, cy] = polygonCentroid(rounded);
    setAnchors((prev) => [...prev, { id, label: `patio_${id}`, type: "patio", x: Math.round(cx), y: Math.round(cy), customPolygon: rounded }]);
  };
  const addExclusionFromPolygon = (poly) => {
    if (!poly) return;
    const id = nextUid();
    const rounded = poly.map(([x, y]) => [Math.round(x), Math.round(y)]);
    setExclusionZones((prev) => [...prev, { id, label: `house_${id}`, poly: rounded }]);
  };

  // finishes whatever freeform shape is currently being drawn, routing to the right target
  const finishFreeformDraw = () => {
    if (drawPoints.length < 3) return;
    if (placeMode === "draw-patio") addPatioFromPolygon(drawPoints);
    else if (placeMode === "draw-boundary") setGardenBoundary(drawPoints.map(([x, y]) => [Math.round(x), Math.round(y)]));
    else if (placeMode === "draw-exclusion") addExclusionFromPolygon(drawPoints);
    setDrawPoints([]);
    setPlaceMode(null);
  };
  const cancelFreeformDraw = () => {
    setDrawPoints([]);
    setPlaceMode(null);
  };
  const resetBoundaryToRect = () => {
    setGardenBoundary([
      [marginMm, marginMm], [gardenW - marginMm, marginMm],
      [gardenW - marginMm, gardenH - marginMm], [marginMm, gardenH - marginMm],
    ]);
  };

  const handleCanvasMouseDown = (evt) => {
    if (!SHAPE_PRESET_MODES.includes(placeMode)) return;
    const pt = svgPointFromEvent(evt);
    setShapeDragStart(pt);
    setShapeDragCurrent(pt);
  };

  const handleAnchorPointerDown = (id) => (evt) => {
    evt.stopPropagation();
    setDragId(id);
  };
  const handlePointerMove = (evt) => {
    if (dragId) {
      const [x, y] = svgPointFromEvent(evt);
      setAnchors((prev) => prev.map((a) => (a.id === dragId ? { ...a, x: Math.round(x), y: Math.round(y) } : a)));
      return;
    }
    if (shapeDragStart) setShapeDragCurrent(svgPointFromEvent(evt));
  };
  const handlePointerUp = () => {
    if (dragId) { setDragId(null); return; }
    if (shapeDragStart && shapeDragCurrent) {
      let poly = null;
      if (placeMode === "draw-square") poly = squarePolygonFromDrag(shapeDragStart, shapeDragCurrent);
      else if (placeMode === "draw-rect") poly = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent);
      else if (placeMode === "draw-circle") poly = circlePolygonFromDrag(shapeDragStart, shapeDragCurrent);
      else if (placeMode === "draw-exclusion-rect") poly = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent);
      if (placeMode === "draw-exclusion-rect") addExclusionFromPolygon(poly);
      else addPatioFromPolygon(poly);
      setShapeDragStart(null);
      setShapeDragCurrent(null);
      setPlaceMode(null);
    }
  };

  const removeAnchor = (id) => {
    setAnchors((prev) => prev.filter((a) => a.id !== id));
    setConnections((prev) => prev.filter((c) => c.a !== id && c.b !== id));
  };
  const removeConnection = (idx) => setConnections((prev) => prev.filter((_, i) => i !== idx));
  const addConnection = () => {
    if (!connFrom || !connTo || connFrom === connTo) return;
    setConnections((prev) => [...prev, { a: connFrom, b: connTo, widthMm: connWidth }]);
    setConnFrom(""); setConnTo("");
  };

  const totalGardenTiles = tileCenters.length;
  const coreCount = paved.filter((t) => t.reason === "core").length;
  const scatterCount = paved.filter((t) => t.reason === "scatter").length;

  const labelStyle = { fontSize: 12, fontWeight: 600, color: INK, letterSpacing: "0.02em" };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", background: APP_BG, fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: INK }}>
      {/* ---------------- control rail ---------------- */}
      <div style={{ width: 320, minWidth: 320, background: PAPER, borderRight: `1px solid ${PANEL_BORDER}`, overflowY: "auto", padding: "18px 16px" }}>
        <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 20, fontWeight: 700, marginBottom: 2, color: INK }}>
          Garden Paving Designer
        </div>
        <div style={{ fontSize: 11.5, color: INK_SOFT, marginBottom: 18 }}>
          Voronoi zones · organic paths · live tile layout
        </div>

        <Section title="Garden">
          <Row label="Width (mm)"><NumInput value={gardenW} onChange={setGardenW} step={100} /></Row>
          <Row label="Height (mm)"><NumInput value={gardenH} onChange={setGardenH} step={100} /></Row>
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 4 }}>
            Width/height set the default rectangle. Draw a custom outline for an irregular plot, an L-shape, a side passage, etc.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <PlaceButton
              active={placeMode === "draw-boundary"}
              onClick={() => { setDrawPoints([]); setPlaceMode(placeMode === "draw-boundary" ? null : "draw-boundary"); }}
              icon={<Square size={13} />} label="Draw boundary" />
            <button onClick={resetBoundaryToRect} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Reset to rectangle</button>
          </div>
          {placeMode === "draw-boundary" && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: "#F1ECE0", borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 6 }}>
                Click to trace the outline ({drawPoints.length} points, need ≥3). This REPLACES the garden boundary.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={finishFreeformDraw} disabled={drawPoints.length < 3}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: drawPoints.length < 3 ? 0.4 : 1, cursor: drawPoints.length < 3 ? "not-allowed" : "pointer" }}>
                  Finish outline
                </button>
                <button onClick={cancelFreeformDraw} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Cancel</button>
              </div>
            </div>
          )}
        </Section>

        <Section title="House / exclusions">
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 6 }}>
            Mark parts of the house (or anything else) that must never be paved. Tiles inside are hard-excluded; paths crossing one are flagged, not auto-routed around.
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <PlaceButton active={placeMode === "draw-exclusion-rect"} onClick={() => setPlaceMode(placeMode === "draw-exclusion-rect" ? null : "draw-exclusion-rect")} icon={<Square size={13} />} label="Rect. house" />
            <PlaceButton active={placeMode === "draw-exclusion"} onClick={() => { setDrawPoints([]); setPlaceMode(placeMode === "draw-exclusion" ? null : "draw-exclusion"); }} icon={<Square size={13} />} label="Freeform house" />
          </div>
          {placeMode === "draw-exclusion-rect" && <div style={{ fontSize: 11, color: ACCENT, marginBottom: 8 }}>Click and drag to size the excluded area.</div>}
          {placeMode === "draw-exclusion" && (
            <div style={{ marginBottom: 10, padding: "8px 10px", background: "#F1ECE0", borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 6 }}>
                Click to add points ({drawPoints.length} so far). Needs at least 3.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={finishFreeformDraw} disabled={drawPoints.length < 3}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: drawPoints.length < 3 ? 0.4 : 1, cursor: drawPoints.length < 3 ? "not-allowed" : "pointer" }}>
                  Finish shape
                </button>
                <button onClick={cancelFreeformDraw} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Cancel</button>
              </div>
            </div>
          )}
          {exclusionZones.map((z) => (
            <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: `1px solid ${PANEL_BORDER}` }}>
              <input value={z.label} onChange={(e) => setExclusionZones((prev) => prev.map((x) => (x.id === z.id ? { ...x, label: e.target.value } : x)))} style={{ ...tinyInputStyle, flex: 1 }} />
              <button onClick={() => setExclusionZones((prev) => prev.filter((x) => x.id !== z.id))} style={iconBtnStyle}><Trash2 size={12} /></button>
            </div>
          ))}
          {exclusionWarnings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {exclusionWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 10.5, color: "#9A4A2B", padding: "2px 0" }}>⚠ {w}</div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Paver">
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {["hexagon", "square", "rectangle"].map((s) => (
              <ShapeButton key={s} active={tileShape === s} onClick={() => setTileShape(s)} label={s} />
            ))}
          </div>
          {tileShape === "hexagon" && (
            <Row label="Across flats (mm)"><NumInput value={paverAcrossFlats} onChange={setPaverAcrossFlats} step={10} /></Row>
          )}
          {tileShape === "square" && (
            <Row label="Side (mm)"><NumInput value={paverSize} onChange={setPaverSize} step={10} /></Row>
          )}
          {tileShape === "rectangle" && (
            <>
              <Row label="Width (mm)"><NumInput value={paverWidth} onChange={setPaverWidth} step={10} /></Row>
              <Row label="Height (mm)"><NumInput value={paverHeight} onChange={setPaverHeight} step={10} /></Row>
              <Row label="Bond">
                <select value={rectBond} onChange={(e) => setRectBond(e.target.value)} style={selectStyle}>
                  <option value="running">Running (brick)</option>
                  <option value="grid">Grid (aligned)</option>
                </select>
              </Row>
              <Row label={`Rotation (${rotationDeg}°)`}>
                <input type="range" min={0} max={90} value={rotationDeg} onChange={(e) => setRotationDeg(+e.target.value)} style={{ width: "100%" }} />
              </Row>
            </>
          )}
        </Section>

        <Section title="Anchors">
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <PlaceButton active={placeMode === "door"} onClick={() => setPlaceMode(placeMode === "door" ? null : "door")} icon={<Home size={13} />} label="Place door" />
            <PlaceButton active={placeMode === "patio"} onClick={() => setPlaceMode(placeMode === "patio" ? null : "patio")} icon={<CircleIcon size={13} />} label="Place patio" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 4 }}>Patio shape presets</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <PlaceButton active={placeMode === "draw-square"} onClick={() => setPlaceMode(placeMode === "draw-square" ? null : "draw-square")} icon={<Square size={13} />} label="Square patio" />
              <PlaceButton active={placeMode === "draw-rect"} onClick={() => setPlaceMode(placeMode === "draw-rect" ? null : "draw-rect")} icon={<Square size={13} />} label="Rect. patio" />
              <PlaceButton active={placeMode === "draw-circle"} onClick={() => setPlaceMode(placeMode === "draw-circle" ? null : "draw-circle")} icon={<CircleIcon size={13} />} label="Circle patio" />
            </div>
            {SHAPE_PRESET_MODES.includes(placeMode) && (
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 8 }}>
                Click and drag on the canvas to size the {placeMode.replace("draw-", "")}.
              </div>
            )}
          </div>
          <div style={{ marginBottom: 10 }}>
            <PlaceButton
              active={placeMode === "draw-patio"}
              onClick={() => { setDrawPoints([]); setPlaceMode(placeMode === "draw-patio" ? null : "draw-patio"); }}
              icon={<CircleIcon size={13} />}
              label="Draw freeform shape"
              fullWidth
            />
          </div>
          {placeMode === "draw-patio" && (
            <div style={{ marginBottom: 10, padding: "8px 10px", background: "#F1ECE0", borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 6 }}>
                Click to add points ({drawPoints.length} so far). Needs at least 3.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={finishFreeformDraw} disabled={drawPoints.length < 3}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: drawPoints.length < 3 ? 0.4 : 1, cursor: drawPoints.length < 3 ? "not-allowed" : "pointer" }}>
                  Finish shape
                </button>
                <button onClick={cancelFreeformDraw} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Cancel</button>
              </div>
            </div>
          )}
          {(placeMode === "door" || placeMode === "patio") && <div style={{ fontSize: 11, color: ACCENT, marginBottom: 8 }}>Click the canvas to place a {placeMode}.</div>}
          {anchors.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: `1px solid ${PANEL_BORDER}` }}>
              {a.type === "door" ? <Square size={11} color={INK} /> : <CircleIcon size={11} color={INK} />}
              <input
                value={a.label}
                onChange={(e) => setAnchors((prev) => prev.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)))}
                style={{ ...tinyInputStyle, flex: 1 }}
              />
              {a.customPolygon && <span style={{ fontSize: 9, color: INK_SOFT }}>custom</span>}
              <span style={{ fontSize: 10, color: INK_SOFT, fontFamily: "monospace" }}>{Math.round(a.x)},{Math.round(a.y)}</span>
              <button onClick={() => removeAnchor(a.id)} style={iconBtnStyle}><Trash2 size={12} /></button>
            </div>
          ))}
        </Section>

        <Section title="Paths">
          <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center" }}>
            <select value={connFrom} onChange={(e) => setConnFrom(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
              <option value="">from…</option>
              {anchors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <select value={connTo} onChange={(e) => setConnTo(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
              <option value="">to…</option>
              {anchors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            <NumInput value={connWidth} onChange={setConnWidth} step={50} />
            <button onClick={addConnection} style={{ ...primaryBtnStyle, padding: "0 10px" }}><Plus size={13} /></button>
          </div>
          {clampReport.map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, padding: "3px 0", color: c.clamped ? "#9A4A2B" : INK_SOFT }}>
              <span>{c.from} → {c.to}: {Math.round(c.usedMm)}mm{c.clamped ? ` (min ${Math.round(c.requiredMm)})` : ""}</span>
              <button onClick={() => removeConnection(i)} style={iconBtnStyle}><Trash2 size={11} /></button>
            </div>
          ))}
        </Section>

        <Section title="Organic zones">
          <Row label={`Zones (${zoneCount})`}><input type="range" min={6} max={80} value={zoneCount} onChange={(e) => setZoneCount(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Relaxation (${relaxIters})`}><input type="range" min={0} max={4} value={relaxIters} onChange={(e) => setRelaxIters(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Path wobble (${wobbleMm}mm)`}><input type="range" min={0} max={1200} step={50} value={wobbleMm} onChange={(e) => setWobbleMm(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Scatter density (${scatterDensity.toFixed(2)})`}><input type="range" min={0} max={1} step={0.05} value={scatterDensity} onChange={(e) => setScatterDensity(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Scatter reach (${scatterMaxMm}mm)`}><input type="range" min={0} max={1500} step={50} value={scatterMaxMm} onChange={(e) => setScatterMaxMm(+e.target.value)} style={{ width: "100%" }} /></Row>
          <button onClick={() => setSeed((s) => s + 1)} style={{ ...primaryBtnStyle, width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <RefreshCw size={13} /> Reroll layout
          </button>
        </Section>

        <Section title="Layers">
          <Toggle label="Planting texture" value={showPlanting} onChange={setShowPlanting} />
          <Toggle label="Boundary" value={showBoundary} onChange={setShowBoundary} />
          <Toggle label="Zone guide" value={showZones} onChange={setShowZones} />
          <Toggle label="Tiles" value={showTiles} onChange={setShowTiles} />
          <Toggle label="Path/patio centerlines" value={showCenterlines} onChange={setShowCenterlines} />
          <Toggle label="Anchors" value={showAnchors} onChange={setShowAnchors} />
        </Section>

        <div style={{ marginTop: 18, padding: "10px 12px", background: "#F1ECE0", borderRadius: 6, fontSize: 10.5, color: INK_SOFT, lineHeight: 1.5 }}>
          Meandering desire-paths and forked branches (Dijkstra void-space routing) aren't ported to this GUI yet — they're a heavier, follow-on piece. This covers the core model: tiles, zones, main paths, patio, anchors.
        </div>
      </div>

      {/* ---------------- canvas ---------------- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "10px 18px", borderBottom: `1px solid ${PANEL_BORDER}`, display: "flex", gap: 22, alignItems: "center", background: PAPER }}>
          <Stat label="Paved tiles" value={`${coreCount + scatterCount} / ${totalGardenTiles}`} />
          <Stat label="Core" value={coreCount} />
          <Stat label="Scatter" value={scatterCount} />
          <Stat label="Coverage" value={`${totalGardenTiles ? Math.round((100 * (coreCount + scatterCount)) / totalGardenTiles) : 0}%`} />
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 10 }}>
            {PALETTE.map((c, i) => materialCounts[i] > 0 && (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: INK_SOFT }}>
                <span style={{ width: 9, height: 9, background: c, display: "inline-block", borderRadius: 2 }} />
                {materialCounts[i]}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflow: "auto" }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${gardenW} ${gardenH}`}
            width={VB_W}
            height={VB_H}
            style={{ background: PLANT_BG, borderRadius: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.12)", cursor: placeMode ? "crosshair" : dragId ? "grabbing" : "default" }}
            onClick={handleCanvasClick}
            onDoubleClick={() => { if (FREEFORM_MODES.includes(placeMode)) finishFreeformDraw(); }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
          >
            <defs>
              <clipPath id="gardenClip">
                <polygon points={gardenBoundary.map((p) => p.join(",")).join(" ")} />
              </clipPath>
              <pattern id="hatch" patternUnits="userSpaceOnUse" width={gardenW * 0.018} height={gardenW * 0.018} patternTransform="rotate(45)">
                <rect width={gardenW * 0.018} height={gardenW * 0.018} fill="#D9C7BE" />
                <line x1="0" y1="0" x2="0" y2={gardenW * 0.018} stroke="#8B3A2B" strokeWidth={gardenW * 0.0025} opacity={0.5} />
              </pattern>
            </defs>

            <g clipPath="url(#gardenClip)">
              {showPlanting && Array.from({ length: 260 }).map((_, i) => {
                const rx = boundaryBBox.xMin + ((i * 97) % (boundaryBBox.xMax - boundaryBBox.xMin));
                const ry = boundaryBBox.yMin + ((i * 233) % (boundaryBBox.yMax - boundaryBBox.yMin));
                return <circle key={i} cx={rx} cy={ry} r={gardenW * 0.0012} fill="#8FA07A" opacity={0.35} />;
              })}

              {showZones && zonePolys.map((poly, i) => poly && (
                <polygon key={i} points={poly.map((p) => p.join(",")).join(" ")} fill={PALETTE[i % PALETTE.length]} opacity={0.1} stroke="none" />
              ))}

              {showTiles && paved.map((t, i) => (
                <polygon key={i} points={tileCornersFn(t.cx, t.cy).map((p) => p.join(",")).join(" ")}
                  fill={PALETTE[t.zoneIdx % PALETTE.length]} stroke={INK} strokeWidth={gardenW * 0.0006} opacity={t.reason === "core" ? 1 : 0.92} />
              ))}

              {/* main path/patio centerlines moved INSIDE the clip group -- these are the
                  reference outlines, and without clipping they could visually poke past the
                  true boundary (confirmed: the default patio blob is a jittered circle with
                  no boundary awareness at all, so if its center sits closer to an edge than
                  its jittered radius, the raw shape legitimately extends past the boundary --
                  actual tile placement was never affected since tiles are independently
                  filtered by point-in-polygon, but the outline was misleadingly unclipped) */}
              {showCenterlines && pathPolys.map((p, i) => (
                <polyline key={i} points={p.poly.map((pt) => pt.join(",")).join(" ")} fill="none" stroke="#1F3A52" strokeWidth={gardenW * 0.0012} opacity={0.7} strokeLinecap="round" />
              ))}
              {showCenterlines && patioBlobs.map((b, i) => (
                <polygon key={i} points={b.poly.map((p) => p.join(",")).join(" ")} fill="none" stroke="#1F3A52" strokeDasharray="20,14" strokeWidth={gardenW * 0.0012} opacity={0.7} />
              ))}
            </g>

            {/* house / exclusion zones: hatched, always drawn on top of tiles so the
                'never paved here' area stays visually unambiguous */}
            {exclusionZones.map((z) => (
              <g key={z.id}>
                <polygon points={z.poly.map((p) => p.join(",")).join(" ")} fill="url(#hatch)" stroke="#8B3A2B" strokeWidth={gardenW * 0.0012} opacity={0.85} />
                <text x={polygonCentroid(z.poly)[0]} y={polygonCentroid(z.poly)[1]} fontSize={gardenW * 0.011} fill="#5A2E1E" textAnchor="middle" style={{ userSelect: "none" }}>{z.label}</text>
              </g>
            ))}

            {showBoundary && (
              <polygon points={gardenBoundary.map((p) => p.join(",")).join(" ")}
                fill="none" stroke="#9C927B" strokeDasharray={`${gardenW * 0.006} ${gardenW * 0.005}`} strokeWidth={gardenW * 0.0015} />
            )}


            {FREEFORM_MODES.includes(placeMode) && drawPoints.length > 0 && (
              <g>
                <polyline
                  points={drawPoints.map((p) => p.join(",")).join(" ")}
                  fill="none" stroke={ACCENT} strokeWidth={gardenW * 0.0015} strokeDasharray="14,8"
                />
                {drawPoints.length >= 3 && (
                  <polygon
                    points={drawPoints.map((p) => p.join(",")).join(" ")}
                    fill={ACCENT} opacity={0.12} stroke="none"
                  />
                )}
                {drawPoints.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={gardenW * 0.005} fill={ACCENT} stroke={PAPER} strokeWidth={gardenW * 0.0012} />
                ))}
              </g>
            )}

            {shapeDragStart && shapeDragCurrent && (() => {
              let preview = null;
              if (placeMode === "draw-square") preview = squarePolygonFromDrag(shapeDragStart, shapeDragCurrent);
              else if (placeMode === "draw-rect") preview = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent);
              else if (placeMode === "draw-circle") preview = circlePolygonFromDrag(shapeDragStart, shapeDragCurrent);
              if (!preview) return null;
              return (
                <polygon points={preview.map((p) => p.join(",")).join(" ")}
                  fill={ACCENT} opacity={0.16} stroke={ACCENT} strokeWidth={gardenW * 0.0015} strokeDasharray="14,8" />
              );
            })()}

            {showAnchors && anchors.map((a) => (
              <g key={a.id} onMouseDown={handleAnchorPointerDown(a.id)} style={{ cursor: "grab" }}>
                {a.type === "door" ? (
                  <rect x={a.x - gardenW * 0.009} y={a.y - gardenW * 0.009} width={gardenW * 0.018} height={gardenW * 0.018}
                    fill={INK} stroke={PAPER} strokeWidth={gardenW * 0.0015} />
                ) : (
                  <circle cx={a.x} cy={a.y} r={gardenW * 0.009} fill={INK} stroke={PAPER} strokeWidth={gardenW * 0.0015} />
                )}
                <text x={a.x} y={a.y - gardenW * 0.016} fontSize={gardenW * 0.011} fill={INK} textAnchor="middle" style={{ userSelect: "none" }}>{a.label}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// small presentational helpers
// ============================================================
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, borderBottom: `1px solid ${PANEL_BORDER}`, paddingBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
function Row({ label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: INK_SOFT, marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}
function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: INK_SOFT, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{value}</div>
    </div>
  );
}
function Toggle({ label, value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
function ShapeButton({ active, onClick, label }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "6px 4px", fontSize: 10.5, textTransform: "capitalize", borderRadius: 5,
      border: `1px solid ${active ? ACCENT : PANEL_BORDER}`, background: active ? ACCENT : PAPER, color: active ? PAPER : INK, cursor: "pointer",
    }}>{label}</button>
  );
}
function PlaceButton({ active, onClick, icon, label, fullWidth }) {
  return (
    <button onClick={onClick} style={{
      flex: fullWidth ? "1 1 100%" : 1, width: fullWidth ? "100%" : undefined,
      padding: "6px 8px", fontSize: 11, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      border: `1px solid ${active ? ACCENT : PANEL_BORDER}`, background: active ? ACCENT : PAPER, color: active ? PAPER : INK, cursor: "pointer",
    }}>{icon}{label}</button>
  );
}
function NumInput({ value, onChange, step = 1 }) {
  return (
    <input type="number" value={value} step={step} onChange={(e) => onChange(+e.target.value)}
      style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, background: PAPER, color: INK }} />
  );
}
const selectStyle = { padding: "5px 6px", fontSize: 11.5, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, background: PAPER, color: INK };
const tinyInputStyle = { padding: "2px 5px", fontSize: 11, border: `1px solid ${PANEL_BORDER}`, borderRadius: 3, background: PAPER, color: INK };
const iconBtnStyle = { border: "none", background: "none", cursor: "pointer", color: INK_SOFT, padding: 2, display: "flex" };
const primaryBtnStyle = { border: "none", background: ACCENT, color: PAPER, fontSize: 12, fontWeight: 600, borderRadius: 5, padding: "7px 10px", cursor: "pointer" };
