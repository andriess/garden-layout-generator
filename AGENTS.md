# AGENTS.md

## What this is
Client-only React + Vite SPA for designing garden paving layouts (hex/square/rectangle
tile grids, Voronoi material zones, boundary-aware organic paths, user-placed meander
tracks routed the same way). No backend, no persistence, no tests.

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
- `src/main.jsx` just mounts `<App />`. `src/App.jsx` (~800 lines) holds the single
  `GardenPavingDesigner` component only — all pure geometry/math and small presentational
  pieces have been extracted into `src/lib/` and `src/components/` (see below). Expect to
  edit `App.jsx` for state/handlers/render, and the relevant `src/lib/*.js` module for
  algorithm changes.
- `src/lib/` — pure logic, no React/JSX, imports flow one direction (leaf → dependent):
  - `geometryUtils.js` — leaf module: `mulberry32`/`gaussian` RNG, `polygonBBox`,
    `pointInPoly`, `pointSegDist`, `closestPointOnPolyline`, `signedDistanceToPolygon`,
    `polygonCentroid`, `segmentsIntersect`. Everything else in `src/lib/` depends on this.
  - `constants.js` — theme colors (`PALETTE`, `INK`, `ACCENT`, etc.) and path-width
    constants (`MIN_PEDESTRIAN_WIDTH_MM`, `MIN_TILES_ACROSS`).
  - `tileGrids.js` — hex/square/rectangle tile grid generation (`makeHexGrid`,
    `makeRectGrid`, `hexCorners`, `rectCorners`, ...).
  - `organicPaths.js` — Catmull-Rom smoothing, boundary-aware wobble
    (`makeOrganicPath`), obstacle-avoiding routing (`makeOrganicRoutedPath`), chaining that
    routing across a hand-placed waypoint chain (`makeOrganicMultiWaypointPath`, used for
    meander tracks), snapping a point onto the nearest path/patio (`snapToPathOrPatio`),
    patio blobs (`makePatioBlob`), path-width clamping (`validatePathWidth`), and
    drag-to-shape presets (`squarePolygonFromDrag`, `rectPolygonFromDrag`,
    `circlePolygonFromDrag`).
  - `voronoiZones.js` — bounded Voronoi polygons + Lloyd relaxation via `d3-delaunay`.
- `src/components/ui.jsx` — small presentational subcomponents (`Section`, `Row`, `Stat`,
  `Toggle`, `ShapeButton`, `PlaceButton`, `NumInput`) plus shared inline-style constants
  (`selectStyle`, `tinyInputStyle`, `iconBtnStyle`, `primaryBtnStyle`).
- Inside `App.jsx` (in order): imports from `lib/`/`components/` → state grouped under
  `// --- ... ---` comment headers (garden, tiles, boundary & exclusion zones,
  anchors/connections, forks, meander tracks, zones/organics, scatter, layer toggles) →
  derived geometry via `useMemo` → pointer interaction handlers (click-to-place,
  drag-to-move) → JSX render.
- Rendering is an inline SVG canvas (see `// ---- SVG viewbox / scale ----` section in
  `App.jsx`), not HTML canvas — all shapes are SVG elements driven by computed
  polygon/point arrays.
- Grid/routing math works in millimeters; conversion to SVG viewBox units happens at the
  viewbox/scale section in `App.jsx`, so keep new geometry in mm and convert at the
  render boundary like existing code does.
- When adding new pure math/geometry helpers, put them in the appropriate `src/lib/*.js`
  module (or add a new leaf module) rather than back into `App.jsx`.

## Deployment
- `vite.config.js` sets `base: "./"` intentionally so the build works on GitHub Pages
  project sites (`https://<user>.github.io/<repo>/`) — do not change this to an absolute
  path or hardcode a repo name.
- `.github/workflows/deploy.yml` builds and deploys to GitHub Pages automatically on
  every push to `main` (Pages source = GitHub Actions). No manual deploy steps needed.
