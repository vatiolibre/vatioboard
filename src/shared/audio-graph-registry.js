/**
 * Shared audio-graph registry.
 *
 * Provides a single WeakMap that maps HTMLMediaElements to shared
 * AudioContext + MediaElementSourceNode entries.  Both the inline
 * mini-visualizer and the Milkdrop panel consume the same graph so
 * createMediaElementSource() is only called once per element.
 *
 * Consumers register themselves via acquireGraph() and release via
 * releaseGraph().  A MediaElementAudioSourceNode cannot be recreated for
 * the same media element in WebKit, so normal release only marks the graph
 * idle; force-destroy it when the media element itself is being replaced.
 *
 * iOS Safari requires a user-gesture to transition an AudioContext from
 * "suspended" to "running".  To avoid race conditions where
 * acquireGraph() runs inside an async callback (after the gesture
 * microtask window closes), callers can pre-warm a shared AudioContext
 * via {@link primeAudioContext} called synchronously from a click / tap
 * handler.  acquireGraph() then reuses the primed context.
 *
 * @module audio-graph-registry
 */

/** @type {WeakMap<HTMLMediaElement, GraphEntry>} */
const MEDIA_GRAPH_BY_ELEMENT = new WeakMap();

/** @type {WeakMap<HTMLMediaElement, { promise: Promise<GraphEntry|null>, cancelled: boolean }>} */
const MEDIA_GRAPH_CREATION_BY_ELEMENT = new WeakMap();

/**
 * Shared pre-warmed AudioContext.
 *
 * Created by {@link primeAudioContext} (from a user gesture) and consumed
 * by the next {@link acquireGraph} call that needs a new context.  Once
 * bound to a MediaElementSourceNode it is no longer reusable — a new
 * prime is needed for the next element.
 *
 * @type {AudioContext|null}
 */
let _primedAudioContext = null;

/**
 * @typedef {object} GraphEntry
 * @property {AudioContext}              audioContext
 * @property {MediaElementAudioSourceNode} sourceNode
 * @property {Set<AudioNode>}            consumers  - analyser nodes or other connected nodes
 * @property {number}                    refCount   - number of active owners
 */

/**
 * Return the existing graph entry for a media element, or null.
 * @param {HTMLMediaElement} mediaElement
 * @returns {GraphEntry|null}
 */
export function getGraph(mediaElement) {
  return MEDIA_GRAPH_BY_ELEMENT.get(mediaElement) || null;
}

async function resumeGraphContext(entry) {
  if (entry?.audioContext?.state === "suspended") {
    try { await entry.audioContext.resume(); } catch { /* best effort */ }
  }
}

async function retainGraph(entry) {
  if (!entry) return null;
  entry.refCount += 1;
  await resumeGraphContext(entry);
  return entry;
}

/**
 * Resume an existing graph for a media element without changing ownership.
 *
 * Safari can suspend an idle AudioContext while the MediaElementSourceNode
 * remains the media element's audio route.  Waking that context before
 * priming/play keeps routed media from starting through a stale graph.
 *
 * @param {HTMLMediaElement} mediaElement
 * @returns {Promise<boolean>} true when an existing graph is running
 */
export async function resumeGraphForElement(mediaElement) {
  const entry = MEDIA_GRAPH_BY_ELEMENT.get(mediaElement);
  if (!entry) return false;
  await resumeGraphContext(entry);
  return entry.audioContext?.state === "running";
}

/**
 * Pre-warm a shared AudioContext from a user-gesture handler.
 *
 * Must be called **synchronously** inside a click / tap / keydown handler so
 * iOS Safari allows the context to transition to "running".  The primed
 * context is stored and reused by the next {@link acquireGraph} call.
 *
 * Safe to call repeatedly — subsequent calls are no-ops while a primed
 * context is already running.
 *
 * @returns {boolean} true when a running AudioContext is ready.
 */
