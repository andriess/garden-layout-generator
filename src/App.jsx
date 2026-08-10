import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Delaunay } from "d3-delaunay";
import { Plus, Trash2, RefreshCw, Home, Circle as CircleIcon, Square, Link2 } from "lucide-react";

import { PALETTE, INK, INK_SOFT, PAPER, PANEL_BORDER, APP_BG, PLANT_BG, ACCENT } from "./lib/constants";
import { mulberry32, polygonBBox, pointInPoly, pointSegDist, signedDistanceToPolygon, polygonCentroid } from "./lib/geometryUtils";
import { hexSizeFromPaver, hexCorners, makeHexGrid, squareCorners, rectCorners, makeRectGrid } from "./lib/tileGrids";
import { makeOrganicRoutedPath, makePatioBlob, sampleAlongPolyline, squarePolygonFromDrag, rectPolygonFromDrag, circlePolygonFromDrag } from "./lib/organicPaths";
import { boundedVoronoiPolygons, relaxPoints } from "./lib/voronoiZones";
import { generateMeanderTracks, validatePathWidth } from "./lib/meanderTracks";
import { Section, Row, Stat, Toggle, ShapeButton, PlaceButton, NumInput, selectStyle, tinyInputStyle, iconBtnStyle, primaryBtnStyle } from "./components/ui";

