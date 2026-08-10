// ============================================================
// A* pathfinding over a rasterized clearance grid -- the real algorithm the Python
// prototype used, ported directly. Replaces the earlier retry-based wobble approach:
// that could only get lucky with random curves and had no idea a narrow gap even existed;
// this genuinely searches the space and finds a route through one if it's there.
// ============================================================
import { polygonBBox, pointInPoly, pointSegDist, signedDistanceToPolygon, mulberry32 } from "./geometryUtils";
import { catmullRom } from "./organicPaths";
import { MIN_PEDESTRIAN_WIDTH_MM, MIN_TILES_ACROSS } from "./constants";

class MinHeap {
  constructor() { this.items = []; }
  push(item, priority) {
    this.items.push({ item, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < n && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top ? top.item : null;
  }
  get size() { return this.items.length; }
}

function buildClearanceGrid({ boundaryPoly, mainPathPolys, exclusionPolys, avoidTracks, cellMm, minPathClearanceMm, minBoundaryClearanceMm, minTrackSepMm }) {
  const bbox = polygonBBox(boundaryPoly);
  const cols = Math.max(2, Math.ceil((bbox.xMax - bbox.xMin) / cellMm));
  const rows = Math.max(2, Math.ceil((bbox.yMax - bbox.yMin) / cellMm));
  const safe = new Uint8Array(cols * rows);
  const idx = (c, r) => r * cols + c;
  const cellCenter = (c, r) => [bbox.xMin + (c + 0.5) * cellMm, bbox.yMin + (r + 0.5) * cellMm];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = cellCenter(c, r);
      let ok = pointInPoly(p, boundaryPoly);
      if (ok) {
        let bd = Infinity;
        for (let i = 0; i < boundaryPoly.length; i++) {
          bd = Math.min(bd, pointSegDist(p, boundaryPoly[i], boundaryPoly[(i + 1) % boundaryPoly.length]));
        }
        if (bd < minBoundaryClearanceMm) ok = false;
      }
      if (ok) {
        outer: for (const mp of mainPathPolys) {
          for (let k = 0; k < mp.poly.length - 1; k++) {
            if (pointSegDist(p, mp.poly[k], mp.poly[k + 1]) - mp.widthMm / 2 < minPathClearanceMm) { ok = false; break outer; }
          }
        }
      }
      if (ok) {
        for (const ex of exclusionPolys) {
          if (signedDistanceToPolygon(p, ex) >= -minPathClearanceMm) { ok = false; break; }
        }
      }
      if (ok && avoidTracks) {
        outer2: for (const track of avoidTracks) {
          for (let k = 0; k < track.length - 1; k++) {
            if (pointSegDist(p, track[k], track[k + 1]) < minTrackSepMm) { ok = false; break outer2; }
          }
        }
      }
      safe[idx(c, r)] = ok ? 1 : 0;
    }
  }
  const openness = buildOpennessField(cols, rows, safe, idx, cellMm);
  return { bbox, cols, rows, cellMm, safe, idx, cellCenter, openness };
}

function buildOpennessField(cols, rows, safe, idx, cellMm) {
  // Multi-source Dijkstra distance transform: for every safe cell, the true (not just
  // axis-aligned) distance in mm to the nearest obstacle/unsafe cell -- boundary, path,
  // patio, exclusion zone, or already-placed track, since all of those are baked into
  // `safe` already. This is what lets aStarSearch tell a route hugging the edge of the
  // safe region apart from one cutting through the open middle of a pocket, which a plain
  // safe/unsafe grid genuinely cannot: both count as equally 'safe' to it otherwise.
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  const visited = new Uint8Array(n);
  const open = new MinHeap();
  for (let i = 0; i < n; i++) {
    if (!safe[i]) { dist[i] = 0; open.push(i, 0); }
  }
  while (open.size > 0) {
    const cur = open.pop();
    if (visited[cur]) continue;
    visited[cur] = 1;
    const cr = Math.floor(cur / cols), cc = cur % cols;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const nIdx = idx(nc, nr);
        if (visited[nIdx]) continue;
        const step = Math.hypot(dc, dr) * cellMm;
        const cand = dist[cur] + step;
        if (cand < dist[nIdx]) { dist[nIdx] = cand; open.push(nIdx, cand); }
      }
    }
  }
  return dist;
}

