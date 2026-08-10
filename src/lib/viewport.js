// ============================================================
// Pan/zoom viewport math -- a "viewport" is the mm-space window (top-left + size) currently
// shown by the SVG's viewBox. Pure math only: no DOM/React here. The canvas element's
// on-screen pixel size is always passed in by the caller rather than read in this module.
// ============================================================

// Standard CSS reference pixel (96px/inch) used purely to translate a mm-per-screen-pixel
// ratio into a familiar drawing scale label like "1:100". This is an approximation (real
// monitor pixel density varies) shared by most browser-based drawing tools that show a scale.
const MM_PER_CSS_PX = 25.4 / 96; // ~0.2646mm per px at an assumed "1:1"

// Common architectural/landscape drawing scales, used to snap a raw zoom ratio to the
// nearest familiar "1:N" label instead of showing an arbitrary number.
export const NICE_SCALES = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 1250, 2000, 2500, 5000, 10000, 20000];

export function scaleLabelForMmPerPx(mmPerPx) {
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return "1:?";
  const ratio = mmPerPx / MM_PER_CSS_PX; // "1 : ratio"
  let best = NICE_SCALES[0], bestDiff = Infinity;
  for (const n of NICE_SCALES) {
    const diff = Math.abs(Math.log(n) - Math.log(ratio));
    if (diff < bestDiff) { bestDiff = diff; best = n; }
  }
  return `1:${best}`;
}

// Keep width + center fixed, resize height to match the container's aspect ratio (w/h) --
// this is what lets the viewBox always exactly fill the screen with no letterboxing, and
// gets re-applied whenever the window/panel is resized.
export function matchAspect(viewport, aspect) {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return viewport;
  const cx = viewport.x + viewport.w / 2;
  const cy = viewport.y + viewport.h / 2;
  const h = viewport.w / aspect;
  return { x: viewport.x, y: cy - h / 2, w: viewport.w, h };
}

// Zoom by `factor` (values <1 zoom in, >1 zoom out) keeping the given mm point fixed on
// screen -- i.e. classic "zoom toward the cursor" behavior.
export function zoomViewport(viewport, factor, pivot) {
  const [px, py] = pivot;
  const w = viewport.w * factor;
  const h = viewport.h * factor;
  const x = px - (px - viewport.x) * factor;
  const y = py - (py - viewport.y) * factor;
  return { x, y, w, h };
}

export function panViewport(viewport, dxMm, dyMm) {
  return { ...viewport, x: viewport.x + dxMm, y: viewport.y + dyMm };
}

export function clampZoomWidth(w, minW, maxW) {
  return Math.min(Math.max(w, minW), maxW);
}

// Frame a bounding box with some breathing room, growing (never cropping) to match the
// container's aspect ratio.
export function fitViewportToBBox(bbox, aspect, marginFactor = 1.25) {
  const w = Math.max(bbox.xMax - bbox.xMin, 1);
  const h = Math.max(bbox.yMax - bbox.yMin, 1);
  const cx = (bbox.xMin + bbox.xMax) / 2;
  const cy = (bbox.yMin + bbox.yMax) / 2;
  let vw = w * marginFactor;
  let vh = h * marginFactor;
  const a = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : vw / vh;
  if (vw / vh > a) vh = vw / a;
  else vw = vh * a;
  return { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh };
}
