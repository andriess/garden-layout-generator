// ============================================================
// Resize helpers for the editable drawn-shape length labels. Each one takes the shape's
// *current* polygon plus a new length (mm) and returns a brand-new polygon -- always
// recomputed cleanly from the current center/centroid rather than trying to nudge existing
// points, so a shape that was previously hand-distorted via vertex-dragging snaps back to
// a clean square/rect/circle the moment its length is edited (an intentional, useful side
// effect: editing a length re-asserts that shape's geometry).
// ============================================================
import { polygonBBox, polygonCentroid } from "./geometryUtils";

// square: keeps the current center, rebuilds an axis-aligned square with the given side.
export function resizeSquareToSide(poly, newSideMm) {
  const bbox = polygonBBox(poly);
  const cx = (bbox.xMin + bbox.xMax) / 2, cy = (bbox.yMin + bbox.yMax) / 2;
  const half = Math.max(newSideMm, 1) / 2;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}

// rect: keeps the current center, rebuilds an axis-aligned rect. Pass null/undefined for
// whichever dimension should stay unchanged.
export function resizeRectToDims(poly, newWidthMm, newHeightMm) {
  const bbox = polygonBBox(poly);
  const cx = (bbox.xMin + bbox.xMax) / 2, cy = (bbox.yMin + bbox.yMax) / 2;
  const w = Math.max(newWidthMm ?? (bbox.xMax - bbox.xMin), 1);
  const h = Math.max(newHeightMm ?? (bbox.yMax - bbox.yMin), 1);
  const hw = w / 2, hh = h / 2;
  return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
}

// circle: keeps the current centroid, regenerates the same point-count regular polygon at
// the new radius (diameter / 2).
export function resizeCircleToDiameter(poly, newDiameterMm) {
  const [cx, cy] = polygonCentroid(poly);
  const r = Math.max(newDiameterMm, 1) / 2;
  const n = poly.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
