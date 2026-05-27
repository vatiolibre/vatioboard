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
  consumeNavigationPayloadHandoff as consumeNavigationPayloadHandoffUntyped,
  NAVIGATION_PAYLOAD_RESOURCES,
  queueNavigationPayloadHandoff as queueNavigationPayloadHandoffUntyped,
} from '../navigation-payload-handoff.js';
import {
  importReplaySession,
  isReplayPayloadComplete,
  loadReplayRecords,
  loadReplaySelection,
  removeReplayRecording,
} from '../../replay/session.js';

export interface ReplaySessionRecord extends Record<string, unknown> {
  id?: string;
}

export interface ReplayRecord extends Record<string, unknown> {
  id: string;
  source?: string;
  session?: ReplaySessionRecord | null;
}

export interface ReplaySelection {
  records: ReplayRecord[];
  selectedRecordingId?: string | null;
  source: string | null;
  session: ReplaySessionRecord | null;
}

export interface ReplayTelemetryRestoreResult {
  restored: boolean;
  session: ReplaySessionRecord | null;
}

interface ReplayTelemetryOptions {
  onPayloadDownloadStart?: () => void;
}

interface CloudLibraryReplayDetail {
  record?: { can_open?: boolean } | null;
  payload?: ReplaySessionRecord | null;
}

interface CloudLibraryReplayResource {
  getDetail(name: string, options: { force: boolean; mode: string }): Promise<CloudLibraryReplayDetail>;
}

interface BackendReplayDetail {
  ok?: boolean;
  payload?: ReplaySessionRecord | null;
}

interface CloudSyncDownloadResult<TPayload = unknown> {
  ok?: boolean;
  payload?: TPayload | null;
}

interface NavigationPayloadHandoff<TPayload = unknown> {
  payload?: TPayload | null;
  meta?: Record<string, unknown> | null;
}

interface QueueNavigationPayloadOptions<TPayload = unknown> {
  resourceType: string;
  recordId?: string;
  payload?: TPayload | null;
  meta?: Record<string, unknown> | null;
}

type LibraryOpenError = Error & { libraryStatusKey?: string };

const consumeNavigationPayloadHandoff = consumeNavigationPayloadHandoffUntyped as (
  options: { resourceType: string; recordId?: string },
) => NavigationPayloadHandoff<unknown> | null;
const queueNavigationPayloadHandoff = queueNavigationPayloadHandoffUntyped as <TPayload>(
  options: QueueNavigationPayloadOptions<TPayload>,
) => NavigationPayloadHandoff<TPayload> | null;
const importStoredReplaySession = importReplaySession as (
  session: ReplaySessionRecord,
  options?: Record<string, unknown>,
) => Promise<ReplaySessionRecord | null>;
const isCompleteReplayPayload = isReplayPayloadComplete as (
  session: unknown,
) => session is ReplaySessionRecord & { id: string };
const loadStoredReplayRecords = loadReplayRecords as () => Promise<ReplayRecord[]>;
const loadStoredReplaySelection = loadReplaySelection as unknown as (
  recordingId: string | null,
) => Promise<ReplaySelection>;
const removeStoredReplayRecording = removeReplayRecording as (recordingId: string) => Promise<unknown>;

const replayResource = cloudLibraryResources[CLOUD_LIBRARY_TAB_KEYS.speed]?.resource as
  | CloudLibraryReplayResource
  | undefined;
const replayRestorePromises = new Map<string, Promise<ReplayTelemetryRestoreResult>>();
const replayRestoreFailures = new Map<string, number>();
const linkedCloudRecords = new Map<string, string>();
const RESTORE_FAILURE_COOLDOWN_MS = 5000;

function getReplayCloudDetailFromBackend(
  options: { name: string; includePayload: boolean },
): Promise<BackendReplayDetail> {
  return (getBackendSpeedRecordingDetail as (
    opts: { name: string; includePayload: boolean },
  ) => Promise<BackendReplayDetail>)(options);
}

function downloadReplaySyncRecord(
  options: { entityType: string; recordId: string; onPayloadDownloadStart?: () => void },
): Promise<CloudSyncDownloadResult<ReplaySessionRecord>> {
  return (downloadCloudSyncRecord as (
    opts: { entityType: string; recordId: string; onPayloadDownloadStart?: () => void },
  ) => Promise<CloudSyncDownloadResult<ReplaySessionRecord>>)(options);
}

function encodeRecordName(value: unknown): string {
  return encodeURIComponent(String(value || '').trim());
}

function normalizeRecordingId(recordingId: unknown): string {
  return String(recordingId || '').trim();
}