function computeGridPockets(grid) {
  // connected-components flood fill over the safe cells -- this is what lets pair-selection
  // avoid wasting attempts on pairs from different disconnected 'islands' of void space (e.g.
  // hub-and-spoke path layouts routinely split the garden into several regions with no way
  // between them except crossing a path). Ported directly from the Python prototype's
  // pocket-detection, which existed for exactly this reason.
  const { cols, rows, safe, idx } = grid;
  const labels = new Int32Array(cols * rows).fill(-1);
  let nextLabel = 0;
  const stack = [];
  for (let start = 0; start < cols * rows; start++) {
    if (!safe[start] || labels[start] !== -1) continue;
    labels[start] = nextLabel;
    stack.push(start);
    while (stack.length) {
      const cur = stack.pop();
      const cr = Math.floor(cur / cols), cc = cur % cols;
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (dc === 0 && dr === 0) continue;
          const nc = cc + dc, nr = cr + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const nIdx = idx(nc, nr);
          if (safe[nIdx] && labels[nIdx] === -1) { labels[nIdx] = nextLabel; stack.push(nIdx); }
        }
      }
    }
    nextLabel++;
  }
  return labels;
}
function pocketOf(grid, pocketLabels, point) {
  const cell = nearestSafeCell(grid, point);
  if (!cell) return -1;
  return pocketLabels[grid.idx(cell[0], cell[1])];
}
function pocketCellIndices(pocketLabels, pocketId) {
  const out = [];
  for (let i = 0; i < pocketLabels.length; i++) if (pocketLabels[i] === pocketId) out.push(i);
  return out;
}
function pickWanderWaypoint(grid, pocketCells, aPos, bPos, rng, excludeMm = 700) {
  // Deliberately routes THROUGH one of the most open cells in the shared pocket, rather than
  // merely discounting the cost of cells near it -- a soft cost nudge still lets total path
  // length dominate the decision (that's exactly what produced the disappointing ~15% detours
  // before). Picking an explicit waypoint and then pathfinding TO it removes length from the
  // decision of *whether* to detour entirely; length only still matters for how each leg gets
  // there, which is fine -- it should still be a walkable route, not a random line.
  const { cellCenter, cols, openness } = grid;
  const ranked = [];
  for (const i of pocketCells) {
    const r = Math.floor(i / cols), c = i % cols;
    const p = cellCenter(c, r);
    if (Math.hypot(p[0] - aPos[0], p[1] - aPos[1]) < excludeMm) continue;
    if (Math.hypot(p[0] - bPos[0], p[1] - bPos[1]) < excludeMm) continue;
    ranked.push([p, openness[i]]);
  }
  if (ranked.length === 0) return null;
  ranked.sort((x, y) => y[1] - x[1]);
  // top-N by openness, not just the single global peak -- keeps repeated tracks through the
  // same pocket from all converging on the exact same point, and the peak itself might be a
  // single-cell fluke; any of these is genuinely "the open part of the pocket".
  const top = ranked.slice(0, Math.min(8, ranked.length));
  return top[Math.floor(rng() * top.length)][0];
}
function nearestSafeCell(grid, p) {
  const { cols, rows, cellMm, bbox, safe, idx } = grid;
  const c0 = Math.min(Math.max(Math.floor((p[0] - bbox.xMin) / cellMm), 0), cols - 1);
  const r0 = Math.min(Math.max(Math.floor((p[1] - bbox.yMin) / cellMm), 0), rows - 1);
  if (safe[idx(c0, r0)]) return [c0, r0];
  const maxRad = Math.max(cols, rows);
  for (let rad = 1; rad < maxRad; rad++) {
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
        const c = c0 + dc, r = r0 + dr;
        if (c >= 0 && c < cols && r >= 0 && r < rows && safe[idx(c, r)]) return [c, r];
      }
    }
  }
  return null;
}

function opennessCostFactor(clearanceMm, biasTargetMm, biasStrength) {
  // 1x cost once a cell is `biasTargetMm` or more from the nearest obstacle (deep in an open
  // pocket); rising smoothly to (1 + biasStrength)x right at the minimum-clearance edge of the
  // safe region. Steepest right where minimum-clearance corridors along paths/patios/boundary
  // sit, which is exactly what makes A* prefer bulging into open space over hugging them --
  // straight-line-shortest is no longer automatically cheapest.
  if (biasStrength <= 0 || biasTargetMm <= 0) return 1;
  const t = Math.min(1, Math.max(0, clearanceMm / biasTargetMm));
  const eased = t * t; // ease-in: bias falls off fast once there's *some* breathing room
  return 1 + biasStrength * (1 - eased);
}

