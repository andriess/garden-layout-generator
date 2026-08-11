// ============================================================
// Save/load: serializing app state to a downloadable JSON file, and parsing/validating a
// file back into a shape App.jsx can restore into its setters. Pure logic only -- the two
// bits of actual browser API usage (Blob+<a> download, File#text()) are trivial one-liners,
// used directly here since this is a client-only app with no backend to talk to.
// ============================================================

export const BOUNDARY_FILE_TYPE = "garden-boundary";
export const DESIGN_FILE_TYPE = "garden-design";
export const FILE_FORMAT_VERSION = 3;

// fields that make up "the site" -- boundary + house/exclusion footprint -- as opposed to
// the rest of a design (tiles, paths, zones, scatter...) built on top of it
export const BOUNDARY_FIELD_NAMES = ["gardenW", "gardenH", "gardenBoundary", "boundaryShapeKind", "exclusionZones"];

// every other persisted (non-derived, non-transient) field of a full design
export const DESIGN_ONLY_FIELD_NAMES = [
  "tileShape", "paverAcrossFlats", "paverSize", "paverWidth", "paverHeight", "rectBond", "rotationDeg",
  "anchors", "connections",
  "meanderPaths", "meanderDensity", "meanderClearanceMm", "showMeander", "meanderSeed",
  "zoneCount", "relaxIters", "wobbleMm", "seed",
  "scatterDensity", "scatterMaxMm",
  "showZones", "showTiles", "showBoundary", "showAnchors", "showCenterlines", "showPlanting",
  "showSettingOutGrid", "settingOutOriginCorner",
];

export const DESIGN_FIELD_NAMES = [...BOUNDARY_FIELD_NAMES, ...DESIGN_ONLY_FIELD_NAMES];

function pick(state, fields) {
  const out = {};
  for (const f of fields) out[f] = state[f];
  return out;
}

export function serializeBoundary(state) {
  return { type: BOUNDARY_FILE_TYPE, version: FILE_FORMAT_VERSION, ...pick(state, BOUNDARY_FIELD_NAMES) };
}

export function serializeDesign(state) {
  return { type: DESIGN_FILE_TYPE, version: FILE_FORMAT_VERSION, ...pick(state, DESIGN_FIELD_NAMES) };
}

// triggers a browser file download of `obj` as pretty-printed JSON -- no dependency needed,
// this "temporary <a download>" trick is the standard hand-rolled equivalent of file-saver
export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function readImportFile(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
}

// ---- migration ---------------------------------------------------------------------
// Brings an older save file's shape up to what the current app expects, so a file someone
// already has on disk still imports instead of being flatly rejected. Runs before
// validateImportPayload -- validation then only has to understand the current format.
//
// v1 -> v2: meander tracks used to be algorithmically generated from meanderCount/meanderSeed
// rather than stored as explicit waypoints, so there's no actual track geometry in a v1 file
// to carry forward -- the old fields never recorded where a track went, only how many to
// generate and a seed to regenerate them with an algorithm that no longer exists. The honest
// migration is dropping them and telling the user, not fabricating waypoints that were never
// there.
//
// v2 -> v3: added the setting-out reference grid toggle + origin corner. Older files simply
// never had an opinion on either, so they default off/top-left rather than being rejected.
export function migrateDesignPayload(obj) {
  if (!obj || typeof obj !== "object" || obj.type !== DESIGN_FILE_TYPE) {
    return { payload: obj, notes: [] };
  }
  let payload = obj;
  const notes = [];

  if (!Array.isArray(payload.meanderPaths)) {
    const oldCount = typeof payload.meanderCount === "number" ? payload.meanderCount : null;
    const trackWord = oldCount === 1 ? "track" : "tracks";
    const countPhrase = oldCount === null ? "any auto-generated meander tracks" : `its ${oldCount} auto-generated meander ${trackWord}`;
    payload = { ...payload, meanderPaths: [] };
    notes.push(`This file predates hand-placed meander tracks -- ${countPhrase} couldn't be carried over and were dropped. Everything else imported as-is; use "Place meander path" to add new ones.`);
  }

  if (payload.showSettingOutGrid === undefined || payload.settingOutOriginCorner === undefined) {
    payload = { ...payload, showSettingOutGrid: payload.showSettingOutGrid ?? false, settingOutOriginCorner: payload.settingOutOriginCorner ?? "minXminY" };
  }

  return { payload, notes };
}

