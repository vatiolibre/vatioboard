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
  importRun,
  isAccelPayloadComplete,
  loadRuns,
  saveRuns,
} from '../../accel/storage.js';

const accelResource = cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.accel]?.resource;
const accelRestorePromises = new Map();
const accelRestoreFailures = new Map();
const RESTORE_FAILURE_COOLDOWN_MS = 5000;

function encodeRecordName(value) {
  return encodeURIComponent(String(value || '').trim());
}

function normalizeRunId(runId) {
  return String(runId || '').trim();
}

function hasRecentRestoreFailure(runId) {
  const failedAtMs = accelRestoreFailures.get(runId);
  return Boolean(
    Number.isFinite(failedAtMs)
    && Date.now() - failedAtMs < RESTORE_FAILURE_COOLDOWN_MS
  );
}

export function clearAccelRestoreFailure(runId) {
  const normalizedRunId = normalizeRunId(runId);
  if (!normalizedRunId) return;
  accelRestoreFailures.delete(normalizedRunId);
}

function selectRun(runs, preferredRunId) {
  const normalizedRunId = normalizeRunId(preferredRunId);
  if (normalizedRunId) {
    return runs.find((entry) => entry.id === normalizedRunId) ?? null;
  }

  return runs[0] ?? null;
}

function applyHandoffToSelection(runs, handoffRun) {
  if (!handoffRun || !isAccelPayloadComplete(handoffRun)) {
    const selectedRun = selectRun(runs, '');
    return {
      run: selectedRun,
      runs,
      selectedResultId: selectedRun?.id || '',
    };
  }

  const nextRuns = runs.some((entry) => entry.id === handoffRun.id)
    ? runs.map((entry) => (entry.id === handoffRun.id ? handoffRun : entry))
    : [handoffRun, ...runs];

  return {
    run: handoffRun,
    runs: nextRuns,
    selectedResultId: handoffRun.id,
  };
}

async function persistRun(run, options = {}) {
  const normalizedRun = await importRun(run, options);
  if (normalizedRun?.id) {
    accelRestoreFailures.delete(normalizedRun.id);
  }
  return normalizedRun;
}

async function loadCloudLibraryAccelDetail(name) {
  if (!accelResource) {
    throw new Error('Accel cloud library resource is unavailable.');
  }

  return accelResource.getDetail(name, {
    force: true,
    mode: 'full',
  });
}

export async function getAccelSelection(runId = '', { preserveMissingSelection = true } = {}) {
  const normalizedRunId = normalizeRunId(runId);
  const runs = await loadRuns();
  const handoff = consumeNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.accelRun,
    recordId: normalizedRunId,
  });
  const handoffRun = handoff?.payload;

  if (handoffRun && isAccelPayloadComplete(handoffRun)) {
    void persistRun(handoffRun).catch(() => {
      // Keep direct-open flow independent from background persistence.
    });
    return applyHandoffToSelection(runs, handoffRun);
  }

  const selectedRun = selectRun(runs, normalizedRunId);
  return {
    run: selectedRun,
    runs,
    selectedResultId:
      selectedRun?.id || (preserveMissingSelection ? normalizedRunId : '') || '',
  };
}

export async function ensureAccelTelemetry(runId, { run = null } = {}) {
  const normalizedRunId = normalizeRunId(runId);
  if (!normalizedRunId) return { restored: false, run };
  if (run && isAccelPayloadComplete(run)) {
    return { restored: false, run };
  }
  if (hasRecentRestoreFailure(normalizedRunId)) {
    return { restored: false, run: null };
  }
  if (accelRestorePromises.has(normalizedRunId)) {
    return accelRestorePromises.get(normalizedRunId);
  }

  const restorePromise = (async () => {
    try {
      const result = await downloadCloudSyncRecord({
        entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
        recordId: normalizedRunId,
      });
      if (
        result?.ok !== true
        || normalizeRunId(result?.payload?.id) !== normalizedRunId
        || !isAccelPayloadComplete(result?.payload)
      ) {
        accelRestoreFailures.set(normalizedRunId, Date.now());
        return { restored: false, run: null };
      }

      queueNavigationPayloadHandoff({
        resourceType: NAVIGATION_PAYLOAD_RESOURCES.accelRun,
        recordId: normalizedRunId,
        payload: result.payload,
      });
      void persistRun(result.payload).catch(() => {
        // Keep the restored payload available through the handoff even if persistence fails.
      });
      accelRestoreFailures.delete(normalizedRunId);
      return {
        restored: true,
        run: result.payload,
      };
    } catch {
      accelRestoreFailures.set(normalizedRunId, Date.now());
      return { restored: false, run: null };
    }
  })().finally(() => {
    accelRestorePromises.delete(normalizedRunId);
  });

  accelRestorePromises.set(normalizedRunId, restorePromise);
  return restorePromise;
}

export async function removeAccelRun(runId) {
  const normalizedRunId = normalizeRunId(runId);
  const nextRuns = (await loadRuns()).filter((entry) => entry.id !== normalizedRunId);
  await saveRuns(nextRuns);
  return nextRuns;
}

export async function openAccelFromCloud(name) {
  const detail = await loadCloudLibraryAccelDetail(name);
  if (detail?.record?.can_open === false || !isAccelPayloadComplete(detail?.payload)) {
    const error = new Error('Acceleration telemetry is unavailable.');
    error.libraryStatusKey = 'cloudLibraryTelemetryUnavailable';
    throw error;
  }

  const payload = detail.payload;
  const runId = normalizeRunId(payload?.id);
  if (!runId) {
    throw new Error('Acceleration payload is missing an id.');
  }

  queueNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.accelRun,
    recordId: runId,
    payload,
  });
  void persistRun(payload).catch(() => {
    // Keep direct-open flow independent from background persistence.
  });

  return `/#/accel?run=${encodeRecordName(runId)}`;
}
