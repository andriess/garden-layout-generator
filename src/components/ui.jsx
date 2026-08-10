// ============================================================
// small presentational helpers used throughout the control rail
// ============================================================
import { INK, INK_SOFT, PAPER, PANEL_BORDER, ACCENT } from "../lib/constants";

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
export const selectStyle = { padding: "5px 6px", fontSize: 11.5, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, background: PAPER, color: INK };
export const tinyInputStyle = { padding: "2px 5px", fontSize: 11, border: `1px solid ${PANEL_BORDER}`, borderRadius: 3, background: PAPER, color: INK };
export const iconBtnStyle = { border: "none", background: "none", cursor: "pointer", color: INK_SOFT, padding: 2, display: "flex" };
export const primaryBtnStyle = { border: "none", background: ACCENT, color: PAPER, fontSize: 12, fontWeight: 600, borderRadius: 5, padding: "7px 10px", cursor: "pointer" };
