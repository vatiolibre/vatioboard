import { createIndexedJsonKeyValueStore } from "../shared/indexed-storage.js";
import { createStorageCapability } from "../shared/storage-capability.js";
import { loadJson, removeStoredValue, saveJson } from "../shared/storage.js";
import type { JsonObject } from "../types/storage";

export const BOARD_DRAWING_KEY = "vatio_board_drawing_v1";
export const BOARD_CURRENT_DOCUMENT_KEY = "vatio_board_document_current_v1";
export const BOARD_PENDING_OPEN_DOCUMENT_KEY = "vatio_board_document_pending_open_v1";
export const BOARD_SCHEMA_VERSION = 1;
export const BOARD_PERSIST_CHUNK_SIZE = 100;

const BOARD_DB_NAME = "vatio-board-storage";
const BOARD_DB_VERSION = 1;
const BOARD_DB_STORE = "boardRecords";
const BOARD_HISTORY_SECTION = "history";
const BOARD_REDO_SECTION = "redo";
const BOARD_CHUNK_KEY_PREFIX = "boardChunk:";

const boardStore = createIndexedJsonKeyValueStore({
  dbName: BOARD_DB_NAME,
  dbVersion: BOARD_DB_VERSION,
  storeName: BOARD_DB_STORE,
});
const boardStorageCapability = createStorageCapability({
  namespace: "board-storage",
  store: boardStore,
});

let boardMigrationPromise: Promise<void> | null = null;
let pendingSaveDocument: BoardDrawing | null = null;
let saveLoopPromise: Promise<void> | null = null;
let generationCounter = 0;

export interface BoardPoint extends JsonObject {
  x: number;
  y: number;
}

export interface BoardClearCommand extends JsonObject {
  type: "clear";
}

export interface BoardStrokeCommand extends JsonObject {
  type: "stroke";
  tool: "pen" | "eraser";
  size: number;
  inkRaw: string;
  points: BoardPoint[];
}

export type BoardCommand = BoardClearCommand | BoardStrokeCommand;

export interface BoardDrawing extends JsonObject {
  version: number;
  updatedAtMs: number;
  commands: BoardCommand[];
  redoCommands: BoardCommand[];
}

export interface StoredBoardDrawingRecord extends BoardDrawing {
  generation: string;
  commandCount: number;
  redoCount: number;
  chunkCount: number;
  redoChunkCount: number;
  previousGeneration: string;
  previousCommandCount: number;
  previousRedoCount: number;
  previousChunkCount: number;
  previousRedoChunkCount: number;
}

export interface EmbeddedBoardDrawingRecord extends BoardDrawing {
  generation: string;
  commandCount: number;
  redoCount: number;
  chunkCount: number;
  redoChunkCount: number;
}

export interface BoardSnapshotReference {
  generation: string;
  commandCount: number;
  redoCount: number;
  chunkCount: number;
  redoChunkCount: number;
}

interface ChunkSaveResult {
  ok: boolean;
  chunkCount: number;
}

interface ChunkLoadResult {
  ok: boolean;
  commands: BoardCommand[];
}

interface HydratedSnapshotResult {
  ok: boolean;
  commands: BoardCommand[];
  redoCommands: BoardCommand[];
}

export interface CurrentBoardDocumentMeta extends JsonObject {
  name: string;
  title: string;
  updatedAtMs: number;
}

