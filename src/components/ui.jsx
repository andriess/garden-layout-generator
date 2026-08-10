// ============================================================
// small presentational helpers used throughout the control rail
// ============================================================
import { Link2, Trash2 } from "lucide-react";
import {
  INK, INK_SOFT, PAPER, PANEL_BORDER, ACCENT,
  ANCHOR_MENU_BUTTON_PX, ANCHOR_MENU_ICON_PX, ANCHOR_MENU_OFFSET_X_PX, ANCHOR_MENU_OFFSET_Y_PX,
} from "../lib/constants";

export function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, borderBottom: `1px solid ${PANEL_BORDER}`, paddingBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
export function Row({ label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: INK_SOFT, marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}
export function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: INK_SOFT, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{value}</div>
    </div>
  );
}
export function Toggle({ label, value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
export function ShapeButton({ active, onClick, label }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "6px 4px", fontSize: 10.5, textTransform: "capitalize", borderRadius: 5,
      border: `1px solid ${active ? ACCENT : PANEL_BORDER}`, background: active ? ACCENT : PAPER, color: active ? PAPER : INK, cursor: "pointer",
    }}>{label}</button>
  );
}
export function PlaceButton({ active, onClick, icon, label, fullWidth }) {
  return (
    <button onClick={onClick} style={{
      flex: fullWidth ? "1 1 100%" : 1, width: fullWidth ? "100%" : undefined,
      padding: "6px 8px", fontSize: 11, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      border: `1px solid ${active ? ACCENT : PANEL_BORDER}`, background: active ? ACCENT : PAPER, color: active ? PAPER : INK, cursor: "pointer",
    }}>{icon}{label}</button>
  );
}
export function NumInput({ value, onChange, step = 1 }) {
  return (
    <input type="number" value={value} step={step} onChange={(e) => onChange(+e.target.value)}
      style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, background: PAPER, color: INK }} />
  );
}
// Small circular action button used by AnchorRadialMenu, rendered inside a foreignObject
// -- fixed screen-px size (via mmPerPx) so it stays a comfortable tap target at any zoom.
function RadialMenuButton({ mmPerPx, offsetXPx, x, y, danger, icon, onClick }) {
  const sizePx = ANCHOR_MENU_BUTTON_PX;
  return (
    <foreignObject
      x={x + offsetXPx * mmPerPx - (sizePx / 2) * mmPerPx}
      y={y - ANCHOR_MENU_OFFSET_Y_PX * mmPerPx - (sizePx / 2) * mmPerPx}
      width={sizePx * mmPerPx}
      height={sizePx * mmPerPx}
      style={{ overflow: "visible" }}
    >
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        style={{
          width: "100%", height: "100%", borderRadius: "50%", display: "flex",
          alignItems: "center", justifyContent: "center", cursor: "pointer",
          border: `${1 * mmPerPx}px solid ${danger ? "#B4483A" : ACCENT}`,
          background: PAPER, color: danger ? "#B4483A" : ACCENT,
          boxShadow: `0 ${1 * mmPerPx}px ${3 * mmPerPx}px rgba(0,0,0,0.18)`, padding: 0,
        }}
      >
        {icon}
      </button>
    </foreignObject>
  );
}

// Radial menu shown next to an anchor after clicking it (idle mode): Link (start the
// connect flow from this anchor) and Delete. Positioned by an mm-space point + mmPerPx,
// same "fixed on-screen size" trick as the length-edit inputs in App.jsx.
export function AnchorRadialMenu({ x, y, mmPerPx, onLink, onDelete }) {
  // lucide's `size` prop becomes a raw SVG width/height inside the foreignObject, which is
  // itself subject to the ambient mm-per-px transform -- scale it explicitly (same as the
  // border/shadow/font-size below) so the icon stays a fixed on-screen size at any zoom.
  const iconPx = ANCHOR_MENU_ICON_PX * mmPerPx;
  return (
    <g>
      <RadialMenuButton mmPerPx={mmPerPx} x={x} y={y} offsetXPx={-ANCHOR_MENU_OFFSET_X_PX}
        icon={<Link2 size={iconPx} />} onClick={onLink} />
      <RadialMenuButton mmPerPx={mmPerPx} x={x} y={y} offsetXPx={ANCHOR_MENU_OFFSET_X_PX}
        danger icon={<Trash2 size={iconPx} />} onClick={onDelete} />
    </g>
  );
}

export const selectStyle = { padding: "5px 6px", fontSize: 11.5, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, background: PAPER, color: INK };
export const tinyInputStyle = { padding: "2px 5px", fontSize: 11, border: `1px solid ${PANEL_BORDER}`, borderRadius: 3, background: PAPER, color: INK };
export const iconBtnStyle = { border: "none", background: "none", cursor: "pointer", color: INK_SOFT, padding: 2, display: "flex" };
export const primaryBtnStyle = { border: "none", background: ACCENT, color: PAPER, fontSize: 12, fontWeight: 600, borderRadius: 5, padding: "7px 10px", cursor: "pointer" };