export function primeAudioContext() {
  // Already have a usable primed context.
  if (_primedAudioContext && _primedAudioContext.state === "running") return true;

  // If a previous primed context exists but is closed, discard it.
  if (_primedAudioContext && _primedAudioContext.state === "closed") {
    _primedAudioContext = null;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return false;

  try {
    const ctx = _primedAudioContext || new AudioContextCtor();
    // resume() inside a user gesture puts iOS Safari into "running".
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    _primedAudioContext = ctx;
    return ctx.state === "running";
  } catch {
    return false;
  }
}

/**
 * Get or create a shared audio graph for a media element.
 *
 * On first call for an element, creates an AudioContext and
 * MediaElementSourceNode.  Concurrent and subsequent calls return the same
 * entry and increment refCount, ensuring createMediaElementSource() is only
 * ever attempted once for a given element.
 *
 * @param {HTMLMediaElement} mediaElement
 * @returns {Promise<GraphEntry|null>} null on failure (CORS, no AudioContext, etc.)
 */
export async function acquireGraph(mediaElement) {
  const existing = MEDIA_GRAPH_BY_ELEMENT.get(mediaElement);
  if (existing) {
    return retainGraph(existing);
  }

  const pending = MEDIA_GRAPH_CREATION_BY_ELEMENT.get(mediaElement);
  if (pending) {
    return retainGraph(await pending.promise);
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;

  const creationRecord = {
    cancelled: false,
    promise: null,
  };

  const creation = (async () => {
    // Prefer the pre-warmed context (created during a user gesture).
    const hasPrimedContext = _primedAudioContext && _primedAudioContext.state !== "closed";
    const audioContext = hasPrimedContext ? _primedAudioContext : new AudioContextCtor();
    if (hasPrimedContext) {
      _primedAudioContext = null;  // consumed — next acquireGraph needs a fresh prime
    }

    try {
      if (audioContext.state === "suspended") await audioContext.resume();
    } catch {
      try { await audioContext.close(); } catch { /* ignore */ }
      return null;
    }
    if (audioContext.state !== "running") {
      try { await audioContext.close(); } catch { /* ignore */ }
      return null;
    }
    if (creationRecord.cancelled) {
      try { await audioContext.close(); } catch { /* ignore */ }
      return null;
    }

    let sourceNode;
    try {
      sourceNode = audioContext.createMediaElementSource(mediaElement);
      sourceNode.connect(audioContext.destination);
    } catch (err) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[audio-graph-registry] createMediaElementSource failed:", err);
      }
      try { await audioContext.close(); } catch { /* ignore */ }
      return null;
    }

    if (creationRecord.cancelled) {
      try { sourceNode.disconnect(); } catch { /* ignore */ }
      try { await audioContext.close(); } catch { /* ignore */ }
      return null;
    }

    /** @type {GraphEntry} */
    const entry = { audioContext, sourceNode, consumers: new Set(), refCount: 0 };
    MEDIA_GRAPH_BY_ELEMENT.set(mediaElement, entry);
    return entry;
  })();

  creationRecord.promise = creation;
  MEDIA_GRAPH_CREATION_BY_ELEMENT.set(mediaElement, creationRecord);

  try {
    return retainGraph(await creation);
  } finally {
    if (MEDIA_GRAPH_CREATION_BY_ELEMENT.get(mediaElement) === creationRecord) {
      MEDIA_GRAPH_CREATION_BY_ELEMENT.delete(mediaElement);
    }
  }
}

/**
 * Decrement the refCount for a graph entry.  When refCount reaches 0 the
 * source remains cached and connected to the destination because Safari
 * keeps the media element associated with that source for the element's
 * lifetime.  Use destroyGraphForElement() when replacing/removing the media
 * element.
 *
 * @param {HTMLMediaElement} mediaElement
 * @param {AudioNode} [consumerNode] - optional analyser/node to disconnect & remove
 */
export function releaseGraph(mediaElement, consumerNode) {
  const entry = MEDIA_GRAPH_BY_ELEMENT.get(mediaElement);
  if (!entry) return;

  if (consumerNode) {
    try { consumerNode.disconnect(); } catch { /* ignore */ }
    entry.consumers.delete(consumerNode);
  }

  entry.refCount = Math.max(0, entry.refCount - 1);

  if (entry.refCount <= 0) entry.refCount = 0;
}

/**
 * Force-destroy the graph for an element regardless of refCount.
 * Used when the media element itself is being disposed.
 *
 * @param {HTMLMediaElement} mediaElement
 * @returns {boolean} true if a graph was found and destroyed
 */
export function destroyGraphForElement(mediaElement) {
  const pending = MEDIA_GRAPH_CREATION_BY_ELEMENT.get(mediaElement);
  if (pending) {
    pending.cancelled = true;
    MEDIA_GRAPH_CREATION_BY_ELEMENT.delete(mediaElement);
  }

  const entry = MEDIA_GRAPH_BY_ELEMENT.get(mediaElement);
  if (!entry) return Boolean(pending);

  MEDIA_GRAPH_BY_ELEMENT.delete(mediaElement);
  try { entry.sourceNode?.disconnect(); } catch { /* ignore */ }
  for (const node of entry.consumers) {
    try { node.disconnect(); } catch { /* ignore */ }
  }
  entry.consumers.clear();
  try {
    const p = entry.audioContext?.close?.();
    p?.catch?.(() => {});
  } catch { /* ignore */ }
  return true;
}

/** @internal — reset primed context; test-only. */
export function _resetPrimedForTesting() {
  _primedAudioContext = null;
}