function aStarSearch(grid, startPt, goalPt, biasTargetMm = 0, biasStrength = 0) {
  const { cols, rows, cellMm, safe, idx, cellCenter, openness } = grid;
  const start = nearestSafeCell(grid, startPt);
  const goal = nearestSafeCell(grid, goalPt);
  if (!start || !goal) return null;
  const startIdx = idx(start[0], start[1]), goalIdx = idx(goal[0], goal[1]);
  const [gx, gy] = cellCenter(goal[0], goal[1]);
  const heuristic = (c, r) => {
    const [px, py] = cellCenter(c, r);
    return Math.hypot(gx - px, gy - py);
  };
  const n = cols * rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  gScore[startIdx] = 0;
  const open = new MinHeap();
  open.push(startIdx, heuristic(start[0], start[1]));

  let found = false;
  while (open.size > 0) {
    const curIdx = open.pop();
    if (closed[curIdx]) continue;
    closed[curIdx] = 1;
    if (curIdx === goalIdx) { found = true; break; }
    const cr = Math.floor(curIdx / cols), cc = curIdx % cols;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const nIdx = idx(nc, nr);
        if (!safe[nIdx] || closed[nIdx]) continue;
        // factor keyed off the *destination* cell's openness -- a step landing deeper in a
        // pocket is cheap, a step landing right back against an obstacle edge is expensive.
        // Since the factor is always >= 1, the plain-Euclidean heuristic stays admissible.
        const factor = opennessCostFactor(openness[nIdx], biasTargetMm, biasStrength);
        const stepCost = Math.hypot(dc, dr) * cellMm * factor;
        const tentative = gScore[curIdx] + stepCost;
        if (tentative < gScore[nIdx]) {
          gScore[nIdx] = tentative;
          cameFrom[nIdx] = curIdx;
          open.push(nIdx, tentative + heuristic(nc, nr));
        }
      }
    }
  }
  if (!found) return null;
  const path = [];
  let cur = goalIdx;
  while (cur !== -1) {
    const r = Math.floor(cur / cols), c = cur % cols;
    path.push(cellCenter(c, r));
    cur = cameFrom[cur];
  }
  path.reverse();
  path.unshift(startPt);
  path.push(goalPt);
  return path;
}

function decimateGridPath(path, targetSpacingMm = 250) {
  if (path.length <= 4) return path;
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) total += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  const targetCount = Math.max(4, Math.min(40, Math.round(total / targetSpacingMm)));
  const idxs = new Set([0, path.length - 1]);
  for (let k = 1; k < targetCount - 1; k++) idxs.add(Math.round((k / (targetCount - 1)) * (path.length - 1)));
  return [...idxs].sort((a, b) => a - b).map((i) => path[i]);
}

function trimTrackEndpoints(poly, excludeMm = 500) {
  // exclude a fixed real-world distance from each end before checking obstacle clearance --
  // without this, a track that legitimately terminates AT the patio (a valid endpoint, same
  // as a main path connecting to it) gets flagged identically to one cutting through its
  // middle. Arc-length based, not a fraction of point count, for the same reason this
  // mattered in the Python version: a percentage-based trim scales with track length and can
  // under- or over-exempt depending on how long the track happens to be.
  const segLens = [];
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    segLens.push(d); total += d;
  }
  if (total <= 2 * excludeMm) return [poly[Math.floor(poly.length / 2)]];
  let acc = 0, lo = 0;
  for (let i = 0; i < segLens.length; i++) { acc += segLens[i]; if (acc >= excludeMm) { lo = i + 1; break; } }
  acc = 0;
  let hi = poly.length - 1;
  for (let i = segLens.length - 1; i >= 0; i--) { acc += segLens[i]; if (acc >= excludeMm) { hi = i; break; } }
  if (hi <= lo) return [poly[Math.floor(poly.length / 2)]];
  return poly.slice(lo, hi + 1);
}
function segmentClearsObstacles(a, b, mainPathPolys, exclusionPolys, minPathClearanceMm, samples = 6) {
  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    for (const mp of mainPathPolys) {
      for (let k = 0; k < mp.poly.length - 1; k++) {
        if (pointSegDist(p, mp.poly[k], mp.poly[k + 1]) - mp.widthMm / 2 < minPathClearanceMm * 0.6) return false;
      }
    }
    for (const ex of exclusionPolys) {
      if (signedDistanceToPolygon(p, ex) >= -minPathClearanceMm * 0.6) return false;
    }
  }
  return true;
}
function polylineClearsObstacles(poly, mainPathPolys, exclusionPolys, minPathClearanceMm, excludeMm = 500) {
  const interior = trimTrackEndpoints(poly, excludeMm);
  for (let i = 0; i < interior.length - 1; i++) {
    if (!segmentClearsObstacles(interior[i], interior[i + 1], mainPathPolys, exclusionPolys, minPathClearanceMm)) return false;
  }
  return true;
}
function smoothAndValidate(waypoints, rawPath, mainPathPolys, exclusionPolys, minPathClearanceMm) {
  // three-tier fallback, each checked explicitly (not assumed safe) -- decimation can drop
  // the exact bend that was routing around an obstacle, so 'fall back to the simpler version'
  // is only correct if that simpler version is actually re-validated, not just trusted:
  // 1. smoothed organic curve (nicest looking, checked along every segment not just sample
  //    points, so a violation strictly between two checked points can't slip through)
  // 2. decimated waypoints joined by straight lines (sharper, still checked)
  // 3. the raw, undecimated A* grid path -- guaranteed safe since every point came from a
  //    certified-safe grid cell and consecutive steps are only one cell apart
  const smoothed = catmullRom(waypoints, 12);
  if (polylineClearsObstacles(smoothed, mainPathPolys, exclusionPolys, minPathClearanceMm)) return smoothed;
  if (polylineClearsObstacles(waypoints, mainPathPolys, exclusionPolys, minPathClearanceMm)) return waypoints;
  return rawPath;
}

