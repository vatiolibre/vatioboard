import { beforeEach, describe, expect, it, vi } from "vitest";

function createPoint(x, y) {
  return { x, y };
}

function createStroke(index) {
  return {
    type: "stroke",
    tool: index % 7 === 0 ? "eraser" : "pen",
    size: 4 + (index % 6),
    inkRaw: index % 2 === 0 ? "#111827" : "#2563eb",
    points: [
      createPoint(index, index + 1),
      createPoint(index + 0.5, index + 1.5),
    ],
  };
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createFakeIndexedDb({ shouldFailPut = () => false } = {}) {
  const records = new Map();
  const objectStoreNames = new Set();
  let putCounter = 0;
  let failPut = shouldFailPut;

function createRequest(transaction, executor) {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    };

    queueMicrotask(() => {
      try {
        executor({
          resolve(value) {
            request.result = cloneJson(value);
            request.onsuccess?.({ target: request });
            queueMicrotask(() => {
              transaction.oncomplete?.({ target: transaction });
            });
          },
          reject(error) {
            request.error = error;
            request.onerror?.({ target: request });
            queueMicrotask(() => {
              transaction.error = error;
              transaction.onabort?.({ target: transaction });
            });
          },
        });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
        queueMicrotask(() => {
          transaction.error = error;
          transaction.onabort?.({ target: transaction });
        });
      }
    });

    return request;
  }

  const database = {
    objectStoreNames: {
      contains(name) {
        return objectStoreNames.has(name);
      },
    },
    createObjectStore(name) {
      objectStoreNames.add(name);
      return {};
    },
    transaction() {
      const transaction = {
        onabort: null,
        oncomplete: null,
        error: null,
        objectStore() {
          return {
            get(key) {
              return createRequest(transaction, ({ resolve }) => {
                resolve(records.has(key) ? records.get(key) : undefined);
              });
            },
            put(value, key) {
              return createRequest(transaction, ({ resolve, reject }) => {
                putCounter += 1;
                if (failPut(key, cloneJson(value), putCounter)) {
                  const error = new Error(`Failed to store ${key}`);
                  transaction.error = error;
                  reject(error);
                  return;
                }

                records.set(key, cloneJson(value));
                resolve(undefined);
              });
            },
            delete(key) {
              return createRequest(transaction, ({ resolve }) => {
                records.delete(key);
                resolve(undefined);
              });
            },
          };
        },
      };

      return transaction;
    },
  };

  return {
    __records: records,
    open: vi.fn(() => {
      const request = {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        try {
          request.onupgradeneeded?.({ target: request });
          request.onsuccess?.({ target: request });
        } catch (error) {
          request.error = error;
          request.onerror?.({ target: request });
        }
      });

      return request;
    }),
    setShouldFailPut(nextShouldFailPut) {
      failPut = nextShouldFailPut;
    },
  };
}

function createFailingIndexedDb({ blocked = false } = {}) {
  return {
    open: vi.fn(() => {
      const request = {
        result: null,
        error: new Error(blocked ? "IndexedDB is blocked" : "IndexedDB open failed"),
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        if (blocked) {
          request.onblocked?.({ target: request });
          return;
        }

        request.onerror?.({ target: request });
      });

      return request;
    }),
  };
}

