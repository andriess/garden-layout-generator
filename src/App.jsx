import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Delaunay } from "d3-delaunay";
import { Plus, Trash2, RefreshCw, Home, Circle as CircleIcon, Square, Link2, Maximize2, Download, Upload, Printer } from "lucide-react";

import {
  PALETTE, INK, INK_SOFT, PAPER, PANEL_BORDER, APP_BG, PLANT_BG, ACCENT,
  HATCH_CELL_MM, HATCH_LINE_MM, PLANTING_DOT_R_MM, PLANTING_ANCHOR_R_MM, PLANTING_ANCHOR_STROKE_MM,
  PLANTING_CELL_STROKE_MM, TILE_STROKE_MM, CENTERLINE_STROKE_MM,
  MEANDER_STROKE_MM, EXCLUSION_STROKE_MM, EXCLUSION_LABEL_FONT_MM, BOUNDARY_STROKE_MM,
  BOUNDARY_DASH_MM, DRAW_PREVIEW_STROKE_MM, DRAW_POINT_R_MM, DRAW_POINT_STROKE_MM,
  CONNECT_PREVIEW_STROKE_MM, ANCHOR_SELECT_RING_R_MM, ANCHOR_SELECT_RING_STROKE_MM,
  ANCHOR_DOOR_HALF_MM, ANCHOR_STROKE_MM, ANCHOR_JUNCTION_SIZE_MM, ANCHOR_PATIO_R_MM,
  ANCHOR_LABEL_OFFSET_MM, ANCHOR_LABEL_FONT_MM, MIN_VIEWPORT_WIDTH_MM, MAX_VIEWPORT_WIDTH_MM,
  LENGTH_LABEL_FONT_PX, LENGTH_INPUT_WIDTH_PX, LENGTH_INPUT_HEIGHT_PX,
  DEFAULT_BOUNDARY_CLEARANCE_MM, MEANDER_REACH_MM,
} from "./lib/constants";
import {
  mulberry32, polygonBBox, pointInPoly, pointSegDist, signedDistanceToPolygon, polygonCentroid,
  polygonEdgeLengths, polylineSegmentLengths, pointAtDistance, closestPointOnPolyline, polygonSignedArea,
} from "./lib/geometryUtils";
import { hexSizeFromPaver, hexCorners, makeHexGrid, squareCorners, rectCorners, makeRectGrid } from "./lib/tileGrids";
import { deriveSettingOutSpacing, originCornerPoint, computeSettingOutGrid } from "./lib/settingOutGrid";
import {
  makeOrganicRoutedPath, makeOrganicMultiWaypointPath, snapToPathOrPatio, validatePathWidth,
  makePatioBlob, sampleAlongPolyline, squarePolygonFromDrag, rectPolygonFromDrag, circlePolygonFromDrag,
} from "./lib/organicPaths";
import { resizeSquareToSide, resizeRectToDims, resizeCircleToDiameter } from "./lib/shapeEdit";
import { boundedVoronoiPolygons, relaxPoints } from "./lib/voronoiZones";
import { ringFromPoly, bufferPolylineToPolygon, differenceCell } from "./lib/polygonBoolean";
import { fitViewportToBBox, matchAspect, zoomViewport, panViewport, clampZoomWidth, scaleLabelForMmPerPx } from "./lib/viewport";
import { serializeBoundary, serializeDesign, downloadJSON, readImportFile, migrateDesignPayload, validateImportPayload, maxIdSuffix } from "./lib/persistence";
import { Section, Row, Stat, Toggle, ShapeButton, PlaceButton, NumInput, AnchorRadialMenu, WaypointRadialMenu, selectStyle, tinyInputStyle, iconBtnStyle, primaryBtnStyle } from "./components/ui";
import { SettingOutOverlay } from "./components/SettingOutOverlay";
import PrintSheet from "./components/PrintSheet";

// ============================================================
// Main component
// ============================================================
let uidCounter = 1;
const nextUid = () => `a${uidCounter++}`;

// UI-chrome sizing (screen pixels, NOT mm) -- selection highlight/handles stay a constant
// on-screen size at any zoom, unlike the true-to-scale mm sizing used for real geometry.
const HIT_TOLERANCE_PX = 8;
const HANDLE_RADIUS_PX = 5;
const HANDLE_STROKE_PX = 2;
const SELECTION_STROKE_PX = 2.5;
const SELECTION_DASH_PX = [8, 5];
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

// Naturalistic planting pockets -- seeded/relaxed the same way the old zone system was, but
// rejecting candidates that land on paved ground so plants only fill the gaps paving left
// behind. Relaxation iterations and the paver clearance margin are fixed rather than exposed
// as sliders (density and clumpiness are the two knobs users actually want to tweak).
const PLANTING_RELAX_ITERS = 2;
const PLANTING_MIN_DOTS_PER_CELL = 2;
const PLANTING_MAX_DOTS_PER_CELL = 10;
const PLANTING_AVG_DOT_AREA_MM2 = 2_000_000; // ~2 m^2 of pocket per dot at clumpiness 1.0