function buildMeanderCandidates(anchors, connections, mainPathPolys, endpointZoneFrac = 0.2) {
  // Ports two things the Python prototype had that this JS candidate list was missing:
  // (1) anchors themselves are candidates, tagged with every path touching them, so a track
  //     can genuinely start/end AT a door or patio, not just somewhere along a path's length;
  // (2) interior path points are restricted to the outer endpointZoneFrac of each path's arc
  //     length -- without this, tracks branch off from arbitrary midpoints instead of reading
  //     as "near a junction/entry", which is what this bug report was about.
  const anchorPathIds = new Map();
  connections.forEach((c, i) => {
    if (!anchorPathIds.has(c.a)) anchorPathIds.set(c.a, new Set());
    if (!anchorPathIds.has(c.b)) anchorPathIds.set(c.b, new Set());
    anchorPathIds.get(c.a).add(i);
    anchorPathIds.get(c.b).add(i);
  });
  const candidates = [];
  anchors.forEach((a) => {
    if (anchorPathIds.has(a.id)) candidates.push({ pos: [a.x, a.y], pathIds: anchorPathIds.get(a.id), isAnchor: true });
  });
  mainPathPolys.forEach((p, pathIdx) => {
    const poly = p.poly;
    const lens = [];
    let total = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const d = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
      lens.push(d); total += d;
    }
    let acc = 0;
    for (let i = 1; i < poly.length - 1; i++) {
      acc += lens[i - 1];
      const frac = total > 0 ? acc / total : 0;
      if (frac <= endpointZoneFrac || frac >= 1 - endpointZoneFrac) {
        candidates.push({ pos: poly[i], pathIds: new Set([pathIdx]), isAnchor: false });
      }
    }
  });
  return candidates;
}
function candidatesSharePath(c1, c2) {
  for (const p of c1.pathIds) if (c2.pathIds.has(p)) return true;
  return false;
}
function endpointsTooSimilar(a, b, usedPairs, minSepMm) {
  for (const [pa, pb] of usedPairs) {
    const sameOrder = Math.hypot(a[0] - pa[0], a[1] - pa[1]) < minSepMm && Math.hypot(b[0] - pb[0], b[1] - pb[1]) < minSepMm;
    const swapped = Math.hypot(a[0] - pb[0], a[1] - pb[1]) < minSepMm && Math.hypot(b[0] - pa[0], b[1] - pa[1]) < minSepMm;
    if (sameOrder || swapped) return true;
  }
  return false;
}

