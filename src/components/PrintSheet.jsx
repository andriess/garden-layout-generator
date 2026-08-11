// ============================================================
// A4-landscape-shaped print page for handing a tiler a setting-out plan: title
// block + a standalone SVG drawing (boundary, exclusion zones, tiles, setting-out
// grid). Renders a fixed layer set regardless of the interactive canvas's live
// show*/layer toggles, so the plan a tiler receives is always consistent.
// Presentational only -- no local state, follows the components/ convention.
// ============================================================
import { polygonBBox, polygonCentroid } from "../lib/geometryUtils";
import { fitViewportToBBox, scaleLabelForMmPerPx } from "../lib/viewport";
import {
  PALETTE, INK, EXCLUSION_STROKE_MM, EXCLUSION_LABEL_FONT_MM, TILE_STROKE_MM,
  BOUNDARY_STROKE_MM, BOUNDARY_DASH_MM, HATCH_CELL_MM, HATCH_LINE_MM,
} from "../lib/constants";
import { SettingOutOverlay } from "./SettingOutOverlay";

const MM_PER_CSS_PX = 25.4 / 96;
const PRINT_AREA_WIDTH_MM = 277; // A4 landscape (297mm) minus 10mm margins each side, see print.css @page

function tileSpecSummary({ tileShape, paverAcrossFlats, paverSize, paverWidth, paverHeight, rectBond, rotationDeg }) {
  if (tileShape === "hexagon") return `Hexagon tiles, ${paverAcrossFlats}mm across flats`;
  if (tileShape === "square") return `Square tiles, ${paverSize}×${paverSize}mm`;
  const bondLabel = rectBond === "running" ? "running bond" : "stack (grid) bond";
  return `Rectangle tiles, ${paverWidth}×${paverHeight}mm, ${bondLabel}${rotationDeg ? `, rotated ${rotationDeg}°` : ""}`;
}

export default function PrintSheet({
  gardenW, gardenH, gardenBoundary, exclusionZones, paved, tileCornersFn, settingOutGrid,
  tileShape, paverAcrossFlats, paverSize, paverWidth, paverHeight, rectBond, rotationDeg,
}) {
  if (!gardenBoundary || gardenBoundary.length < 3) return null;

  // independent of the interactive canvas's pan/zoom viewport -- always frames the
  // whole boundary, shaped for an A4 landscape page
  const vb = fitViewportToBBox(polygonBBox(gardenBoundary), 297 / 210, 1.15);
  const scaleLabel = scaleLabelForMmPerPx((vb.w / PRINT_AREA_WIDTH_MM) * MM_PER_CSS_PX);
  const spec = tileSpecSummary({ tileShape, paverAcrossFlats, paverSize, paverWidth, paverHeight, rectBond, rotationDeg });

  return (
    <div className="print-sheet">
      <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
        Setting-out plan
      </div>
      <div style={{ fontSize: 11, color: "#444", marginBottom: 10, lineHeight: 1.5 }}>
        Printed {new Date().toLocaleDateString()} &middot; Garden {gardenW}&times;{gardenH}mm &middot; {spec} &middot; Scale {scaleLabel} (approximate --
        "fit to page" print settings can alter it; use the mm distances marked on the reference grid for on-site measurement instead)
        {tileShape === "rectangle" && rectBond === "running" && (
          <><br />Running bond staggers joints by {Math.round(paverWidth / 2)}mm every other row -- no continuous column reference line is shown for this reason.</>
        )}
      </div>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width="100%" style={{ display: "block" }}>
        <defs>
          <pattern id="printHatch" patternUnits="userSpaceOnUse" width={HATCH_CELL_MM} height={HATCH_CELL_MM} patternTransform="rotate(45)">
            <rect width={HATCH_CELL_MM} height={HATCH_CELL_MM} fill="#D9C7BE" />
            <line x1="0" y1="0" x2="0" y2={HATCH_CELL_MM} stroke="#8B3A2B" strokeWidth={HATCH_LINE_MM} opacity={0.5} />
          </pattern>
        </defs>

        {paved.map((t, i) => (
          <polygon key={i} points={tileCornersFn(t.cx, t.cy).map((p) => p.join(",")).join(" ")}
            fill={PALETTE[t.zoneIdx % PALETTE.length]} stroke={INK} strokeWidth={TILE_STROKE_MM} />
        ))}

        {exclusionZones.map((z) => (
          <g key={z.id}>
            <polygon points={z.poly.map((p) => p.join(",")).join(" ")} fill="url(#printHatch)" stroke="#8B3A2B" strokeWidth={EXCLUSION_STROKE_MM} opacity={0.85} />
            <text x={polygonCentroid(z.poly)[0]} y={polygonCentroid(z.poly)[1]} fontSize={EXCLUSION_LABEL_FONT_MM} fill="#5A2E1E" textAnchor="middle">{z.label}</text>
          </g>
        ))}

        <polygon points={gardenBoundary.map((p) => p.join(",")).join(" ")}
          fill="none" stroke="#9C927B" strokeDasharray={`${BOUNDARY_DASH_MM[0]} ${BOUNDARY_DASH_MM[1]}`} strokeWidth={BOUNDARY_STROKE_MM} />

        <SettingOutOverlay grid={settingOutGrid} />
      </svg>
    </div>
  );
}
