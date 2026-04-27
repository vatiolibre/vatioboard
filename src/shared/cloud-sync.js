import { createEmptyBoardDrawing, loadBoardDrawing, saveBoardDrawing } from "../board/storage.js";
import { MAX_RUNS } from "../accel/constants.js";
import { isAccelPayloadComplete, loadRuns, saveRuns } from "../accel/storage.js";
import {
  MAX_STORED_REPLAYS,
  isReplayPayloadComplete,
  loadReplayLibrary,
  loadReplaySessionById,
  removeReplayRecording,
  saveReplayLibrary,
} from "../replay/session.js";
import { createIndexedJsonKeyValueStore } from "./indexed-storage.js";
import {
  BACKEND_AUTH_STATE_EVENT,
  downloadSyncPayloadFromBackend,
  getBackendFeatureAccessState,
  getProtectedCloudSyncRequestGate,
  getBackendSessionState,
  pullSyncChangesFromBackend,
  pushSyncChangesToBackend,
} from "./backend-auth.js";
import { hasSingleTabOwnership, SINGLE_TAB_OWNERSHIP_EVENT } from "./single-tab.js";
import { createStorageCapability } from "./storage-capability.js";
import { loadJson, loadText, removeStoredValue, saveJson, saveText } from "./storage.js";

export const CLOUD_SYNC_ENTITY_TYPES = Object.freeze({
  accelRun: "accel_run",
  boardDrawing: "board_drawing",
  replaySession: "replay_session",
});

export const CLOUD_SYNC_APPLIED_EVENT = "vatioboard:cloud-sync-applied";
export const CLOUD_SYNC_STATUS_EVENT = "vatioboard:cloud-sync-status";
export const CLOUD_SYNC_STATUS_STATES = Object.freeze({
  failed: "failed",
  localOnly: "local_only",
  paused: "paused",
  synced: "synced",
  syncing: "syncing",
});

const CLOUD_SYNC_DEVICE_KEY = "vatioboard.cloud_sync.device_id";
const CLOUD_SYNC_LOCK_NAME = "vatioboard:cloud-sync";
const CLOUD_SYNC_DB_NAME = "vatioboard-cloud-sync";
const CLOUD_SYNC_DB_STORE = "cloudSyncState";
const CLOUD_SYNC_DB_VERSION = 1;
const CLOUD_SYNC_OUTBOX_KEY = "outbox";
const CLOUD_SYNC_STATE_KEY = "state";
const CLOUD_SYNC_OUTBOX_FALLBACK_KEY = "vatioboard.cloud_sync.outbox";
const CLOUD_SYNC_STATE_FALLBACK_KEY = "vatioboard.cloud_sync.state";
const CLOUD_SYNC_BOOTSTRAP_VERSION = 2;
const CLOUD_SYNC_PULL_LIMIT = 100;
const CLOUD_SYNC_PUSH_BATCH_SIZE = 25;
const CLOUD_SYNC_RETRY_MS = 5000;
const CLOUD_SYNC_BOARD_RECORD_ID = "primary";
const MAX_PULL_PAGES_PER_PASS = 20;
const CLOUD_SYNC_IMMEDIATE_REQUEST_THROTTLE_MS = 1000;

const syncStore = createIndexedJsonKeyValueStore({
  dbName: CLOUD_SYNC_DB_NAME,
  dbVersion: CLOUD_SYNC_DB_VERSION,
  storeName: CLOUD_SYNC_DB_STORE,
});
const syncStoreCapability = createStorageCapability({
  namespace: "cloud-sync-state",
  store: syncStore,
});

