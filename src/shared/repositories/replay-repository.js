import { getBackendSpeedRecordingDetail } from '../backend-auth.js';
import {
  CLOUD_LIBRARY_TAB_KEYS,
  cloudLibraryResources,
} from '../cloud-library-resources.js';
import {
  CLOUD_SYNC_ENTITY_TYPES,
  downloadCloudSyncRecord,
} from '../cloud-sync.js';
import {
  consumeNavigationPayloadHandoff,
  NAVIGATION_PAYLOAD_RESOURCES,
  queueNavigationPayloadHandoff,
} from '../navigation-payload-handoff.js';
import {
  importReplaySession,
  isReplayPayloadComplete,
  loadReplayRecords,
  loadReplaySelection,
  removeReplayRecording,
} from '../../replay/session.js';

const replayResource = cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.speed]?.resource;
const replayRestorePromises = new Map();
const replayRestoreFailures = new Map();
const linkedCloudRecords = new Map();
const RESTORE_FAILURE_COOLDOWN_MS = 5000;

function encodeRecordName(value) {
  return encodeURIComponent(String(value || '').trim());
}

function normalizeRecordingId(recordingId) {
  return String(recordingId || '').trim();
}

function hasRecentRestoreFailure(recordingId) {
  const failedAtMs = replayRestoreFailures.get(recordingId);
  return Boolean(
    Number.isFinite(failedAtMs)
    && Date.now() - failedAtMs < RESTORE_FAILURE_COOLDOWN_MS
  );
}

function applyHandoffToSelection(selection, handoffPayload) {
  if (!handoffPayload || !isReplayPayloadComplete(handoffPayload)) {
    return {
      records: selection.records,
      selectedRecordingId: selection.selectedRecordingId ?? selection.session?.id ?? null,
      source: selection.source,
      session: selection.session,
    };
  }

  const nextRecords = selection.records.some((record) => record.id === handoffPayload.id)
    ? selection.records.map((record) =>
      record.id === handoffPayload.id
        ? {
          ...record,
          session: handoffPayload,
        }
        : record
    )
    : [{
      id: handoffPayload.id,
      source: 'library',
      session: handoffPayload,
    }, ...selection.records];

  return {
    records: nextRecords,
    selectedRecordingId: handoffPayload.id,
    source: 'library',
    session: handoffPayload,
  };
}

async function persistReplayPayload(session, options = {}) {
  const normalizedSession = await importReplaySession(session, options);
  if (normalizedSession?.id) {
    replayRestoreFailures.delete(normalizedSession.id);
  }
  return normalizedSession;
}

async function loadCloudLibraryReplayDetail(name) {
  if (!replayResource) {
    throw new Error('Replay cloud library resource is unavailable.');
  }

  return replayResource.getDetail(name, {
    force: true,
    mode: 'full',
  });
}

async function restoreReplayFromLinkedCloudRecord(recordingId, cloudRecordName) {
  if (!cloudRecordName) return null;

  const detail = await getBackendSpeedRecordingDetail({
    name: cloudRecordName,
    includePayload: true,
  });
  const payload = detail?.payload;
  const payloadId = normalizeRecordingId(payload?.id) || recordingId;

  if (detail?.ok !== true || payloadId !== recordingId || !isReplayPayloadComplete(payload)) {
    return null;
  }

  return payload;
}

async function downloadReplayPayload(recordingId, { onPayloadDownloadStart } = {}) {
  const result = await downloadCloudSyncRecord({
    entityType: CLOUD_SYNC_ENTITY_TYPES.replaySession,
    recordId: recordingId,
    onPayloadDownloadStart,
  });
  const payloadId = normalizeRecordingId(result?.payload?.id);
  if (
    result?.ok !== true
    || payloadId !== recordingId
    || !isReplayPayloadComplete(result?.payload)
  ) {
    return null;
  }

  return result.payload;
}

export function registerLinkedReplayCloudRecord(recordingId, cloudRecordName) {
  const normalizedRecordingId = normalizeRecordingId(recordingId);
  const normalizedCloudRecordName = normalizeRecordingId(cloudRecordName);
  if (!normalizedRecordingId || !normalizedCloudRecordName) return;
  linkedCloudRecords.set(normalizedRecordingId, normalizedCloudRecordName);
}