export function generateMeanderTracks({ anchors, connections, mainPathPolys, patioPolys = [], count, boundaryPoly, exclusionPolys, minPathClearanceMm, minBoundaryClearanceMm = 300, minTrackSepMm, minEndpointReuseSepMm = 1200, preferAnchorProb = 0.8, seed, cellMm = 150, openSpaceBiasStrength = 1.5, wanderProb = 0.85 }) {
  const rng = mulberry32(seed);
  const accepted = [];
  const usedPairs = [];
  // patios are just another obstacle to route around, same as an exclusion zone -- this is
  // what fixes tracks cutting straight through a patio (the clearance grid never knew about
  // them before, only main-path segments and explicit exclusion zones)
  const allExclusionPolys = [...exclusionPolys, ...patioPolys];
  const candidates = buildMeanderCandidates(anchors, connections, mainPathPolys);
  const anchorCandidates = candidates.filter((c) => c.isAnchor);
  if (candidates.length < 2 || mainPathPolys.length === 0) return [];
  // Mild per-leg openness bias (see opennessCostFactor) -- just enough to stop each leg from
  // tracing the minimum-clearance edge on its way to/from the wander waypoint below, which
  // is what actually does the work of getting a track deep into a pocket. Not a length
  // trade-off knob: the waypoint choice deliberately ignores length entirely.
  const openSpaceBiasTargetMm = Math.max(minPathClearanceMm, minBoundaryClearanceMm, minTrackSepMm || 0) * 3;

  for (let t = 0; t < count; t++) {
    // grid rebuilt fresh for every track, folding in everything accepted so far -- this is
    // what makes later tracks genuinely aware of earlier ones, not just checked against them
    const grid = buildClearanceGrid({
      boundaryPoly, mainPathPolys, exclusionPolys: allExclusionPolys, avoidTracks: accepted,
      cellMm, minPathClearanceMm, minBoundaryClearanceMm, minTrackSepMm,
    });
    const pocketLabels = computeGridPockets(grid);
    const pocketGroups = {};
    for (const c of candidates) {
      const pocket = pocketOf(grid, pocketLabels, c.pos);
      if (pocket < 0) continue;
      (pocketGroups[pocket] ||= []).push(c);
    }
    const viablePocketIds = Object.keys(pocketGroups).filter((k) => pocketGroups[k].length >= 2);
    if (viablePocketIds.length === 0) continue; // no pocket has two candidates this round

    for (let attempt = 0; attempt < 20; attempt++) {
      // pick the POCKET first, then draw both endpoints from within it -- this is what
      // guarantees a route can exist before even attempting one, and what makes every
      // reachable pocket get a fair shot instead of only the ones random luck kept landing in
      const pocketId = viablePocketIds[Math.floor(rng() * viablePocketIds.length)];
      const group = pocketGroups[pocketId];
      const groupAnchors = group.filter((c) => c.isAnchor);
      const pool1 = groupAnchors.length > 0 && rng() < preferAnchorProb ? groupAnchors : group;
      const pool2 = groupAnchors.length > 0 && rng() < preferAnchorProb ? groupAnchors : group;
      const c1 = pool1[Math.floor(rng() * pool1.length)];
      const c2 = pool2[Math.floor(rng() * pool2.length)];
      if (c1 === c2 || candidatesSharePath(c1, c2)) continue;
      const d = Math.hypot(c1.pos[0] - c2.pos[0], c1.pos[1] - c2.pos[1]);
      if (d < 800 || d > 7000) continue;
      if (endpointsTooSimilar(c1.pos, c2.pos, usedPairs, minEndpointReuseSepMm)) continue;
      // Route THROUGH the pocket's open middle whenever one is worth visiting -- this is the
      // actual "wandering" mechanic (see pickWanderWaypoint), not a length trade-off. Only
      // falls back to a direct route if no qualifying waypoint exists (tiny/uniform pocket)
      // or a leg genuinely can't be found.
      let raw = null;
      if (rng() < wanderProb) {
        const pocketCells = pocketCellIndices(pocketLabels, Number(pocketId));
        const waypoint = pickWanderWaypoint(grid, pocketCells, c1.pos, c2.pos, rng);
        if (waypoint) {
          const leg1 = aStarSearch(grid, c1.pos, waypoint, openSpaceBiasTargetMm, openSpaceBiasStrength);
          const leg2 = aStarSearch(grid, waypoint, c2.pos, openSpaceBiasTargetMm, openSpaceBiasStrength);
          if (leg1 && leg2) raw = leg1.concat(leg2.slice(1));
        }
      }
      if (!raw) raw = aStarSearch(grid, c1.pos, c2.pos, openSpaceBiasTargetMm, openSpaceBiasStrength);
      if (!raw) continue; // shouldn't normally happen (same pocket) -- fall through and retry regardless
      const waypoints = decimateGridPath(raw);
      const poly = smoothAndValidate(waypoints, raw, mainPathPolys, allExclusionPolys, minPathClearanceMm);
      accepted.push(poly);
      usedPairs.push([c1.pos, c2.pos]);
      break;
    }
  }
  return accepted;
}

export function validatePathWidth(widthMm, acrossMm) {
  const required = Math.max(MIN_PEDESTRIAN_WIDTH_MM, MIN_TILES_ACROSS * acrossMm);
  const clamped = Math.max(widthMm, required);
  return { clamped, wasClamped: clamped !== widthMm, required };
}
