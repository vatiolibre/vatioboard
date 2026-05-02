import { loadJson, removeStoredValue, saveJson } from './storage.js';

export const NAVIGATION_PAYLOAD_RESOURCES = Object.freeze({
  accelRun: 'accel_run',
  boardDocument: 'board_document',
  replaySession: 'replay_session',
});

const HANDOFF_STORAGE_KEY_PREFIX = 'vatioboard.navigation_handoff';
const handoffCache = new Map();

function normalizeResourceType(resourceType) {
  return String(resourceType || '').trim();
}

function normalizeRecordId(recordId) {
  return String(recordId || '').trim();
}

function createHandoffStorageKey(resourceType) {
  return `${HANDOFF_STORAGE_KEY_PREFIX}:${resourceType}`;
}

function matchesRecordId(entry, recordId) {
  if (!recordId) return true;
  return normalizeRecordId(entry?.recordId) === recordId;
}

export function queueNavigationPayloadHandoff({
  resourceType,
  recordId = '',
  payload = null,
  meta = null,
} = {}) {
  const normalizedResourceType = normalizeResourceType(resourceType);
  if (!normalizedResourceType) return null;

  const handoff = {
    createdAtMs: Date.now(),
    meta: meta && typeof meta === 'object' ? meta : null,
    payload,
    recordId: normalizeRecordId(recordId),
    resourceType: normalizedResourceType,
  };
  handoffCache.set(normalizedResourceType, handoff);
  saveJson(createHandoffStorageKey(normalizedResourceType), handoff);
  return handoff;
}

export function consumeNavigationPayloadHandoff({ resourceType, recordId = '' } = {}) {
  const normalizedResourceType = normalizeResourceType(resourceType);
  const normalizedRecordId = normalizeRecordId(recordId);
  if (!normalizedResourceType) return null;

  const cachedEntry = handoffCache.get(normalizedResourceType) ?? null;
  if (cachedEntry && matchesRecordId(cachedEntry, normalizedRecordId)) {
    handoffCache.delete(normalizedResourceType);
    removeStoredValue(createHandoffStorageKey(normalizedResourceType));
    return cachedEntry;
  }

  const storedEntry = loadJson(createHandoffStorageKey(normalizedResourceType), null);
  if (!storedEntry || !matchesRecordId(storedEntry, normalizedRecordId)) {
    return null;
  }

  handoffCache.delete(normalizedResourceType);
  removeStoredValue(createHandoffStorageKey(normalizedResourceType));
  return storedEntry;
}