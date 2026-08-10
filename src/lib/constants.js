// ============================================================
// Palette -- carried over from the earlier static-render prototype
// so the tool and its output stay visually consistent.
// ============================================================
export const PALETTE = ["#C9A574", "#6B7A80", "#BE6A47", "#7C8A63", "#D9CFB8", "#565349"];
export const INK = "#3A362E";
export const INK_SOFT = "#6B6152";
export const PAPER = "#FBFAF6";
export const PANEL_BORDER = "#DCD5C4";
export const APP_BG = "#E4E0D3";
export const PLANT_BG = "#DCE0CC";
export const ACCENT = "#BE6A47";

// ============================================================
// Path width validation
// ============================================================
export const MIN_PEDESTRIAN_WIDTH_MM = 400;
export const MIN_TILES_ACROSS = 2;

// ============================================================
// Boundary repulsion -- default minimum distance any path/patio outline must keep from the
// garden boundary edge (also used as the fallback when routing around a concave boundary
// notch). User-adjustable via the "Boundary clearance" slider; this is just the initial value.
// ============================================================
export const DEFAULT_BOUNDARY_CLEARANCE_MM = 300;

// ============================================================
// Rendering sizes -- fixed real-world (mm) sizes for on-canvas elements, so line weights
// and markers stay true to scale and don't change apparent screen size as the user zooms
// (matching how a real scale drawing behaves). UI-only chrome (selection highlight, vertex
// drag handles) is deliberately NOT in here -- those size themselves from screen pixels in
// App.jsx so they stay grabbable/visible at any zoom level instead.
// ============================================================
export const HATCH_CELL_MM = 160;
export const HATCH_LINE_MM = 22;
export const PLANTING_DOT_R_MM = 12;
export const TILE_STROKE_MM = 5;
export const CENTERLINE_STROKE_MM = 12;
export const MEANDER_STROKE_MM = 8;
export const EXCLUSION_STROKE_MM = 12;
export const EXCLUSION_LABEL_FONT_MM = 100;
export const BOUNDARY_STROKE_MM = 14;
export const BOUNDARY_DASH_MM = [55, 45];
export const DRAW_PREVIEW_STROKE_MM = 14;
export const DRAW_POINT_R_MM = 45;
export const DRAW_POINT_STROKE_MM = 12;
export const CONNECT_PREVIEW_STROKE_MM = 16;
export const ANCHOR_SELECT_RING_R_MM = 150;
export const ANCHOR_SELECT_RING_STROKE_MM = 16;
export const ANCHOR_DOOR_HALF_MM = 80;
export const ANCHOR_STROKE_MM = 14;
export const ANCHOR_JUNCTION_SIZE_MM = 100;
export const ANCHOR_PATIO_R_MM = 80;
export const ANCHOR_LABEL_OFFSET_MM = 150;
export const ANCHOR_LABEL_FONT_MM = 100;

// ============================================================
// Viewport (pan/zoom) bounds, mm -- how far the user can zoom in/out.
// ============================================================
export const MIN_VIEWPORT_WIDTH_MM = 300; // ~1:1 close-up
export const MAX_VIEWPORT_WIDTH_MM = 300000; // ~300m wide

// ============================================================
// Edge/diameter length labels & inputs (drawn-shape length editing) -- screen-px constants
// like the vertex-handle sizing above, so the label/input stays a fixed on-screen size
// (readable, clickable) at any zoom level rather than scaling with the mm geometry.
// ============================================================
export const LENGTH_LABEL_FONT_PX = 11;
export const LENGTH_INPUT_WIDTH_PX = 64;
export const LENGTH_INPUT_HEIGHT_PX = 20;

// ============================================================
// Anchor radial action menu (click an anchor -> Link/Delete buttons) -- screen-px
// constants, same reasoning as the length-edit block above: fixed on-screen size at any
// zoom, converted to mm via mmPerPx at the point of use.
// ============================================================
export const ANCHOR_MENU_BUTTON_PX = 26;
export const ANCHOR_MENU_ICON_PX = 13;
export const ANCHOR_MENU_OFFSET_X_PX = 22;
export const ANCHOR_MENU_OFFSET_Y_PX = 28;
