/**
 * Board Document Session Model
 *
 * Single source of truth for the current working document's lifecycle state.
 * Tracks local session identity, remote document identity, content state,
 * dirty flags, save/delete states, and linked PNG drawing record.
 */

export type BoardDocumentSaveState = 'idle' | 'saving' | 'queued_offline' | 'error';
export type BoardDocumentDeleteState = 'idle' | 'deleting' | 'queued_offline' | 'error';

export interface BoardDocumentSession {
  /** Unique local session identifier. */
  localSessionId: string;
  /** Backend board document name, or null. */
  remoteDocumentName: string | null;
  /** Current document title. */
  documentTitle: string;
  /** Whether the user has drawn something. */
  hasUserContent: boolean;
  /** Whether unsaved changes exist. */
  isDirty: boolean;
  /** Timestamp of last successful save (0 = never). */
  lastSavedAtMs: number;
  /** Timestamp of last local modification. */
  lastModifiedAtMs: number;
  /** Linked VatioLibre saved drawing name, or null. */
  linkedPngDrawingName: string | null;
  saveState: BoardDocumentSaveState;
  deleteState: BoardDocumentDeleteState;
  /** Whether this session was opened from cloud library. */
  openedFromCloud: boolean;
  /** Whether this document has ever been saved to backend. */
  materializedRemotely: boolean;
}

export interface CreateDocumentSessionOptions {
  name?: string | null;
  title?: string | null;
  hasContent?: unknown;
  linkedPngName?: string | null;
}

export interface MarkSavedOptions {
  name?: string | null;
  title?: string | null;
  linkedPngName?: string | null;
}

let sessionCounter = 0;

function createSessionId(): string {
  sessionCounter += 1;
  return `local-${Date.now()}-${sessionCounter}`;
}

/**
 * Create a fresh blank session (no document, no content).
 */
export function createBlankSession(): BoardDocumentSession {
  return {
    localSessionId: createSessionId(),
    remoteDocumentName: null,
    documentTitle: "",
    hasUserContent: false,
    isDirty: false,
    lastSavedAtMs: 0,
    lastModifiedAtMs: 0,
    linkedPngDrawingName: null,
    saveState: "idle",
    deleteState: "idle",
    openedFromCloud: false,
    materializedRemotely: false,
  };
}

/**
 * Create a session for an existing cloud document that was opened.
 */
export function createOpenedDocumentSession({
  name,
  title,
  hasContent,
  linkedPngName = null,
}: CreateDocumentSessionOptions): BoardDocumentSession {
  return {
    localSessionId: createSessionId(),
    remoteDocumentName: name || null,
    documentTitle: title || "",
    hasUserContent: Boolean(hasContent),
    isDirty: false,
    lastSavedAtMs: Date.now(),
    lastModifiedAtMs: Date.now(),
    linkedPngDrawingName: linkedPngName || null,
    saveState: "idle",
    deleteState: "idle",
    openedFromCloud: true,
    materializedRemotely: Boolean(name),
  };
}

/**
 * Create a session from restored local state (page reload/hydrate).
 */
export function createRestoredSession({
  name,
  title,
  hasContent,
  linkedPngName = null,
}: CreateDocumentSessionOptions): BoardDocumentSession {
  return {
    localSessionId: createSessionId(),
    remoteDocumentName: name || null,
    documentTitle: title || "",
    hasUserContent: Boolean(hasContent),
    isDirty: false,
    lastSavedAtMs: name ? Date.now() : 0,
    lastModifiedAtMs: Date.now(),
    linkedPngDrawingName: linkedPngName || null,
    saveState: "idle",
    deleteState: "idle",
    openedFromCloud: false,
    materializedRemotely: Boolean(name),
  };
}

/**
 * Whether this session is eligible for cloud creation/update.
 * A blank canvas with no user content must NOT create cloud records.
 */
export function isCloudEligible(session: BoardDocumentSession | null | undefined): boolean {
  return Boolean(session?.hasUserContent);
}

/**
 * Whether this session represents a named cloud document (has been saved or opened from cloud).
 */
export function isNamedDocument(session: BoardDocumentSession | null | undefined): boolean {
  return Boolean(session?.remoteDocumentName);
}

/**
 * Whether this session has unsaved work that would be lost.
 */
export function hasUnsavedWork(session: BoardDocumentSession | null | undefined): boolean {
  return Boolean(session?.isDirty && session?.hasUserContent);
}

/**
 * Whether a title prompt is needed before first save.
 */
export function needsTitleForSave(session: BoardDocumentSession | null | undefined): boolean {
  return !isNamedDocument(session) && !session?.documentTitle?.trim();
}

/**
 * Update session after content changes (stroke, undo, redo, etc.).
 */
export function markContentModified(session: BoardDocumentSession): void {
  session.hasUserContent = true;
  session.isDirty = true;
  session.lastModifiedAtMs = Date.now();
}

/**
 * Update session after successful save.
 */
export function markSaved(session: BoardDocumentSession, { name, title, linkedPngName }: MarkSavedOptions): void {
  session.remoteDocumentName = name || session.remoteDocumentName;
  session.documentTitle = title || session.documentTitle;
  session.linkedPngDrawingName = linkedPngName || session.linkedPngDrawingName;
  session.isDirty = false;
  session.lastSavedAtMs = Date.now();
  session.saveState = "idle";
  session.materializedRemotely = true;
}

/**
 * Update session after successful deletion.
 */
export function markDeleted(session: BoardDocumentSession): void {
  session.remoteDocumentName = null;
  session.documentTitle = "";
  session.hasUserContent = false;
  session.isDirty = false;
  session.lastSavedAtMs = 0;
  session.lastModifiedAtMs = 0;
  session.linkedPngDrawingName = null;
  session.saveState = "idle";
  session.deleteState = "idle";
  session.openedFromCloud = false;
  session.materializedRemotely = false;
}