// ============================================================
// Main component
// ============================================================
let uidCounter = 1;
const nextUid = () => `a${uidCounter++}`;

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

  // --- garden boundary & exclusion (house) zones ---
  const [gardenBoundary, setGardenBoundary] = useState(() => [
    [marginMm, marginMm], [gardenW - marginMm, marginMm],
    [gardenW - marginMm, gardenH - marginMm], [marginMm, gardenH - marginMm],
  ]);
  const [exclusionZones, setExclusionZones] = useState([]); // [{id, label, poly}] -- house footprint etc.

  // --- anchors & connections ---
  const [anchors, setAnchors] = useState(() => [
    { id: "back_door", label: "back_door", type: "door", x: 900, y: 900 },
    { id: "side_gate", label: "side_gate", type: "door", x: 8300, y: 1600 },
    { id: "front_exit", label: "front_exit", type: "door", x: 800, y: 5900 },
    { id: "patio", label: "patio", type: "patio", x: 3200, y: 4600, radius: 1000 },
  ]);
  const [connections, setConnections] = useState(() => [
    { a: "back_door", b: "patio", widthMm: 400 },
    { a: "patio", b: "side_gate", widthMm: 400 },
    { a: "patio", b: "front_exit", widthMm: 400 },
  ]);

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

  // --- forks: branch off an existing path at a point, to another anchor ---
  const [forkOnConn, setForkOnConn] = useState(0); // index into connections
  const [forkFrac, setForkFrac] = useState(0.5);
  const [forkTo, setForkTo] = useState("");
  const [forkWidth, setForkWidth] = useState(350);

  // --- meander (desire) tracks ---
  const [meanderCount, setMeanderCount] = useState(3);
  const [meanderDensity, setMeanderDensity] = useState(0.55);
  const [meanderClearanceMm, setMeanderClearanceMm] = useState(300);
  const [showMeander, setShowMeander] = useState(true);
  const [meanderSeed, setMeanderSeed] = useState(1);

  // --- zones / organics ---
  const [zoneCount, setZoneCount] = useState(30);
  const [relaxIters, setRelaxIters] = useState(1);
  const [wobbleMm, setWobbleMm] = useState(450);
  const [seed, setSeed] = useState(7);

  // --- scatter (kept simple/fixed-ish, still exposed) ---
  const [scatterDensity, setScatterDensity] = useState(0.7);
  const [scatterMaxMm, setScatterMaxMm] = useState(700);

  // --- layer toggles ---
  const [showZones, setShowZones] = useState(true);
  const [showTiles, setShowTiles] = useState(true);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [showCenterlines, setShowCenterlines] = useState(true);
  const [showPlanting, setShowPlanting] = useState(true);

  const svgRef = useRef(null);

  // leaving the connect tool (switching to any other tool) should abandon an in-progress drag
  useEffect(() => {
    if (placeMode !== "connect") {
      setConnectFromId(null);
      setConnectPreviewPoint(null);
    }
  }, [placeMode]);

  const boundaryBBox = useMemo(() => polygonBBox(gardenBoundary), [gardenBoundary]);

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
    let raw;
    if (geom.shape === "hexagon") raw = makeHexGrid(geom.size, gardenBoundary);
    else if (geom.shape === "square") raw = makeRectGrid(geom.size, geom.size, "grid", 0, gardenBoundary);
    else raw = makeRectGrid(geom.width, geom.height, geom.bond, geom.rotationDeg, gardenBoundary);
    // exclude tiles whose center falls inside any marked house/exclusion zone
    if (exclusionZones.length === 0) return raw;
    return raw.filter((pt) => !exclusionZones.some((z) => pointInPoly(pt, z.poly)));
  }, [geom, gardenBoundary, exclusionZones]);

  const tileCornersFn = useCallback((cx, cy, scale = 0.98) => {
    if (geom.shape === "hexagon") return hexCorners(cx, cy, geom.size * scale);
    if (geom.shape === "square") return squareCorners(cx, cy, geom.size * scale, 0);
    return rectCorners(cx, cy, geom.width * scale, geom.height * scale, geom.rotationDeg);
  }, [geom]);

  // ---- main paths ----
  const rng = useMemo(() => mulberry32(seed * 9973 + 17), [seed]);
  const anchorById = useMemo(() => Object.fromEntries(anchors.map((a) => [a.id, a])), [anchors]);

  const { pathPolys, clampReport, patioBlobs, exclusionWarnings } = useMemo(() => {
    const localRng = mulberry32(seed * 9973 + 17);
    const polys = [];
    const report = [];
    const warnings = [];
    for (const c of connections) {
      const a = anchorById[c.a], b = anchorById[c.b];
      if (!a || !b) continue;
      const { clamped, wasClamped, required } = validatePathWidth(c.widthMm, geom.acrossMm);
      const poly = makeOrganicRoutedPath([a.x, a.y], [b.x, b.y], wobbleMm, localRng, gardenBoundary, exclusionZones);
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
      poly: a.customPolygon && a.customPolygon.length >= 3 ? a.customPolygon : makePatioBlob([a.x, a.y], a.radius || 1000, localRng, 0.24, 16, gardenBoundary),
      label: a.label,
    }));
    return { pathPolys: polys, clampReport: report, patioBlobs: blobs, exclusionWarnings: warnings };
  }, [connections, anchorById, wobbleMm, seed, gardenBoundary, geom.acrossMm, anchors, exclusionZones]);

  // ---- zones ----
  const zoneSeeds = useMemo(() => {
    const localRng = mulberry32(seed * 131 + 5);
    const pts = [];
    let attempts = 0;
    while (pts.length < zoneCount && attempts < zoneCount * 60) {
      attempts++;
      const cand = [
        boundaryBBox.xMin + localRng() * (boundaryBBox.xMax - boundaryBBox.xMin),
        boundaryBBox.yMin + localRng() * (boundaryBBox.yMax - boundaryBBox.yMin),
      ];
      if (pointInPoly(cand, gardenBoundary) && !exclusionZones.some((z) => pointInPoly(cand, z.poly))) pts.push(cand);
    }
    return relaxPoints(pts, relaxIters, boundaryBBox);
  }, [zoneCount, relaxIters, seed, boundaryBBox, gardenBoundary, exclusionZones]);

  const zoneDelaunay = useMemo(() => Delaunay.from(zoneSeeds), [zoneSeeds]);
  const zonePolys = useMemo(() => boundedVoronoiPolygons(zoneSeeds, boundaryBBox), [zoneSeeds, boundaryBBox]);

  // ---- tile paving selection: core (on path/patio) + scatter (fringe) ----
  const meanderTracks = useMemo(() => {
    if (!showMeander || meanderCount <= 0) return [];
    return generateMeanderTracks({
      anchors,
      connections,
      mainPathPolys: pathPolys,
      patioPolys: patioBlobs.map((b) => b.poly),
      count: meanderCount,
      minPathClearanceMm: meanderClearanceMm,
      minBoundaryClearanceMm: 300,
      boundaryPoly: gardenBoundary,
      exclusionPolys: exclusionZones.map((z) => z.poly),
      minTrackSepMm: 500,
      seed: meanderSeed * 7159 + 11,
    });
  }, [showMeander, meanderCount, meanderClearanceMm, anchors, connections, pathPolys, patioBlobs, gardenBoundary, exclusionZones, meanderSeed]);

  const paved = useMemo(() => {
    const scatterRng = mulberry32(seed * 7919 + 3);
    const meanderRng = mulberry32(meanderSeed * 3121 + 41);
    const meanderReachMm = 220; // how far a tile can sit from a track's centerline and still qualify
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
        if (bestD <= meanderReachMm && meanderRng() < meanderDensity * (1 - bestD / meanderReachMm)) {
          reason = "meander";
        }
      }
      if (reason) {
        const idx = zoneDelaunay.find(cx, cy);
        result.push({ cx, cy, reason, zoneIdx: idx });
      }
    }
    return result;
  }, [tileCenters, pathPolys, patioBlobs, scatterMaxMm, scatterDensity, seed, zoneDelaunay, meanderTracks, meanderDensity, meanderSeed]);

  const materialCounts = useMemo(() => {
    const counts = new Array(PALETTE.length).fill(0);
    for (const t of paved) counts[t.zoneIdx % PALETTE.length]++;
    return counts;
  }, [paved]);

  // ---- SVG viewbox / scale ----
  const VB_W = 900;
  const scale = VB_W / gardenW;
  const VB_H = gardenH * scale;

  // ---- interactions: click-to-place, drag-to-move ----
  const svgPointFromEvent = useCallback((evt) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    const xFrac = (clientX - rect.left) / rect.width;
    const yFrac = (clientY - rect.top) / rect.height;
    return [xFrac * gardenW, yFrac * gardenH];
  }, [gardenW, gardenH]);

  const FREEFORM_MODES = ["draw-patio", "draw-boundary", "draw-exclusion"];
  const SHAPE_PRESET_MODES = ["draw-square", "draw-rect", "draw-circle", "draw-exclusion-rect"];

  const handleCanvasClick = (evt) => {
    if (!placeMode) return;
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

  const addPatioFromPolygon = (poly) => {
    if (!poly) return;
    const id = nextUid();
    const rounded = poly.map(([x, y]) => [Math.round(x), Math.round(y)]);
    const [cx, cy] = polygonCentroid(rounded);
    setAnchors((prev) => [...prev, { id, label: `patio_${id}`, type: "patio", x: Math.round(cx), y: Math.round(cy), customPolygon: rounded }]);
  };
  const addExclusionFromPolygon = (poly) => {
    if (!poly) return;
    const id = nextUid();
    const rounded = poly.map(([x, y]) => [Math.round(x), Math.round(y)]);
    setExclusionZones((prev) => [...prev, { id, label: `house_${id}`, poly: rounded }]);
  };

  // finishes whatever freeform shape is currently being drawn, routing to the right target
  const finishFreeformDraw = () => {
    if (drawPoints.length < 3) return;
    if (placeMode === "draw-patio") addPatioFromPolygon(drawPoints);
    else if (placeMode === "draw-boundary") setGardenBoundary(drawPoints.map(([x, y]) => [Math.round(x), Math.round(y)]));
    else if (placeMode === "draw-exclusion") addExclusionFromPolygon(drawPoints);
    setDrawPoints([]);
    setPlaceMode(null);
  };
  const cancelFreeformDraw = () => {
    setDrawPoints([]);
    setPlaceMode(null);
  };
  const resetBoundaryToRect = () => {
    setGardenBoundary([
      [marginMm, marginMm], [gardenW - marginMm, marginMm],
      [gardenW - marginMm, gardenH - marginMm], [marginMm, gardenH - marginMm],
    ]);
  };

  const handleCanvasMouseDown = (evt) => {
    if (!SHAPE_PRESET_MODES.includes(placeMode)) return;
    const pt = svgPointFromEvent(evt);
    setShapeDragStart(pt);
    setShapeDragCurrent(pt);
  };

  const handleAnchorPointerDown = (id) => (evt) => {
    evt.stopPropagation();
    if (placeMode === "connect") {
      setConnectFromId(id);
      const a = anchorById[id];
      if (a) setConnectPreviewPoint([a.x, a.y]);
      return;
    }
    setDragId(id);
  };
  // mouseup on a *specific* anchor -- only meaningful while a connect-drag is in flight,
  // and only if it lands on a different anchor than the one the drag started from.
  const handleAnchorPointerUp = (id) => (evt) => {
    if (!connectFromId) return;
    evt.stopPropagation();
    if (id !== connectFromId) {
      const already = connections.some(
        (c) => (c.a === connectFromId && c.b === id) || (c.a === id && c.b === connectFromId)
      );
      if (!already) setConnections((prev) => [...prev, { a: connectFromId, b: id, widthMm: connWidth }]);
    }
    setConnectFromId(null);
    setConnectPreviewPoint(null);
  };
  const handlePointerMove = (evt) => {
    if (dragId) {
      const [x, y] = svgPointFromEvent(evt);
      setAnchors((prev) => prev.map((a) => (a.id === dragId ? { ...a, x: Math.round(x), y: Math.round(y) } : a)));
      return;
    }
    if (connectFromId) {
      setConnectPreviewPoint(svgPointFromEvent(evt));
      return;
    }
    if (shapeDragStart) setShapeDragCurrent(svgPointFromEvent(evt));
  };
  const handlePointerUp = () => {
    if (dragId) { setDragId(null); return; }
    if (connectFromId) {
      // released over empty canvas (not on another anchor) -- abandon the connect-drag
      setConnectFromId(null);
      setConnectPreviewPoint(null);
      return;
    }
    if (shapeDragStart && shapeDragCurrent) {
      let poly = null;
      if (placeMode === "draw-square") poly = squarePolygonFromDrag(shapeDragStart, shapeDragCurrent);
      else if (placeMode === "draw-rect") poly = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent);
      else if (placeMode === "draw-circle") poly = circlePolygonFromDrag(shapeDragStart, shapeDragCurrent);
      else if (placeMode === "draw-exclusion-rect") poly = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent);
      if (placeMode === "draw-exclusion-rect") addExclusionFromPolygon(poly);
      else addPatioFromPolygon(poly);
      setShapeDragStart(null);
      setShapeDragCurrent(null);
      setPlaceMode(null);
    }
  };

  const removeAnchor = (id) => {
    setAnchors((prev) => prev.filter((a) => a.id !== id));
    setConnections((prev) => prev.filter((c) => c.a !== id && c.b !== id));
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

  const totalGardenTiles = tileCenters.length;
  const coreCount = paved.filter((t) => t.reason === "core").length;
  const scatterCount = paved.filter((t) => t.reason === "scatter").length;
  const meanderTileCount = paved.filter((t) => t.reason === "meander").length;

  const labelStyle = { fontSize: 12, fontWeight: 600, color: INK, letterSpacing: "0.02em" };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", background: APP_BG, fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: INK }}>
      {/* ---------------- control rail ---------------- */}
      <div style={{ width: 320, minWidth: 320, background: PAPER, borderRight: `1px solid ${PANEL_BORDER}`, overflowY: "auto", padding: "18px 16px" }}>
        <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 20, fontWeight: 700, marginBottom: 2, color: INK }}>
          Garden Paving Designer
        </div>
        <div style={{ fontSize: 11.5, color: INK_SOFT, marginBottom: 18 }}>
          Voronoi zones · organic paths · live tile layout
        </div>

        <Section title="Garden">
          <Row label="Width (mm)"><NumInput value={gardenW} onChange={setGardenW} step={100} /></Row>
          <Row label="Height (mm)"><NumInput value={gardenH} onChange={setGardenH} step={100} /></Row>
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 4 }}>
            Width/height set the default rectangle. Draw a custom outline for an irregular plot, an L-shape, a side passage, etc.
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
              <button onClick={() => setExclusionZones((prev) => prev.filter((x) => x.id !== z.id))} style={iconBtnStyle}><Trash2 size={12} /></button>
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
              label="Connect anchors (drag)"
              fullWidth
            />
            {placeMode === "connect" && (
              <div style={{ fontSize: 11, color: ACCENT, marginTop: 6 }}>
                {connectFromId
                  ? "Drag to another anchor and release to connect."
                  : "Click and drag from an anchor to another anchor on the canvas."}
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

        <Section title="Organic zones">
          <Row label={`Zones (${zoneCount})`}><input type="range" min={6} max={80} value={zoneCount} onChange={(e) => setZoneCount(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Relaxation (${relaxIters})`}><input type="range" min={0} max={4} value={relaxIters} onChange={(e) => setRelaxIters(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Path wobble (${wobbleMm}mm)`}><input type="range" min={0} max={1200} step={50} value={wobbleMm} onChange={(e) => setWobbleMm(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Scatter density (${scatterDensity.toFixed(2)})`}><input type="range" min={0} max={1} step={0.05} value={scatterDensity} onChange={(e) => setScatterDensity(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Scatter reach (${scatterMaxMm}mm)`}><input type="range" min={0} max={1500} step={50} value={scatterMaxMm} onChange={(e) => setScatterMaxMm(+e.target.value)} style={{ width: "100%" }} /></Row>
          <button onClick={() => setSeed((s) => s + 1)} style={{ ...primaryBtnStyle, width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <RefreshCw size={13} /> Reroll layout
          </button>
        </Section>

        <Section title="Meander (desire) tracks">
          <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 6 }}>
            Informal wandering shortcuts, branching off the main paths -- sparse, broken tiling,
            never a guaranteed solid core. Routed with A* over a clearance grid (like the
            original prototype's Dijkstra approach), so it can genuinely find a path through a
            gap rather than just getting lucky with a random curve -- but it can still fail if
            no route exists at all through the remaining void space.
          </div>
          <Row label={`Track count (${meanderCount})`}><input type="range" min={0} max={10} value={meanderCount} onChange={(e) => setMeanderCount(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Stepping density (${meanderDensity.toFixed(2)})`}><input type="range" min={0.1} max={1} step={0.05} value={meanderDensity} onChange={(e) => setMeanderDensity(+e.target.value)} style={{ width: "100%" }} /></Row>
          <Row label={`Clearance from paths (${meanderClearanceMm}mm)`}><input type="range" min={150} max={600} step={25} value={meanderClearanceMm} onChange={(e) => setMeanderClearanceMm(+e.target.value)} style={{ width: "100%" }} /></Row>
          <button onClick={() => setMeanderSeed((s) => s + 1)} style={{ ...primaryBtnStyle, width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <RefreshCw size={13} /> Reroll tracks
          </button>
        </Section>

        <Section title="Layers">
          <Toggle label="Planting texture" value={showPlanting} onChange={setShowPlanting} />
          <Toggle label="Boundary" value={showBoundary} onChange={setShowBoundary} />
          <Toggle label="Zone guide" value={showZones} onChange={setShowZones} />
          <Toggle label="Tiles" value={showTiles} onChange={setShowTiles} />
          <Toggle label="Path/patio centerlines" value={showCenterlines} onChange={setShowCenterlines} />
          <Toggle label="Meander tracks" value={showMeander} onChange={setShowMeander} />
          <Toggle label="Anchors" value={showAnchors} onChange={setShowAnchors} />
        </Section>

        <div style={{ marginTop: 18, padding: "10px 12px", background: "#F1ECE0", borderRadius: 6, fontSize: 10.5, color: INK_SOFT, lineHeight: 1.5 }}>
          Known gap vs. the original prototype: no disconnected-void-'pocket' detection, so a
          meander track occasionally fails to route even when a human would see open space
          nearby -- it just gets skipped rather than mis-drawn.
        </div>
      </div>

      {/* ---------------- canvas ---------------- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "10px 18px", borderBottom: `1px solid ${PANEL_BORDER}`, display: "flex", gap: 22, alignItems: "center", background: PAPER }}>
          <Stat label="Paved tiles" value={`${coreCount + scatterCount + meanderTileCount} / ${totalGardenTiles}`} />
          <Stat label="Core" value={coreCount} />
          <Stat label="Scatter" value={scatterCount} />
          <Stat label="Meander" value={`${meanderTileCount} (${meanderTracks.length}/${meanderCount} tracks)`} />
          <Stat label="Coverage" value={`${totalGardenTiles ? Math.round((100 * (coreCount + scatterCount + meanderTileCount)) / totalGardenTiles) : 0}%`} />
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 10 }}>
            {PALETTE.map((c, i) => materialCounts[i] > 0 && (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: INK_SOFT }}>
                <span style={{ width: 9, height: 9, background: c, display: "inline-block", borderRadius: 2 }} />
                {materialCounts[i]}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflow: "auto" }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${gardenW} ${gardenH}`}
            width={VB_W}
            height={VB_H}
            style={{ background: PLANT_BG, borderRadius: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.12)", cursor: connectFromId ? "crosshair" : placeMode ? "crosshair" : dragId ? "grabbing" : "default" }}
            onClick={handleCanvasClick}
            onDoubleClick={() => { if (FREEFORM_MODES.includes(placeMode)) finishFreeformDraw(); }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
          >
            <defs>
              <clipPath id="gardenClip">
                <polygon points={gardenBoundary.map((p) => p.join(",")).join(" ")} />
              </clipPath>
              <pattern id="hatch" patternUnits="userSpaceOnUse" width={gardenW * 0.018} height={gardenW * 0.018} patternTransform="rotate(45)">
                <rect width={gardenW * 0.018} height={gardenW * 0.018} fill="#D9C7BE" />
                <line x1="0" y1="0" x2="0" y2={gardenW * 0.018} stroke="#8B3A2B" strokeWidth={gardenW * 0.0025} opacity={0.5} />
              </pattern>
            </defs>

            <g clipPath="url(#gardenClip)">
              {showPlanting && Array.from({ length: 260 }).map((_, i) => {
                const rx = boundaryBBox.xMin + ((i * 97) % (boundaryBBox.xMax - boundaryBBox.xMin));
                const ry = boundaryBBox.yMin + ((i * 233) % (boundaryBBox.yMax - boundaryBBox.yMin));
                return <circle key={i} cx={rx} cy={ry} r={gardenW * 0.0012} fill="#8FA07A" opacity={0.35} />;
              })}

              {showZones && zonePolys.map((poly, i) => poly && (
                <polygon key={i} points={poly.map((p) => p.join(",")).join(" ")} fill={PALETTE[i % PALETTE.length]} opacity={0.1} stroke="none" />
              ))}

              {showTiles && paved.map((t, i) => (
                <polygon key={i} points={tileCornersFn(t.cx, t.cy).map((p) => p.join(",")).join(" ")}
                  fill={PALETTE[t.zoneIdx % PALETTE.length]} stroke={INK} strokeWidth={gardenW * 0.0006} opacity={t.reason === "core" ? 1 : 0.92} />
              ))}

              {/* main path/patio centerlines moved INSIDE the clip group -- these are the
                  reference outlines, and without clipping they could visually poke past the
                  true boundary (confirmed: the default patio blob is a jittered circle with
                  no boundary awareness at all, so if its center sits closer to an edge than
                  its jittered radius, the raw shape legitimately extends past the boundary --
                  actual tile placement was never affected since tiles are independently
                  filtered by point-in-polygon, but the outline was misleadingly unclipped) */}
              {showCenterlines && pathPolys.map((p, i) => (
                <polyline key={i} points={p.poly.map((pt) => pt.join(",")).join(" ")} fill="none" stroke="#1F3A52" strokeWidth={gardenW * 0.0012} opacity={0.7} strokeLinecap="round" />
              ))}
              {showCenterlines && patioBlobs.map((b, i) => (
                <polygon key={i} points={b.poly.map((p) => p.join(",")).join(" ")} fill="none" stroke="#1F3A52" strokeDasharray="20,14" strokeWidth={gardenW * 0.0012} opacity={0.7} />
              ))}
              {showCenterlines && showMeander && meanderTracks.map((track, i) => (
                <polyline key={`m${i}`} points={track.map((pt) => pt.join(",")).join(" ")} fill="none" stroke="#8B3A2B" strokeWidth={gardenW * 0.0009} strokeDasharray="16,10" opacity={0.65} strokeLinecap="round" />
              ))}
            </g>

            {/* house / exclusion zones: hatched, always drawn on top of tiles so the
                'never paved here' area stays visually unambiguous */}
            {exclusionZones.map((z) => (
              <g key={z.id}>
                <polygon points={z.poly.map((p) => p.join(",")).join(" ")} fill="url(#hatch)" stroke="#8B3A2B" strokeWidth={gardenW * 0.0012} opacity={0.85} />
                <text x={polygonCentroid(z.poly)[0]} y={polygonCentroid(z.poly)[1]} fontSize={gardenW * 0.011} fill="#5A2E1E" textAnchor="middle" style={{ userSelect: "none" }}>{z.label}</text>
              </g>
            ))}

            {showBoundary && (
              <polygon points={gardenBoundary.map((p) => p.join(",")).join(" ")}
                fill="none" stroke="#9C927B" strokeDasharray={`${gardenW * 0.006} ${gardenW * 0.005}`} strokeWidth={gardenW * 0.0015} />
            )}


            {FREEFORM_MODES.includes(placeMode) && drawPoints.length > 0 && (
              <g>
                <polyline
                  points={drawPoints.map((p) => p.join(",")).join(" ")}
                  fill="none" stroke={ACCENT} strokeWidth={gardenW * 0.0015} strokeDasharray="14,8"
                />
                {drawPoints.length >= 3 && (
                  <polygon
                    points={drawPoints.map((p) => p.join(",")).join(" ")}
                    fill={ACCENT} opacity={0.12} stroke="none"
                  />
                )}
                {drawPoints.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={gardenW * 0.005} fill={ACCENT} stroke={PAPER} strokeWidth={gardenW * 0.0012} />
                ))}
              </g>
            )}

            {shapeDragStart && shapeDragCurrent && (() => {
              let preview = null;
              if (placeMode === "draw-square") preview = squarePolygonFromDrag(shapeDragStart, shapeDragCurrent);
              else if (placeMode === "draw-rect") preview = rectPolygonFromDrag(shapeDragStart, shapeDragCurrent);
              else if (placeMode === "draw-circle") preview = circlePolygonFromDrag(shapeDragStart, shapeDragCurrent);
              if (!preview) return null;
              return (
                <polygon points={preview.map((p) => p.join(",")).join(" ")}
                  fill={ACCENT} opacity={0.16} stroke={ACCENT} strokeWidth={gardenW * 0.0015} strokeDasharray="14,8" />
              );
            })()}

            {connectFromId && connectPreviewPoint && anchorById[connectFromId] && (
              <line
                x1={anchorById[connectFromId].x} y1={anchorById[connectFromId].y}
                x2={connectPreviewPoint[0]} y2={connectPreviewPoint[1]}
                stroke={ACCENT} strokeWidth={gardenW * 0.0018} strokeDasharray="14,8" strokeLinecap="round"
              />
            )}

            {showAnchors && anchors.map((a) => (
              <g
                key={a.id}
                onMouseDown={handleAnchorPointerDown(a.id)}
                onMouseUp={handleAnchorPointerUp(a.id)}
                style={{ cursor: placeMode === "connect" ? "crosshair" : "grab" }}
              >
                {connectFromId === a.id && (
                  <circle cx={a.x} cy={a.y} r={gardenW * 0.016} fill="none" stroke={ACCENT} strokeWidth={gardenW * 0.0018} strokeDasharray="6,5" />
                )}
                {a.type === "door" ? (
                  <rect x={a.x - gardenW * 0.009} y={a.y - gardenW * 0.009} width={gardenW * 0.018} height={gardenW * 0.018}
                    fill={INK} stroke={PAPER} strokeWidth={gardenW * 0.0015} />
                ) : a.type === "junction" ? (
                  <polygon points={[[0, -1], [0.87, 0.5], [-0.87, 0.5]].map(([dx, dy]) => `${a.x + dx * gardenW * 0.011},${a.y + dy * gardenW * 0.011}`).join(" ")}
                    fill={INK} stroke={PAPER} strokeWidth={gardenW * 0.0015} />
                ) : (
                  <circle cx={a.x} cy={a.y} r={gardenW * 0.009} fill={INK} stroke={PAPER} strokeWidth={gardenW * 0.0015} />
                )}
                <text x={a.x} y={a.y - gardenW * 0.016} fontSize={gardenW * 0.011} fill={INK} textAnchor="middle" style={{ userSelect: "none" }}>{a.label}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
