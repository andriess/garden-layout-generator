// ============================================================
// Core point/polygon math shared by tile grids, organic paths, Voronoi zones,
// and the meander-track router. Kept dependency-free (no imports from the
// rest of the app) so everything else can safely depend on it.
// ============================================================

export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng) {
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function polygonBBox(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
}

export function clampPointToBBox(p, bbox) {
  return [Math.min(Math.max(p[0], bbox.xMin), bbox.xMax), Math.min(Math.max(p[1], bbox.yMin), bbox.yMax)];
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointSegDist(p, a, b) {
  const ap = [p[0] - a[0], p[1] - a[1]];
  const ab = [b[0] - a[0], b[1] - a[1]];
  const denom = ab[0] * ab[0] + ab[1] * ab[1] + 1e-9;
  let t = (ap[0] * ab[0] + ap[1] * ab[1]) / denom;
  t = Math.min(Math.max(t, 0), 1);
  const proj = [a[0] + t * ab[0], a[1] + t * ab[1]];
  return Math.hypot(p[0] - proj[0], p[1] - proj[1]);
}

export function signedDistanceToPolygon(p, poly) {
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

export function polygonCentroid(pts) {
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

export function segmentsIntersect(p1, p2, p3, p4) {
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ---- edge/segment length helpers, shared by the drawn-shape length labels (live preview
// while drawing, and the editable per-edge inputs once a shape is selected) ----

// closed-polygon edge lengths -- edge i runs poly[i] -> poly[(i+1) % n], so the last entry
// is the closing edge back to the first point (every finished drawn shape renders as a
// closed <polygon>, so that closing edge is a real, visible, editable line too).
export function polygonEdgeLengths(poly) {
  const n = poly.length;
  const lens = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    lens.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return lens;
}

// open-chain segment lengths -- used for the freeform draw-in-progress preview, before the
// shape is closed into a polygon.
export function polylineSegmentLengths(points) {
  const lens = [];
  for (let i = 0; i < points.length - 1; i++) {
    lens.push(Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
  }
  return lens;
}

// moves `to` along the from->to direction so the segment becomes exactly `newLen` long,
// keeping `from` and the direction fixed -- the basis of freeform per-edge length editing.
export function pointAtDistance(from, to, newLen) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  return [from[0] + (dx / len) * newLen, from[1] + (dy / len) * newLen];
}