export default function GardenPavingDesigner() {
  // --- garden ---
  const [gardenW, setGardenW] = useState(9000);
  const [gardenH, setGardenH] = useState(6500);
  const marginMm = 300;

  // --- tiles ---
  const [tileShape, setTileShape] = useState("hexagon");
  const [paverAcrossFlats, setPaverAcrossFlats] = useState(200);
  const [paverSize, setPaverSize] = useState(200);
  const [paverWidth, setPaverWidth] = useState(300);
  const [paverHeight, setPaverHeight] = useState(150);
  const [rectBond, setRectBond] = useState("running");
  const [rotationDeg, setRotationDeg] = useState(0);

  // --- garden boundary & exclusion (house) zones -- canvas starts empty; the user draws
  // (or resets to a default rectangle) rather than a shape being seeded for them ---
  const [gardenBoundary, setGardenBoundary] = useState([]);
  const [boundaryShapeKind, setBoundaryShapeKind] = useState("rect"); // "rect" | "freeform" -- drives edge-length editing
  const [exclusionZones, setExclusionZones] = useState([]); // [{id, label, poly, shapeKind}] -- house footprint etc.
  // minimum distance any path/patio outline (and meander track) must keep from the boundary
  // edge -- also doubles as the routing corridor's boundary clearance for concave notches.
  const [boundaryClearanceMm, setBoundaryClearanceMm] = useState(DEFAULT_BOUNDARY_CLEARANCE_MM);

  // --- anchors & connections (also empty by default) ---
  const [anchors, setAnchors] = useState([]);
  const [connections, setConnections] = useState([]);

  // placeMode: null | 'door' | 'patio' | 'draw-patio' | 'draw-square' | 'draw-rect' | 'draw-circle'
  //            | 'draw-boundary' | 'draw-exclusion' | 'draw-exclusion-rect'
  const [placeMode, setPlaceMode] = useState(null);
  const [drawPoints, setDrawPoints] = useState([]); // vertices while freeform-drawing (patio/boundary/exclusion)
  const [shapeDragStart, setShapeDragStart] = useState(null); // drag-to-define presets: square/rect/circle
  const [shapeDragCurrent, setShapeDragCurrent] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [connFrom, setConnFrom] = useState("");
  const [connTo, setConnTo] = useState("");
  const [connWidth, setConnWidth] = useState(400);
  // click-and-drag connect tool: mousedown on an anchor while placeMode === "connect"
  // starts a rubber-band line; releasing over a *different* anchor commits a connection.
  const [connectFromId, setConnectFromId] = useState(null);
  const [connectPreviewPoint, setConnectPreviewPoint] = useState(null);
  // click an anchor (idle mode) to open a small radial menu next to it: Link / Delete
  const [anchorMenuId, setAnchorMenuId] = useState(null);
  // click a meander waypoint (idle mode, track selected) to open a delete-only radial menu
  const [waypointMenu, setWaypointMenu] = useState(null); // { meanderId, index } | null

  // --- vector point editing: select a drawn polygon (boundary / exclusion zone / custom
  // patio shape) by clicking its outline, then drag its vertex handles to reshape it ---
  const [selectedShape, setSelectedShape] = useState(null); // { kind: 'boundary'|'exclusion'|'patio', id }
  const [draggedVertex, setDraggedVertex] = useState(null); // { kind, id, index }

  // --- forks: branch off an existing path at a point, to another anchor ---
  const [forkOnConn, setForkOnConn] = useState(0); // index into connections
  const [forkFrac, setForkFrac] = useState(0.5);
  const [forkTo, setForkTo] = useState("");
  const [forkWidth, setForkWidth] = useState(350);

  // --- meander (desire) tracks: user-placed waypoint chains, routed leg-by-leg with the
  // same organic path algorithm as main paths (makeOrganicMultiWaypointPath) ---
  const [meanderPaths, setMeanderPaths] = useState([]); // [{id, waypoints: [[x,y],...]}]
  const [meanderDensity, setMeanderDensity] = useState(0.55);
  const [meanderClearanceMm, setMeanderClearanceMm] = useState(300);
  const [showMeander, setShowMeander] = useState(true);
  const [meanderSeed, setMeanderSeed] = useState(1);

  // --- paving / organics ---
  const [wobbleMm, setWobbleMm] = useState(450);
  const [seed, setSeed] = useState(7);

  // --- scatter (kept simple/fixed-ish, still exposed) ---
  const [scatterDensity, setScatterDensity] = useState(0.7);
  const [scatterMaxMm, setScatterMaxMm] = useState(700);

  // --- planting: naturalistic pocket fill, computed from the unpaved gaps left after
  // paving is laid out (see the plantingSeeds/plantingCells/plantingDots pipeline below) ---
  const [plantingDensity, setPlantingDensity] = useState(30); // target pocket/seed count
  const [plantingClumpiness, setPlantingClumpiness] = useState(0.5); // 0-1: how many dots fill each pocket

  // --- layer toggles ---
  const [showTiles, setShowTiles] = useState(true);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [showCenterlines, setShowCenterlines] = useState(true);
  const [showPlanting, setShowPlanting] = useState(true);
  const [showPlantingAnchors, setShowPlantingAnchors] = useState(false); // reference dot at each pocket's voronoi seed

  // --- setting-out reference grid: a dimensioned measurement overlay a tiler can use to
  // locate rows/courses on site, independent of the tile grid rendering itself ---
  const [showSettingOutGrid, setShowSettingOutGrid] = useState(false);
  const [settingOutOriginCorner, setSettingOutOriginCorner] = useState("minXminY");

  // --- pan/zoom viewport: an mm-space window into an otherwise infinite canvas, always
  // resized to exactly fill the on-screen canvas element (see the ResizeObserver below) ---
  const [viewport, setViewport] = useState({ x: -5000, y: -5000, w: 10000, h: 10000 });
  const [canvasSize, setCanvasSize] = useState({ w: 1, h: 1 }); // on-screen px size of the canvas element
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // transient (non-persisted) print-lifecycle gate -- mounting PrintSheet only while this
  // is true avoids permanently doubling the tile SVG's DOM node count for large gardens
  const [printPreviewActive, setPrintPreviewActive] = useState(false);
  const panLastRef = useRef(null); // last client {x,y} while a pan gesture is in flight

  const svgRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const importInputRef = useRef(null);

  const hasBoundary = gardenBoundary.length >= 3;
  const mmPerPx = canvasSize.w > 0 ? viewport.w / canvasSize.w : 1;

  // leaving the connect tool, or activating any placement tool, abandons in-progress
  // connect-drags and shape-vertex selection (editing and placing don't mix)
  useEffect(() => {
    if (placeMode !== "connect") {
      setConnectFromId(null);
      setConnectPreviewPoint(null);
    }
    if (placeMode) {
      setSelectedShape(null);
      setDraggedVertex(null);
      setAnchorMenuId(null);
    }
  }, [placeMode]);

  // keep the viewBox's aspect ratio locked to the canvas element's on-screen aspect ratio,
  // so the drawable area always exactly fills the screen with no letterboxing
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setCanvasSize({ w: width, h: height });
        setViewport((prev) => matchAspect(prev, width / height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // spacebar-held is a pan trigger (along with middle/right mouse); ignore it while the
  // user is typing into a text field
  useEffect(() => {
    const isEditable = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
    const onKeyDown = (e) => {
      if (e.key === "Escape") { setAnchorMenuId(null); setWaypointMenu(null); }
      if (e.code === "Space" && !isEditable(document.activeElement)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // triggers the browser's native print dialog once the (otherwise hidden) PrintSheet has
  // mounted and laid out; "afterprint" fires whether the user prints or cancels, so it's
  // also how printPreviewActive gets turned back off again
  useEffect(() => {
    if (!printPreviewActive) return;
    const onAfterPrint = () => setPrintPreviewActive(false);
    window.addEventListener("afterprint", onAfterPrint);
    const raf = requestAnimationFrame(() => window.print());
    return () => {
      window.removeEventListener("afterprint", onAfterPrint);
      cancelAnimationFrame(raf);
    };
  }, [printPreviewActive]);

  // ---- interactions: click-to-place, drag-to-move ----
  // Maps a mouse/touch event to an mm-space point via the SVG's own screen transform, so it
  // stays correct regardless of current pan/zoom or the element's on-screen aspect ratio.
  const svgPointFromEvent = useCallback((evt) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [pt.x, pt.y];
  }, []);

  // wheel-to-zoom, centered on the cursor's mm point -- attached natively (not via React's
  // onWheel) so preventDefault reliably stops the page from scrolling while zooming.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (evt) => {
      evt.preventDefault();
      const pivot = svgPointFromEvent(evt);
      const factor = Math.exp(evt.deltaY * WHEEL_ZOOM_SENSITIVITY);
      setViewport((prev) => {
        const targetW = clampZoomWidth(prev.w * factor, MIN_VIEWPORT_WIDTH_MM, MAX_VIEWPORT_WIDTH_MM);
        const clampedFactor = targetW / prev.w;
        return zoomViewport(prev, clampedFactor, pivot);
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgPointFromEvent]);

  const fitViewToPoints = useCallback((points) => {
    const el = canvasWrapRef.current;
    if (!el || !points || points.length < 3) return;
    const rect = el.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
    setViewport(fitViewportToBBox(polygonBBox(points), aspect));
  }, []);
  const fitView = useCallback(() => {
    if (hasBoundary) fitViewToPoints(gardenBoundary);
  }, [hasBoundary, gardenBoundary, fitViewToPoints]);

  const boundaryBBox = useMemo(
    () => (hasBoundary ? polygonBBox(gardenBoundary) : { xMin: 0, xMax: 0, yMin: 0, yMax: 0 }),
    [gardenBoundary, hasBoundary]
  );

  // ---- tile geometry ----
  const geom = useMemo(() => {
    if (tileShape === "hexagon") {
      const size = hexSizeFromPaver(paverAcrossFlats);
      return { shape: "hexagon", size, acrossMm: paverAcrossFlats };
    } else if (tileShape === "square") {
      return { shape: "square", size: paverSize, acrossMm: paverSize };
    } else {
      return { shape: "rectangle", width: paverWidth, height: paverHeight, rotationDeg, bond: rectBond, acrossMm: Math.min(paverWidth, paverHeight) };
    }
  }, [tileShape, paverAcrossFlats, paverSize, paverWidth, paverHeight, rotationDeg, rectBond]);

  const tileCenters = useMemo(() => {
    if (!hasBoundary) return [];
    let raw;
    if (geom.shape === "hexagon") raw = makeHexGrid(geom.size, gardenBoundary);
    else if (geom.shape === "square") raw = makeRectGrid(geom.size, geom.size, "grid", 0, gardenBoundary);
    else raw = makeRectGrid(geom.width, geom.height, geom.bond, geom.rotationDeg, gardenBoundary);
    // exclude tiles whose center falls inside any marked house/exclusion zone
    if (exclusionZones.length === 0) return raw;
    return raw.filter((pt) => !exclusionZones.some((z) => pointInPoly(pt, z.poly)));
  }, [geom, gardenBoundary, exclusionZones, hasBoundary]);

  const tileCornersFn = useCallback((cx, cy, scale = 0.98) => {
    if (geom.shape === "hexagon") return hexCorners(cx, cy, geom.size * scale);
    if (geom.shape === "square") return squareCorners(cx, cy, geom.size * scale, 0);
    return rectCorners(cx, cy, geom.width * scale, geom.height * scale, geom.rotationDeg);
  }, [geom]);

  // ---- setting-out reference grid: computed unconditionally (not gated on the show
  // toggle) since it's cheap line geometry and the print sheet needs it regardless of the
  // on-screen toggle's state ----
  const settingOutSpec = useMemo(() => deriveSettingOutSpacing(geom), [geom]);
  const settingOutGrid = useMemo(() => {
    if (!hasBoundary) return null;
    const origin = originCornerPoint(gardenBoundary, settingOutOriginCorner);
    return computeSettingOutGrid({ boundaryPoly: gardenBoundary, origin, ...settingOutSpec });
  }, [hasBoundary, gardenBoundary, settingOutOriginCorner, settingOutSpec]);

  // ---- main paths ----
  const rng = useMemo(() => mulberry32(seed * 9973 + 17), [seed]);
  const anchorById = useMemo(() => Object.fromEntries(anchors.map((a) => [a.id, a])), [anchors]);

  const { pathPolys, clampReport, patioBlobs, exclusionWarnings } = useMemo(() => {
    // routing math assumes a real boundary polygon (bbox/ray-casts against it) -- without
    // one there's nowhere valid to route through yet, so just render nothing rather than
    // risk garbage/Infinity geometry from an empty boundary.
    if (!hasBoundary) return { pathPolys: [], clampReport: [], patioBlobs: [], exclusionWarnings: [] };
    const localRng = mulberry32(seed * 9973 + 17);
    const polys = [];
    const report = [];
    const warnings = [];
    for (const c of connections) {
      const a = anchorById[c.a], b = anchorById[c.b];
      if (!a || !b) continue;
      const { clamped, wasClamped, required } = validatePathWidth(c.widthMm, geom.acrossMm);
      const poly = makeOrganicRoutedPath([a.x, a.y], [b.x, b.y], wobbleMm, localRng, gardenBoundary, exclusionZones, boundaryClearanceMm);
      polys.push({ poly, widthMm: clamped, from: a.label, to: b.label });
      report.push({ from: a.label, to: b.label, requestedMm: c.widthMm, usedMm: clamped, requiredMm: required, clamped: wasClamped });
      // flag (not fix) any path whose centerline dips into a marked house/exclusion zone --
      // auto-routing a path around an obstacle is a real pathfinding problem (same class as
      // the meander/fork system), not solved here; this just makes the conflict visible.
      for (const z of exclusionZones) {
        if (poly.some((p) => pointInPoly(p, z.poly))) {
          warnings.push(`${a.label} → ${b.label} crosses "${z.label}"`);
          break;
        }
      }
    }
    const blobs = anchors.filter((a) => a.type === "patio").map((a) => ({
      poly: a.customPolygon && a.customPolygon.length >= 3 ? a.customPolygon : makePatioBlob([a.x, a.y], a.radius || 1000, localRng, 0.24, 16, gardenBoundary, boundaryClearanceMm),
      label: a.label,
    }));
    return { pathPolys: polys, clampReport: report, patioBlobs: blobs, exclusionWarnings: warnings };
  }, [connections, anchorById, wobbleMm, seed, gardenBoundary, geom.acrossMm, anchors, exclusionZones, hasBoundary, boundaryClearanceMm]);

  // ---- tile paving selection: core (on path/patio) + scatter (fringe) ----
  // meander tracks: same organic routing as main paths, chained across the user's own
  // hand-placed waypoints instead of a pair of anchors -- see makeOrganicMultiWaypointPath.
  // computed unconditionally -- showMeander only gates rendering (see the JSX below)
  // and must NOT gate this geometry, since paved's tile tagging and the planting
  // obstacle footprint both need the real track even while it's hidden on screen.
  const meanderTracks = useMemo(() => {
    if (!hasBoundary || meanderPaths.length === 0) return [];
    const localRng = mulberry32(seed * 6089 + 29);
    return meanderPaths
      .filter((m) => m.waypoints.length >= 2)
      .map((m) => makeOrganicMultiWaypointPath(m.waypoints, wobbleMm, localRng, gardenBoundary, exclusionZones, meanderClearanceMm));
  }, [hasBoundary, meanderPaths, gardenBoundary, exclusionZones, meanderClearanceMm, wobbleMm, seed]);

  const paved = useMemo(() => {
    const scatterRng = mulberry32(seed * 7919 + 3);
    const meanderRng = mulberry32(meanderSeed * 3121 + 41);
    const result = [];
    for (const [cx, cy] of tileCenters) {
      let margin = -1e9;
      for (const { poly, widthMm } of pathPolys) {
        for (let k = 0; k < poly.length - 1; k++) {
          const d = pointSegDist([cx, cy], poly[k], poly[k + 1]);
          const m = widthMm / 2 - d;
          if (m > margin) margin = m;
        }
      }
      for (const { poly: patioPoly } of patioBlobs) {
        const m = signedDistanceToPolygon([cx, cy], patioPoly);
        if (m > margin) margin = m;
      }
      let reason = null;
      if (margin > 0) reason = "core";
      else {
        const distOut = -margin;
        if (distOut <= scatterMaxMm) {
          const prob = scatterDensity * (1 - distOut / scatterMaxMm);
          if (scatterRng() < prob) reason = "scatter";
        }
      }
      // meander tiles: sparse/broken, only checked for tiles the main path system didn't
      // already claim -- a real deer-track tile is never guaranteed, always a coin flip
      if (!reason && meanderTracks.length > 0) {
        let bestD = Infinity;
        for (const track of meanderTracks) {
          for (let k = 0; k < track.length - 1; k++) {
            const d = pointSegDist([cx, cy], track[k], track[k + 1]);
            if (d < bestD) bestD = d;
          }
        }
        if (bestD <= MEANDER_REACH_MM && meanderRng() < meanderDensity * (1 - bestD / MEANDER_REACH_MM)) {
          reason = "meander";
        }
      }
      if (reason) result.push({ cx, cy, reason });
    }
    return result;
  }, [tileCenters, pathPolys, patioBlobs, scatterMaxMm, scatterDensity, seed, meanderTracks, meanderDensity, meanderSeed]);

  // ---- planting pockets: naturalistic fill for the ground paving left uncovered ----
  // Nearest-paved-tile lookup, so candidate planting points can reject ones that land on
  // (or right next to) a paver -- same distance-threshold approach as the scatter/meander
  // margins above, just against the paved tile set instead of a path/patio polygon.
  const pavedDelaunay = useMemo(
    () => (paved.length ? Delaunay.from(paved.map((t) => [t.cx, t.cy])) : null),
    [paved]
  );
  const pavedClearanceMm = geom.acrossMm * 0.65;

  const nearPavedTile = useCallback((pt) => {
    if (!pavedDelaunay) return false;
    const t = paved[pavedDelaunay.find(pt[0], pt[1])];
    return Math.hypot(pt[0] - t.cx, pt[1] - t.cy) < pavedClearanceMm;
  }, [pavedDelaunay, paved, pavedClearanceMm]);

  // seed points: rejection-sampled across the boundary (same pattern the old zone seeding
  // used), additionally rejecting anything that landed on paved ground, then Lloyd-relaxed
  // so the pockets end up evenly spread rather than clumped by sampling luck
  const plantingSeeds = useMemo(() => {
    if (!hasBoundary) return [];
    const localRng = mulberry32(seed * 131 + 5);
    const pts = [];
    let attempts = 0;
    while (pts.length < plantingDensity && attempts < plantingDensity * 60) {
      attempts++;
      const cand = [
        boundaryBBox.xMin + localRng() * (boundaryBBox.xMax - boundaryBBox.xMin),
        boundaryBBox.yMin + localRng() * (boundaryBBox.yMax - boundaryBBox.yMin),
      ];
      if (!pointInPoly(cand, gardenBoundary)) continue;
      if (exclusionZones.some((z) => pointInPoly(cand, z.poly))) continue;
      if (nearPavedTile(cand)) continue;
      pts.push(cand);
    }
    return relaxPoints(pts, PLANTING_RELAX_ITERS, boundaryBBox);
  }, [plantingDensity, seed, boundaryBBox, gardenBoundary, exclusionZones, hasBoundary, nearPavedTile]);

  // obstacle footprint for planting cells -- always built from the real geometry
  // (never gated by a show* toggle), so hiding a layer on screen never lets
  // planting grow onto it. Patios/exclusion zones are already closed polygons;
  // paths/meander tracks are centerline + width, buffered into a ribbon polygon.
  const plantingObstaclePolygons = useMemo(() => {
    const polys = [];
    for (const z of exclusionZones) polys.push([ringFromPoly(z.poly)]);
    for (const b of patioBlobs) polys.push([ringFromPoly(b.poly)]);
    for (const p of pathPolys) {
      const buffered = bufferPolylineToPolygon(p.poly, p.widthMm / 2);
      if (buffered.length) polys.push(buffered);
    }
    for (const track of meanderTracks) {
      const buffered = bufferPolylineToPolygon(track, MEANDER_REACH_MM);
      if (buffered.length) polys.push(buffered);
    }
    return polys;
  }, [exclusionZones, patioBlobs, pathPolys, meanderTracks]);

  // each seed's raw bbox-clipped voronoi cell, then exactly clipped away from every
  // obstacle -- an obstacle cutting through the middle of a cell can split it into
  // multiple pieces, so each entry here is an array of polygons, not a single one.
  const plantingCells = useMemo(() => {
    const raw = boundedVoronoiPolygons(plantingSeeds, boundaryBBox);
    return raw.map((poly) => (poly ? differenceCell(poly, plantingObstaclePolygons) : null));
  }, [plantingSeeds, boundaryBBox, plantingObstaclePolygons]);

  // each voronoi cell is one "pocket" -- scatter a handful of small plant dots inside it
  // rather than a single dot per seed, so pockets read as naturalistic drifts/clumps of
  // planting instead of a sparse grid. Dot count scales with the cell's own area (bigger
  // pocket = more dots) and with the user's clumpiness setting (fuller vs. sparser drifts).
  // A clipped cell may be several disjoint pieces (an obstacle cutting through its middle),
  // so the target count is computed from the cell's total area, then split across pieces.
  const plantingDots = useMemo(() => {
    if (!hasBoundary) return [];
    const localRng = mulberry32(seed * 5231 + 13);
    const dots = [];
    for (const pieces of plantingCells) {
      if (!pieces || pieces.length === 0) continue;
      const pieceAreas = pieces.map((poly) => Math.abs(polygonSignedArea(poly)));
      const area = pieceAreas.reduce((s, a) => s + a, 0);
      if (area <= 0) continue;
      const baseline = (area / PLANTING_AVG_DOT_AREA_MM2) * (0.4 + 1.2 * plantingClumpiness);
      const targetCount = Math.max(
        PLANTING_MIN_DOTS_PER_CELL,
        Math.min(PLANTING_MAX_DOTS_PER_CELL, Math.round(baseline))
      );
      for (let pi = 0; pi < pieces.length; pi++) {
        const poly = pieces[pi];
        const pieceTarget = Math.max(1, Math.round(targetCount * (pieceAreas[pi] / area)));
        const cellBBox = polygonBBox(poly);
        let placed = 0, attempts = 0;
        while (placed < pieceTarget && attempts < pieceTarget * 40) {
          attempts++;
          const cand = [
            cellBBox.xMin + localRng() * (cellBBox.xMax - cellBBox.xMin),
            cellBBox.yMin + localRng() * (cellBBox.yMax - cellBBox.yMin),
          ];
          if (!pointInPoly(cand, poly)) continue;
          if (nearPavedTile(cand)) continue;
          dots.push(cand);
          placed++;
        }
      }
    }
    return dots;
  }, [plantingCells, seed, plantingClumpiness, hasBoundary, nearPavedTile]);

  // ---- vector point editing: which polygons are selectable, and hit-testing against them ----
  const editablePolys = useMemo(() => {
    const list = [];
    if (hasBoundary) list.push({ kind: "boundary", id: null, poly: gardenBoundary, shapeKind: boundaryShapeKind });
    for (const z of exclusionZones) list.push({ kind: "exclusion", id: z.id, poly: z.poly, shapeKind: z.shapeKind || "freeform" });
    for (const a of anchors) {
      if (a.type === "patio" && a.customPolygon && a.customPolygon.length >= 3) {
        list.push({ kind: "patio", id: a.id, poly: a.customPolygon, shapeKind: a.shapeKind || "freeform" });
      }
    }
    return list;
  }, [hasBoundary, gardenBoundary, boundaryShapeKind, exclusionZones, anchors]);

  const findShapeNear = useCallback((pt, toleranceMm) => {
    let best = null, bestDist = Infinity;
    for (const shape of editablePolys) {
      const d = Math.abs(signedDistanceToPolygon(pt, shape.poly));
      if (d < bestDist) { bestDist = d; best = shape; }
    }
    return best && bestDist <= toleranceMm ? best : null;
  }, [editablePolys]);

  // meander tracks are open waypoint chains, not closed polygons, so they don't fit
  // editablePolys/findShapeNear (built around signedDistanceToPolygon) -- hit-tested
  // separately against each track's raw hand-placed waypoints.
  const findMeanderNear = useCallback((pt, toleranceMm) => {
    let best = null, bestDist = Infinity;
    for (const m of meanderPaths) {
      if (m.waypoints.length < 2) continue;
      const hit = closestPointOnPolyline(pt, m.waypoints, false);
      if (hit && hit.dist < bestDist) { bestDist = hit.dist; best = m; }
    }
    return best && bestDist <= toleranceMm ? best : null;
  }, [meanderPaths]);

  const selectedShapeData = useMemo(() => {
    if (!selectedShape) return null;
    return editablePolys.find((s) => s.kind === selectedShape.kind && s.id === selectedShape.id) || null;
  }, [selectedShape, editablePolys]);

  // ---- editable edge/diameter length labels for the selected shape -- how many labels and
  // where they sit depends on shapeKind: one side for a square, two (width+height) for a
  // rect, one diameter for a circle, every edge (including the closing one) for freeform ----
  const lengthEditTargets = useMemo(() => {
    if (!selectedShapeData) return [];
    const { poly, shapeKind } = selectedShapeData;
    if (poly.length < 2) return [];
    if (shapeKind === "circle") {
      const bbox = polygonBBox(poly);
      const [cx] = polygonCentroid(poly);
      const diameter = Math.max(bbox.xMax - bbox.xMin, bbox.yMax - bbox.yMin);
      return [{ edgeIndex: null, x: cx, y: bbox.yMin, lengthMm: diameter }];
    }
    const lens = polygonEdgeLengths(poly);
    const edgeTarget = (i) => {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      return { edgeIndex: i, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, lengthMm: lens[i] };
    };
    if (shapeKind === "square") return [edgeTarget(0)];
    if (shapeKind === "rect") return [edgeTarget(0), edgeTarget(1)];
    return lens.map((_, i) => edgeTarget(i)); // freeform: every edge
  }, [selectedShapeData]);

  // writes a resized/reshaped polygon back to whichever state slice owns the selected shape
  const setShapePolygon = useCallback((kind, id, newPoly) => {
    const rounded = newPoly.map(([x, y]) => [Math.round(x), Math.round(y)]);
    if (kind === "boundary") setGardenBoundary(rounded);
    else if (kind === "exclusion") setExclusionZones((prev) => prev.map((z) => (z.id === id ? { ...z, poly: rounded } : z)));
    else if (kind === "patio") {
      setAnchors((prev) => prev.map((a) => {
        if (a.id !== id) return a;
        const [cx, cy] = polygonCentroid(rounded);
        return { ...a, customPolygon: rounded, x: Math.round(cx), y: Math.round(cy) };
      }));
    }
  }, []);

  const commitLengthEdit = useCallback((target, newLenMm) => {
    if (!selectedShapeData || !Number.isFinite(newLenMm) || newLenMm <= 0) return;
    const { kind, id, poly, shapeKind } = selectedShapeData;
    let newPoly;
    if (shapeKind === "circle") newPoly = resizeCircleToDiameter(poly, newLenMm);
    else if (shapeKind === "square") newPoly = resizeSquareToSide(poly, newLenMm);
    else if (shapeKind === "rect") {
      newPoly = target.edgeIndex === 0 ? resizeRectToDims(poly, newLenMm, null) : resizeRectToDims(poly, null, newLenMm);
    } else {
      // freeform: move just the "to" vertex of this one edge along its own direction, so
      // editing one line's length doesn't disturb any other point
      const n = poly.length;
      const toIndex = (target.edgeIndex + 1) % n;
      const newTo = pointAtDistance(poly[target.edgeIndex], poly[toIndex], newLenMm);
      newPoly = poly.map((p, i) => (i === toIndex ? newTo : p));
    }
    setShapePolygon(kind, id, newPoly);
  }, [selectedShapeData, setShapePolygon]);

  // ---- interactions: click-to-place, drag-to-move ----
  const FREEFORM_MODES = ["draw-patio", "draw-boundary", "draw-exclusion", "draw-meander"];
  const SHAPE_PRESET_MODES = ["draw-square", "draw-rect", "draw-circle", "draw-exclusion-rect"];

  const handleCanvasClick = (evt) => {
    if (!placeMode) {
      // idle mode: clicking near a drawn shape's outline (or a meander track's waypoint
      // chain) selects it for vertex editing; clicking empty canvas deselects (and dismisses
      // any open anchor radial menu)
      const [x, y] = svgPointFromEvent(evt);
      const hit = findShapeNear([x, y], HIT_TOLERANCE_PX * mmPerPx);
      const meanderHit = !hit ? findMeanderNear([x, y], HIT_TOLERANCE_PX * mmPerPx) : null;
      setSelectedShape(hit ? { kind: hit.kind, id: hit.id } : meanderHit ? { kind: "meander", id: meanderHit.id } : null);
      setAnchorMenuId(null);
      setWaypointMenu(null);
      return;
    }
    if (placeMode === "connect") {
      // connect tool is click-to-select-source, click-to-select-target -- clicking
      // empty canvas (i.e. not on an anchor, which stops propagation before this fires)
      // cancels whichever anchor is currently selected as the connection source
      setConnectFromId(null);
      setConnectPreviewPoint(null);
      return;
    }
    const [x, y] = svgPointFromEvent(evt);
    if (FREEFORM_MODES.includes(placeMode)) {
      setDrawPoints((prev) => [...prev, [Math.round(x), Math.round(y)]]);
      return;
    }
    if (SHAPE_PRESET_MODES.includes(placeMode)) return; // those are drag-driven, not click-driven
    const id = nextUid();
    const label = placeMode === "patio" ? `patio_${id}` : `door_${id}`;
    const newAnchor = { id, label, type: placeMode, x: Math.round(x), y: Math.round(y), ...(placeMode === "patio" ? { radius: 1000 } : {}) };
    setAnchors((prev) => [...prev, newAnchor]);
    setPlaceMode(null);
  };

  const addPatioFromPolygon = (poly, shapeKind = "freeform") => {
    if (!poly) return null;
    const id = nextUid();
    const rounded = poly.map(([x, y]) => [Math.round(x), Math.round(y)]);
    const [cx, cy] = polygonCentroid(rounded);
    setAnchors((prev) => [...prev, { id, label: `patio_${id}`, type: "patio", x: Math.round(cx), y: Math.round(cy), customPolygon: rounded, shapeKind }]);
    return id;
  };
  const addExclusionFromPolygon = (poly, shapeKind = "freeform") => {
    if (!poly) return null;
    const id = nextUid();
    const rounded = poly.map(([x, y]) => [Math.round(x), Math.round(y)]);
    setExclusionZones((prev) => [...prev, { id, label: `house_${id}`, poly: rounded, shapeKind }]);
    return id;
  };

  // finishes whatever freeform shape is currently being drawn, routing to the right target
  const finishFreeformDraw = () => {
    if (placeMode === "draw-meander" ? drawPoints.length < 2 : drawPoints.length < 3) return;
    if (placeMode === "draw-patio") {
      const newId = addPatioFromPolygon(drawPoints, "freeform");
      if (newId) setSelectedShape({ kind: "patio", id: newId });
    }
    else if (placeMode === "draw-boundary") {
      const rounded = drawPoints.map(([x, y]) => [Math.round(x), Math.round(y)]);
      setGardenBoundary(rounded);
      setBoundaryShapeKind("freeform");
      setSelectedShape({ kind: "boundary", id: null });
      fitViewToPoints(rounded);
    }
    else if (placeMode === "draw-exclusion") {
      const newId = addExclusionFromPolygon(drawPoints, "freeform");
      if (newId) setSelectedShape({ kind: "exclusion", id: newId });
    }
    else if (placeMode === "draw-meander") {
      // start and end always snap onto the nearest main-path centerline or patio outline, so
      // a meander track always reads as branching off something rather than floating free
      const patioPolys = patioBlobs.map((b) => b.poly);
      const lastIdx = drawPoints.length - 1;
      const waypoints = drawPoints.map((p, i) => {
        if (i !== 0 && i !== lastIdx) return p;
        const [sx, sy] = snapToPathOrPatio(p, pathPolys, patioPolys);
        return [Math.round(sx), Math.round(sy)];
      });
      const newId = nextUid();
      setMeanderPaths((prev) => [...prev, { id: newId, waypoints }]);
      setSelectedShape({ kind: "meander", id: newId });
    }
    setDrawPoints([]);
    setPlaceMode(null);
  };
  const removeMeanderPath = (id) => {
    setMeanderPaths((prev) => prev.filter((m) => m.id !== id));
    setSelectedShape((s) => (s && s.kind === "meander" && s.id === id ? null : s));
    setWaypointMenu((w) => (w && w.meanderId === id ? null : w));
  };
  // deletes a single waypoint from a meander track; if that leaves fewer than 2 waypoints
  // the whole track is removed instead (mirrors finishFreeformDraw's >=2-point invariant).
  // deleting an endpoint re-snaps the new endpoint onto the nearest path/patio, same as
  // dragging one does in handlePointerMove.
  const removeWaypoint = (meanderId, index) => {
    setWaypointMenu(null);
    const m = meanderPaths.find((mp) => mp.id === meanderId);
    if (!m) return;
    if (m.waypoints.length <= 2) {
      removeMeanderPath(meanderId);
      return;
    }
    const isEndpoint = index === 0 || index === m.waypoints.length - 1;
    const nextWaypoints = m.waypoints.filter((_, i) => i !== index);
    if (isEndpoint) {
      const endIdx = index === 0 ? 0 : nextWaypoints.length - 1;
      const [sx, sy] = snapToPathOrPatio(nextWaypoints[endIdx], pathPolys, patioBlobs.map((b) => b.poly));
      nextWaypoints[endIdx] = [Math.round(sx), Math.round(sy)];
    }
    setMeanderPaths((prev) => prev.map((mp) => (mp.id === meanderId ? { ...mp, waypoints: nextWaypoints } : mp)));
  };
  const cancelFreeformDraw = () => {
    setDrawPoints([]);
    setPlaceMode(null);
  };
  const resetBoundaryToRect = () => {
    const rect = [
      [marginMm, marginMm], [gardenW - marginMm, marginMm],
      [gardenW - marginMm, gardenH - marginMm], [marginMm, gardenH - marginMm],
    ];
    setGardenBoundary(rect);
    setBoundaryShapeKind("rect");
    setSelectedShape((s) => (s && s.kind === "boundary" ? null : s));
    fitViewToPoints(rect);
  };

  const handleCanvasMouseDown = (evt) => {
    // pan gesture: spacebar-held + left mouse, or middle/right mouse, from anywhere on the
    // canvas -- takes priority over every other tool so it never conflicts with them
    const isPanTrigger = evt.button === 1 || evt.button === 2 || (evt.button === 0 && spaceHeld);
    if (isPanTrigger) {
      evt.preventDefault();
      setIsPanning(true);
      panLastRef.current = { x: evt.clientX, y: evt.clientY };
      return;
    }
    if (!SHAPE_PRESET_MODES.includes(placeMode)) return;
    const pt = svgPointFromEvent(evt);
    setShapeDragStart(pt);
    setShapeDragCurrent(pt);
  };

  const handleAnchorPointerDown = (id) => (evt) => {
    evt.stopPropagation();
    setAnchorMenuId(null); // a drag supersedes any open radial menu
    if (placeMode === "connect") return; // connect tool is click-driven, see handleAnchorClick
    setDragId(id);
  };
  // click on an anchor: in idle mode this opens/closes a small radial menu (Link/Delete)
  // next to the anchor; while the connect tool is active, first click selects the source
  // anchor, a second click on a *different* anchor commits the connection, and clicking
  // the same anchor again cancels the selection. Any other tool (drawing/placing) lets the
  // click fall through unhandled, so e.g. freeform drawing over an anchor still works.
  const handleAnchorClick = (id) => (evt) => {
    if (!placeMode) {
      evt.stopPropagation();
      setAnchorMenuId((prev) => (prev === id ? null : id));
      return;
    }
    if (placeMode !== "connect") return;
    evt.stopPropagation();
    if (!connectFromId) {
      setConnectFromId(id);
      const a = anchorById[id];
      if (a) setConnectPreviewPoint([a.x, a.y]);
      return;
    }
    if (id === connectFromId) {
      setConnectFromId(null);
      setConnectPreviewPoint(null);
      return;
    }
    const already = connections.some(
      (c) => (c.a === connectFromId && c.b === id) || (c.a === id && c.b === connectFromId)
    );
    if (!already) setConnections((prev) => [...prev, { a: connectFromId, b: id, widthMm: connWidth }]);
    setConnectFromId(null);
    setConnectPreviewPoint(null);
  };
  // vertex handle drag -- reshapes whichever polygon is currently selected
  const handleVertexPointerDown = (kind, id, index) => (evt) => {
    evt.stopPropagation();
    setWaypointMenu(null); // a drag supersedes any open waypoint radial menu
    setDraggedVertex({ kind, id, index });
  };
  // click on a meander waypoint handle: opens/closes a delete-only radial menu next to it
  const handleWaypointClick = (meanderId, index) => (evt) => {
    evt.stopPropagation();
    setWaypointMenu((prev) =>
      prev && prev.meanderId === meanderId && prev.index === index ? null : { meanderId, index }
    );
  };
  const handlePointerMove = (evt) => {
    if (isPanning && panLastRef.current) {
      const dxPx = evt.clientX - panLastRef.current.x;
      const dyPx = evt.clientY - panLastRef.current.y;
      panLastRef.current = { x: evt.clientX, y: evt.clientY };
      setViewport((prev) => panViewport(prev, -dxPx * mmPerPx, -dyPx * mmPerPx));
      return;
    }
    if (draggedVertex) {
      const [x, y] = svgPointFromEvent(evt);
      const rx = Math.round(x), ry = Math.round(y);
      const { kind, id, index } = draggedVertex;
      if (kind === "boundary") {
        setGardenBoundary((prev) => prev.map((p, i) => (i === index ? [rx, ry] : p)));
      } else if (kind === "exclusion") {
        setExclusionZones((prev) => prev.map((z) => (z.id === id ? { ...z, poly: z.poly.map((p, i) => (i === index ? [rx, ry] : p)) } : z)));
      } else if (kind === "patio") {
        setAnchors((prev) => prev.map((a) => {
          if (a.id !== id || !a.customPolygon) return a;
          const nextPoly = a.customPolygon.map((p, i) => (i === index ? [rx, ry] : p));
          const [cx, cy] = polygonCentroid(nextPoly);
          return { ...a, customPolygon: nextPoly, x: Math.round(cx), y: Math.round(cy) };
        }));
      } else if (kind === "meander") {
        setMeanderPaths((prev) => prev.map((m) => {
          if (m.id !== id) return m;
          // the start/end waypoint stays snapped to whatever path/patio it's nearest to,
          // even while being dragged around -- interior waypoints move freely
          const isEndpoint = index === 0 || index === m.waypoints.length - 1;
          let point = [rx, ry];
          if (isEndpoint) {
            const [sx, sy] = snapToPathOrPatio([x, y], pathPolys, patioBlobs.map((b) => b.poly));
            point = [Math.round(sx), Math.round(sy)];
          }
          return { ...m, waypoints: m.waypoints.map((p, i) => (i === index ? point : p)) };
        }));
      }
      return;
    }
    if (dragId) {
      const [x, y] = svgPointFromEvent(evt);
      const nx = Math.round(x), ny = Math.round(y);
      setAnchors((prev) => prev.map((a) => {
        if (a.id !== dragId) return a;
        if (a.customPolygon) {
          const dx = nx - a.x, dy = ny - a.y;
          return { ...a, x: nx, y: ny, customPolygon: a.customPolygon.map(([px, py]) => [px + dx, py + dy]) };
        }
        return { ...a, x: nx, y: ny };
      }));
      return;
    }
    if (connectFromId) {
      setConnectPreviewPoint(svgPointFromEvent(evt));
      return;
    }
    if (shapeDragStart) setShapeDragCurrent(svgPointFromEvent(evt));
  };
  const handlePointerUp = () => {
    if (isPanning) { setIsPanning(false); panLastRef.current = null; return; }
    if (draggedVertex) { setDraggedVertex(null); return; }
    if (dragId) { setDragId(null); return; }
    if (shapeDragStart && shapeDragCurrent) {
      let poly = null;
      let shapeKind = null;
      if (placeMode === "draw-square") { poly = squarePolygonFromDrag(shapeDragStart, shapeDragCurrent); shapeKind = "square"; }
      else if (placeMode === "draw-rect") { poly = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent); shapeKind = "rect"; }
      else if (placeMode === "draw-circle") { poly = circlePolygonFromDrag(shapeDragStart, shapeDragCurrent); shapeKind = "circle"; }
      else if (placeMode === "draw-exclusion-rect") { poly = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent); shapeKind = "rect"; }
      if (placeMode === "draw-exclusion-rect") {
        const newId = addExclusionFromPolygon(poly, shapeKind);
        if (newId) setSelectedShape({ kind: "exclusion", id: newId });
      } else {
        const newId = addPatioFromPolygon(poly, shapeKind);
        if (newId) setSelectedShape({ kind: "patio", id: newId });
      }
      setShapeDragStart(null);
      setShapeDragCurrent(null);
      setPlaceMode(null);
    }
  };

  const removeAnchor = (id) => {
    setAnchors((prev) => prev.filter((a) => a.id !== id));
    setConnections((prev) => prev.filter((c) => c.a !== id && c.b !== id));
    setSelectedShape((s) => (s && s.kind === "patio" && s.id === id ? null : s));
    setAnchorMenuId((m) => (m === id ? null : m));
  };
  // radial-menu actions: Link hands off into the existing two-click connect flow, pre-seeded
  // with this anchor as the source; Delete reuses removeAnchor's cascade delete.
  const linkFromAnchorMenu = (id) => {
    const a = anchorById[id];
    if (!a) return;
    setPlaceMode("connect");
    setConnectFromId(id);
    setConnectPreviewPoint([a.x, a.y]);
    setAnchorMenuId(null);
  };
  const removeExclusionZone = (id) => {
    setExclusionZones((prev) => prev.filter((x) => x.id !== id));
    setSelectedShape((s) => (s && s.kind === "exclusion" && s.id === id ? null : s));
  };
  const removeConnection = (idx) => setConnections((prev) => prev.filter((_, i) => i !== idx));
  const addConnection = () => {
    if (!connFrom || !connTo || connFrom === connTo) return;
    setConnections((prev) => [...prev, { a: connFrom, b: connTo, widthMm: connWidth }]);
    setConnFrom(""); setConnTo("");
  };

  const addFork = () => {
    if (!forkTo || connections.length === 0 || forkOnConn >= connections.length) return;
    const basePoly = pathPolys[forkOnConn];
    if (!basePoly) return;
    const [fx, fy] = sampleAlongPolyline(basePoly.poly, forkFrac);
    const forkId = nextUid();
    const forkAnchor = { id: forkId, label: `fork_${forkId}`, type: "junction", x: Math.round(fx), y: Math.round(fy) };
    setAnchors((prev) => [...prev, forkAnchor]);
    setConnections((prev) => [...prev, { a: forkId, b: forkTo, widthMm: forkWidth }]);
    setForkTo("");
  };

  // ---- save / load: export the design (or just the boundary + house/exclusion zones) to
  // a downloadable JSON file, and import one back in to keep editing ----
  const exportDesign = () => {
    downloadJSON(serializeDesign({
      gardenW, gardenH, gardenBoundary, boundaryShapeKind, exclusionZones,
      tileShape, paverAcrossFlats, paverSize, paverWidth, paverHeight, rectBond, rotationDeg,
      anchors, connections,
      meanderPaths, meanderDensity, meanderClearanceMm, showMeander, meanderSeed,
      wobbleMm, seed,
      scatterDensity, scatterMaxMm,
      plantingDensity, plantingClumpiness,
      showTiles, showBoundary, showAnchors, showCenterlines, showPlanting, showPlantingAnchors,
      showSettingOutGrid, settingOutOriginCorner,
    }), `garden-design-${Date.now()}.json`);
  };
  const exportBoundary = () => {
    downloadJSON(serializeBoundary({ gardenW, gardenH, gardenBoundary, boundaryShapeKind, exclusionZones }),
      `garden-boundary-${Date.now()}.json`);
  };

  // importing (either kind of file) abandons any in-progress tool/selection state, since
  // none of it is meaningful against a freshly-swapped-in boundary/design
  const resetTransientToolState = () => {
    setPlaceMode(null);
    setDrawPoints([]);
    setShapeDragStart(null);
    setShapeDragCurrent(null);
    setDragId(null);
    setConnFrom("");
    setConnTo("");
    setConnectFromId(null);
    setConnectPreviewPoint(null);
    setSelectedShape(null);
    setDraggedVertex(null);
    setForkTo("");
  };
  // `uidCounter` is a plain module-level variable (not React state, see top of file) --
  // bumping it here just mutates it directly so ids handed out after an import never
  // collide with ids that came from the imported file.
  const bumpUidCounterPast = (ids) => {
    const next = maxIdSuffix(ids) + 1;
    if (next > uidCounter) uidCounter = next;
  };

  const handleImportFile = async (file) => {
    let payload;
    try {
      payload = await readImportFile(file);
    } catch (err) {
      window.alert(err.message);
      return;
    }
    const { payload: migrated, notes } = migrateDesignPayload(payload);
    payload = migrated;
    const { kind, errors } = validateImportPayload(payload);
    if (!kind || errors.length > 0) {
      window.alert(`Could not import "${file.name}":\n${errors.join("\n")}`);
      return;
    }
    if (kind === "boundary") {
      if (!window.confirm("Import boundary & house/exclusion zones? This replaces the current ones -- the rest of the design (tiles, paths, zones, scatter) is left as-is.")) return;
      setGardenW(payload.gardenW);
      setGardenH(payload.gardenH);
      setGardenBoundary(payload.gardenBoundary);
      setBoundaryShapeKind(payload.boundaryShapeKind);
      setExclusionZones(payload.exclusionZones);
      bumpUidCounterPast(payload.exclusionZones.map((z) => z.id));
    } else {
      const confirmMsg = notes.length > 0
        ? `Import full design? This replaces everything currently on screen.\n\n${notes.join("\n")}`
        : "Import full design? This replaces everything currently on screen.";
      if (!window.confirm(confirmMsg)) return;
      setGardenW(payload.gardenW);
      setGardenH(payload.gardenH);
      setGardenBoundary(payload.gardenBoundary);
      setBoundaryShapeKind(payload.boundaryShapeKind);
      setExclusionZones(payload.exclusionZones);
      setTileShape(payload.tileShape);
      setPaverAcrossFlats(payload.paverAcrossFlats);
      setPaverSize(payload.paverSize);
      setPaverWidth(payload.paverWidth);
      setPaverHeight(payload.paverHeight);
      setRectBond(payload.rectBond);
      setRotationDeg(payload.rotationDeg);
      setAnchors(payload.anchors);
      setConnections(payload.connections);
      setMeanderPaths(payload.meanderPaths);
      setMeanderDensity(payload.meanderDensity);
      setMeanderClearanceMm(payload.meanderClearanceMm);
      setShowMeander(payload.showMeander);
      setMeanderSeed(payload.meanderSeed);
      setWobbleMm(payload.wobbleMm);
      setSeed(payload.seed);
      setScatterDensity(payload.scatterDensity);
      setScatterMaxMm(payload.scatterMaxMm);
      setPlantingDensity(payload.plantingDensity);
      setPlantingClumpiness(payload.plantingClumpiness);
      setShowTiles(payload.showTiles);
      setShowBoundary(payload.showBoundary);
      setShowAnchors(payload.showAnchors);
      setShowCenterlines(payload.showCenterlines);
      setShowPlanting(payload.showPlanting);
      setShowPlantingAnchors(payload.showPlantingAnchors);
      setShowSettingOutGrid(payload.showSettingOutGrid);
      setSettingOutOriginCorner(payload.settingOutOriginCorner);
      bumpUidCounterPast([...payload.exclusionZones.map((z) => z.id), ...payload.anchors.map((a) => a.id), ...payload.meanderPaths.map((m) => m.id)]);
    }
    resetTransientToolState();
    if (payload.gardenBoundary.length >= 3) fitViewToPoints(payload.gardenBoundary);
  };
  const onImportInputChange = (evt) => {
    const file = evt.target.files && evt.target.files[0];
    evt.target.value = ""; // so re-selecting the same filename later still fires onChange
    if (file) handleImportFile(file);
  };

  const totalGardenTiles = tileCenters.length;
  const coreCount = paved.filter((t) => t.reason === "core").length;
  const scatterCount = paved.filter((t) => t.reason === "scatter").length;
  const meanderTileCount = paved.filter((t) => t.reason === "meander").length;

  const labelStyle = { fontSize: 12, fontWeight: 600, color: INK, letterSpacing: "0.02em" };
  const scaleLabel = scaleLabelForMmPerPx(mmPerPx);
  const canvasCursor = isPanning ? "grabbing" : spaceHeld ? "grab" : connectFromId ? "crosshair" : placeMode ? "crosshair" : dragId ? "grabbing" : "default";

  return (
    <>
    <div className="app-shell" style={{ display: "flex", height: "100vh", width: "100%", background: APP_BG, fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: INK }}>
      {/* ---------------- control rail ---------------- */}
      <div style={{ width: 320, minWidth: 320, background: PAPER, borderRight: `1px solid ${PANEL_BORDER}`, overflowY: "auto", padding: "18px 16px" }}>
        <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 20, fontWeight: 700, marginBottom: 2, color: INK }}>
          Garden Paving Designer
        </div>
        <div style={{ fontSize: 11.5, color: INK_SOFT, marginBottom: 18 }}>
          Naturalistic planting · organic paths · live tile layout
        </div>

        <Section title="Save / load">
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 8 }}>
            Export to a JSON file to save your work or share it; import a file later to keep editing.
          </div>
          <button onClick={exportDesign} style={{ ...primaryBtnStyle, width: "100%", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Download size={13} /> Export design
          </button>
          <button onClick={exportBoundary} disabled={!hasBoundary}
            style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, width: "100%", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: hasBoundary ? 1 : 0.4, cursor: hasBoundary ? "pointer" : "not-allowed" }}>
            <Download size={13} /> Export boundary only
          </button>
          <button onClick={() => importInputRef.current && importInputRef.current.click()}
            style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Upload size={13} /> Import JSON…
          </button>
          <input ref={importInputRef} type="file" accept="application/json" onChange={onImportInputChange} style={{ display: "none" }} />
        </Section>

        <Section title="Garden">
          <Row label="Width (mm)"><NumInput value={gardenW} onChange={setGardenW} step={100} /></Row>
          <Row label="Height (mm)"><NumInput value={gardenH} onChange={setGardenH} step={100} /></Row>
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 4 }}>
            {hasBoundary
              ? "Width/height only apply if you use \"Reset to rectangle\" below. Draw a custom outline for an irregular plot, an L-shape, a side passage, etc. Once drawn, click the outline on the canvas to drag its points."
              : "Nothing is drawn yet. Draw a custom outline, or use \"Reset to rectangle\" to start from these dimensions."}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <PlaceButton
              active={placeMode === "draw-boundary"}
              onClick={() => { setDrawPoints([]); setPlaceMode(placeMode === "draw-boundary" ? null : "draw-boundary"); }}
              icon={<Square size={13} />} label="Draw boundary" />
            <button onClick={resetBoundaryToRect} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Reset to rectangle</button>
          </div>
          {placeMode === "draw-boundary" && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: "#F1ECE0", borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 6 }}>
                Click to trace the outline ({drawPoints.length} points, need ≥3). This REPLACES the garden boundary.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={finishFreeformDraw} disabled={drawPoints.length < 3}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: drawPoints.length < 3 ? 0.4 : 1, cursor: drawPoints.length < 3 ? "not-allowed" : "pointer" }}>
                  Finish outline
                </button>
                <button onClick={cancelFreeformDraw} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Cancel</button>
              </div>
            </div>
          )}
          <Row label={`Boundary clearance (${boundaryClearanceMm}mm)`}>
            <input type="range" min={0} max={1500} step={50} value={boundaryClearanceMm}
              onChange={(e) => setBoundaryClearanceMm(+e.target.value)} style={{ width: "100%" }} />
          </Row>
          <div style={{ fontSize: 10, color: INK_SOFT }}>
            Minimum distance paths, patios, and meander tracks must keep from the boundary edge -- they always route around it, never through it.
          </div>
        </Section>

        <Section title="House / exclusions">
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 6 }}>
            Mark parts of the house (or anything else) that must never be paved. Tiles inside are hard-excluded; paths crossing one are flagged, not auto-routed around.
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <PlaceButton active={placeMode === "draw-exclusion-rect"} onClick={() => setPlaceMode(placeMode === "draw-exclusion-rect" ? null : "draw-exclusion-rect")} icon={<Square size={13} />} label="Rect. house" />
            <PlaceButton active={placeMode === "draw-exclusion"} onClick={() => { setDrawPoints([]); setPlaceMode(placeMode === "draw-exclusion" ? null : "draw-exclusion"); }} icon={<Square size={13} />} label="Freeform house" />
          </div>
          {placeMode === "draw-exclusion-rect" && <div style={{ fontSize: 11, color: ACCENT, marginBottom: 8 }}>Click and drag to size the excluded area.</div>}
          {placeMode === "draw-exclusion" && (
            <div style={{ marginBottom: 10, padding: "8px 10px", background: "#F1ECE0", borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 6 }}>
                Click to add points ({drawPoints.length} so far). Needs at least 3.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={finishFreeformDraw} disabled={drawPoints.length < 3}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: drawPoints.length < 3 ? 0.4 : 1, cursor: drawPoints.length < 3 ? "not-allowed" : "pointer" }}>
                  Finish shape
                </button>
                <button onClick={cancelFreeformDraw} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Cancel</button>
              </div>
            </div>
          )}
          {exclusionZones.map((z) => (
            <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: `1px solid ${PANEL_BORDER}` }}>
              <input value={z.label} onChange={(e) => setExclusionZones((prev) => prev.map((x) => (x.id === z.id ? { ...x, label: e.target.value } : x)))} style={{ ...tinyInputStyle, flex: 1 }} />
              <button onClick={() => removeExclusionZone(z.id)} style={iconBtnStyle}><Trash2 size={12} /></button>
            </div>
          ))}
          {exclusionWarnings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {exclusionWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 10.5, color: "#9A4A2B", padding: "2px 0" }}>⚠ {w}</div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Paver">
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {["hexagon", "square", "rectangle"].map((s) => (
              <ShapeButton key={s} active={tileShape === s} onClick={() => setTileShape(s)} label={s} />
            ))}
          </div>
          {tileShape === "hexagon" && (
            <Row label="Across flats (mm)"><NumInput value={paverAcrossFlats} onChange={setPaverAcrossFlats} step={10} /></Row>
          )}
          {tileShape === "square" && (
            <Row label="Side (mm)"><NumInput value={paverSize} onChange={setPaverSize} step={10} /></Row>
          )}
          {tileShape === "rectangle" && (
            <>
              <Row label="Width (mm)"><NumInput value={paverWidth} onChange={setPaverWidth} step={10} /></Row>
              <Row label="Height (mm)"><NumInput value={paverHeight} onChange={setPaverHeight} step={10} /></Row>
              <Row label="Bond">
                <select value={rectBond} onChange={(e) => setRectBond(e.target.value)} style={selectStyle}>
                  <option value="running">Running (brick)</option>
                  <option value="grid">Grid (aligned)</option>
                </select>
              </Row>
              <Row label={`Rotation (${rotationDeg}°)`}>
                <input type="range" min={0} max={90} value={rotationDeg} onChange={(e) => setRotationDeg(+e.target.value)} style={{ width: "100%" }} />
              </Row>
            </>
          )}
        </Section>

        <Section title="Anchors">
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <PlaceButton active={placeMode === "door"} onClick={() => setPlaceMode(placeMode === "door" ? null : "door")} icon={<Home size={13} />} label="Place door" />
            <PlaceButton active={placeMode === "patio"} onClick={() => setPlaceMode(placeMode === "patio" ? null : "patio")} icon={<CircleIcon size={13} />} label="Place patio" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 4 }}>Patio shape presets</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <PlaceButton active={placeMode === "draw-square"} onClick={() => setPlaceMode(placeMode === "draw-square" ? null : "draw-square")} icon={<Square size={13} />} label="Square patio" />
              <PlaceButton active={placeMode === "draw-rect"} onClick={() => setPlaceMode(placeMode === "draw-rect" ? null : "draw-rect")} icon={<Square size={13} />} label="Rect. patio" />
              <PlaceButton active={placeMode === "draw-circle"} onClick={() => setPlaceMode(placeMode === "draw-circle" ? null : "draw-circle")} icon={<CircleIcon size={13} />} label="Circle patio" />
            </div>
            {SHAPE_PRESET_MODES.includes(placeMode) && (
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 8 }}>
                Click and drag on the canvas to size the {placeMode.replace("draw-", "")}.
              </div>
            )}
          </div>
          <div style={{ marginBottom: 10 }}>
            <PlaceButton
              active={placeMode === "draw-patio"}
              onClick={() => { setDrawPoints([]); setPlaceMode(placeMode === "draw-patio" ? null : "draw-patio"); }}
              icon={<CircleIcon size={13} />}
              label="Draw freeform shape"
              fullWidth
            />
          </div>
          {placeMode === "draw-patio" && (
            <div style={{ marginBottom: 10, padding: "8px 10px", background: "#F1ECE0", borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 6 }}>
                Click to add points ({drawPoints.length} so far). Needs at least 3.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={finishFreeformDraw} disabled={drawPoints.length < 3}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: drawPoints.length < 3 ? 0.4 : 1, cursor: drawPoints.length < 3 ? "not-allowed" : "pointer" }}>
                  Finish shape
                </button>
                <button onClick={cancelFreeformDraw} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Cancel</button>
              </div>
            </div>
          )}
          {(placeMode === "door" || placeMode === "patio") && <div style={{ fontSize: 11, color: ACCENT, marginBottom: 8 }}>Click the canvas to place a {placeMode}.</div>}
          {anchors.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: `1px solid ${PANEL_BORDER}` }}>
              {a.type === "door" ? <Square size={11} color={INK} /> : a.type === "junction" ? <span style={{ fontSize: 11 }}>△</span> : <CircleIcon size={11} color={INK} />}
              <input
                value={a.label}
                onChange={(e) => setAnchors((prev) => prev.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)))}
                style={{ ...tinyInputStyle, flex: 1 }}
              />
              {a.customPolygon && <span style={{ fontSize: 9, color: INK_SOFT }}>custom</span>}
              <span style={{ fontSize: 10, color: INK_SOFT, fontFamily: "monospace" }}>{Math.round(a.x)},{Math.round(a.y)}</span>
              <button onClick={() => removeAnchor(a.id)} style={iconBtnStyle}><Trash2 size={12} /></button>
            </div>
          ))}
        </Section>

        <Section title="Paths">
          <div style={{ marginBottom: 10 }}>
            <PlaceButton
              active={placeMode === "connect"}
              onClick={() => setPlaceMode(placeMode === "connect" ? null : "connect")}
              icon={<Link2 size={13} />}
              label="Connect anchors"
              fullWidth
            />
            {placeMode === "connect" && (
              <div style={{ fontSize: 11, color: ACCENT, marginTop: 6 }}>
                {connectFromId
                  ? "Click another anchor to connect (or click it again to cancel)."
                  : "Click an anchor to start a connection."}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center" }}>
            <select value={connFrom} onChange={(e) => setConnFrom(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
              <option value="">from…</option>
              {anchors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <select value={connTo} onChange={(e) => setConnTo(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
              <option value="">to…</option>
              {anchors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            <NumInput value={connWidth} onChange={setConnWidth} step={50} />
            <button onClick={addConnection} style={{ ...primaryBtnStyle, padding: "0 10px" }}><Plus size={13} /></button>
          </div>
          {clampReport.map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, padding: "3px 0", color: c.clamped ? "#9A4A2B" : INK_SOFT }}>
              <span>{c.from} → {c.to}: {Math.round(c.usedMm)}mm{c.clamped ? ` (min ${Math.round(c.requiredMm)})` : ""}</span>
              <button onClick={() => removeConnection(i)} style={iconBtnStyle}><Trash2 size={11} /></button>
            </div>
          ))}
        </Section>

        <Section title="Forks">
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 6 }}>
            Branch a new path off an existing one, at any point along it, to another anchor -- a T-junction, not a 3-way meeting point.
          </div>
          <Row label="On path">
            <select value={forkOnConn} onChange={(e) => setForkOnConn(+e.target.value)} style={{ ...selectStyle, width: "100%" }}>
              {connections.map((c, i) => {
                const fromLabel = anchorById[c.a]?.label || c.a, toLabel = anchorById[c.b]?.label || c.b;
                return <option key={i} value={i}>{fromLabel} → {toLabel}</option>;
              })}
            </select>
          </Row>
          <Row label={`Position along path (${Math.round(forkFrac * 100)}%)`}>
            <input type="range" min={0.05} max={0.95} step={0.01} value={forkFrac} onChange={(e) => setForkFrac(+e.target.value)} style={{ width: "100%" }} />
          </Row>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <select value={forkTo} onChange={(e) => setForkTo(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
              <option value="">connect to…</option>
              {anchors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <NumInput value={forkWidth} onChange={setForkWidth} step={50} />
          </div>
          <button onClick={addFork} disabled={!forkTo || connections.length === 0} style={{ ...primaryBtnStyle, width: "100%", opacity: !forkTo ? 0.4 : 1 }}>
            Add fork
          </button>
        </Section>

        <Section title="Paving">
          <Row label={`Path wobble (${wobbleMm}mm)`}><input type="range" min={0} max={1200} step={50} value={wobbleMm} onChange={(e) => setWobbleMm(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Scatter density (${scatterDensity.toFixed(2)})`}><input type="range" min={0} max={1} step={0.05} value={scatterDensity} onChange={(e) => setScatterDensity(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Scatter reach (${scatterMaxMm}mm)`}><input type="range" min={0} max={1500} step={50} value={scatterMaxMm} onChange={(e) => setScatterMaxMm(+e.target.value)} style={{ width: "100%" }} /></Row>
          <button onClick={() => setSeed((s) => s + 1)} style={{ ...primaryBtnStyle, width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <RefreshCw size={13} /> Reroll layout
          </button>
        </Section>

        <Section title="Planting">
          <Row label={`Planting density (${plantingDensity})`}><input type="range" min={10} max={200} value={plantingDensity} onChange={(e) => setPlantingDensity(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Clumpiness (${plantingClumpiness.toFixed(2)})`}><input type="range" min={0} max={1} step={0.05} value={plantingClumpiness} onChange={(e) => setPlantingClumpiness(+e.target.value)} style={{ width: "100%" }} /></Row>
        </Section>

        <Section title="Meander (desire) tracks">
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 6 }}>
            Informal wandering shortcuts, branching off the main paths -- sparse, broken tiling,
            never a guaranteed solid core. Place waypoints by hand; the start and end always
            snap onto the nearest path centerline or patio outline, routed leg-by-leg the same
            way as a normal path.
          </div>
          <div style={{ marginBottom: 10 }}>
            <PlaceButton
              active={placeMode === "draw-meander"}
              onClick={() => { setDrawPoints([]); setPlaceMode(placeMode === "draw-meander" ? null : "draw-meander"); }}
              icon={<Plus size={13} />}
              label="Place meander path"
              fullWidth
            />
          </div>
          {placeMode === "draw-meander" && (
            <div style={{ marginBottom: 10, padding: "8px 10px", background: "#F1ECE0", borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: ACCENT, marginBottom: 6 }}>
                Click to add waypoints ({drawPoints.length} so far). Needs at least 2 -- start
                and end will snap to the nearest path or patio.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={finishFreeformDraw} disabled={drawPoints.length < 2}
                  style={{ ...primaryBtnStyle, flex: 1, opacity: drawPoints.length < 2 ? 0.4 : 1, cursor: drawPoints.length < 2 ? "not-allowed" : "pointer" }}>
                  Finish path
                </button>
                <button onClick={cancelFreeformDraw} style={{ ...primaryBtnStyle, background: PANEL_BORDER, color: INK, flex: 1 }}>Cancel</button>
              </div>
            </div>
          )}
          {meanderPaths.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: `1px solid ${PANEL_BORDER}` }}>
              <span
                onClick={() => setSelectedShape({ kind: "meander", id: m.id })}
                style={{ fontSize: 10.5, color: INK_SOFT, flex: 1, cursor: "pointer" }}
              >
                {m.waypoints.length} waypoints
              </span>
              <button onClick={() => removeMeanderPath(m.id)} style={iconBtnStyle}><Trash2 size={12} /></button>
            </div>
          ))}
          <Row label={`Stepping density (${meanderDensity.toFixed(2)})`}><input type="range" min={0.1} max={1} step={0.05} value={meanderDensity} onChange={(e) => setMeanderDensity(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Clearance from boundary/houses (${meanderClearanceMm}mm)`}><input type="range" min={150} max={600} step={25} value={meanderClearanceMm} onChange={(e) => setMeanderClearanceMm(+e.target.value)} style={{ width: "100%" }} /></Row>
          <button onClick={() => setMeanderSeed((s) => s + 1)} style={{ ...primaryBtnStyle, width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <RefreshCw size={13} /> Reroll stepping stones
          </button>
        </Section>

        <Section title="Layers">
          <Toggle label="Planting texture" value={showPlanting} onChange={setShowPlanting} />
          <Toggle label="Planting anchors" value={showPlantingAnchors} onChange={setShowPlantingAnchors} />
          <Toggle label="Boundary" value={showBoundary} onChange={setShowBoundary} />
          <Toggle label="Tiles" value={showTiles} onChange={setShowTiles} />
          <Toggle label="Path/patio centerlines" value={showCenterlines} onChange={setShowCenterlines} />
          <Toggle label="Meander tracks" value={showMeander} onChange={setShowMeander} />
          <Toggle label="Anchors" value={showAnchors} onChange={setShowAnchors} />
        </Section>

        <Section title="Setting-out plan">
          <Toggle label="Show reference grid" value={showSettingOutGrid} onChange={setShowSettingOutGrid} />
          <Row label="Origin corner">
            <select style={selectStyle} value={settingOutOriginCorner} onChange={(e) => setSettingOutOriginCorner(e.target.value)}>
              <option value="minXminY">Top-left</option>
              <option value="maxXminY">Top-right</option>
              <option value="minXmaxY">Bottom-left</option>
              <option value="maxXmaxY">Bottom-right</option>
            </select>
          </Row>
          <button onClick={() => setPrintPreviewActive(true)} disabled={!hasBoundary}
            style={{ ...primaryBtnStyle, width: "100%", marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: hasBoundary ? 1 : 0.4, cursor: hasBoundary ? "pointer" : "not-allowed" }}>
            <Printer size={13} /> Print setting-out plan
          </button>
        </Section>

        <div style={{ marginTop: 18, padding: "10px 12px", background: "#F1ECE0", borderRadius: 6, fontSize: 10.5, color: INK_SOFT, lineHeight: 1.5 }}>
          Meander tracks don't auto-route around other paths or patios -- only the boundary and
          house/exclusion zones, same as normal paths. If a track's leg crosses something it
          shouldn't, drag a waypoint (or add another one) to steer around it.
        </div>
      </div>

      {/* ---------------- canvas ---------------- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "10px 18px", borderBottom: `1px solid ${PANEL_BORDER}`, display: "flex", gap: 22, alignItems: "center", background: PAPER }}>
          <Stat label="Paved tiles" value={`${coreCount + scatterCount + meanderTileCount} / ${totalGardenTiles}`} />
          <Stat label="Core" value={coreCount} />
          <Stat label="Scatter" value={scatterCount} />
          <Stat label="Meander" value={`${meanderTileCount} (${meanderPaths.length} tracks)`} />
          <Stat label="Coverage" value={`${totalGardenTiles ? Math.round((100 * (coreCount + scatterCount + meanderTileCount)) / totalGardenTiles) : 0}%`} />
          <div style={{ flex: 1 }} />
          <button onClick={fitView} disabled={!hasBoundary} title="Fit view to boundary"
            style={{ ...iconBtnStyle, opacity: hasBoundary ? 1 : 0.35, cursor: hasBoundary ? "pointer" : "not-allowed" }}>
            <Maximize2 size={15} />
          </button>
        </div>

        <div ref={canvasWrapRef} style={{ flex: 1, position: "relative", overflow: "hidden", background: PLANT_BG }}>
          <svg
            ref={svgRef}
            viewBox={`${viewport.x} ${viewport.y} ${viewport.w} ${viewport.h}`}
            width="100%"
            height="100%"
            style={{ display: "block", touchAction: "none", cursor: canvasCursor }}
            onClick={handleCanvasClick}
            onDoubleClick={() => { if (FREEFORM_MODES.includes(placeMode)) finishFreeformDraw(); }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <defs>
              <clipPath id="gardenClip">
                <polygon points={gardenBoundary.map((p) => p.join(",")).join(" ")} />
              </clipPath>
              <pattern id="hatch" patternUnits="userSpaceOnUse" width={HATCH_CELL_MM} height={HATCH_CELL_MM} patternTransform="rotate(45)">
                <rect width={HATCH_CELL_MM} height={HATCH_CELL_MM} fill="#D9C7BE" />
                <line x1="0" y1="0" x2="0" y2={HATCH_CELL_MM} stroke="#8B3A2B" strokeWidth={HATCH_LINE_MM} opacity={0.5} />
              </pattern>
            </defs>

            <g clipPath="url(#gardenClip)">
              {/* planting pockets: each voronoi cell is the bed for one drift of a single
                  naturalistic-planting species -- the cell polygon itself is the plant area,
                  the stipple dots inside are just ground texture, not individual plants.
                  Cells are geometrically clipped (polygon-clipping's difference) against
                  every obstacle -- patios, paths, meander tracks, exclusion zones -- so an
                  obstacle can split one cell into several pieces, rendered here separately.
                  Still drawn first/underneath the tiles/exclusion hatching below as a
                  fallback for the one case the clip doesn't cover: an obstacle fully
                  enclosed inside a cell, touching none of its edges, comes back as a hole
                  that this per-piece outer-ring rendering can't cut out. */}
              {showPlanting && plantingCells.map((pieces, i) => pieces && pieces.map((poly, j) => poly && poly.length >= 3 && (
                <polygon key={`pc${i}-${j}`} points={poly.map((p) => p.join(",")).join(" ")}
                  fill="#8FA07A" fillOpacity={0.22} stroke="#5F7050" strokeWidth={PLANTING_CELL_STROKE_MM} strokeOpacity={0.55} />
              )))}
              {showPlanting && plantingDots.map(([px, py], i) => (
                <circle key={i} cx={px} cy={py} r={PLANTING_DOT_R_MM} fill="#8FA07A" opacity={0.35} />
              ))}
              {showPlantingAnchors && plantingSeeds.map(([sx, sy], i) => (
                <circle key={`pa${i}`} cx={sx} cy={sy} r={PLANTING_ANCHOR_R_MM} fill="none" stroke={INK_SOFT} strokeWidth={PLANTING_ANCHOR_STROKE_MM} opacity={0.8} />
              ))}

              {showTiles && paved.map((t, i) => (
                <polygon key={i} points={tileCornersFn(t.cx, t.cy).map((p) => p.join(",")).join(" ")}
                  fill={PALETTE[0]} stroke={INK} strokeWidth={TILE_STROKE_MM} opacity={t.reason === "core" ? 1 : 0.92} />
              ))}

              {/* main path/patio centerlines moved INSIDE the clip group -- these are the
                  reference outlines, and without clipping they could visually poke past the
                  true boundary (confirmed: the default patio blob is a jittered circle with
                  no boundary awareness at all, so if its center sits closer to an edge than
                  its jittered radius, the raw shape legitimately extends past the boundary --
                  actual tile placement was never affected since tiles are independently
                  filtered by point-in-polygon, but the outline was misleadingly unclipped) */}
              {showCenterlines && pathPolys.map((p, i) => (
                <polyline key={i} points={p.poly.map((pt) => pt.join(",")).join(" ")} fill="none" stroke="#1F3A52" strokeWidth={CENTERLINE_STROKE_MM} opacity={0.7} strokeLinecap="round" />
              ))}
              {showCenterlines && patioBlobs.map((b, i) => (
                <polygon key={i} points={b.poly.map((p) => p.join(",")).join(" ")} fill="none" stroke="#1F3A52" strokeDasharray="20,14" strokeWidth={CENTERLINE_STROKE_MM} opacity={0.7} />
              ))}
              {showCenterlines && showMeander && meanderTracks.map((track, i) => (
                <polyline key={`m${i}`} points={track.map((pt) => pt.join(",")).join(" ")} fill="none" stroke="#8B3A2B" strokeWidth={MEANDER_STROKE_MM} strokeDasharray="16,10" opacity={0.65} strokeLinecap="round" />
              ))}
            </g>

            {/* house / exclusion zones: hatched, always drawn on top of tiles so the
                'never paved here' area stays visually unambiguous */}
            {exclusionZones.map((z) => (
              <g key={z.id}>
                <polygon points={z.poly.map((p) => p.join(",")).join(" ")} fill="url(#hatch)" stroke="#8B3A2B" strokeWidth={EXCLUSION_STROKE_MM} opacity={0.85} />
                <text x={polygonCentroid(z.poly)[0]} y={polygonCentroid(z.poly)[1]} fontSize={EXCLUSION_LABEL_FONT_MM} fill="#5A2E1E" textAnchor="middle" style={{ userSelect: "none" }}>{z.label}</text>
              </g>
            ))}

            {showBoundary && hasBoundary && (
              <polygon points={gardenBoundary.map((p) => p.join(",")).join(" ")}
                fill="none" stroke="#9C927B" strokeDasharray={`${BOUNDARY_DASH_MM[0]} ${BOUNDARY_DASH_MM[1]}`} strokeWidth={BOUNDARY_STROKE_MM} />
            )}

            {showSettingOutGrid && <SettingOutOverlay grid={settingOutGrid} />}

            {/* selected shape's outline + draggable vertex handles -- handle/stroke sizes are
                screen-pixel constants (via mmPerPx) so they stay grabbable at any zoom */}
            {selectedShapeData && (
              <g>
                <polygon points={selectedShapeData.poly.map((p) => p.join(",")).join(" ")}
                  fill="none" stroke={ACCENT} strokeWidth={SELECTION_STROKE_PX * mmPerPx}
                  strokeDasharray={`${SELECTION_DASH_PX[0] * mmPerPx} ${SELECTION_DASH_PX[1] * mmPerPx}`} />
                {selectedShapeData.poly.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={HANDLE_RADIUS_PX * mmPerPx}
                    fill={PAPER} stroke={ACCENT} strokeWidth={HANDLE_STROKE_PX * mmPerPx}
                    onMouseDown={handleVertexPointerDown(selectedShapeData.kind, selectedShapeData.id, i)}
                    style={{ cursor: "grab" }} />
                ))}
              </g>
            )}

            {/* editable length labels for the selected shape -- one per side/diameter to
                edit, depending on shapeKind (see lengthEditTargets); hidden mid vertex-drag
                so the inputs don't fight with a live reshape */}
            {selectedShapeData && !draggedVertex && lengthEditTargets.map((t, i) => (
              <foreignObject
                key={`${selectedShape.kind}-${selectedShape.id}-${i}`}
                x={t.x - (LENGTH_INPUT_WIDTH_PX / 2) * mmPerPx}
                y={t.y - (LENGTH_INPUT_HEIGHT_PX / 2) * mmPerPx}
                width={LENGTH_INPUT_WIDTH_PX * mmPerPx}
                height={LENGTH_INPUT_HEIGHT_PX * mmPerPx}
                style={{ overflow: "visible" }}
              >
                <input
                  type="number"
                  defaultValue={Math.round(t.lengthMm)}
                  key={Math.round(t.lengthMm)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  onBlur={(e) => commitLengthEdit(t, +e.target.value)}
                  style={{
                    width: "100%", height: "100%", boxSizing: "border-box", textAlign: "center",
                    fontSize: `${LENGTH_LABEL_FONT_PX * mmPerPx}px`, fontFamily: "monospace",
                    border: `${1 * mmPerPx}px solid ${ACCENT}`, borderRadius: `${4 * mmPerPx}px`,
                    background: PAPER, color: INK, padding: 0,
                  }}
                />
              </foreignObject>
            ))}

            {/* selected meander track: raw hand-placed waypoint chain + draggable handles --
                a separate open-polyline analog of the closed-shape block above, since meander
                tracks aren't part of editablePolys/selectedShapeData */}
            {selectedShape?.kind === "meander" && (() => {
              const m = meanderPaths.find((mp) => mp.id === selectedShape.id);
              if (!m) return null;
              return (
                <g>
                  <polyline points={m.waypoints.map((p) => p.join(",")).join(" ")}
                    fill="none" stroke={ACCENT} strokeWidth={SELECTION_STROKE_PX * mmPerPx}
                    strokeDasharray={`${SELECTION_DASH_PX[0] * mmPerPx} ${SELECTION_DASH_PX[1] * mmPerPx}`} />
                  {m.waypoints.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={HANDLE_RADIUS_PX * mmPerPx}
                      fill={PAPER} stroke={ACCENT} strokeWidth={HANDLE_STROKE_PX * mmPerPx}
                      onMouseDown={handleVertexPointerDown("meander", m.id, i)}
                      onClick={handleWaypointClick(m.id, i)}
                      style={{ cursor: "grab" }} />
                  ))}
                  {/* delete-only radial menu -- opened by clicking a waypoint handle above */}
                  {!placeMode && waypointMenu && waypointMenu.meanderId === m.id && m.waypoints[waypointMenu.index] && (
                    <WaypointRadialMenu
                      x={m.waypoints[waypointMenu.index][0]}
                      y={m.waypoints[waypointMenu.index][1]}
                      mmPerPx={mmPerPx}
                      onDelete={() => removeWaypoint(m.id, waypointMenu.index)}
                    />
                  )}
                </g>
              );
            })()}

            {FREEFORM_MODES.includes(placeMode) && drawPoints.length > 0 && (
              <g>
                <polyline
                  points={drawPoints.map((p) => p.join(",")).join(" ")}
                  fill="none" stroke={ACCENT} strokeWidth={DRAW_PREVIEW_STROKE_MM} strokeDasharray="14,8"
                />
                {drawPoints.length >= 3 && (
                  <polygon
                    points={drawPoints.map((p) => p.join(",")).join(" ")}
                    fill={ACCENT} opacity={0.12} stroke="none"
                  />
                )}
                {drawPoints.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={DRAW_POINT_R_MM} fill={ACCENT} stroke={PAPER} strokeWidth={DRAW_POINT_STROKE_MM} />
                ))}
                {/* live, read-only length of each line placed so far -- mouse is still busy
                    clicking points, so editing happens later once the shape is selected */}
                {polylineSegmentLengths(drawPoints).map((len, i) => {
                  const a = drawPoints[i], b = drawPoints[i + 1];
                  return (
                    <text key={i} x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - LENGTH_LABEL_FONT_PX * mmPerPx}
                      fontSize={LENGTH_LABEL_FONT_PX * mmPerPx} fill={ACCENT} textAnchor="middle" style={{ userSelect: "none" }}>
                      {Math.round(len)}
                    </text>
                  );
                })}
              </g>
            )}

            {shapeDragStart && shapeDragCurrent && (() => {
              let preview = null;
              if (placeMode === "draw-square") preview = squarePolygonFromDrag(shapeDragStart, shapeDragCurrent);
              else if (placeMode === "draw-rect") preview = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent);
              else if (placeMode === "draw-circle") preview = circlePolygonFromDrag(shapeDragStart, shapeDragCurrent);
              else if (placeMode === "draw-exclusion-rect") preview = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent);
              if (!preview) return null;
              // live, read-only dimension label(s) -- mouse button is still down, so precise
              // numeric editing only becomes available once the shape is finished and selected
              let labels = [];
              if (placeMode === "draw-square") {
                const lens = polygonEdgeLengths(preview);
                const a = preview[0], b = preview[1];
                labels = [{ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, len: lens[0] }];
              } else if (placeMode === "draw-rect" || placeMode === "draw-exclusion-rect") {
                const lens = polygonEdgeLengths(preview);
                const w0 = preview[0], w1 = preview[1], h0 = preview[1], h1 = preview[2];
                labels = [
                  { x: (w0[0] + w1[0]) / 2, y: (w0[1] + w1[1]) / 2, len: lens[0] },
                  { x: (h0[0] + h1[0]) / 2, y: (h0[1] + h1[1]) / 2, len: lens[1] },
                ];
              } else if (placeMode === "draw-circle") {
                const bbox = polygonBBox(preview);
                const [cx] = polygonCentroid(preview);
                labels = [{ x: cx, y: bbox.yMin, len: bbox.xMax - bbox.xMin }];
              }
              return (
                <g>
                  <polygon points={preview.map((p) => p.join(",")).join(" ")}
                    fill={ACCENT} opacity={0.16} stroke={ACCENT} strokeWidth={DRAW_PREVIEW_STROKE_MM} strokeDasharray="14,8" />
                  {labels.map((l, i) => (
                    <text key={i} x={l.x} y={l.y - LENGTH_LABEL_FONT_PX * mmPerPx}
                      fontSize={LENGTH_LABEL_FONT_PX * mmPerPx} fill={ACCENT} textAnchor="middle" style={{ userSelect: "none" }}>
                      {Math.round(l.len)}
                    </text>
                  ))}
                </g>
              );
            })()}

            {connectFromId && connectPreviewPoint && anchorById[connectFromId] && (
              <line
                x1={anchorById[connectFromId].x} y1={anchorById[connectFromId].y}
                x2={connectPreviewPoint[0]} y2={connectPreviewPoint[1]}
                stroke={ACCENT} strokeWidth={CONNECT_PREVIEW_STROKE_MM} strokeDasharray="14,8" strokeLinecap="round"
              />
            )}

            {showAnchors && anchors.map((a) => (
              <g
                key={a.id}
                onMouseDown={handleAnchorPointerDown(a.id)}
                onClick={handleAnchorClick(a.id)}
                style={{ cursor: placeMode === "connect" ? "crosshair" : "grab" }}
              >
                {connectFromId === a.id && (
                  <circle cx={a.x} cy={a.y} r={ANCHOR_SELECT_RING_R_MM} fill="none" stroke={ACCENT} strokeWidth={ANCHOR_SELECT_RING_STROKE_MM} strokeDasharray="6,5" />
                )}
                {a.type === "door" ? (
                  <rect x={a.x - ANCHOR_DOOR_HALF_MM} y={a.y - ANCHOR_DOOR_HALF_MM} width={ANCHOR_DOOR_HALF_MM * 2} height={ANCHOR_DOOR_HALF_MM * 2}
                    fill={INK} stroke={PAPER} strokeWidth={ANCHOR_STROKE_MM} />
                ) : a.type === "junction" ? (
                  <polygon points={[[0, -1], [0.87, 0.5], [-0.87, 0.5]].map(([dx, dy]) => `${a.x + dx * ANCHOR_JUNCTION_SIZE_MM},${a.y + dy * ANCHOR_JUNCTION_SIZE_MM}`).join(" ")}
                    fill={INK} stroke={PAPER} strokeWidth={ANCHOR_STROKE_MM} />
                ) : (
                  <circle cx={a.x} cy={a.y} r={ANCHOR_PATIO_R_MM} fill={INK} stroke={PAPER} strokeWidth={ANCHOR_STROKE_MM} />
                )}
                <text x={a.x} y={a.y - ANCHOR_LABEL_OFFSET_MM} fontSize={ANCHOR_LABEL_FONT_MM} fill={INK} textAnchor="middle" style={{ userSelect: "none" }}>{a.label}</text>
              </g>
            ))}

            {/* radial action menu -- opened by clicking an anchor while idle (see
                handleAnchorClick); only ever one open at a time */}
            {!placeMode && anchorMenuId && anchorById[anchorMenuId] && (
              <AnchorRadialMenu
                x={anchorById[anchorMenuId].x}
                y={anchorById[anchorMenuId].y}
                mmPerPx={mmPerPx}
                onLink={() => linkFromAnchorMenu(anchorMenuId)}
                onDelete={() => removeAnchor(anchorMenuId)}
              />
            )}
          </svg>

          {/* current drawing scale -- reflects zoom level, like a real scale drawing */}
          <div style={{
            position: "absolute", left: 12, bottom: 12, background: "rgba(251,250,246,0.9)",
            border: `1px solid ${PANEL_BORDER}`, borderRadius: 5, padding: "4px 9px",
            fontSize: 11.5, fontFamily: "monospace", color: INK, pointerEvents: "none",
          }}>
            {scaleLabel}
          </div>

          {/* empty-state hint -- guides the user to draw a boundary before anything else works */}
          {!hasBoundary && !placeMode && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{
                background: PAPER, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: "16px 22px",
                textAlign: "center", pointerEvents: "auto", boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
              }}>
                <div style={{ fontSize: 13, color: INK, marginBottom: 10 }}>Start by drawing your garden's boundary</div>
                <button onClick={() => { setDrawPoints([]); setPlaceMode("draw-boundary"); }} style={primaryBtnStyle}>Draw boundary</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    {printPreviewActive && (
      <PrintSheet
        gardenW={gardenW} gardenH={gardenH} gardenBoundary={gardenBoundary} exclusionZones={exclusionZones}
        paved={paved} tileCornersFn={tileCornersFn} settingOutGrid={settingOutGrid}
        tileShape={tileShape} paverAcrossFlats={paverAcrossFlats} paverSize={paverSize}
        paverWidth={paverWidth} paverHeight={paverHeight} rectBond={rectBond} rotationDeg={rotationDeg}
      />
    )}
    </>
  );
}
