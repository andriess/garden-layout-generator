// ============================================================
// Setting-out reference grid: an origin point + dimensioned row/column lines a
// tiler can measure from on site to locate rows/courses, independent of (but
// aligned to) the tile grid's own orientation and spacing. Pure geometry only,
// same style as tileGrids.js/viewport.js.
// ============================================================
import { polygonBBox } from "./geometryUtils";

export const ORIGIN_CORNERS = ["minXminY", "maxXminY", "minXmaxY", "maxXmaxY"];

const NICE_SPACINGS_MM = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000];

export function originCornerPoint(boundaryPoly, corner) {
  const { xMin, xMax, yMin, yMax } = polygonBBox(boundaryPoly);
  const x = corner === "maxXminY" || corner === "maxXmaxY" ? xMax : xMin;
  const y = corner === "minXmaxY" || corner === "maxXmaxY" ? yMax : yMin;
  return [x, y];
}

// Snaps an arbitrary mm target to the nearest "nice" round spacing a tiler would
// actually want to measure against, rather than an odd derived number.
export function pickNiceSpacingMm(targetMm) {
  if (!Number.isFinite(targetMm) || targetMm <= 0) return NICE_SPACINGS_MM[0];
  let best = NICE_SPACINGS_MM[0], bestDiff = Infinity;
  for (const n of NICE_SPACINGS_MM) {
    const diff = Math.abs(Math.log(n) - Math.log(targetMm));
    if (diff < bestDiff) { bestDiff = diff; best = n; }
  }
  return best;
}

// If native spacing would draw more than maxLines across the boundary's extent,
// thin to every Nth course instead of a solid wall of lines.
export function courseStride(spacingMm, extentMm, maxLines = 40) {
  if (!Number.isFinite(spacingMm) || spacingMm <= 0) return 1;
  const rawCount = extentMm / spacingMm;
  return Math.max(1, Math.ceil(rawCount / maxLines));
}

// Derives axis rotation + row/column spacing directly from the app's tile `geom`
// (see App.jsx). Only rectangle tiles carry real orientation/bond info; hexagon
// and square grids are never rotated, so the setting-out grid mirrors that.
export function deriveSettingOutSpacing(geom) {
  if (!geom) return { axisRotationDeg: 0, rowSpacingMm: 100, colSpacingMm: 100, drawColumns: true };
  if (geom.shape === "hexagon") {
    const spacing = pickNiceSpacingMm(geom.acrossMm);
    return { axisRotationDeg: 0, rowSpacingMm: spacing, colSpacingMm: spacing, drawColumns: true };
  }
  if (geom.shape === "square") {
    return { axisRotationDeg: 0, rowSpacingMm: geom.size, colSpacingMm: geom.size, drawColumns: true };
  }
  // rectangle: a running bond staggers joints by half a tile every other row, so there
  // is no continuous column line to draw honestly -- only row lines are shown.
  return {
    axisRotationDeg: geom.rotationDeg || 0,
    rowSpacingMm: geom.height,
    colSpacingMm: geom.width,
    drawColumns: geom.bond !== "running",
  };
}

function rotate(x, y, cos, sin) {
  return [x * cos - y * sin, x * sin + y * cos];
}

// Builds row/column reference lines in world mm space: rotates the boundary bbox
// into the grid's local (possibly rotated) frame -- same rotation convention as
// rectCorners in tileGrids.js -- lays out evenly spaced lines across that local
// extent (plus a margin so labels sit just past the boundary edge), then rotates
// the line endpoints back to world space.
export function computeSettingOutGrid({
  boundaryPoly, origin, axisRotationDeg = 0, rowSpacingMm, colSpacingMm, drawColumns = true,
  marginMm = 400, maxLines = 40,
}) {
  const a = (axisRotationDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const invCos = Math.cos(-a), invSin = Math.sin(-a);
  const [ox, oy] = origin;

  // world -> local (relative to origin, un-rotated by axisRotationDeg)
  const toLocal = ([x, y]) => rotate(x - ox, y - oy, invCos, invSin);
  // local -> world
  const toWorld = ([lx, ly]) => {
    const [wx, wy] = rotate(lx, ly, cos, sin);
    return [wx + ox, wy + oy];
  };

  const localPts = boundaryPoly.map(toLocal);
  const lxs = localPts.map((p) => p[0]), lys = localPts.map((p) => p[1]);
  const lxMin = Math.min(...lxs, 0) - marginMm, lxMax = Math.max(...lxs, 0) + marginMm;
  const lyMin = Math.min(...lys, 0) - marginMm, lyMax = Math.max(...lys, 0) + marginMm;

  // offset 0 is skipped in both loops below -- the bold xAxis/yAxis lines already
  // mark that position, so a dashed reference line there would just be redundant.
  const rows = [];
  const rowStride = courseStride(rowSpacingMm, lyMax - lyMin, maxLines);
  for (let y = rowSpacingMm, i = 1; y <= lyMax; y += rowSpacingMm, i++) {
    if (i % rowStride === 0) rows.push({ offsetMm: Math.round(y), a: toWorld([lxMin, y]), b: toWorld([lxMax, y]) });
  }
  for (let y = -rowSpacingMm, i = 1; y >= lyMin; y -= rowSpacingMm, i++) {
    if (i % rowStride === 0) rows.push({ offsetMm: Math.round(y), a: toWorld([lxMin, y]), b: toWorld([lxMax, y]) });
  }

  const cols = [];
  if (drawColumns) {
    const colStride = courseStride(colSpacingMm, lxMax - lxMin, maxLines);
    for (let x = colSpacingMm, i = 1; x <= lxMax; x += colSpacingMm, i++) {
      if (i % colStride === 0) cols.push({ offsetMm: Math.round(x), a: toWorld([x, lyMin]), b: toWorld([x, lyMax]) });
    }
    for (let x = -colSpacingMm, i = 1; x >= lxMin; x -= colSpacingMm, i++) {
      if (i % colStride === 0) cols.push({ offsetMm: Math.round(x), a: toWorld([x, lyMin]), b: toWorld([x, lyMax]) });
    }
  }

  return {
    origin,
    axisRotationDeg,
    xAxis: { a: toWorld([lxMin, 0]), b: toWorld([lxMax, 0]) },
    yAxis: { a: toWorld([0, lyMin]), b: toWorld([0, lyMax]) },
    rows,
    cols,
  };
}