let listenersInstalled = false;
let syncScheduled = false;
let syncTimerId = null;
let syncChain = Promise.resolve();
let syncInFlight = false;
let syncRetryRequested = false;
let activeSyncPromise = null;
let outboxMutationChain = Promise.resolve();
let releaseSyncLock = null;
let activeSyncAbortController = null;
let backendAuthenticated = null;
let logoutPending = false;
const suppressedPayloadDownloadWarnings = new Set();
let lastImmediateSyncRequestAtMs = 0;
let cloudSyncStatus = {
  state: CLOUD_SYNC_STATUS_STATES.syncing,
  reason: "starting",
  lastSuccessAtMs: 0,
  lastFailureAtMs: 0,
  lastFailureMessage: "",
  pendingByEntity: {},
};

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizePositiveInteger(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function getEntityKey(entityType, recordId) {
  return `${String(entityType || "").trim()}:${String(recordId || "").trim()}`;
}

function isCloudSyncDevMode() {
  return Boolean(
    import.meta.env?.DEV
    || import.meta.env?.MODE === "test"
    || globalThis.process?.env?.NODE_ENV === "test"
  );
}

function warnRepeatedPayloadDownloadSuppressed(name) {
  if (!isCloudSyncDevMode()) return;
  const normalizedName = String(name || "").trim();
  if (!normalizedName || suppressedPayloadDownloadWarnings.has(normalizedName)) return;
  suppressedPayloadDownloadWarnings.add(normalizedName);
  console.warn(`[cloud-sync] repeated payload download suppressed: ${normalizedName}`);
}

function hashString(value) {
  const source = String(value || "");
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }

  return `h${Math.abs(hash)}`;
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function createDeviceId() {
  return `device-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function getDeviceId() {
  let deviceId = loadText(CLOUD_SYNC_DEVICE_KEY, "").trim();
  if (!deviceId) {
    deviceId = createDeviceId();
    saveText(CLOUD_SYNC_DEVICE_KEY, deviceId);
  }
  return deviceId;
}

function emitCloudSyncApplied(detail) {
  if (
    typeof window === "undefined"
    || typeof window.dispatchEvent !== "function"
    || typeof CustomEvent !== "function"
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(CLOUD_SYNC_APPLIED_EVENT, {
      detail,
    })
  );
}

function clonePendingByEntity(pendingByEntity) {
  if (!pendingByEntity || typeof pendingByEntity !== "object") {
    return {};
  }

  return { ...pendingByEntity };
}

function emitCloudSyncStatus(detail) {
  if (
    typeof window === "undefined"
    || typeof window.dispatchEvent !== "function"
    || typeof CustomEvent !== "function"
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(CLOUD_SYNC_STATUS_EVENT, {
      detail,
    })
  );
}

function setCloudSyncStatus(nextStatus = {}) {
  cloudSyncStatus = {
    ...cloudSyncStatus,
    ...nextStatus,
    pendingByEntity:
      nextStatus.pendingByEntity === undefined
        ? cloudSyncStatus.pendingByEntity
        : clonePendingByEntity(nextStatus.pendingByEntity),
  };
  emitCloudSyncStatus(getCloudSyncStatus());
}

function countPendingByEntity(outbox) {
  const pendingByEntity = {};

  for (const entry of normalizeOutboxEntries(outbox)) {
    pendingByEntity[entry.entityType] = (pendingByEntity[entry.entityType] || 0) + 1;
  }

  return pendingByEntity;
}

function syncCloudSyncPendingStatus(outbox) {
  setCloudSyncStatus({
    pendingByEntity: countPendingByEntity(outbox),
  });
}

function setCloudSyncSkippedState(reason = "") {
  if (reason === "auth" || reason === "guest" || reason === "disabled") {
    setCloudSyncStatus({
      state: CLOUD_SYNC_STATUS_STATES.localOnly,
      reason,
    });
    return;
  }

  if (
    reason === "ownership"
    || reason === "lease"
    || reason === "offline"
    || reason === "aborted"
    || reason === "logout"
  ) {
    setCloudSyncStatus({
      state: CLOUD_SYNC_STATUS_STATES.paused,
      reason,
    });
    return;
  }

  if (reason === "unavailable") {
    setCloudSyncStatus({
      state: CLOUD_SYNC_STATUS_STATES.failed,
      reason,
      lastFailureAtMs: Date.now(),
      lastFailureMessage: "",
    });
    return;
  }

  setCloudSyncStatus({
    state: CLOUD_SYNC_STATUS_STATES.localOnly,
    reason,
  });
}

export function getCloudSyncStatus() {
  return {
    ...cloudSyncStatus,
    pendingByEntity: clonePendingByEntity(cloudSyncStatus.pendingByEntity),
  };
}

function isCloudSyncAuthAllowed() {
  return logoutPending !== true && backendAuthenticated !== false;
}

function isAbortError(error) {
  return Boolean(
    error
    && (
      error.name === "AbortError"
      || error.code === 20
    )
  );
}

function abortActiveCloudSync() {
  if (!activeSyncAbortController) return;
  try {
    activeSyncAbortController.abort();
  } catch {
    // Ignore abort failures while fencing off active sync work.
  }
}

function isCloudSyncAccessBlockedResult(result) {
  const status = Number(result?.status) || 0;
  return (
    result?.blockedByAuth === true
    || result?.blockedByFeature === true
    || status === 401
    || status === 403
  );
}

function getCloudSyncBlockedReason(result, fallback = "disabled") {
  const status = Number(result?.status) || 0;
  if (result?.blockedByAuth === true || status === 401) {
    return "auth";
  }
  return String(result?.reason || fallback || "disabled").trim() || "disabled";
}

function settleCloudSyncAccessBlocked(result) {
  const reason = getCloudSyncBlockedReason(result);
  if (reason === "auth") {
    backendAuthenticated = false;
  }
  syncRetryRequested = false;
  clearScheduledSyncTimer();
  setCloudSyncSkippedState(reason);
  abortActiveCloudSync();
  return {
    blocked: true,
    reason,
    status: Number(result?.status) || 0,
  };
}

function getStateRecords(state) {
  return state?.records && typeof state.records === "object" && !Array.isArray(state.records)
    ? state.records
    : {};
}

function normalizeStateRecords(records) {
  const normalizedRecords = {};

  for (const record of Object.values(getStateRecords({ records }))) {
    const meta = normalizeRecordMeta(record);
    if (!meta) continue;
    normalizedRecords[getEntityKey(meta.entityType, meta.clientRecordId)] = meta;
  }

  return normalizedRecords;
}

function compareCloudRecordMetaFreshness(left, right) {
  const leftServerVersion = normalizePositiveInteger(Number(left?.serverVersion), 0);
  const rightServerVersion = normalizePositiveInteger(Number(right?.serverVersion), 0);
  if (leftServerVersion !== rightServerVersion) return leftServerVersion - rightServerVersion;

  const leftClientUpdatedAtMs = normalizePositiveInteger(Number(left?.clientUpdatedAtMs), 0);
  const rightClientUpdatedAtMs = normalizePositiveInteger(Number(right?.clientUpdatedAtMs), 0);
  if (leftClientUpdatedAtMs !== rightClientUpdatedAtMs) {
    return leftClientUpdatedAtMs - rightClientUpdatedAtMs;
  }

  const leftModified = String(left?.modified || "");
  const rightModified = String(right?.modified || "");
  if (leftModified === rightModified) return 0;
  return leftModified > rightModified ? 1 : -1;
}

function mergeCloudSyncRecords(indexedRecords, fallbackRecords) {
  const merged = { ...normalizeStateRecords(indexedRecords) };

  for (const [key, fallbackMeta] of Object.entries(normalizeStateRecords(fallbackRecords))) {
    const indexedMeta = merged[key];
    if (!indexedMeta || compareCloudRecordMetaFreshness(indexedMeta, fallbackMeta) < 0) {
      merged[key] = fallbackMeta;
    }
  }

  return merged;
}

function isValidCloudSyncState(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (
      typeof value.cursor === "string"
      || Number.isFinite(Number(value.bootstrapVersion))
      || (value.records && typeof value.records === "object" && !Array.isArray(value.records))
    )
  );
}

async function loadCloudSyncState() {
  const indexedDbUsable = await syncStoreCapability.isIndexedDbUsable();
  const indexedValue = indexedDbUsable
    ? await syncStore.getValue(CLOUD_SYNC_STATE_KEY)
    : undefined;
  const fallbackValue = loadJson(CLOUD_SYNC_STATE_FALLBACK_KEY, {});
  const hasIndexedState = indexedDbUsable && isValidCloudSyncState(indexedValue);
  const indexedState = hasIndexedState ? indexedValue : {};
  const fallbackState = isValidCloudSyncState(fallbackValue) ? fallbackValue : {};
  const cursor = hasIndexedState
    ? (typeof indexedState.cursor === "string" ? indexedState.cursor : "")
    : (typeof fallbackState.cursor === "string" ? fallbackState.cursor : "");

  return {
    cursor,
    bootstrapVersion: Math.max(
      normalizePositiveInteger(Number(indexedState.bootstrapVersion), 0),
      normalizePositiveInteger(Number(fallbackState.bootstrapVersion), 0)
    ),
    records: mergeCloudSyncRecords(indexedState.records, fallbackState.records),
  };
}

async function saveCloudSyncState(state) {
  const snapshot = cloneJson(
    {
      cursor: typeof state?.cursor === "string" ? state.cursor : "",
      bootstrapVersion: normalizePositiveInteger(state?.bootstrapVersion, 0),
      records: normalizeStateRecords(state?.records),
    },
    {
      cursor: "",
      bootstrapVersion: 0,
      records: {},
    }
  );
  const stored = (await syncStoreCapability.isIndexedDbUsable())
    ? await syncStore.setValue(CLOUD_SYNC_STATE_KEY, snapshot)
    : false;
  if (!stored) {
    saveJson(CLOUD_SYNC_STATE_FALLBACK_KEY, snapshot);
  } else {
    removeStoredValue(CLOUD_SYNC_STATE_FALLBACK_KEY);
  }
}

async function loadCloudSyncOutbox() {
  const indexedValue = await syncStoreCapability.isIndexedDbUsable()
    ? await syncStore.getValue(CLOUD_SYNC_OUTBOX_KEY)
    : undefined;
  const storedValue =
    indexedValue !== undefined ? indexedValue : loadJson(CLOUD_SYNC_OUTBOX_FALLBACK_KEY, []);
  return Array.isArray(storedValue) ? storedValue : [];
}

async function saveCloudSyncOutbox(outbox) {
  const snapshot = cloneJson(Array.isArray(outbox) ? outbox : [], []);
  const stored = (await syncStoreCapability.isIndexedDbUsable())
    ? await syncStore.setValue(CLOUD_SYNC_OUTBOX_KEY, snapshot)
    : false;
  if (!stored) {
    saveJson(CLOUD_SYNC_OUTBOX_FALLBACK_KEY, snapshot);
  }
}

function normalizeOutboxEntries(outbox) {
  return (Array.isArray(outbox) ? outbox : []).map(normalizeQueuedChange).filter(Boolean);
}

function normalizeQueuedChange(change) {
  if (!change || typeof change !== "object") return null;
  const entityType = String(change.entityType || "").trim();
  const recordId = String(change.recordId || "").trim();
  if (!entityType || !recordId) return null;

  const deletedAtMs = normalizePositiveInteger(change.deletedAtMs, 0);
  const updatedAtMs = normalizePositiveInteger(
    change.updatedAtMs,
    deletedAtMs || Date.now()
  );
  const payloadMode =
    deletedAtMs > 0
      ? "deleted"
      : String(
        change.payloadMode
        || (Object.prototype.hasOwnProperty.call(change, "payload") ? "inline" : "lazy")
      ).trim().toLowerCase() || "inline";
  const payload = deletedAtMs || payloadMode === "lazy"
    ? null
    : cloneJson(change.payload, null);
  const contentHash =
    typeof change.contentHash === "string" && change.contentHash
      ? change.contentHash
      : (
        payload === null
          ? (deletedAtMs ? hashString(`deleted:${deletedAtMs}`) : "")
          : hashString(stableStringify(payload))
      );

  return {
    entityType,
    recordId,
    deviceId: String(change.deviceId || getDeviceId()).trim(),
    recordTitle: String(change.recordTitle || "").trim(),
    updatedAtMs,
    deletedAtMs,
    contentHash,
    payload,
    payloadMode,
    manifest: deletedAtMs ? null : cloneJson(change.manifest, null),
  };
}

function areQueuedChangesEquivalent(left, right) {
  const normalizedLeft = normalizeQueuedChange(left);
  const normalizedRight = normalizeQueuedChange(right);
  if (!normalizedLeft || !normalizedRight) return false;

  return (
    normalizedLeft.entityType === normalizedRight.entityType
    && normalizedLeft.recordId === normalizedRight.recordId
    && normalizedLeft.deviceId === normalizedRight.deviceId
    && normalizedLeft.updatedAtMs === normalizedRight.updatedAtMs
    && normalizedLeft.deletedAtMs === normalizedRight.deletedAtMs
    && normalizedLeft.contentHash === normalizedRight.contentHash
    && normalizedLeft.payloadMode === normalizedRight.payloadMode
  );
}

function normalizeRecordMeta(record) {
  if (!record || typeof record !== "object") return null;
  const entityType = String(record.entity_type || record.entityType || "").trim();
  const clientRecordId = String(record.client_record_id || record.clientRecordId || "").trim();
  const name = String(record.name || "").trim();
  if (!entityType || !clientRecordId || !name) return null;

  return {
    name,
    entityType,
    clientRecordId,
    deviceId: String(record.device_id || record.deviceId || "").trim(),
    recordTitle: String(record.record_title || record.recordTitle || "").trim(),
    contentHash: String(record.content_hash || record.contentHash || "").trim(),
    clientUpdatedAtMs: normalizePositiveInteger(
      Number(record.client_updated_at_ms || record.clientUpdatedAtMs),
      0
    ),
    deletedAtMs: normalizePositiveInteger(
      Number(record.deleted_at_ms || record.deletedAtMs),
      0
    ),
    serverVersion: normalizePositiveInteger(
      Number(record.server_version || record.serverVersion),
      0
    ),
    payloadSize: normalizePositiveInteger(Number(record.payload_size || record.payloadSize), 0),
    modified: String(record.modified || "").trim(),
  };
}

function isSameAppliedCloudRecord(previousMeta, nextMeta) {
  return Boolean(
    previousMeta
    && nextMeta
    && previousMeta.name === nextMeta.name
    && Number(previousMeta.serverVersion) === Number(nextMeta.serverVersion)
    && String(previousMeta.contentHash || "") === String(nextMeta.contentHash || "")
    && String(previousMeta.clientUpdatedAtMs || "") === String(nextMeta.clientUpdatedAtMs || "")
    && Number(previousMeta.deletedAtMs || 0) === Number(nextMeta.deletedAtMs || 0)
  );
}

async function findCloudSyncRecordMeta(entityType, recordId) {
  const normalizedEntityType = String(entityType || "").trim();
  const normalizedRecordId = String(recordId || "").trim();
  if (!normalizedEntityType || !normalizedRecordId) return null;

  const state = await loadCloudSyncState();
  return normalizeRecordMeta(state.records[getEntityKey(normalizedEntityType, normalizedRecordId)]);
}

function createQueuedChangePayload(change) {
  return {
    entity_type: change.entityType,
    client_record_id: change.recordId,
    device_id: change.deviceId,
    updated_at_ms: change.updatedAtMs,
    deleted_at_ms: change.deletedAtMs || undefined,
    content_hash: change.contentHash,
    record_title: change.recordTitle || undefined,
    payload: change.payload,
  };
}

function countArrayItems(value) {
  return Array.isArray(value) ? value.length : 0;
}

function createReplaySessionManifest(session) {
  if (!session || typeof session !== "object") return null;

  return {
    id: String(session.id || "").trim(),
    startedAtMs: normalizePositiveInteger(session.startedAtMs, 0),
    endedAtMs: normalizePositiveInteger(session.endedAtMs, 0),
    updatedAtMs: normalizePositiveInteger(session.updatedAtMs, 0),
    unit: String(session.unit || "").trim() || "kmh",
    distanceUnit: String(session.distanceUnit || "").trim() || "m",
    sampleCount: normalizePositiveInteger(
      session.sampleCount ?? session.persistedSampleCount ?? countArrayItems(session.samples),
      0
    ),
    totalDistanceM: Number.isFinite(session.totalDistanceM) ? session.totalDistanceM : 0,
    maxSpeedMs: Number.isFinite(session.maxSpeedMs) ? session.maxSpeedMs : 0,
    minAltitudeM: Number.isFinite(session.minAltitudeM) ? session.minAltitudeM : 0,
    maxAltitudeM: Number.isFinite(session.maxAltitudeM) ? session.maxAltitudeM : 0,
    startPlace: cloneJson(session.startPlace, null),
    endPlace: cloneJson(session.endPlace, null),
    recordingState: String(session.recordingState || "").trim() || "stopped",
    contentHash: String(session.contentHash || "").trim(),
    previewRoute: cloneJson(session.previewRoute, null)
      ?? buildPreviewRouteFromSamples(session.samples),
  };
}

/**
 * Build a lightweight [lon, lat][] preview route from GPS samples.
 * Downsamples to at most 200 points to keep the manifest small.
 */
function buildPreviewRouteFromSamples(samples, maxPoints = 200) {
  if (!Array.isArray(samples) || samples.length < 2) return null;

  const coords = [];
  for (const s of samples) {
    const lat = Number(s?.latitude);
    const lon = Number(s?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      coords.push([lon, lat]);
    }
  }

  if (coords.length < 2) return null;

  if (coords.length <= maxPoints) return coords;

  const step = (coords.length - 1) / (maxPoints - 1);
  const result = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(coords[Math.floor(i * step)]);
  }
  result.push(coords[coords.length - 1]);
  return result;
}

function createAccelRunManifest(run) {
  if (!run || typeof run !== "object") return null;

  return {
    id: String(run.id || "").trim(),
    presetId: String(run.presetId || "").trim(),
    presetSignature: String(run.presetSignature || "").trim(),
    elapsedMs: Number.isFinite(run.elapsedMs) ? run.elapsedMs : 0,
    savedAtMs: normalizePositiveInteger(run.savedAtMs ?? run.updatedAtMs, 0),
    qualityGrade: String(run.qualityGrade || "").trim(),
    qualityScore: Number.isFinite(run.qualityScore) ? run.qualityScore : null,
    warningKeys: Array.isArray(run.warningKeys) ? run.warningKeys.slice() : [],
    startPlace: cloneJson(run.startPlace, null),
    endPlace: cloneJson(run.endPlace, null),
    sampleCount: normalizePositiveInteger(run.sampleCount ?? countArrayItems(run.sampleLog), 0),
    contentHash: String(run.contentHash || "").trim(),
  };
}

function createBoardDrawingManifest(drawing) {
  if (!drawing || typeof drawing !== "object") return null;

  return {
    updatedAtMs: normalizePositiveInteger(drawing.updatedAtMs, 0),
    commandCount: countArrayItems(drawing.commands),
    redoCommandCount: countArrayItems(drawing.redoCommands),
    generation: String(drawing.generation || "").trim(),
    contentHash: String(drawing.contentHash || "").trim(),
  };
}

function mutateCloudSyncOutbox(mutator) {
  const mutationPromise = outboxMutationChain.catch(() => {}).then(async () => {
    const currentOutbox = normalizeOutboxEntries(await loadCloudSyncOutbox());
    const result = await mutator(currentOutbox);
    const nextOutbox = normalizeOutboxEntries(result?.nextOutbox ?? currentOutbox);
    await saveCloudSyncOutbox(nextOutbox);
    syncCloudSyncPendingStatus(nextOutbox);
    return result?.value;
  });

  outboxMutationChain = mutationPromise.catch(() => {});
  return mutationPromise;
}

async function queueNormalizedCloudSyncChange(change) {
  const normalized = normalizeQueuedChange(change);
  if (!normalized) return false;

  return mutateCloudSyncOutbox((outbox) => {
    const entityKey = getEntityKey(normalized.entityType, normalized.recordId);
    const nextOutbox = [];
    let replaced = false;

    for (const entry of outbox) {
      if (getEntityKey(entry.entityType, entry.recordId) === entityKey) {
        replaced = true;
        nextOutbox.push(normalized);
        continue;
      }
      nextOutbox.push(entry);
    }

    if (!replaced) {
      nextOutbox.push(normalized);
    }

    return {
      nextOutbox,
      value: true,
    };
  });
}

async function queueBootstrapReplayChanges(stateRecords, outboxMap) {
  const queuedChanges = [];
  const replayLibrary = await loadReplayLibrary();

  for (const session of replayLibrary) {
    if (!session?.id) continue;
    const entityKey = getEntityKey(CLOUD_SYNC_ENTITY_TYPES.replaySession, session.id);
    const known = stateRecords[entityKey];
    const outboxEntry = outboxMap.get(entityKey);
    const updatedAtMs = normalizePositiveInteger(
      session.updatedAtMs ?? session.endedAtMs ?? session.startedAtMs,
      0
    );
    if (
      outboxEntry
      || (known
        && normalizePositiveInteger(known.clientUpdatedAtMs, 0) >= updatedAtMs
        && known.deletedAtMs === 0)
    ) {
      continue;
    }

    queuedChanges.push(
      normalizeQueuedChange({
        entityType: CLOUD_SYNC_ENTITY_TYPES.replaySession,
        recordId: session.id,
        recordTitle: session.startPlace?.label || session.id,
        updatedAtMs,
        payloadMode: "lazy",
        contentHash: String(session.contentHash || "").trim(),
        manifest: createReplaySessionManifest(session),
      })
    );
  }

  return queuedChanges.filter(Boolean);
}

async function queueBootstrapAccelChanges(stateRecords, outboxMap) {
  const queuedChanges = [];
  const runs = await loadRuns();

  for (const run of runs) {
    if (!run?.id) continue;
    const entityKey = getEntityKey(CLOUD_SYNC_ENTITY_TYPES.accelRun, run.id);
    const known = stateRecords[entityKey];
    const outboxEntry = outboxMap.get(entityKey);
    const updatedAtMs = normalizePositiveInteger(run.savedAtMs ?? run.updatedAtMs, 0);

    if (
      outboxEntry
      || (known
        && normalizePositiveInteger(known.clientUpdatedAtMs, 0) >= updatedAtMs
        && known.deletedAtMs === 0)
    ) {
      continue;
    }

    queuedChanges.push(
      normalizeQueuedChange({
        entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
        recordId: run.id,
        recordTitle: run.presetId || run.id,
        updatedAtMs,
        payloadMode: "lazy",
        contentHash: String(run.contentHash || "").trim(),
        manifest: createAccelRunManifest(run),
      })
    );
  }

  return queuedChanges.filter(Boolean);
}

async function queueBootstrapBoardChange(stateRecords, outboxMap) {
  const drawing = await loadBoardDrawing();
  const updatedAtMs = normalizePositiveInteger(drawing?.updatedAtMs, 0);
  if (updatedAtMs === 0) return [];

  const entityKey = getEntityKey(
    CLOUD_SYNC_ENTITY_TYPES.boardDrawing,
    CLOUD_SYNC_BOARD_RECORD_ID
  );
  const known = stateRecords[entityKey];
  const outboxEntry = outboxMap.get(entityKey);

  if (
    outboxEntry
    || (known
      && normalizePositiveInteger(known.clientUpdatedAtMs, 0) >= updatedAtMs
      && known.deletedAtMs === 0)
  ) {
    return [];
  }

  return [
    normalizeQueuedChange({
      entityType: CLOUD_SYNC_ENTITY_TYPES.boardDrawing,
      recordId: CLOUD_SYNC_BOARD_RECORD_ID,
      recordTitle: "Board",
      updatedAtMs,
      payloadMode: "lazy",
      contentHash: String(drawing.contentHash || "").trim(),
      manifest: createBoardDrawingManifest(drawing),
    }),
  ].filter(Boolean);
}

async function bootstrapLocalCloudSyncChanges() {
  const [state, outbox] = await Promise.all([loadCloudSyncState(), loadCloudSyncOutbox()]);
  if (state.bootstrapVersion >= CLOUD_SYNC_BOOTSTRAP_VERSION) {
    return;
  }
  const outboxMap = new Map(
    normalizeOutboxEntries(outbox)
      .map((entry) => [getEntityKey(entry.entityType, entry.recordId), entry])
  );

  const queuedChanges = [
    ...(await queueBootstrapReplayChanges(state.records, outboxMap)),
    ...(await queueBootstrapAccelChanges(state.records, outboxMap)),
    ...(await queueBootstrapBoardChange(state.records, outboxMap)),
  ];

  if (queuedChanges.length > 0) {
    await mutateCloudSyncOutbox((latestOutbox) => {
      const latestOutboxMap = new Map(
        latestOutbox.map((entry) => [getEntityKey(entry.entityType, entry.recordId), entry])
      );
      const nextOutbox = latestOutbox.slice();

      for (const change of queuedChanges) {
        const entityKey = getEntityKey(change.entityType, change.recordId);
        if (latestOutboxMap.has(entityKey)) continue;
        latestOutboxMap.set(entityKey, change);
        nextOutbox.push(change);
      }

      return {
        nextOutbox,
      };
    });
  }

  await saveCloudSyncState({
    ...state,
    bootstrapVersion: CLOUD_SYNC_BOOTSTRAP_VERSION,
  });
}

async function acquireSyncLease() {
  if (!hasSingleTabOwnership()) return false;

  if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") {
    return true;
  }

  return new Promise((resolve) => {
    let settled = false;
    let releaseHold = () => {};
    const holdPromise = new Promise((release) => {
      releaseHold = release;
    });

    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const requestPromise = navigator.locks.request(
        CLOUD_SYNC_LOCK_NAME,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            settle(false);
            return;
          }

          releaseSyncLock = () => {
            releaseSyncLock = null;
            releaseHold();
          };
          settle(true);
          await holdPromise;
        }
      );

      Promise.resolve(requestPromise).catch(() => {
        releaseSyncLock = null;
        settle(true);
      });
    } catch {
      releaseSyncLock = null;
      settle(true);
    }
  });
}

function releaseSyncLease() {
  if (typeof releaseSyncLock === "function") {
    try {
      releaseSyncLock();
    } catch {
      // Ignore sync lock release failures.
    }
  }
  releaseSyncLock = null;
}

async function applyReplayRecord(meta, payload) {
  if (!isReplayPayloadComplete(payload)) {
    return;
  }

  const library = await loadReplayLibrary();
  const nextLibrary = library.filter((entry) => entry.id !== meta.clientRecordId);
  nextLibrary.unshift(cloneJson(payload, null));
  await saveReplayLibrary(nextLibrary.slice(0, MAX_STORED_REPLAYS));
}

async function deleteReplayRecord(meta) {
  await removeReplayRecording(meta.clientRecordId);
}

async function applyAccelRun(meta, payload) {
  if (!isAccelPayloadComplete(payload)) {
    return;
  }

  const runs = await loadRuns();
  const nextRuns = runs.filter((entry) => entry.id !== meta.clientRecordId);
  nextRuns.unshift(cloneJson(payload, null));
  nextRuns.sort((left, right) => (right.savedAtMs || 0) - (left.savedAtMs || 0));
  await saveRuns(nextRuns.slice(0, MAX_RUNS));
}

async function deleteAccelRun(meta) {
  const runs = await loadRuns();
  await saveRuns(runs.filter((entry) => entry.id !== meta.clientRecordId));
}

async function applyBoardDrawing(meta, payload) {
  const localDrawing = await loadBoardDrawing();
  const localUpdatedAtMs = normalizePositiveInteger(localDrawing?.updatedAtMs, 0);

  if (localUpdatedAtMs > meta.clientUpdatedAtMs) {
    return;
  }

  await saveBoardDrawing(payload || createEmptyBoardDrawing());
}

async function deleteBoardDrawing() {
  // Board sync uses empty snapshots instead of tombstones.
}

async function applyRemoteCloudRecord(meta, payload) {
  if (meta.entityType === CLOUD_SYNC_ENTITY_TYPES.replaySession) {
    await applyReplayRecord(meta, payload);
    return;
  }
  if (meta.entityType === CLOUD_SYNC_ENTITY_TYPES.accelRun) {
    await applyAccelRun(meta, payload);
    return;
  }
  if (meta.entityType === CLOUD_SYNC_ENTITY_TYPES.boardDrawing) {
    await applyBoardDrawing(meta, payload);
  }
}

export async function restoreCloudSyncRecord({
  entityType,
  recordId,
  signal,
} = {}) {
  const result = await downloadCloudSyncRecord({
    entityType,
    recordId,
    signal,
  });
  if (result?.ok !== true) {
    return result;
  }

  await applyRemoteCloudRecord(result.meta, result.payload);
  return {
    ok: true,
    reason: "",
    status: result.status,
    meta: result.meta,
    payload: result.payload,
  };
}

export async function downloadCloudSyncRecord({
  entityType,
  recordId,
  onPayloadDownloadStart,
  signal,
} = {}) {
  const meta = await findCloudSyncRecordMeta(entityType, recordId);
  if (!meta || meta.deletedAtMs > 0) {
    return {
      ok: false,
      reason: "missing",
      meta: null,
      payload: null,
    };
  }

  let gate = null;
  try {
    gate = await getProtectedCloudSyncRequestGate({ signal });
    if (!gate.allowed) {
      const blocked = settleCloudSyncAccessBlocked(gate);
      return {
        ok: false,
        reason: blocked.reason,
        status: blocked.status,
        meta,
        payload: null,
        blockedByAuth: gate.blockedByAuth === true,
        blockedByFeature: gate.blockedByFeature === true,
      };
    }

    const payloadRequest = {
      name: meta.name,
      signal: gate.signal,
    };
    if (typeof onPayloadDownloadStart === "function") {
      payloadRequest.onRequestStart = onPayloadDownloadStart;
    }

    const payloadResult = await downloadSyncPayloadFromBackend(payloadRequest);
    if (isCloudSyncAccessBlockedResult(payloadResult)) {
      const blocked = settleCloudSyncAccessBlocked(payloadResult);
      return {
        ok: false,
        reason: blocked.reason,
        status: blocked.status,
        meta,
        payload: null,
        blockedByAuth: payloadResult.blockedByAuth === true,
        blockedByFeature: payloadResult.blockedByFeature === true,
      };
    }
    if (!payloadResult.ok || payloadResult.payload === null || payloadResult.payload === undefined) {
      return {
        ok: false,
        reason: "download_failed",
        status: payloadResult.status,
        meta,
        payload: null,
      };
    }

    return {
      ok: true,
      reason: "",
      status: payloadResult.status,
      meta,
      payload: payloadResult.payload,
    };
  } finally {
    gate?.cleanup?.();
  }
}

async function applyRemoteCloudDeletion(meta) {
  if (meta.entityType === CLOUD_SYNC_ENTITY_TYPES.replaySession) {
    await deleteReplayRecord(meta);
    return;
  }
  if (meta.entityType === CLOUD_SYNC_ENTITY_TYPES.accelRun) {
    await deleteAccelRun(meta);
    return;
  }
  if (meta.entityType === CLOUD_SYNC_ENTITY_TYPES.boardDrawing) {
    await deleteBoardDrawing(meta);
  }
}

async function hydrateReplayChangePayload(change) {
  return loadReplaySessionById(change.recordId);
}

async function hydrateAccelChangePayload(change) {
  const runs = await loadRuns();
  return runs.find((entry) => entry.id === change.recordId) ?? null;
}

async function hydrateBoardChangePayload() {
  return loadBoardDrawing();
}

function getHydratedRecordTitle(change, payload) {
  if (!payload || typeof payload !== "object") {
    return change.recordTitle || change.recordId;
  }

  if (change.entityType === CLOUD_SYNC_ENTITY_TYPES.replaySession) {
    return payload.startPlace?.label || payload.id || change.recordTitle || change.recordId;
  }
  if (change.entityType === CLOUD_SYNC_ENTITY_TYPES.accelRun) {
    return payload.presetId || payload.id || change.recordTitle || change.recordId;
  }
  if (change.entityType === CLOUD_SYNC_ENTITY_TYPES.boardDrawing) {
    return change.recordTitle || "Board";
  }

  return change.recordTitle || change.recordId;
}

async function hydrateQueuedChangeForPush(change) {
  const normalized = normalizeQueuedChange(change);
  if (!normalized) return null;
  if (normalized.deletedAtMs > 0 || normalized.payloadMode !== "lazy") {
    return normalized;
  }

  let payload = null;
  if (normalized.entityType === CLOUD_SYNC_ENTITY_TYPES.replaySession) {
    payload = await hydrateReplayChangePayload(normalized);
  } else if (normalized.entityType === CLOUD_SYNC_ENTITY_TYPES.accelRun) {
    payload = await hydrateAccelChangePayload(normalized);
  } else if (normalized.entityType === CLOUD_SYNC_ENTITY_TYPES.boardDrawing) {
    payload = await hydrateBoardChangePayload(normalized);
  }

  if (!payload) {
    throw new Error(
      `Cloud sync payload for ${normalized.entityType}:${normalized.recordId} is unavailable.`
    );
  }

  const hydratedPayload = cloneJson(payload, null);
  return normalizeQueuedChange({
    ...normalized,
    contentHash: hashString(stableStringify(hydratedPayload)),
    recordTitle: getHydratedRecordTitle(normalized, hydratedPayload),
    payloadMode: "inline",
    payload: hydratedPayload,
  });
}

async function pushCloudSyncOutbox({
  csrfToken,
  signal,
}) {
  if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;
  const outbox = await loadCloudSyncOutbox();
  if (outbox.length === 0) return;

  const validChanges = normalizeOutboxEntries(outbox);
  if (validChanges.length === 0) {
    await mutateCloudSyncOutbox(() => ({
      nextOutbox: [],
    }));
    return;
  }

  const state = await loadCloudSyncState();
  const processedChanges = [];
  const resolvedChanges = [];

  for (const change of validChanges) {
    const hydratedChange = await hydrateQueuedChangeForPush(change);
    if (!hydratedChange) continue;
    resolvedChanges.push({
      original: change,
      hydrated: hydratedChange,
    });
  }

  for (
    let batchStart = 0;
    batchStart < resolvedChanges.length;
    batchStart += CLOUD_SYNC_PUSH_BATCH_SIZE
  ) {
    if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;
    const batch = resolvedChanges.slice(batchStart, batchStart + CLOUD_SYNC_PUSH_BATCH_SIZE);
    const result = await pushSyncChangesToBackend({
      changes: batch.map(({ hydrated }) => createQueuedChangePayload(hydrated)),
      csrfToken,
      signal,
    });
    if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;
    if (isCloudSyncAccessBlockedResult(result)) {
      return settleCloudSyncAccessBlocked(result);
    }
    if (!result.ok) {
      throw new Error(`Cloud sync push failed with status ${result.status}.`);
    }

    for (const record of Array.isArray(result.records) ? result.records : []) {
      const meta = normalizeRecordMeta(record);
      if (!meta) continue;
      state.records[getEntityKey(meta.entityType, meta.clientRecordId)] = meta;
    }

    processedChanges.push(...batch.map(({ original }) => original));
  }

  await saveCloudSyncState(state);
  await mutateCloudSyncOutbox((latestOutbox) => ({
    nextOutbox: latestOutbox.filter(
      (entry) =>
        !processedChanges.some((processedChange) =>
          areQueuedChangesEquivalent(entry, processedChange)
        )
    ),
  }));
}

async function pullCloudSyncRecords({ signal } = {}) {
  if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;
  const state = await loadCloudSyncState();
  let cursor = state.cursor;
  let keepPulling = true;
  let pageCount = 0;
  const seenPageCursors = new Set();

  while (keepPulling) {
    if (signal?.aborted) {
      throw Object.assign(new Error("Cloud sync aborted."), { name: "AbortError" });
    }
    pageCount += 1;
    if (pageCount > MAX_PULL_PAGES_PER_PASS) {
      setCloudSyncStatus({
        state: CLOUD_SYNC_STATUS_STATES.paused,
        reason: "pull_page_limit",
        lastFailureAtMs: Date.now(),
        lastFailureMessage: "Cloud sync pull paused after too many pages in one pass.",
      });
      return {
        halted: true,
        reason: "pull_page_limit",
      };
    }

    if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;
    const result = await pullSyncChangesFromBackend({
      cursor,
      limit: CLOUD_SYNC_PULL_LIMIT,
      signal,
    });
    if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;
    if (isCloudSyncAccessBlockedResult(result)) {
      return settleCloudSyncAccessBlocked(result);
    }
    if (!result.ok) {
      throw new Error(`Cloud sync pull failed with status ${result.status}.`);
    }

    const pageSignature = JSON.stringify({
      cursor,
      nextCursor: result.nextCursor || "",
      hasMore: result.hasMore === true,
      records: (Array.isArray(result.records) ? result.records : []).map((record) => {
        const meta = normalizeRecordMeta(record);
        return meta
          ? [
            meta.name,
            meta.entityType,
            meta.clientRecordId,
            meta.serverVersion,
            meta.contentHash,
            meta.clientUpdatedAtMs,
            meta.deletedAtMs,
          ]
          : null;
      }),
    });
    if (seenPageCursors.has(pageSignature)) {
      setCloudSyncStatus({
        state: CLOUD_SYNC_STATUS_STATES.paused,
        reason: "pull_cursor_repeat",
        lastFailureAtMs: Date.now(),
        lastFailureMessage: "Cloud sync pull paused after receiving a repeated page cursor.",
      });
      return {
        halted: true,
        reason: "pull_cursor_repeat",
      };
    }
    seenPageCursors.add(pageSignature);

    for (const record of Array.isArray(result.records) ? result.records : []) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Cloud sync aborted."), { name: "AbortError" });
      }
      if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;
      const meta = normalizeRecordMeta(record);
      if (!meta) continue;
      const entityKey = getEntityKey(meta.entityType, meta.clientRecordId);
      const previousMeta = normalizeRecordMeta(state.records[entityKey]);

      if (isSameAppliedCloudRecord(previousMeta, meta)) {
        state.records[entityKey] = meta;
        warnRepeatedPayloadDownloadSuppressed(meta.name);
        continue;
      }

      let appliedPayload = null;

      if (meta.deletedAtMs > 0) {
        await applyRemoteCloudDeletion(meta);
      } else {
        const payloadResult = await downloadSyncPayloadFromBackend({
          name: meta.name,
          signal,
        });
        if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;
        if (isCloudSyncAccessBlockedResult(payloadResult)) {
          return settleCloudSyncAccessBlocked(payloadResult);
        }
        if (!payloadResult.ok) {
          throw new Error(`Cloud sync payload download failed with status ${payloadResult.status}.`);
        }
        appliedPayload = payloadResult.payload;
        await applyRemoteCloudRecord(meta, appliedPayload);
      }

      state.records[entityKey] = meta;
      emitCloudSyncApplied({
        entityType: meta.entityType,
        recordId: meta.clientRecordId,
        deleted: meta.deletedAtMs > 0,
        payload: meta.deletedAtMs > 0 ? null : appliedPayload,
      });
    }

    const nextCursor = typeof result.nextCursor === "string" ? result.nextCursor : cursor;
    if (result.hasMore === true && nextCursor === cursor) {
      state.cursor = cursor;
      await saveCloudSyncState(state);
      setCloudSyncStatus({
        state: CLOUD_SYNC_STATUS_STATES.paused,
        reason: "pull_cursor_stalled",
        lastFailureAtMs: Date.now(),
        lastFailureMessage: "Cloud sync pull paused after the backend repeated the same cursor.",
      });
      return {
        halted: true,
        reason: "pull_cursor_stalled",
      };
    }

    cursor = nextCursor;
    state.cursor = cursor;
    await saveCloudSyncState(state);
    keepPulling = result.hasMore === true;
  }

  return {
    halted: false,
  };
}

async function resolveCloudSyncCapability({ signal } = {}) {
  const session = await getBackendSessionState({ signal });
  if (!session.ok || session.isGuest) {
    if (session.isGuest) {
      backendAuthenticated = false;
      logoutPending = false;
    }
    setCloudSyncSkippedState(session.isGuest ? "guest" : "unavailable");
    return {
      enabled: false,
      reason: session.isGuest ? "guest" : "unavailable",
      csrfToken: "",
    };
  }

  backendAuthenticated = true;
  logoutPending = false;

  const featureAccess = await getBackendFeatureAccessState({ signal });
  if (!featureAccess.ok || featureAccess.isGuest) {
    if (featureAccess.isGuest) {
      backendAuthenticated = false;
      logoutPending = false;
    }
    setCloudSyncSkippedState(featureAccess.isGuest ? "guest" : "unavailable");
    return {
      enabled: false,
      reason: featureAccess.isGuest ? "guest" : "unavailable",
      csrfToken: "",
    };
  }

  backendAuthenticated = true;
  if (featureAccess.cloudSyncCapability.enabled !== true) {
    syncRetryRequested = false;
    clearScheduledSyncTimer();
    abortActiveCloudSync();
    setCloudSyncSkippedState(featureAccess.cloudSyncCapability.reason || "disabled");
  }
  return {
    enabled: featureAccess.cloudSyncCapability.enabled === true,
    reason: featureAccess.cloudSyncCapability.reason || "",
    csrfToken: featureAccess.cloudSyncCapability.csrfToken || "",
  };
}

function clearScheduledSyncTimer() {
  if (syncTimerId !== null) {
    window.clearTimeout(syncTimerId);
    syncTimerId = null;
  }
}

export function stopCloudSyncLoop() {
  clearScheduledSyncTimer();
  syncScheduled = false;
  syncRetryRequested = false;
  abortActiveCloudSync();
  if (logoutPending) {
    setCloudSyncSkippedState("logout");
  }
}

function scheduleCloudSync({ immediate = false } = {}) {
  if (typeof window === "undefined") return;
  if (!hasSingleTabOwnership() || !isCloudSyncAuthAllowed()) return;

  syncScheduled = true;
  setCloudSyncStatus({
    state: CLOUD_SYNC_STATUS_STATES.syncing,
    reason: immediate ? "scheduled_immediate" : "scheduled",
  });
  if (syncInFlight) {
    syncRetryRequested = true;
    return;
  }

  if (immediate) {
    clearScheduledSyncTimer();
    syncChain = syncChain.catch(() => {}).then(() => syncCloudRecords());
    return;
  }

  if (syncTimerId !== null) return;
  syncTimerId = window.setTimeout(() => {
    syncTimerId = null;
    syncChain = syncChain.catch(() => {}).then(() => syncCloudRecords());
  }, CLOUD_SYNC_RETRY_MS);
}

export function requestCloudSync({
  reason = "requested",
  immediate = false,
  signal,
} = {}) {
  if (signal?.aborted) {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }

  const runImmediate = Boolean(immediate);
  if (runImmediate) {
    const now = Date.now();
    if (
      syncScheduled
      || syncInFlight
      || (lastImmediateSyncRequestAtMs > 0
        && now - lastImmediateSyncRequestAtMs < CLOUD_SYNC_IMMEDIATE_REQUEST_THROTTLE_MS)
    ) {
      syncRetryRequested = syncInFlight || syncRetryRequested;
      setCloudSyncStatus({
        state: CLOUD_SYNC_STATUS_STATES.syncing,
        reason: `${reason || "requested"}_deduped`,
      });
      return true;
    }
    lastImmediateSyncRequestAtMs = now;
  }

  const schedule = () => {
    if (signal?.aborted) return;
    scheduleCloudSync({ immediate: runImmediate });
  };

  schedule();
  return true;
}

export async function queueCloudSyncChange(change) {
  const didQueue = await queueNormalizedCloudSyncChange(change);
  if (didQueue && hasSingleTabOwnership()) {
    scheduleCloudSync();
  }
  return didQueue;
}

export async function queueCloudSyncDeletion({
  entityType,
  recordId,
  deletedAtMs = Date.now(),
  recordTitle = "",
} = {}) {
  return queueCloudSyncChange({
    entityType,
    recordId,
    deletedAtMs,
    updatedAtMs: deletedAtMs,
    recordTitle,
    payload: null,
  });
}

export function syncCloudRecords() {
  if (syncInFlight && activeSyncPromise) return activeSyncPromise;
  if (!hasSingleTabOwnership()) {
    setCloudSyncSkippedState("ownership");
    return Promise.resolve({
      ok: false,
      skipped: true,
      reason: "ownership",
    });
  }
  if (!isCloudSyncAuthAllowed()) {
    setCloudSyncSkippedState(logoutPending ? "logout" : "auth");
    return Promise.resolve({
      ok: false,
      skipped: true,
      reason: "auth",
    });
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setCloudSyncSkippedState("offline");
    return Promise.resolve({
      ok: false,
      skipped: true,
      reason: "offline",
    });
  }

  syncInFlight = true;
  setCloudSyncStatus({
    state: CLOUD_SYNC_STATUS_STATES.syncing,
    reason: "running",
  });
  clearScheduledSyncTimer();
  activeSyncAbortController =
    typeof AbortController === "function" ? new AbortController() : null;
  const syncSignal = activeSyncAbortController?.signal;

  activeSyncPromise = (async () => {
    let retryAfterFailure = false;

    try {
      const hasLease = await acquireSyncLease();
      if (!hasLease) {
        setCloudSyncSkippedState("lease");
        return {
          ok: false,
          skipped: true,
          reason: "lease",
        };
      }

      if (!hasSingleTabOwnership()) {
        setCloudSyncSkippedState("ownership");
        return {
          ok: false,
          skipped: true,
          reason: "ownership",
        };
      }
      if (!isCloudSyncAuthAllowed()) {
        setCloudSyncSkippedState(logoutPending ? "logout" : "auth");
        return {
          ok: false,
          skipped: true,
          reason: "auth",
        };
      }

      await bootstrapLocalCloudSyncChanges();

      if (!isCloudSyncAuthAllowed()) {
        setCloudSyncSkippedState(logoutPending ? "logout" : "auth");
        return {
          ok: false,
          skipped: true,
          reason: "auth",
        };
      }

      const capability = await resolveCloudSyncCapability({ signal: syncSignal });
      if (!capability.enabled) {
        setCloudSyncSkippedState(capability.reason || "disabled");
        return {
          ok: true,
          skipped: true,
          reason: capability.reason || "disabled",
        };
      }

      if (!hasSingleTabOwnership()) {
        setCloudSyncSkippedState("ownership");
        return {
          ok: false,
          skipped: true,
          reason: "ownership",
        };
      }
      if (!isCloudSyncAuthAllowed()) {
        setCloudSyncSkippedState(logoutPending ? "logout" : "auth");
        return {
          ok: false,
          skipped: true,
          reason: "auth",
        };
      }

      const pushResult = await pushCloudSyncOutbox({
        csrfToken: capability.csrfToken,
        signal: syncSignal,
      });
      if (pushResult?.blocked) {
        return {
          ok: true,
          skipped: true,
          reason: pushResult.reason || "disabled",
        };
      }

      const pullResult = await pullCloudSyncRecords({ signal: syncSignal });
      if (pullResult?.blocked) {
        return {
          ok: true,
          skipped: true,
          reason: pullResult.reason || "disabled",
        };
      }
      if (pullResult?.halted) {
        return {
          ok: false,
          skipped: true,
          reason: pullResult.reason || "pull_paused",
        };
      }

      setCloudSyncStatus({
        state: CLOUD_SYNC_STATUS_STATES.synced,
        reason: "enabled",
        lastSuccessAtMs: Date.now(),
        lastFailureAtMs: 0,
        lastFailureMessage: "",
      });

      return {
        ok: true,
      };
    } catch (error) {
      if (isAbortError(error)) {
        setCloudSyncSkippedState(logoutPending ? "logout" : "aborted");
        return {
          ok: false,
          skipped: true,
          reason: "aborted",
        };
      }
      setCloudSyncStatus({
        state: CLOUD_SYNC_STATUS_STATES.failed,
        reason: "error",
        lastFailureAtMs: Date.now(),
        lastFailureMessage: String(error?.message || "Cloud sync failed."),
      });
      retryAfterFailure = true;
      throw error;
    } finally {
      const continueAfterCurrentPass = syncRetryRequested;
      syncRetryRequested = false;
      syncScheduled = false;
      syncInFlight = false;
      activeSyncPromise = null;
      activeSyncAbortController = null;
      releaseSyncLease();

      if (retryAfterFailure) {
        scheduleCloudSync();
      } else if (continueAfterCurrentPass) {
        scheduleCloudSync({ immediate: true });
      }
    }
  })();
  syncChain = activeSyncPromise.catch(() => {});
  return activeSyncPromise;
}

export function startCloudSyncLoop({ immediate = true } = {}) {
  if (typeof window === "undefined" || listenersInstalled) {
    if (immediate) {
      scheduleCloudSync({ immediate: true });
    }
    return;
  }

  listenersInstalled = true;
  void loadCloudSyncOutbox()
    .then((outbox) => {
      syncCloudSyncPendingStatus(outbox);
    })
    .catch(() => {});
  window.addEventListener("online", () => {
    scheduleCloudSync({ immediate: true });
  });
  window.addEventListener("offline", () => {
    setCloudSyncSkippedState("offline");
  });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleCloudSync({ immediate: true });
      }
    });
  }
  window.addEventListener(SINGLE_TAB_OWNERSHIP_EVENT, (event) => {
    if (event?.detail?.owned === false) {
      stopCloudSyncLoop();
      setCloudSyncSkippedState("ownership");
      return;
    }
    if (event?.detail?.owned === true) {
      scheduleCloudSync({ immediate: true });
    }
  });
  window.addEventListener(BACKEND_AUTH_STATE_EVENT, (event) => {
    if (event?.detail?.pendingLogout === true) {
      logoutPending = true;
      stopCloudSyncLoop();
      setCloudSyncSkippedState("logout");
      return;
    }
    if (event?.detail?.authenticated === true) {
      backendAuthenticated = true;
      logoutPending = false;
      scheduleCloudSync({ immediate: true });
      return;
    }
    if (event?.detail?.isGuest === true) {
      backendAuthenticated = false;
      logoutPending = false;
      stopCloudSyncLoop();
      setCloudSyncSkippedState("guest");
    }
  });

  if (immediate) {
    scheduleCloudSync({ immediate: true });
  }
}

export function isCloudSyncScheduled() {
  return syncScheduled || syncInFlight || syncTimerId !== null;
}
