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

export type MutationType = 'create' | 'update' | 'delete';
export type MutationStatus = 'pending' | 'replaying' | 'failed';

export interface QueuedMutation {
  /** Unique mutation ID. */
  id: string;
  /** Mutation type. */
  type: MutationType;
  /** Backend document name (null for pending creates). */
  documentName?: string | null;
  /** Local session ID for reconciliation. */
  localSessionId?: string | null;
  /** Document title. */
  title: string;
  /** Board drawing payload (null for deletes). */
  payload: unknown | null;
  /** PNG snapshot blob (not persisted, set before replay). */
  pngBlob?: Blob | null;
  /** When this mutation was queued. */
  queuedAtMs: number;
  status: MutationStatus;
  /** Failure description if status === 'failed'. */
  failReason: string;
  [key: string]: unknown;
}

interface QueueCreateMutationOptions {
  localSessionId?: string | null;
  title?: string | null;
  payload?: unknown;
}

interface QueueUpdateMutationOptions {
  documentName?: string | null;
  localSessionId?: string | null;
  title?: string | null;
  payload?: unknown;
}

interface QueueDeleteMutationOptions {
  documentName?: string | null;
  localSessionId?: string | null;
}

let mutationCounter = 0;

function createMutationId(): string {
  mutationCounter += 1;
  return `mut-${Date.now()}-${mutationCounter}`;
}

function loadQueue(): QueuedMutation[] {
  const raw = loadJson<QueuedMutation[]>(QUEUE_STORAGE_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function persistQueue(queue: QueuedMutation[]): void {
  if (queue.length === 0) {
    removeStoredValue(QUEUE_STORAGE_KEY);
    return;
  }
  // Strip non-serializable blobs before persisting
  const serializable = queue.map(({ pngBlob: _pngBlob, ...rest }) => rest);
  saveJson(QUEUE_STORAGE_KEY, serializable);
}

/**
 * Get all pending mutations in queue order.
 */
export function getPendingMutations(): QueuedMutation[] {
  return loadQueue().filter((m) => m.status === "pending" || m.status === "failed");
}

/**
 * Whether there are any pending mutations in the queue.
 */
export function hasPendingMutations(): boolean {
  return getPendingMutations().length > 0;
}

/**
 * Queue a create mutation.
 */
export function queueCreateMutation({ localSessionId, title, payload }: QueueCreateMutationOptions): void {
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
export function queueUpdateMutation({
  documentName,
  localSessionId,
  title,
  payload,
}: QueueUpdateMutationOptions): void {
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
export function queueDeleteMutation({ documentName, localSessionId }: QueueDeleteMutationOptions): void {
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
export function removeMutation(mutationId: unknown): void {
  const queue = loadQueue();
  persistQueue(queue.filter((m) => m.id !== mutationId));
}

/**
 * Mark a mutation as failed.
 */
export function markMutationFailed(mutationId: unknown, reason?: string): void {
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
export function markMutationReplaying(mutationId: unknown): void {
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
export function reconcileLocalToRemote(localSessionId: unknown, remoteName: string | null): void {
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
export function clearMutationQueue(): void {
  removeStoredValue(QUEUE_STORAGE_KEY);
}

/**
 * Get count of pending mutations.
 */
export function getPendingMutationCount(): number {
  return getPendingMutations().length;
}
