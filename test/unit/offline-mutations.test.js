import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  queueCreateMutation,
  queueUpdateMutation,
  queueDeleteMutation,
  removeMutation,
  markMutationFailed,
  getPendingMutations,
  hasPendingMutations,
  clearMutationQueue,
} from "../../src/board/offline-mutations.js";

const STORAGE_KEY = "vatio_board_mutation_queue_v1";

describe("offline-mutations", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("starts with an empty queue", () => {
    expect(getPendingMutations()).toEqual([]);
    expect(hasPendingMutations()).toBe(false);
  });

  it("queues a create mutation", () => {
    queueCreateMutation({ localSessionId: "s1", title: "Board A", payload: {} });
    const pending = getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe("create");
    expect(pending[0].title).toBe("Board A");
    expect(hasPendingMutations()).toBe(true);
  });

  it("queues an update mutation", () => {
    queueUpdateMutation({ documentName: "DOC-1", payload: { x: 1 } });
    const pending = getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe("update");
    expect(pending[0].documentName).toBe("DOC-1");
  });

  it("queues a delete mutation and it supersedes pending updates", () => {
    queueUpdateMutation({ documentName: "DOC-1", payload: { x: 1 } });
    queueDeleteMutation({ documentName: "DOC-1" });
    const pending = getPendingMutations();
    // Delete should supersede update for same doc
    const docMutations = pending.filter((m) => m.documentName === "DOC-1");
    expect(docMutations).toHaveLength(1);
    expect(docMutations[0].type).toBe("delete");
  });

  it("removes a mutation by id", () => {
    queueCreateMutation({ localSessionId: "s2", title: "Board B", payload: {} });
    const [mutation] = getPendingMutations();
    removeMutation(mutation.id);
    expect(getPendingMutations()).toHaveLength(0);
  });

  it("marks a mutation as failed", () => {
    queueCreateMutation({ localSessionId: "s3", title: "Board C", payload: {} });
    const [mutation] = getPendingMutations();
    markMutationFailed(mutation.id, "Server error");
    const updated = getPendingMutations();
    expect(updated[0].failReason).toBe("Server error");
  });

  it("clears the entire queue", () => {
    queueCreateMutation({ localSessionId: "s4", title: "Board D", payload: {} });
    queueUpdateMutation({ documentName: "DOC-2", payload: {} });
    clearMutationQueue();
    expect(getPendingMutations()).toHaveLength(0);
    expect(hasPendingMutations()).toBe(false);
  });

  it("deduplicates updates for the same document", () => {
    queueUpdateMutation({ documentName: "DOC-3", payload: { v: 1 } });
    queueUpdateMutation({ documentName: "DOC-3", payload: { v: 2 } });
    const pending = getPendingMutations();
    const doc3 = pending.filter((m) => m.documentName === "DOC-3");
    expect(doc3).toHaveLength(1);
    expect(doc3[0].payload).toEqual({ v: 2 });
  });
});