export interface PendingBoardDocumentOpen extends JsonObject {
  document: JsonObject | null;
  payload: BoardDrawing;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

function normalizePositiveInteger(value: unknown, fallback = 0): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePoint(point: unknown): BoardPoint | null {
  if (!isRecord(point)) return null;
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;

  return {
    x: point.x,
    y: point.y,
  };
}

function normalizeCommand(command: unknown): BoardCommand | null {
  if (!isRecord(command)) return null;

  if (command.type === "clear") {
    return { type: "clear" };
  }

  if (command.type !== "stroke") return null;

  const points = Array.isArray(command.points)
    ? command.points.map(normalizePoint).filter((point): point is BoardPoint => Boolean(point))
    : [];

  if (points.length === 0) return null;

  return {
    type: "stroke",
    tool: command.tool === "eraser" ? "eraser" : "pen",
    size: isFiniteNumber(command.size) && command.size > 0 ? command.size : 6,
    inkRaw: typeof command.inkRaw === "string" ? command.inkRaw : "#111827",
    points,
  };
}

function normalizeCommands(commands: unknown): BoardCommand[] {
  if (!Array.isArray(commands)) return [];
  return commands.map(normalizeCommand).filter((command): command is BoardCommand => Boolean(command));
}

function createStoredDocument(document: unknown = {}): StoredBoardDrawingRecord {
  const record = isRecord(document) ? document : {};
  const commands = normalizeCommands(record.commands);
  const redoCommands = normalizeCommands(record.redoCommands);

  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalizePositiveInteger(record.updatedAtMs, Date.now()),
    generation: typeof record.generation === "string" ? record.generation : "",
    commandCount: normalizePositiveInteger(record.commandCount, commands.length),
    redoCount: normalizePositiveInteger(record.redoCount, redoCommands.length),
    chunkCount: normalizePositiveInteger(record.chunkCount, 0),
    redoChunkCount: normalizePositiveInteger(record.redoChunkCount, 0),
    previousGeneration: typeof record.previousGeneration === "string" ? record.previousGeneration : "",
    previousCommandCount: normalizePositiveInteger(record.previousCommandCount, 0),
    previousRedoCount: normalizePositiveInteger(record.previousRedoCount, 0),
    previousChunkCount: normalizePositiveInteger(record.previousChunkCount, 0),
    previousRedoChunkCount: normalizePositiveInteger(record.previousRedoChunkCount, 0),
    commands,
    redoCommands,
  };
}

export function createEmptyBoardDrawing(): BoardDrawing {
  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: 0,
    commands: [],
    redoCommands: [],
  };
}

export function hasBoardDrawingContent(document: unknown): boolean {
  const normalized = toBoardDrawing(document);
  return normalized.commands.length > 0 || normalized.redoCommands.length > 0;
}

function toBoardDrawing(document: unknown): BoardDrawing {
  const normalized = createStoredDocument(document);
  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalized.updatedAtMs,
    commands: normalized.commands,
    redoCommands: normalized.redoCommands,
  };
}

function createEmbeddedBoardDrawing(document: unknown): EmbeddedBoardDrawingRecord {
  const normalized = toBoardDrawing(document);
  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalized.updatedAtMs || Date.now(),
    generation: "",
    commandCount: normalized.commands.length,
    redoCount: normalized.redoCommands.length,
    chunkCount: 0,
    redoChunkCount: 0,
    commands: normalized.commands,
    redoCommands: normalized.redoCommands,
  };
}

function getBoardChunkKey(generation: string, section: string, chunkIndex: number): string {
  return `${BOARD_CHUNK_KEY_PREFIX}${generation}:${section}:${String(chunkIndex)}`;
}

function createGenerationId(): string {
  generationCounter += 1;
  return `board-${Date.now()}-${generationCounter}`;
}

async function openBoardDatabase(): Promise<IDBDatabase | null> {
  if (!(await boardStorageCapability.isIndexedDbUsable())) return null;

  try {
    return await boardStore.openDatabase();
  } catch {
    return null;
  }
}

export function getBoardStorageCapability() {
  return boardStorageCapability;
}

function createSnapshotReference(
  document: unknown,
  { previous = false }: { previous?: boolean } = {},
): BoardSnapshotReference {
  const normalized = createStoredDocument(document);

  return previous
    ? {
      generation: normalized.previousGeneration,
      commandCount: normalized.previousCommandCount,
      redoCount: normalized.previousRedoCount,
      chunkCount: normalized.previousChunkCount,
      redoChunkCount: normalized.previousRedoChunkCount,
    }
    : {
      generation: normalized.generation,
      commandCount: normalized.commandCount,
      redoCount: normalized.redoCount,
      chunkCount: normalized.chunkCount,
      redoChunkCount: normalized.redoChunkCount,
    };
}