function hasRecentRestoreFailure(recordingId: string): boolean {
  const failedAtMs = replayRestoreFailures.get(recordingId);
  return Boolean(
    Number.isFinite(failedAtMs)
    && Date.now() - failedAtMs < RESTORE_FAILURE_COOLDOWN_MS
  );
}

function applyHandoffToSelection(selection: ReplaySelection, handoffPayload: unknown): ReplaySelection {
  if (!handoffPayload || !isCompleteReplayPayload(handoffPayload)) {
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

async function persistReplayPayload(
  session: ReplaySessionRecord,
  options: Record<string, unknown> = {},
): Promise<ReplaySessionRecord | null> {
  const normalizedSession = await importStoredReplaySession(session, options);
  if (normalizedSession?.id) {
    replayRestoreFailures.delete(normalizedSession.id);
  }
  return normalizedSession;
}

async function loadCloudLibraryReplayDetail(name: string): Promise<CloudLibraryReplayDetail> {
  if (!replayResource) {
    throw new Error('Replay cloud library resource is unavailable.');
  }

  return replayResource.getDetail(name, {
    force: true,
    mode: 'full',
  });
}

async function restoreReplayFromLinkedCloudRecord(
  recordingId: string,
  cloudRecordName: string,
): Promise<ReplaySessionRecord | null> {
  if (!cloudRecordName) return null;

  const detail = await getReplayCloudDetailFromBackend({
    name: cloudRecordName,
    includePayload: true,
  });
  const payload = detail?.payload;
  const payloadId = normalizeRecordingId(payload?.id) || recordingId;

  if (detail?.ok !== true || payloadId !== recordingId || !isCompleteReplayPayload(payload)) {
    return null;
  }

  return payload;
}

async function downloadReplayPayload(
  recordingId: string,
  { onPayloadDownloadStart }: ReplayTelemetryOptions = {},
): Promise<ReplaySessionRecord | null> {
  const result = await downloadReplaySyncRecord({
    entityType: CLOUD_SYNC_ENTITY_TYPES.replaySession,
    recordId: recordingId,
    onPayloadDownloadStart,
  });
  const payloadId = normalizeRecordingId(result?.payload?.id);
  if (
    result?.ok !== true
    || payloadId !== recordingId
    || !isCompleteReplayPayload(result?.payload)
  ) {
    return null;
  }

  return result.payload;
}

export function registerLinkedReplayCloudRecord(recordingId: unknown, cloudRecordName: unknown): void {
  const normalizedRecordingId = normalizeRecordingId(recordingId);
  const normalizedCloudRecordName = normalizeRecordingId(cloudRecordName);
  if (!normalizedRecordingId || !normalizedCloudRecordName) return;
  linkedCloudRecords.set(normalizedRecordingId, normalizedCloudRecordName);
}

export function clearReplayRestoreFailure(recordingId: unknown): void {
  const normalizedRecordingId = normalizeRecordingId(recordingId);
  if (!normalizedRecordingId) return;
  replayRestoreFailures.delete(normalizedRecordingId);
}

export async function getReplaySelection(recordingId: unknown = null): Promise<ReplaySelection> {
  const normalizedRecordingId = normalizeRecordingId(recordingId);
  const selection = await loadStoredReplaySelection(normalizedRecordingId || null);
  const handoff = consumeNavigationPayloadHandoff({
    resourceType: NAVIGATION_PAYLOAD_RESOURCES.replaySession,
    recordId: normalizedRecordingId,
  });

  const handoffPayload = handoff?.payload;
  if (handoffPayload && isCompleteReplayPayload(handoffPayload)) {
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
  recordingId: unknown,
  { session = null, onPayloadDownloadStart }: { session?: ReplaySessionRecord | null } & ReplayTelemetryOptions = {},
): Promise<ReplayTelemetryRestoreResult> {
  const normalizedRecordingId = normalizeRecordingId(recordingId);
  if (!normalizedRecordingId) return { restored: false, session };
  if (session && isCompleteReplayPayload(session)) {
    return { restored: false, session };
  }
  if (hasRecentRestoreFailure(normalizedRecordingId)) {
    return { restored: false, session: null };
  }
  if (replayRestorePromises.has(normalizedRecordingId)) {
    return replayRestorePromises.get(normalizedRecordingId)!;
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

export async function listReplayRecords(): Promise<ReplayRecord[]> {
  return loadStoredReplayRecords();
}

export async function removeReplayRecord(recordingId: unknown): Promise<unknown> {
  return removeStoredReplayRecording(normalizeRecordingId(recordingId));
}

export async function openReplayFromCloud(name: string): Promise<string> {
  const detail = await loadCloudLibraryReplayDetail(name);
  if (detail?.record?.can_open === false || !isCompleteReplayPayload(detail?.payload)) {
    const error = new Error('Replay telemetry is unavailable.') as LibraryOpenError;
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
