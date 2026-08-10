// ============================================================
// Geometry: tiles (hexagon / square / rectangle grids)
// ============================================================
import { polygonBBox, pointInPoly } from "./geometryUtils";

export function hexSizeFromPaver(acrossFlatsMm) {
  return acrossFlatsMm / Math.sqrt(3); // circumradius, mm
}

export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}

export function makeHexGrid(size, boundaryPoly) {
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

export function squareCorners(cx, cy, size, rotDeg) {
  return rectCorners(cx, cy, size, size, rotDeg);
}

export function rectCorners(cx, cy, width, height, rotDeg = 0) {
  const hw = width / 2, hh = height / 2;
  let local = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  if (rotDeg) {
    const a = (rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    local = local.map(([x, y]) => [x * c - y * s, y * c + x * s]);
  }
  return local.map(([x, y]) => [x + cx, y + cy]);
}

export function makeRectGrid(width, height, bond, rotDeg, boundaryPoly) {
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
