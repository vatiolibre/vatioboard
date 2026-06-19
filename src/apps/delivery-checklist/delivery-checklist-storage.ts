import type { VatioAppSettingsService, VatioAppStorage } from "../../app-platform/types";
import {
  DELIVERY_CHECKLIST_SESSION_VERSION,
  createDeliveryChecklistSession,
  createSessionTitle,
  getChecklistItems,
  normalizeChecklistModelKey,
  normalizeItemState,
  type DeliveryChecklistItemState,
  type DeliveryChecklistModelKey,
  type DeliveryChecklistSession,
  type DeliveryChecklistVehicleMetadata,
} from "./delivery-checklist-data.js";

export const DELIVERY_CHECKLIST_SESSIONS_KEY = "sessions.v1";
export const DELIVERY_CHECKLIST_ACTIVE_SESSION_KEY = "activeSessionId";
export const DELIVERY_CHECKLIST_LAST_MODEL_KEY = "lastModelKey";
export const DELIVERY_CHECKLIST_STORAGE_PREFIX = "vatioboard.app.vatio.deliveryChecklist.";

interface DeliveryChecklistRepositoryOptions {
  appStorage?: VatioAppStorage | null;
  settingsService?: VatioAppSettingsService | null;
  storage?: Storage | null;
}

export interface CreateDeliveryChecklistSessionOptions {
  id?: string;
  modelKey?: DeliveryChecklistModelKey;
  metadata?: DeliveryChecklistVehicleMetadata;
}

export interface DeliveryChecklistRepository {
  createSession(options?: CreateDeliveryChecklistSessionOptions): DeliveryChecklistSession;
  deleteSession(id: string): boolean;
  getActiveSession(): DeliveryChecklistSession | null;
  getActiveSessionId(): string;
  getLastModelKey(): DeliveryChecklistModelKey;
  listSessions(): DeliveryChecklistSession[];
  saveSession(session: DeliveryChecklistSession): boolean;
  setActiveSessionId(id: string): boolean;
  setLastModelKey(modelKey: DeliveryChecklistModelKey): boolean;
  updateItemState(sessionId: string, itemId: string, state: Partial<DeliveryChecklistItemState>): DeliveryChecklistSession | null;
}

