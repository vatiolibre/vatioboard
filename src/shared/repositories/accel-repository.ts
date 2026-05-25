import {
  CLOUD_LIBRARY_TAB_KEYS,
  cloudLibraryResources,
} from '../cloud-library-resources.js';
import {
  CLOUD_SYNC_ENTITY_TYPES,
  downloadCloudSyncRecord,
} from '../cloud-sync.js';
import {
  consumeNavigationPayloadHandoff as consumeNavigationPayloadHandoffUntyped,
  NAVIGATION_PAYLOAD_RESOURCES,
  queueNavigationPayloadHandoff as queueNavigationPayloadHandoffUntyped,
} from '../navigation-payload-handoff.js';
import {
  importRun,
  isAccelPayloadComplete,
  loadRuns,
  saveRuns,
} from '../../accel/storage.js';

export interface AccelRunRecord extends Record<string, unknown> {
  id?: string;
}

export interface AccelSelection {
  run: AccelRunRecord | null;
  runs: AccelRunRecord[];
  selectedResultId: string;
}

export interface AccelTelemetryRestoreResult {
  restored: boolean;
  run: AccelRunRecord | null;
}

interface CloudLibraryAccelDetail {
  record?: { can_open?: boolean } | null;
  payload?: AccelRunRecord | null;
}

interface CloudLibraryAccelResource {
  getDetail(name: string, options: { force: boolean; mode: string }): Promise<CloudLibraryAccelDetail>;
}

interface NavigationPayloadHandoff<TPayload = unknown> {
  payload?: TPayload | null;
  meta?: Record<string, unknown> | null;
  recordId?: string;
  resourceType?: string;
}

interface QueueNavigationPayloadOptions<TPayload = unknown> {
  resourceType: string;
  recordId?: string;
  payload?: TPayload | null;
  meta?: Record<string, unknown> | null;
}

interface CloudSyncDownloadResult<TPayload = unknown> {
  ok?: boolean;
  payload?: TPayload | null;
}

type LibraryOpenError = Error & { libraryStatusKey?: string };

const consumeNavigationPayloadHandoff = consumeNavigationPayloadHandoffUntyped as (
  options: { resourceType: string; recordId?: string },
) => NavigationPayloadHandoff<unknown> | null;
const queueNavigationPayloadHandoff = queueNavigationPayloadHandoffUntyped as <TPayload>(
  options: QueueNavigationPayloadOptions<TPayload>,
) => NavigationPayloadHandoff<TPayload> | null;
const loadAccelRuns = loadRuns as () => Promise<AccelRunRecord[]>;
const saveAccelRuns = saveRuns as (runs: AccelRunRecord[]) => Promise<unknown>;
const importAccelRun = importRun as (
  run: AccelRunRecord,
  options?: Record<string, unknown>,
) => Promise<AccelRunRecord | null>;
const isCompleteAccelPayload = isAccelPayloadComplete as (payload: unknown) => payload is AccelRunRecord & { id: string };
const accelResource = cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.accel]?.resource as CloudLibraryAccelResource | undefined;
const accelRestorePromises = new Map<string, Promise<AccelTelemetryRestoreResult>>();
const accelRestoreFailures = new Map<string, number>();
const RESTORE_FAILURE_COOLDOWN_MS = 5000;

function downloadAccelSyncRecord(
  options: { entityType: string; recordId: string },
): Promise<CloudSyncDownloadResult<AccelRunRecord>> {
  return (downloadCloudSyncRecord as (
    opts: { entityType: string; recordId: string },
  ) => Promise<CloudSyncDownloadResult<AccelRunRecord>>)(options);
}

function encodeRecordName(value: unknown): string {
  return encodeURIComponent(String(value || '').trim());
}

function normalizeRunId(runId: unknown): string {
  return String(runId || '').trim();
}

function hasRecentRestoreFailure(runId: string): boolean {
  const failedAtMs = accelRestoreFailures.get(runId);
  return Boolean(
    Number.isFinite(failedAtMs)
    && Date.now() - failedAtMs < RESTORE_FAILURE_COOLDOWN_MS
  );
}

export function clearAccelRestoreFailure(runId: unknown): void {
  const normalizedRunId = normalizeRunId(runId);
  if (!normalizedRunId) return;
  accelRestoreFailures.delete(normalizedRunId);
}

function selectRun(runs: AccelRunRecord[], preferredRunId: unknown): AccelRunRecord | null {
  const normalizedRunId = normalizeRunId(preferredRunId);
  if (normalizedRunId) {
    return runs.find((entry) => entry.id === normalizedRunId) ?? null;
  }

  return runs[0] ?? null;
}

function applyHandoffToSelection(runs: AccelRunRecord[], handoffRun: unknown): AccelSelection {
  if (!handoffRun || !isCompleteAccelPayload(handoffRun)) {
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

async function persistRun(run: AccelRunRecord, options: Record<string, unknown> = {}): Promise<AccelRunRecord | null> {
  const normalizedRun = await importAccelRun(run, options);
  if (normalizedRun?.id) {
    accelRestoreFailures.delete(normalizedRun.id);
  }
  return normalizedRun;
}

async function loadCloudLibraryAccelDetail(name: string): Promise<CloudLibraryAccelDetail> {
  if (!accelResource) {
    throw new Error('Accel cloud library resource is unavailable.');
  }

  return accelResource.getDetail(name, {
    force: true,
    mode: 'full',
  });
}

export async function getAccelSelection(
  runId: unknown = '',
  { preserveMissingSelection = true }: { preserveMissingSelection?: boolean } = {},
): Promise<AccelSelection> {
  const normalizedRunId = normalizeRunId(runId);
  const runs = await loadAccelRuns();
  const handoff = consumeNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.accelRun,
    recordId: normalizedRunId,
  });
  const handoffRun = handoff?.payload;

  if (handoffRun && isCompleteAccelPayload(handoffRun)) {
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

export async function ensureAccelTelemetry(
  runId: unknown,
  { run = null }: { run?: AccelRunRecord | null } = {},
): Promise<AccelTelemetryRestoreResult> {
  const normalizedRunId = normalizeRunId(runId);
  if (!normalizedRunId) return { restored: false, run };
  if (run && isCompleteAccelPayload(run)) {
    return { restored: false, run };
  }
  if (hasRecentRestoreFailure(normalizedRunId)) {
    return { restored: false, run: null };
  }
  if (accelRestorePromises.has(normalizedRunId)) {
    return accelRestorePromises.get(normalizedRunId)!;
  }

  const restorePromise = (async () => {
    try {
      const result = await downloadAccelSyncRecord({
        entityType: CLOUD_SYNC_ENTITY_TYPES.accelRun,
        recordId: normalizedRunId,
      });
      if (
        result?.ok !== true
        || normalizeRunId(result?.payload?.id) !== normalizedRunId
        || !isCompleteAccelPayload(result?.payload)
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

export async function removeAccelRun(runId: unknown): Promise<AccelRunRecord[]> {
  const normalizedRunId = normalizeRunId(runId);
  const nextRuns = (await loadAccelRuns()).filter((entry) => entry.id !== normalizedRunId);
  await saveAccelRuns(nextRuns);
  return nextRuns;
}

export async function openAccelFromCloud(name: string): Promise<string> {
  const detail = await loadCloudLibraryAccelDetail(name);
  if (detail?.record?.can_open === false || !isCompleteAccelPayload(detail?.payload)) {
    const error = new Error('Acceleration telemetry is unavailable.') as LibraryOpenError;
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