function hasPersistedSnapshot(snapshot: BoardSnapshotReference | null | undefined): boolean {
  return Boolean(snapshot?.generation)
    || snapshot?.chunkCount > 0
    || snapshot?.redoChunkCount > 0;
}

async function deleteChunkRange(generation: string, section: string, chunkCount: number): Promise<void> {
  if (!boardStore.hasSupport() || !generation) return;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    await boardStore.deleteValue(getBoardChunkKey(generation, section, chunkIndex));
  }
}

async function deleteSnapshotReference(snapshot: BoardSnapshotReference | null | undefined): Promise<void> {
  if (!snapshot?.generation) return;
  await deleteChunkRange(snapshot.generation, BOARD_HISTORY_SECTION, snapshot.chunkCount ?? 0);
  await deleteChunkRange(snapshot.generation, BOARD_REDO_SECTION, snapshot.redoChunkCount ?? 0);
}

async function saveCommandChunks(
  generation: string,
  section: string,
  commands: BoardCommand[],
): Promise<ChunkSaveResult> {
  let chunkIndex = 0;

  for (let index = 0; index < commands.length; index += BOARD_PERSIST_CHUNK_SIZE) {
    const chunk = commands.slice(index, index + BOARD_PERSIST_CHUNK_SIZE);
    const stored = await boardStore.setValue(getBoardChunkKey(generation, section, chunkIndex), chunk);
    if (!stored) {
      return {
        ok: false,
        chunkCount: chunkIndex,
      };
    }
    chunkIndex += 1;
  }

  return {
    ok: true,
    chunkCount: chunkIndex,
  };
}

async function loadCommandChunks(
  generation: string,
  section: string,
  chunkCount: number,
  expectedCount: number,
): Promise<ChunkLoadResult> {
  if (chunkCount === 0) {
    return {
      ok: expectedCount === 0,
      commands: [],
    };
  }

  if (!generation) {
    return {
      ok: false,
      commands: [],
    };
  }

  const commands: BoardCommand[] = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunk = await boardStore.getValue<BoardCommand[]>(getBoardChunkKey(generation, section, chunkIndex));
    if (!Array.isArray(chunk) || chunk.length === 0) {
      return {
        ok: false,
        commands: [],
      };
    }

    const normalizedChunk = normalizeCommands(chunk);
    if (normalizedChunk.length !== chunk.length) {
      return {
        ok: false,
        commands: [],
      };
    }

    commands.push(...normalizedChunk);
  }

  return {
    ok: commands.length === expectedCount,
    commands,
  };
}

