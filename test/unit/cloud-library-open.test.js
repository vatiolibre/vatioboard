import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  accelDetail: vi.fn(),
  boardDetail: vi.fn(),
  speedDetail: vi.fn(),
  hasBoardDrawingContent: vi.fn(),
  importReplaySession: vi.fn(),
  isAccelPayloadComplete: vi.fn(),
  isReplayPayloadComplete: vi.fn(),
  importRun: vi.fn(),
  loadBoardDrawing: vi.fn(),
  queuePendingBoardDocumentOpen: vi.fn(),
  queuePendingReplaySessionOpen: vi.fn(),
}));

vi.mock("../../src/shared/cloud-library-resources.js", () => ({
  CLOUD_LIBRARY_TAB_KEYS: {
    accel: "accel",
    boardDocuments: "board_documents",
    savedImages: "saved_images",
    speed: "speed",
  },
  cloudLibraryResources: {
    speed: {
      resource: {
        getDetail: mockState.speedDetail,
      },
    },
    accel: {
      resource: {
        getDetail: mockState.accelDetail,
      },
    },
    board_documents: {
      resource: {
        getDetail: mockState.boardDetail,
      },
    },
  },
}));

vi.mock("../../src/replay/session.js", () => ({
  importReplaySession: mockState.importReplaySession,
  isReplayPayloadComplete: mockState.isReplayPayloadComplete,
  queuePendingReplaySessionOpen: mockState.queuePendingReplaySessionOpen,
}));

vi.mock("../../src/accel/storage.js", () => ({
  isAccelPayloadComplete: mockState.isAccelPayloadComplete,
  importRun: mockState.importRun,
}));

vi.mock("../../src/board/storage.js", () => ({
  hasBoardDrawingContent: mockState.hasBoardDrawingContent,
  loadBoardDrawing: mockState.loadBoardDrawing,
  queuePendingBoardDocumentOpen: mockState.queuePendingBoardDocumentOpen,
}));

