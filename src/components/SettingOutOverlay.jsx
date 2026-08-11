// ============================================================
// Renders a computeSettingOutGrid() result as SVG: dashed row/column reference
// lines with mm offset labels, plus bold axes and an origin marker. Shared
// between the interactive canvas and the print sheet so both stay identical.
// ============================================================
import {
  SETTING_OUT_COLOR, SETTING_OUT_AXIS_STROKE_MM, SETTING_OUT_LINE_STROKE_MM,
  SETTING_OUT_LINE_DASH_MM, SETTING_OUT_LABEL_FONT_MM, SETTING_OUT_ORIGIN_R_MM,
} from "../lib/constants";

export function SettingOutOverlay({ grid }) {
  if (!grid) return null;
  const dash = SETTING_OUT_LINE_DASH_MM.join(",");
  return (
    <g pointerEvents="none">
      {grid.rows.map((r, i) => (
        <g key={`row${i}`}>
          <line x1={r.a[0]} y1={r.a[1]} x2={r.b[0]} y2={r.b[1]} stroke={SETTING_OUT_COLOR}
            strokeWidth={SETTING_OUT_LINE_STROKE_MM} strokeDasharray={dash} opacity={0.55} />
          <text x={r.b[0]} y={r.b[1]} fontSize={SETTING_OUT_LABEL_FONT_MM} fill={SETTING_OUT_COLOR} opacity={0.85}>{r.offsetMm}</text>
        </g>
      ))}
      {grid.cols.map((c, i) => (
        <g key={`col${i}`}>
          <line x1={c.a[0]} y1={c.a[1]} x2={c.b[0]} y2={c.b[1]} stroke={SETTING_OUT_COLOR}
            strokeWidth={SETTING_OUT_LINE_STROKE_MM} strokeDasharray={dash} opacity={0.55} />
          <text x={c.b[0]} y={c.b[1]} fontSize={SETTING_OUT_LABEL_FONT_MM} fill={SETTING_OUT_COLOR} opacity={0.85}>{c.offsetMm}</text>
        </g>
      ))}
      <line x1={grid.xAxis.a[0]} y1={grid.xAxis.a[1]} x2={grid.xAxis.b[0]} y2={grid.xAxis.b[1]}
        stroke={SETTING_OUT_COLOR} strokeWidth={SETTING_OUT_AXIS_STROKE_MM} />
      <line x1={grid.yAxis.a[0]} y1={grid.yAxis.a[1]} x2={grid.yAxis.b[0]} y2={grid.yAxis.b[1]}
        stroke={SETTING_OUT_COLOR} strokeWidth={SETTING_OUT_AXIS_STROKE_MM} />
      <circle cx={grid.origin[0]} cy={grid.origin[1]} r={SETTING_OUT_ORIGIN_R_MM} fill={SETTING_OUT_COLOR} />
    </g>
  );
}