// ---- validation -------------------------------------------------------------------
const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));
const isPoly = (p) => Array.isArray(p) && p.every(isPoint);
const isFiniteNum = (n) => typeof n === "number" && Number.isFinite(n);

function validateExclusionZones(zones, errors) {
  if (!Array.isArray(zones)) { errors.push('"exclusionZones" must be an array'); return; }
  zones.forEach((z, i) => {
    if (!z || typeof z.id !== "string" || !isPoly(z.poly) || z.poly.length < 3) {
      errors.push(`exclusionZones[${i}] is malformed`);
    }
  });
}

function validateBoundaryFields(obj, errors) {
  if (!isFiniteNum(obj.gardenW) || !isFiniteNum(obj.gardenH)) errors.push('"gardenW"/"gardenH" must be numbers');
  if (!isPoly(obj.gardenBoundary)) errors.push('"gardenBoundary" must be an array of [x,y] points');
  else if (obj.gardenBoundary.length > 0 && obj.gardenBoundary.length < 3) errors.push('"gardenBoundary" needs at least 3 points');
  if (obj.boundaryShapeKind !== "rect" && obj.boundaryShapeKind !== "freeform") errors.push('"boundaryShapeKind" must be "rect" or "freeform"');
  validateExclusionZones(obj.exclusionZones, errors);
}

function validateAnchorsAndConnections(obj, errors) {
  if (!Array.isArray(obj.anchors)) errors.push('"anchors" must be an array');
  else obj.anchors.forEach((a, i) => {
    if (!a || typeof a.id !== "string" || !isFiniteNum(a.x) || !isFiniteNum(a.y)) errors.push(`anchors[${i}] is malformed`);
  });
  if (!Array.isArray(obj.connections)) errors.push('"connections" must be an array');
  else obj.connections.forEach((c, i) => {
    if (!c || typeof c.a !== "string" || typeof c.b !== "string" || !isFiniteNum(c.widthMm)) errors.push(`connections[${i}] is malformed`);
  });
}

function validateMeanderPaths(obj, errors) {
  if (!Array.isArray(obj.meanderPaths)) { errors.push('"meanderPaths" must be an array'); return; }
  obj.meanderPaths.forEach((m, i) => {
    if (!m || typeof m.id !== "string" || !isPoly(m.waypoints) || m.waypoints.length < 2) {
      errors.push(`meanderPaths[${i}] is malformed`);
    }
  });
}

// Inspects a parsed JSON payload and reports which kind of save file it is (if any) plus
// any structural problems found. Callers decide what to do with `errors` -- currently App.jsx
// blocks import entirely on any error rather than trying to partially recover.
export function validateImportPayload(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { kind: null, errors: ["File does not contain a JSON object."] };
  }

  const kind = obj.type === DESIGN_FILE_TYPE ? "design" : obj.type === BOUNDARY_FILE_TYPE ? "boundary" : null;
  if (!kind) {
    return { kind: null, errors: [`Unrecognized file type "${obj.type}" -- expected "${DESIGN_FILE_TYPE}" or "${BOUNDARY_FILE_TYPE}".`] };
  }

  const errors = [];
  validateBoundaryFields(obj, errors);
  if (kind === "design") {
    validateAnchorsAndConnections(obj, errors);
    validateMeanderPaths(obj, errors);
    for (const f of DESIGN_ONLY_FIELD_NAMES) {
      if (!(f in obj)) errors.push(`missing field "${f}"`);
    }
  }
  return { kind, errors };
}

// highest numeric suffix found among ids like "a12" -- lets the caller bump its own id
// counter past anything just imported, so newly created ids never collide with them
export function maxIdSuffix(ids) {
  let max = 0;
  for (const id of ids) {
    const m = typeof id === "string" ? /^[a-zA-Z]*(\d+)$/.exec(id) : null;
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}
