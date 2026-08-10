# AGENTS.md

## What this is
Client-only React + Vite SPA for designing garden paving layouts (hex/square/rectangle
tile grids, Voronoi material zones, boundary-aware organic paths, A*-routed meander
tracks that avoid house/exclusion polygons). No backend, no persistence, no tests.

## Commands
```bash
npm install
npm run dev       # Vite dev server
npm run build     # production build -> dist/
npm run preview   # preview the dist/ build
```
There is no lint, typecheck, or test script configured (no eslint/vitest/jest in
package.json) — don't assume one exists or invent a command for it.

## Architecture
- Almost the entire app lives in `src/App.jsx` (~1600 lines, single component).
  `src/main.jsx` just mounts `<App />`. Expect to edit one big file, not a component tree.
- Layout inside `App.jsx` (in order): pure geometry/math helpers (hex/square/rect grid
  generation, Catmull-Rom smoothing, obstacle-avoiding path routing, clearance-grid A*
  search for meander tracks, bounded Voronoi via `d3-delaunay`) → the `App` component
  with state grouped under `// --- ... ---` comment headers (garden, tiles, boundary &
  exclusion zones, anchors/connections, forks, meander tracks, zones/organics, scatter,
  layer toggles) → derived geometry/render logic → pointer interaction handlers
  (click-to-place, drag-to-move) → small presentational subcomponents at the bottom
  (`Section`, `Row`, `Stat`, `Toggle`, `ShapeButton`, `PlaceButton`, `NumInput`).
- Rendering is an inline SVG canvas (see `// ---- SVG viewbox / scale ----` section),
  not HTML canvas — all shapes are SVG elements driven by computed polygon/point arrays.
- Grid/routing math works in millimeters; conversion to SVG viewBox units happens at the
  viewbox/scale section, so keep new geometry in mm and convert at the render boundary
  like existing code does.

## Deployment
- `vite.config.js` sets `base: "./"` intentionally so the build works on GitHub Pages
  project sites (`https://<user>.github.io/<repo>/`) — do not change this to an absolute
  path or hardcode a repo name.
- `.github/workflows/deploy.yml` builds and deploys to GitHub Pages automatically on
  every push to `main` (Pages source = GitHub Actions). No manual deploy steps needed.