describe("board storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves large drawings in IndexedDB-backed chunks", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createFakeIndexedDb();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });
    vi.resetModules();

    try {
      const boardStorage = await import("../../src/board/storage.js");
      const commands = Array.from({ length: boardStorage.BOARD_PERSIST_CHUNK_SIZE + 45 }, (_, index) => createStroke(index));

      await boardStorage.saveBoardDrawing({
        commands,
        redoCommands: [createStroke(999)],
      });

      const restored = await boardStorage.loadBoardDrawing();

      expect(restored.commands).toHaveLength(commands.length);
      expect(restored.redoCommands).toHaveLength(1);
      expect(restored.commands[0]).toMatchObject({
        type: "stroke",
        points: [createPoint(0, 1), createPoint(0.5, 1.5)],
      });
      expect(restored.commands[commands.length - 1]).toMatchObject({
        points: [createPoint(commands.length - 1, commands.length), createPoint(commands.length - 0.5, commands.length + 0.5)],
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });

  it("keeps the last good snapshot when a later chunked save fails", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createFakeIndexedDb();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });
    vi.resetModules();

    try {
      const boardStorage = await import("../../src/board/storage.js");
      const initialCommands = Array.from({ length: 150 }, (_, index) => createStroke(index));
      const updatedCommands = Array.from({ length: 260 }, (_, index) => createStroke(index));

      await boardStorage.saveBoardDrawing({
        commands: initialCommands,
        redoCommands: [],
      });

      fakeIndexedDb.setShouldFailPut((key) => key.includes(":history:1"));

      await boardStorage.saveBoardDrawing({
        commands: updatedCommands,
        redoCommands: [createStroke(1234)],
      });

      const restored = await boardStorage.loadBoardDrawing();

      expect(restored.commands).toHaveLength(initialCommands.length);
      expect(restored.redoCommands).toEqual([]);
      expect(restored.commands[initialCommands.length - 1]).toMatchObject({
        points: [createPoint(149, 150), createPoint(149.5, 150.5)],
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });

  it("falls back to embedded local storage when IndexedDB cannot be opened", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const failingIndexedDb = createFailingIndexedDb();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: failingIndexedDb,
    });
    vi.resetModules();

    try {
      const boardStorage = await import("../../src/board/storage.js");
      localStorage.setItem(boardStorage.BOARD_DRAWING_KEY, JSON.stringify({
        version: boardStorage.BOARD_SCHEMA_VERSION,
        updatedAtMs: 1,
        generation: "",
        commandCount: 1,
        redoCount: 0,
        chunkCount: 0,
        redoChunkCount: 0,
        commands: [createStroke(1)],
        redoCommands: [],
      }));

      const restoredLegacy = await boardStorage.loadBoardDrawing();
      expect(restoredLegacy.commands).toHaveLength(1);

      await boardStorage.saveBoardDrawing({
        commands: [createStroke(1), createStroke(2)],
        redoCommands: [createStroke(3)],
      });

      const embeddedSnapshot = JSON.parse(localStorage.getItem(boardStorage.BOARD_DRAWING_KEY));
      expect(embeddedSnapshot.commandCount).toBe(2);
      expect(embeddedSnapshot.redoCount).toBe(1);
      expect(embeddedSnapshot.commands).toHaveLength(2);
      expect(embeddedSnapshot.redoCommands).toHaveLength(1);

      const restored = await boardStorage.loadBoardDrawing();
      expect(restored.commands).toHaveLength(2);
      expect(restored.redoCommands).toHaveLength(1);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });

  it("falls back to the previous indexed snapshot when the latest generation is corrupted", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createFakeIndexedDb();

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });
    vi.resetModules();

    try {
      const boardStorage = await import("../../src/board/storage.js");
      const firstCommands = Array.from({ length: 145 }, (_, index) => createStroke(index));
      const secondCommands = Array.from({ length: 255 }, (_, index) => createStroke(index + 500));

      await boardStorage.saveBoardDrawing({
        commands: firstCommands,
        redoCommands: [createStroke(900)],
      });
      await boardStorage.saveBoardDrawing({
        commands: secondCommands,
        redoCommands: [createStroke(901), createStroke(902)],
      });

      const metadata = fakeIndexedDb.__records.get(boardStorage.BOARD_DRAWING_KEY);
      expect(metadata.previousGeneration).toBeTruthy();
      fakeIndexedDb.__records.delete(`boardChunk:${metadata.generation}:history:1`);

      const restored = await boardStorage.loadBoardDrawing();
      expect(restored.commands).toHaveLength(firstCommands.length);
      expect(restored.redoCommands).toHaveLength(1);
      expect(restored.commands[firstCommands.length - 1]).toMatchObject({
        points: [createPoint(144, 145), createPoint(144.5, 145.5)],
      });
      expect(restored.redoCommands[0]).toMatchObject({
        points: [createPoint(900, 901), createPoint(900.5, 901.5)],
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });
});
