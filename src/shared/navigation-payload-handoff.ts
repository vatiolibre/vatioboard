import { loadJson, removeStoredValue, saveJson } from './storage.js';

export const NAVIGATION_PAYLOAD_RESOURCES = Object.freeze({
  accelRun: 'accel_run',
  boardDocument: 'board_document',
  replaySession: 'replay_session',
} as const);

export type NavigationPayloadResource =
  typeof NAVIGATION_PAYLOAD_RESOURCES[keyof typeof NAVIGATION_PAYLOAD_RESOURCES];

export interface NavigationPayloadHandoff<TPayload = unknown> {
  createdAtMs: number;
  meta: object | null;
  payload: TPayload | null;
  recordId: string;
  resourceType: string;
}

export interface QueueNavigationPayloadHandoffOptions<TPayload = unknown> {
  resourceType?: unknown;
  recordId?: unknown;
  payload?: TPayload | null;
  meta?: unknown;
}

export interface ConsumeNavigationPayloadHandoffOptions {
  resourceType?: unknown;
  recordId?: unknown;
}

const HANDOFF_STORAGE_KEY_PREFIX = 'vatioboard.navigation_handoff';
const handoffCache = new Map<string, NavigationPayloadHandoff>();

function normalizeResourceType(resourceType: unknown): string {
  return String(resourceType || '').trim();
}

function normalizeRecordId(recordId: unknown): string {
  return String(recordId || '').trim();
}

function createHandoffStorageKey(resourceType: string): string {
  return `${HANDOFF_STORAGE_KEY_PREFIX}:${resourceType}`;
}

function matchesRecordId(entry: NavigationPayloadHandoff | null | undefined, recordId: string): boolean {
  if (!recordId) return true;
  return normalizeRecordId(entry?.recordId) === recordId;
}

export function queueNavigationPayloadHandoff({
  resourceType,
  recordId = '',
  payload = null,
  meta = null,
}: QueueNavigationPayloadHandoffOptions = {}): NavigationPayloadHandoff | null {
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

export function consumeNavigationPayloadHandoff({
  resourceType,
  recordId = '',
}: ConsumeNavigationPayloadHandoffOptions = {}): NavigationPayloadHandoff | null {
  const normalizedResourceType = normalizeResourceType(resourceType);
  const normalizedRecordId = normalizeRecordId(recordId);
  if (!normalizedResourceType) return null;

  const cachedEntry = handoffCache.get(normalizedResourceType) ?? null;
  if (cachedEntry && matchesRecordId(cachedEntry, normalizedRecordId)) {
    handoffCache.delete(normalizedResourceType);
    removeStoredValue(createHandoffStorageKey(normalizedResourceType));
    return cachedEntry;
  }

  const storedEntry = loadJson<NavigationPayloadHandoff>(createHandoffStorageKey(normalizedResourceType), null);
  if (!storedEntry || !matchesRecordId(storedEntry, normalizedRecordId)) {
    return null;
  }

  handoffCache.delete(normalizedResourceType);
  removeStoredValue(createHandoffStorageKey(normalizedResourceType));
  return storedEntry;
}