function getDefaultStorage(): Storage | null {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function loadFallbackJson<T>(storage: Storage | null | undefined, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const value = storage.getItem(`${DELIVERY_CHECKLIST_STORAGE_PREFIX}${key}`);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function saveFallbackJson(storage: Storage | null | undefined, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(`${DELIVERY_CHECKLIST_STORAGE_PREFIX}${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadFallbackSetting(storage: Storage | null | undefined, key: string, fallback = ""): string {
  if (!storage) return fallback;
  try {
    return storage.getItem(`${DELIVERY_CHECKLIST_STORAGE_PREFIX}settings.${key}`) || fallback;
  } catch {
    return fallback;
  }
}

function saveFallbackSetting(storage: Storage | null | undefined, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(`${DELIVERY_CHECKLIST_STORAGE_PREFIX}settings.${key}`, value);
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

export function normalizeDeliveryChecklistSession(value: unknown): DeliveryChecklistSession | null {
  const source = asRecord(value);
  const id = String(source.id || "").trim();
  if (!id) return null;

  const modelKey = normalizeChecklistModelKey(source.modelKey);
  const metadata = asRecord(source.metadata) as DeliveryChecklistVehicleMetadata;
  const itemStateSource = asRecord(source.itemState);
  const itemState: DeliveryChecklistSession["itemState"] = {};

  for (const item of getChecklistItems(modelKey)) {
    itemState[item.id] = normalizeItemState(itemStateSource[item.id]);
  }

  const now = new Date().toISOString();
  const createdAt = typeof source.createdAt === "string" && source.createdAt ? source.createdAt : now;
  const updatedAt = typeof source.updatedAt === "string" && source.updatedAt ? source.updatedAt : createdAt;

  return {
    id,
    version: DELIVERY_CHECKLIST_SESSION_VERSION,
    modelKey,
    title: String(source.title || "").trim() || createSessionTitle(modelKey, metadata),
    metadata,
    itemState,
    createdAt,
    updatedAt,
  };
}

function normalizeSessionsPayload(value: unknown): DeliveryChecklistSession[] {
  const source = asRecord(value);
  const sessions = Array.isArray(value)
    ? value
    : Array.isArray(source.sessions)
      ? source.sessions
      : [];

  return sessions
    .map(normalizeDeliveryChecklistSession)
    .filter((session): session is DeliveryChecklistSession => Boolean(session));
}

function sessionsPayload(sessions: DeliveryChecklistSession[]) {
  return {
    version: DELIVERY_CHECKLIST_SESSION_VERSION,
    sessions,
  };
}

export function createDeliveryChecklistRepository({
  appStorage = null,
  settingsService = null,
  storage = getDefaultStorage(),
}: DeliveryChecklistRepositoryOptions = {}): DeliveryChecklistRepository {
  function readSessions(): DeliveryChecklistSession[] {
    const value = appStorage
      ? appStorage.getJson(DELIVERY_CHECKLIST_SESSIONS_KEY, null)
      : loadFallbackJson(storage, DELIVERY_CHECKLIST_SESSIONS_KEY, null);
    return normalizeSessionsPayload(value);
  }

  function writeSessions(sessions: DeliveryChecklistSession[]): boolean {
    const payload = sessionsPayload(sessions);
    return appStorage
      ? appStorage.setJson(DELIVERY_CHECKLIST_SESSIONS_KEY, payload)
      : saveFallbackJson(storage, DELIVERY_CHECKLIST_SESSIONS_KEY, payload);
  }

  function getSetting(key: string, fallback = ""): string {
    if (settingsService) {
      const value = settingsService.get<string>(key, fallback);
      return typeof value === "string" ? value : fallback;
    }
    return loadFallbackSetting(storage, key, fallback);
  }

  function setSetting(key: string, value: string): boolean {
    if (settingsService) return settingsService.set(key, value);
    return saveFallbackSetting(storage, key, value);
  }

  function setActiveSessionId(id: string): boolean {
    return setSetting(DELIVERY_CHECKLIST_ACTIVE_SESSION_KEY, String(id || ""));
  }

  function setLastModelKey(modelKey: DeliveryChecklistModelKey): boolean {
    return setSetting(DELIVERY_CHECKLIST_LAST_MODEL_KEY, normalizeChecklistModelKey(modelKey));
  }

  function saveSession(session: DeliveryChecklistSession): boolean {
    const normalized = normalizeDeliveryChecklistSession({
      ...session,
      updatedAt: new Date().toISOString(),
    });
    if (!normalized) return false;

    const sessions = readSessions();
    const index = sessions.findIndex((existing) => existing.id === normalized.id);
    if (index >= 0) {
      sessions[index] = normalized;
    } else {
      sessions.unshift(normalized);
    }

    if (!writeSessions(sessions)) return false;
    setLastModelKey(normalized.modelKey);
    return true;
  }

  function createSession(options: CreateDeliveryChecklistSessionOptions = {}): DeliveryChecklistSession {
    const session = createDeliveryChecklistSession({
      id: options.id,
      modelKey: options.modelKey || getLastModelKey(),
      metadata: options.metadata,
    });
    saveSession(session);
    setActiveSessionId(session.id);
    return session;
  }

  function listSessions(): DeliveryChecklistSession[] {
    return readSessions();
  }

  function getActiveSessionId(): string {
    return getSetting(DELIVERY_CHECKLIST_ACTIVE_SESSION_KEY, "");
  }

  function getLastModelKey(): DeliveryChecklistModelKey {
    return normalizeChecklistModelKey(getSetting(DELIVERY_CHECKLIST_LAST_MODEL_KEY, "modely"));
  }

  function getActiveSession(): DeliveryChecklistSession | null {
    const sessions = readSessions();
    if (!sessions.length) return null;
    const activeId = getActiveSessionId();
    return sessions.find((session) => session.id === activeId) || sessions[0] || null;
  }

  function deleteSession(id: string): boolean {
    const sessionId = String(id || "").trim();
    if (!sessionId) return false;
    const sessions = readSessions().filter((session) => session.id !== sessionId);
    const saved = writeSessions(sessions);
    if (getActiveSessionId() === sessionId) {
      setActiveSessionId(sessions[0]?.id || "");
    }
    return saved;
  }

  function updateItemState(
    sessionId: string,
    itemId: string,
    state: Partial<DeliveryChecklistItemState>,
  ): DeliveryChecklistSession | null {
    const sessions = readSessions();
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return null;

    const existing = normalizeItemState(sessions[index].itemState[itemId]);
    sessions[index] = {
      ...sessions[index],
      itemState: {
        ...sessions[index].itemState,
        [itemId]: normalizeItemState({
          ...existing,
          ...state,
          updatedAt: new Date().toISOString(),
        }),
      },
      updatedAt: new Date().toISOString(),
    };

    return writeSessions(sessions) ? sessions[index] : null;
  }

  return {
    createSession,
    deleteSession,
    getActiveSession,
    getActiveSessionId,
    getLastModelKey,
    listSessions,
    saveSession,
    setActiveSessionId,
    setLastModelKey,
    updateItemState,
  };
}