describe("cloud library open helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mockState).forEach((entry) => entry.mockReset());
  });

  it("imports a replay payload lazily and returns a replay deep link", async () => {
    mockState.speedDetail.mockResolvedValue({
      record: {
        can_open: true,
      },
      payload: {
        id: "remote-replay-1",
        samples: [
          { timestampMs: 1000, latitude: 40.7, longitude: -74.0 },
          { timestampMs: 2000, latitude: 40.8, longitude: -73.9 },
        ],
      },
    });
    mockState.isReplayPayloadComplete.mockReturnValue(true);
    mockState.importReplaySession.mockResolvedValue({
      id: "local-replay-1",
    });

    const { openCloudReplaySession } = await import("../../src/shared/cloud-library-open.js");
    await expect(openCloudReplaySession("SYNC-REPLAY-1")).resolves.toBe(
      "/replay.html?record=local-replay-1&cloudRecord=SYNC-REPLAY-1"
    );

    expect(mockState.speedDetail).toHaveBeenCalledWith("SYNC-REPLAY-1", {
      force: true,
      mode: "full",
    });
    expect(mockState.queuePendingReplaySessionOpen).toHaveBeenCalledWith({
      id: "remote-replay-1",
      samples: [
        { timestampMs: 1000, latitude: 40.7, longitude: -74.0 },
        { timestampMs: 2000, latitude: 40.8, longitude: -73.9 },
      ],
    });
    expect(mockState.importReplaySession).toHaveBeenCalledWith(
      {
        id: "remote-replay-1",
        samples: [
          { timestampMs: 1000, latitude: 40.7, longitude: -74.0 },
          { timestampMs: 2000, latitude: 40.8, longitude: -73.9 },
        ],
      },
      { saveLast: true }
    );
  });

  it("rejects summary-only replay payloads instead of opening a blank replay page", async () => {
    mockState.speedDetail.mockResolvedValue({
      record: {
        can_open: false,
      },
      payload: {
        id: "remote-replay-1",
        sampleCount: 24,
      },
    });
    mockState.isReplayPayloadComplete.mockReturnValue(false);

    const { openCloudReplaySession } = await import("../../src/shared/cloud-library-open.js");
    await expect(openCloudReplaySession("SYNC-REPLAY-1")).rejects.toMatchObject({
      libraryStatusKey: "cloudLibraryTelemetryUnavailable",
    });

    expect(mockState.importReplaySession).not.toHaveBeenCalled();
  });

  it("imports an accel payload lazily and returns an accel deep link", async () => {
    mockState.accelDetail.mockResolvedValue({
      record: {
        can_open: true,
      },
      payload: {
        id: "remote-run-1",
        sampleLog: [
          { elapsedFromStartMs: 0, speedMs: 0 },
          { elapsedFromStartMs: 4200, speedMs: 26.8 },
        ],
      },
    });
    mockState.isAccelPayloadComplete.mockReturnValue(true);
    mockState.importRun.mockResolvedValue({
      id: "local-run-1",
    });

    const { openCloudAccelRun } = await import("../../src/shared/cloud-library-open.js");
    await expect(openCloudAccelRun("SYNC-ACCEL-1")).resolves.toBe("/accel.html?run=local-run-1");

    expect(mockState.accelDetail).toHaveBeenCalledWith("SYNC-ACCEL-1", {
      force: true,
      mode: "full",
    });
    expect(mockState.importRun).toHaveBeenCalledWith({
      id: "remote-run-1",
      sampleLog: [
        { elapsedFromStartMs: 0, speedMs: 0 },
        { elapsedFromStartMs: 4200, speedMs: 26.8 },
      ],
    });
  });

  it("rejects summary-only accel payloads instead of opening a broken accel detail", async () => {
    mockState.accelDetail.mockResolvedValue({
      record: {
        can_open: false,
      },
      payload: {
        id: "remote-run-1",
        elapsedMs: 4200,
        presetId: "0-60",
      },
    });
    mockState.isAccelPayloadComplete.mockReturnValue(false);

    const { openCloudAccelRun } = await import("../../src/shared/cloud-library-open.js");
    await expect(openCloudAccelRun("SYNC-ACCEL-1")).rejects.toMatchObject({
      libraryStatusKey: "cloudLibraryTelemetryUnavailable",
    });

    expect(mockState.importRun).not.toHaveBeenCalled();
  });

  it("does not queue a board document when the user cancels replacing local work", async () => {
    mockState.boardDetail.mockResolvedValue({
      document: {
        name: "BOARD-DOC-1",
        title: "Skidpad",
      },
      payload: {
        updatedAtMs: 1712160000000,
        commands: [{ type: "stroke", points: [{ x: 1, y: 1 }] }],
        redoCommands: [],
      },
    });
    mockState.loadBoardDrawing.mockResolvedValue({
      commands: [{ type: "stroke" }],
      redoCommands: [],
    });
    mockState.hasBoardDrawingContent.mockReturnValue(true);

    const { openCloudBoardDocument } = await import("../../src/shared/cloud-library-open.js");
    const confirmReplace = vi.fn(() => false);

    await expect(openCloudBoardDocument("BOARD-DOC-1", { confirmReplace })).resolves.toBeNull();

    expect(confirmReplace).toHaveBeenCalledTimes(1);
    expect(mockState.queuePendingBoardDocumentOpen).not.toHaveBeenCalled();
  });

  it("queues an empty board document payload so the editor can open and update it", async () => {
    mockState.boardDetail.mockResolvedValue({
      document: {
        name: "BOARD-DOC-1",
        title: "Skidpad",
      },
      payload: {
        updatedAtMs: 1712160000000,
        commands: [],
        redoCommands: [],
      },
    });
    mockState.loadBoardDrawing.mockResolvedValue({
      commands: [],
      redoCommands: [],
    });
    mockState.hasBoardDrawingContent.mockReturnValue(false);

    const { openCloudBoardDocument } = await import("../../src/shared/cloud-library-open.js");
    await expect(openCloudBoardDocument("BOARD-DOC-1")).resolves.toBe("/");

    expect(mockState.queuePendingBoardDocumentOpen).toHaveBeenCalledWith({
      document: {
        name: "BOARD-DOC-1",
        title: "Skidpad",
      },
      payload: {
        updatedAtMs: 1712160000000,
        commands: [],
        redoCommands: [],
      },
    });
  });
});
