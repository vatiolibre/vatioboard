/**
 * Board Document Offline Mutation Queue
 *
 * Queues create/update/delete mutations locally when offline or unable to sync,
 * then replays them when connectivity and auth are restored.
 *
 * Design:
 *  - Mutations are persisted to localStorage for durability
 *  - Latest update wins (dedup): only the most recent update payload per document is kept
 *  - Delete supersedes pending creates/updates for the same document
 *  - After successful replay, local temporary IDs are reconciled to real backend IDs
 */

import { loadJson, saveJson, removeStoredValue } from "../shared/storage.js";

const QUEUE_STORAGE_KEY = "vatio_board_mutation_queue_v1";

/**
 * @typedef {'create'|'update'|'delete'} MutationType
 *
 * @typedef {Object} QueuedMutation
 * @property {string}       id               - Unique mutation ID
 * @property {MutationType} type             - Mutation type
 * @property {string|null}  documentName     - Backend document name (null for pending creates)
 * @property {string}       localSessionId   - Local session ID for reconciliation
 * @property {string}       title            - Document title
 * @property {Object|null}  payload          - Board drawing payload (null for deletes)
 * @property {Blob|null}    pngBlob          - PNG snapshot blob (not persisted, set before replay)
 * @property {number}       queuedAtMs       - When this mutation was queued
 * @property {'pending'|'replaying'|'failed'} status
 * @property {string}       failReason       - Failure description if status === 'failed'
 */

let mutationCounter = 0;

function createMutationId() {
  mutationCounter += 1;
  return `mut-${Date.now()}-${mutationCounter}`;
}

function loadQueue() {
  const raw = loadJson(QUEUE_STORAGE_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function persistQueue(queue) {
  if (queue.length === 0) {
    removeStoredValue(QUEUE_STORAGE_KEY);
    return;
  }
  // Strip non-serializable blobs before persisting
  const serializable = queue.map(({ pngBlob, ...rest }) => rest);
  saveJson(QUEUE_STORAGE_KEY, serializable);
}

/**
 * Get all pending mutations in queue order.
 */
export function getPendingMutations() {
  return loadQueue().filter((m) => m.status === "pending" || m.status === "failed");
}

/**
 * Whether there are any pending mutations in the queue.
 */
export function hasPendingMutations() {
  return getPendingMutations().length > 0;
}

/**
 * Queue a create mutation.
 */
export function queueCreateMutation({ localSessionId, title, payload }) {
  const queue = loadQueue();

  // Remove any existing pending create for same local session (dedup)
  const filtered = queue.filter(
    (m) => !(m.localSessionId === localSessionId && m.type === "create" && m.status === "pending")
  );

  filtered.push({
    id: createMutationId(),
    type: "create",
    documentName: null,
    localSessionId,
    title: title || "",
    payload: payload || null,
    queuedAtMs: Date.now(),
    status: "pending",
    failReason: "",
  });

  persistQueue(filtered);
}

/**
 * Queue an update mutation. Latest payload wins.
 */
export function queueUpdateMutation({ documentName, localSessionId, title, payload }) {
  const queue = loadQueue();

  // Remove any existing pending update for the same document (latest wins)
  const filtered = queue.filter(
    (m) => !(m.documentName === documentName && m.type === "update" && m.status === "pending")
  );

  filtered.push({
    id: createMutationId(),
    type: "update",
    documentName,
    localSessionId,
    title: title || "",
    payload: payload || null,
    queuedAtMs: Date.now(),
    status: "pending",
    failReason: "",
  });

  persistQueue(filtered);
}

/**
 * Queue a delete mutation. Supersedes pending updates for the same document.
 */
export function queueDeleteMutation({ documentName, localSessionId }) {
  const queue = loadQueue();

  // Remove pending creates/updates for the same document
  const filtered = queue.filter(
    (m) => !(m.documentName === documentName && (m.type === "create" || m.type === "update") && m.status === "pending")
  );

  // Also remove pending creates for the same local session
  const cleaned = filtered.filter(
    (m) => !(m.localSessionId === localSessionId && m.type === "create" && m.status === "pending")
  );

  // Only queue delete if the document has a remote name
  if (documentName) {
    cleaned.push({
      id: createMutationId(),
      type: "delete",
      documentName,
      localSessionId,
      title: "",
      payload: null,
      queuedAtMs: Date.now(),
      status: "pending",
      failReason: "",
    });
  }

  persistQueue(cleaned);
}

/**
 * Remove a specific mutation from the queue (after successful replay).
 */
export function removeMutation(mutationId) {
  const queue = loadQueue();
  persistQueue(queue.filter((m) => m.id !== mutationId));
}

/**
 * Mark a mutation as failed.
 */
export function markMutationFailed(mutationId, reason) {
  const queue = loadQueue();
  const mutation = queue.find((m) => m.id === mutationId);
  if (mutation) {
    mutation.status = "failed";
    mutation.failReason = reason || "Unknown error";
  }
  persistQueue(queue);
}

/**
 * Mark a mutation as replaying.
 */
export function markMutationReplaying(mutationId) {
  const queue = loadQueue();
  const mutation = queue.find((m) => m.id === mutationId);
  if (mutation) {
    mutation.status = "replaying";
  }
  persistQueue(queue);
}

/**
 * Reconcile a local session ID to a real backend document name after successful create.
 * Updates any pending update mutations that reference the old local session.
 */
export function reconcileLocalToRemote(localSessionId, remoteName) {
  const queue = loadQueue();
  let changed = false;
  for (const mutation of queue) {
    if (mutation.localSessionId === localSessionId && !mutation.documentName && mutation.type !== "delete") {
      mutation.documentName = remoteName;
      changed = true;
    }
  }
  if (changed) {
    persistQueue(queue);
  }
}

/**
 * Clear the entire queue (e.g. after successful full replay).
 */
export function clearMutationQueue() {
  removeStoredValue(QUEUE_STORAGE_KEY);
}

/**
 * Get count of pending mutations.
 */
export function getPendingMutationCount() {
  return getPendingMutations().length;
}