async function persistBoardDocument(document: unknown): Promise<boolean> {
  const normalized = toBoardDrawing({
    ...(isRecord(document) ? document : {}),
    updatedAtMs: isRecord(document) && isFiniteNumber(document.updatedAtMs) ? document.updatedAtMs : Date.now(),
  });

  const database = await openBoardDatabase();
  if (!database) {
    saveJson(BOARD_DRAWING_KEY, createEmbeddedBoardDrawing(normalized));
    return true;
  }

  const previousDocument = createStoredDocument(await boardStore.getValue<StoredBoardDrawingRecord>(BOARD_DRAWING_KEY));
  const previousSnapshot = createSnapshotReference(previousDocument);
  const previousBackupSnapshot = createSnapshotReference(previousDocument, { previous: true });
  const nextGeneration = normalized.commands.length > 0 || normalized.redoCommands.length > 0
    ? createGenerationId()
    : "";

  const historySave = await saveCommandChunks(nextGeneration, BOARD_HISTORY_SECTION, normalized.commands);
  if (!historySave.ok) {
    await deleteChunkRange(nextGeneration, BOARD_HISTORY_SECTION, historySave.chunkCount);
    return false;
  }

  const redoSave = await saveCommandChunks(nextGeneration, BOARD_REDO_SECTION, normalized.redoCommands);
  if (!redoSave.ok) {
    await deleteChunkRange(nextGeneration, BOARD_HISTORY_SECTION, historySave.chunkCount);
    await deleteChunkRange(nextGeneration, BOARD_REDO_SECTION, redoSave.chunkCount);
    return false;
  }

  const stored = await boardStore.setValue(BOARD_DRAWING_KEY, {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalized.updatedAtMs,
    generation: nextGeneration,
    commandCount: normalized.commands.length,
    redoCount: normalized.redoCommands.length,
    chunkCount: historySave.chunkCount,
    redoChunkCount: redoSave.chunkCount,
    previousGeneration: previousSnapshot.generation,
    previousCommandCount: previousSnapshot.commandCount,
    previousRedoCount: previousSnapshot.redoCount,
    previousChunkCount: previousSnapshot.chunkCount,
    previousRedoChunkCount: previousSnapshot.redoChunkCount,
    commands: [],
    redoCommands: [],
  } satisfies StoredBoardDrawingRecord);

  if (!stored) {
    await deleteChunkRange(nextGeneration, BOARD_HISTORY_SECTION, historySave.chunkCount);
    await deleteChunkRange(nextGeneration, BOARD_REDO_SECTION, redoSave.chunkCount);
    return false;
  }

  removeStoredValue(BOARD_DRAWING_KEY);
  if (
    previousBackupSnapshot.generation
    && previousBackupSnapshot.generation !== previousSnapshot.generation
    && previousBackupSnapshot.generation !== nextGeneration
  ) {
    await deleteSnapshotReference(previousBackupSnapshot);
  }
  return true;
}

async function migrateLegacyBoardStorage(): Promise<void> {
  if (!boardStore.hasSupport()) return;

  if (!boardMigrationPromise) {
    boardMigrationPromise = (async () => {
      const database = await openBoardDatabase();
      if (!database) return;

      const existingValue = await boardStore.getValue(BOARD_DRAWING_KEY);
      if (existingValue !== undefined) return;

      const legacyValue = loadJson<unknown>(BOARD_DRAWING_KEY, undefined);
      if (legacyValue === undefined) return;

      const stored = await persistBoardDocument(legacyValue);
      if (stored) {
        removeStoredValue(BOARD_DRAWING_KEY);
      }
    })();
  }

  return boardMigrationPromise;
}

async function hydratePersistedSnapshot(snapshot: BoardSnapshotReference): Promise<HydratedSnapshotResult> {
  if (!hasPersistedSnapshot(snapshot)) {
    return {
      ok: true,
      commands: [],
      redoCommands: [],
    };
  }

  const commands = await loadCommandChunks(
    snapshot.generation,
    BOARD_HISTORY_SECTION,
    snapshot.chunkCount,
    snapshot.commandCount,
  );
  if (!commands.ok) {
    return {
      ok: false,
      commands: [],
      redoCommands: [],
    };
  }

  const redoCommands = await loadCommandChunks(
    snapshot.generation,
    BOARD_REDO_SECTION,
    snapshot.redoChunkCount,
    snapshot.redoCount,
  );
  if (!redoCommands.ok) {
    return {
      ok: false,
      commands: [],
      redoCommands: [],
    };
  }

  return {
    ok: true,
    commands: commands.commands,
    redoCommands: redoCommands.commands,
  };
}

