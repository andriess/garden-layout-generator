// ============================================================
// Voronoi zones (mirror-point rectangle clip + Lloyd relaxation)
// ============================================================
import { Delaunay } from "d3-delaunay";
import { polygonCentroid } from "./geometryUtils";

export function boundedVoronoiPolygons(points, bounds) {
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

export function relaxPoints(points, iters, bounds) {
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