export function clearReplayRestoreFailure(recordingId) {
  const normalizedRecordingId = normalizeRecordingId(recordingId);
  if (!normalizedRecordingId) return;
  replayRestoreFailures.delete(normalizedRecordingId);
}

export async function getReplaySelection(recordingId = null) {
  const normalizedRecordingId = normalizeRecordingId(recordingId);
  const selection = await loadReplaySelection(normalizedRecordingId || null);
  const handoff = consumeNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.replaySession,
    recordId: normalizedRecordingId,
  });

  const handoffPayload = handoff?.payload;
  if (handoffPayload && isReplayPayloadComplete(handoffPayload)) {
    void persistReplayPayload(handoffPayload, { saveLast: true }).catch(() => {
      // Keep the direct-open payload usable even if background persistence fails.
    });
    return applyHandoffToSelection(selection, handoffPayload);
  }

  return {
    records: selection.records,
    selectedRecordingId: normalizedRecordingId || selection.session?.id || null,
    source: selection.source,
    session: selection.session,
  };
}

export async function ensureReplayTelemetry(
  recordingId,
  { session = null, onPayloadDownloadStart } = {}
) {
  const normalizedRecordingId = normalizeRecordingId(recordingId);
  if (!normalizedRecordingId) return { restored: false, session };
  if (session && isReplayPayloadComplete(session)) {
    return { restored: false, session };
  }
  if (hasRecentRestoreFailure(normalizedRecordingId)) {
    return { restored: false, session: null };
  }
  if (replayRestorePromises.has(normalizedRecordingId)) {
    return replayRestorePromises.get(normalizedRecordingId);
  }

  const restorePromise = (async () => {
    try {
      const linkedCloudRecordName = linkedCloudRecords.get(normalizedRecordingId) || '';
      const linkedPayload = linkedCloudRecordName
        ? await restoreReplayFromLinkedCloudRecord(normalizedRecordingId, linkedCloudRecordName)
        : null;
      const restoredPayload = linkedPayload || await downloadReplayPayload(normalizedRecordingId, {
        onPayloadDownloadStart,
      });
      if (!restoredPayload) {
        replayRestoreFailures.set(normalizedRecordingId, Date.now());
        return { restored: false, session: null };
      }

      queueNavigationPayloadHandoff({
        resourceType: NAVIGATION_PAYLOAD_RESOURCES.replaySession,
        recordId: normalizedRecordingId,
        payload: restoredPayload,
        meta: {
          cloudRecordName: linkedCloudRecordName || '',
        },
      });
      void persistReplayPayload(restoredPayload, { saveLast: true }).catch(() => {
        // Keep the restored payload available through the handoff even if persistence fails.
      });
      linkedCloudRecords.delete(normalizedRecordingId);
      replayRestoreFailures.delete(normalizedRecordingId);
      return {
        restored: true,
        session: restoredPayload,
      };
    } catch {
      replayRestoreFailures.set(normalizedRecordingId, Date.now());
      return { restored: false, session: null };
    }
  })().finally(() => {
    replayRestorePromises.delete(normalizedRecordingId);
  });

  replayRestorePromises.set(normalizedRecordingId, restorePromise);
  return restorePromise;
}

export async function listReplayRecords() {
  return loadReplayRecords();
}

export async function removeReplayRecord(recordingId) {
  return removeReplayRecording(recordingId);
}

export async function openReplayFromCloud(name) {
  const detail = await loadCloudLibraryReplayDetail(name);
  if (detail?.record?.can_open === false || !isReplayPayloadComplete(detail?.payload)) {
    const error = new Error('Replay telemetry is unavailable.');
    error.libraryStatusKey = 'cloudLibraryTelemetryUnavailable';
    throw error;
  }

  const payload = detail.payload;
  const recordingId = normalizeRecordingId(payload?.id);
  if (!recordingId) {
    throw new Error('Replay payload is missing an id.');
  }

  registerLinkedReplayCloudRecord(recordingId, name);
  queueNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.replaySession,
    recordId: recordingId,
    payload,
    meta: {
      cloudRecordName: name,
    },
  });
  void persistReplayPayload(payload, { saveLast: true }).catch(() => {
    // Keep direct-open flow independent from background persistence.
  });

  return `/#/replay?record=${encodeRecordName(recordingId)}&cloudRecord=${encodeRecordName(name)}`;
}