async function hydrateStoredBoardDrawing(document: unknown): Promise<BoardDrawing | null> {
  const normalized = createStoredDocument(document);

  if (!hasPersistedSnapshot(createSnapshotReference(normalized))) {
    return toBoardDrawing(normalized);
  }

  const currentSnapshot = await hydratePersistedSnapshot(createSnapshotReference(normalized));
  if (currentSnapshot.ok) {
    return toBoardDrawing({
      ...normalized,
      commands: currentSnapshot.commands,
      redoCommands: currentSnapshot.redoCommands,
    });
  }

  const backupReference = createSnapshotReference(normalized, { previous: true });
  if (!hasPersistedSnapshot(backupReference)) {
    return null;
  }

  const backupSnapshot = await hydratePersistedSnapshot(backupReference);
  if (backupSnapshot.ok) {
    return toBoardDrawing({
      ...normalized,
      commands: backupSnapshot.commands,
      redoCommands: backupSnapshot.redoCommands,
    });
  }

  return null;
}

export async function loadBoardDrawing(): Promise<BoardDrawing> {
  await migrateLegacyBoardStorage();

  const database = await openBoardDatabase();
  if (database) {
    const indexedValue = await boardStore.getValue<StoredBoardDrawingRecord>(BOARD_DRAWING_KEY);
    if (indexedValue !== undefined) {
      const hydrated = await hydrateStoredBoardDrawing(indexedValue);
      if (hydrated) return hydrated;
    }
  }

  return toBoardDrawing(loadJson(BOARD_DRAWING_KEY, createEmptyBoardDrawing()));
}

export function saveBoardDrawing(document: unknown): Promise<void> {
  pendingSaveDocument = cloneJson(toBoardDrawing(document));
  saveLoopPromise = (saveLoopPromise || Promise.resolve()).then(async () => {
    while (pendingSaveDocument) {
      const nextDocument = pendingSaveDocument;
      pendingSaveDocument = null;

      try {
        await persistBoardDocument(nextDocument);
      } catch {
        // Keep the last good snapshot intact when persistence fails.
      }
    }
  });

  return saveLoopPromise;
}

export function loadCurrentBoardDocumentMeta(): CurrentBoardDocumentMeta | null {
  const storedValue = loadJson<Record<string, unknown>>(BOARD_CURRENT_DOCUMENT_KEY, null);
  if (!isRecord(storedValue)) return null;

  const name = typeof storedValue.name === "string" ? storedValue.name : "";
  if (!name) return null;

  return {
    name,
    title: typeof storedValue.title === "string" ? storedValue.title : "",
    updatedAtMs: normalizePositiveInteger(storedValue.updatedAtMs, 0),
  };
}

export function saveCurrentBoardDocumentMeta(meta: unknown): void {
  const normalizedMeta = isRecord(meta) ? meta : {};
  const name = typeof normalizedMeta.name === "string" ? normalizedMeta.name : "";
  if (!name) {
    removeStoredValue(BOARD_CURRENT_DOCUMENT_KEY);
    return;
  }

  saveJson(BOARD_CURRENT_DOCUMENT_KEY, {
    name,
    title: typeof normalizedMeta.title === "string" ? normalizedMeta.title : "",
    updatedAtMs: normalizePositiveInteger(normalizedMeta.updatedAtMs, Date.now()),
  });
}

export function clearCurrentBoardDocumentMeta(): void {
  removeStoredValue(BOARD_CURRENT_DOCUMENT_KEY);
}

export function queuePendingBoardDocumentOpen(payload: unknown): void {
  saveJson(BOARD_PENDING_OPEN_DOCUMENT_KEY, isRecord(payload) ? payload : null);
}

export function consumePendingBoardDocumentOpen(): PendingBoardDocumentOpen | null {
  const pendingOpen = loadJson<Record<string, unknown>>(BOARD_PENDING_OPEN_DOCUMENT_KEY, null);
  removeStoredValue(BOARD_PENDING_OPEN_DOCUMENT_KEY);

  if (!isRecord(pendingOpen)) return null;
  const drawing = toBoardDrawing(pendingOpen.payload);
  if (!drawing) return null;

  return {
    document: isRecord(pendingOpen.document)
      ? pendingOpen.document as JsonObject
      : null,
    payload: drawing,
  };
}
