// ============================================================
// Polygon boolean ops for obstacle-aware planting cells. Thin wrapper around the
// polygon-clipping package -- kept out of geometryUtils.js, which is deliberately
// dependency-free (see its own header comment).
// ============================================================
import polygonClipping from "polygon-clipping";

// This app's polygons are open point arrays ([[x,y], ...], no repeated closing
// point -- see voronoiZones.js). polygon-clipping's Ring type is also just a
// Pair[]; it closes rings internally, so no explicit closing point is required,
// but every result ring it returns comes back closed and needs stripping.
export function ringFromPoly(poly) {
  return poly.map(([x, y]) => [x, y]);
}

export function polyFromRing(ring) {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

// a small regular polygon around `center` -- used as the "joint disc" that plugs
// the gap a plain per-segment quad buffer would otherwise leave at a sharp turn.
function regularPolygon(center, radius, sides = 8) {
  const [cx, cy] = center;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

// Buffers an open polyline into a ribbon polygon of the given half-width: one
// quad per segment (offset perpendicular to the segment) plus a joint disc at
// each interior vertex, unioned into a single Polygon/MultiPolygon. Not a true
// geometric offset (round caps at the open ends are simply omitted -- the ribbon
// stops flush at the first/last point) but good enough to keep planting off a
// path/meander corridor, matching the width already used to place tiles.
export function bufferPolylineToPolygon(points, halfWidth) {
  if (points.length < 2 || halfWidth <= 0) return [];
  const pieces = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-9;
    const nx = (-dy / len) * halfWidth, ny = (dx / len) * halfWidth;
    pieces.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
  }
  for (let i = 1; i < points.length - 1; i++) {
    pieces.push(regularPolygon(points[i], halfWidth));
  }
  const geoms = pieces.map((ring) => [ring]);
  return polygonClipping.union(...geoms);
}

// Subtracts the union of `obstaclePolygons` (each a polygon-clipping Polygon or
// MultiPolygon) from `cellPoly` (this app's point-array format). Returns an array
// of point-array polygons -- one per surviving piece, outer ring only. An
// obstacle fully enclosed inside the cell (touching none of its edges) produces a
// hole that's dropped here; the existing draw order (planting cells rendered
// before tiles/centerlines/exclusion hatching) still covers that rare case.
export function differenceCell(cellPoly, obstaclePolygons) {
  if (!obstaclePolygons || obstaclePolygons.length === 0) return [cellPoly];
  const result = polygonClipping.difference([ringFromPoly(cellPoly)], ...obstaclePolygons);
  return result.map((poly) => polyFromRing(poly[0])).filter((poly) => poly.length >= 3);
}
