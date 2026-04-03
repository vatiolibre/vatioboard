import { createIndexedJsonKeyValueStore } from "../shared/indexed-storage.js";
import { loadJson, removeStoredValue, saveJson } from "../shared/storage.js";

export const BOARD_DRAWING_KEY = "vatio_board_drawing_v1";
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

let boardMigrationPromise = null;
let pendingSaveDocument = null;
let saveLoopPromise = null;
let generationCounter = 0;

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function normalizePositiveInteger(value, fallback = 0) {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePoint(point) {
  if (!point || typeof point !== "object") return null;
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;

  return {
    x: point.x,
    y: point.y,
  };
}

function normalizeCommand(command) {
  if (!command || typeof command !== "object") return null;

  if (command.type === "clear") {
    return { type: "clear" };
  }

  if (command.type !== "stroke") return null;

  const points = Array.isArray(command.points)
    ? command.points.map(normalizePoint).filter(Boolean)
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

function normalizeCommands(commands) {
  if (!Array.isArray(commands)) return [];
  return commands.map(normalizeCommand).filter(Boolean);
}

function createStoredDocument(document = {}) {
  const commands = normalizeCommands(document.commands);
  const redoCommands = normalizeCommands(document.redoCommands);

  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalizePositiveInteger(document.updatedAtMs, Date.now()),
    generation: typeof document.generation === "string" ? document.generation : "",
    commandCount: normalizePositiveInteger(document.commandCount, commands.length),
    redoCount: normalizePositiveInteger(document.redoCount, redoCommands.length),
    chunkCount: normalizePositiveInteger(document.chunkCount, 0),
    redoChunkCount: normalizePositiveInteger(document.redoChunkCount, 0),
    previousGeneration: typeof document.previousGeneration === "string" ? document.previousGeneration : "",
    previousCommandCount: normalizePositiveInteger(document.previousCommandCount, 0),
    previousRedoCount: normalizePositiveInteger(document.previousRedoCount, 0),
    previousChunkCount: normalizePositiveInteger(document.previousChunkCount, 0),
    previousRedoChunkCount: normalizePositiveInteger(document.previousRedoChunkCount, 0),
    commands,
    redoCommands,
  };
}

export function createEmptyBoardDrawing() {
  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: 0,
    commands: [],
    redoCommands: [],
  };
}

function toBoardDrawing(document) {
  const normalized = createStoredDocument(document);
  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalized.updatedAtMs,
    commands: normalized.commands,
    redoCommands: normalized.redoCommands,
  };
}

function createEmbeddedBoardDrawing(document) {
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

function getBoardChunkKey(generation, section, chunkIndex) {
  return `${BOARD_CHUNK_KEY_PREFIX}${generation}:${section}:${String(chunkIndex)}`;
}

function createGenerationId() {
  generationCounter += 1;
  return `board-${Date.now()}-${generationCounter}`;
}

async function openBoardDatabase() {
  if (!boardStore.hasSupport()) return null;

  try {
    return await boardStore.openDatabase();
  } catch {
    return null;
  }
}

function createSnapshotReference(document, { previous = false } = {}) {
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

function hasPersistedSnapshot(snapshot) {
  return Boolean(snapshot?.generation)
    || snapshot?.chunkCount > 0
    || snapshot?.redoChunkCount > 0;
}

async function deleteChunkRange(generation, section, chunkCount) {
  if (!boardStore.hasSupport() || !generation) return;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    await boardStore.deleteValue(getBoardChunkKey(generation, section, chunkIndex));
  }
}

async function deleteSnapshotReference(snapshot) {
  if (!snapshot?.generation) return;
  await deleteChunkRange(snapshot.generation, BOARD_HISTORY_SECTION, snapshot.chunkCount ?? 0);
  await deleteChunkRange(snapshot.generation, BOARD_REDO_SECTION, snapshot.redoChunkCount ?? 0);
}

async function saveCommandChunks(generation, section, commands) {
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

async function loadCommandChunks(generation, section, chunkCount, expectedCount) {
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

  const commands = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunk = await boardStore.getValue(getBoardChunkKey(generation, section, chunkIndex));
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

async function persistBoardDocument(document) {
  const normalized = toBoardDrawing({
    ...document,
    updatedAtMs: isFiniteNumber(document?.updatedAtMs) ? document.updatedAtMs : Date.now(),
  });

  const database = await openBoardDatabase();
  if (!database) {
    saveJson(BOARD_DRAWING_KEY, createEmbeddedBoardDrawing(normalized));
    return true;
  }

  const previousDocument = createStoredDocument(await boardStore.getValue(BOARD_DRAWING_KEY));
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
  });

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

async function migrateLegacyBoardStorage() {
  if (!boardStore.hasSupport()) return;

  if (!boardMigrationPromise) {
    boardMigrationPromise = (async () => {
      const database = await openBoardDatabase();
      if (!database) return;

      const existingValue = await boardStore.getValue(BOARD_DRAWING_KEY);
      if (existingValue !== undefined) return;

      const legacyValue = loadJson(BOARD_DRAWING_KEY, undefined);
      if (legacyValue === undefined) return;

      const stored = await persistBoardDocument(legacyValue);
      if (stored) {
        removeStoredValue(BOARD_DRAWING_KEY);
      }
    })();
  }

  return boardMigrationPromise;
}

async function hydratePersistedSnapshot(snapshot) {
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

async function hydrateStoredBoardDrawing(document) {
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

export async function loadBoardDrawing() {
  await migrateLegacyBoardStorage();

  const database = await openBoardDatabase();
  if (database) {
    const indexedValue = await boardStore.getValue(BOARD_DRAWING_KEY);
    if (indexedValue !== undefined) {
      const hydrated = await hydrateStoredBoardDrawing(indexedValue);
      if (hydrated) return hydrated;
    }
  }

  return toBoardDrawing(loadJson(BOARD_DRAWING_KEY, createEmptyBoardDrawing()));
}

export function saveBoardDrawing(document) {
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
