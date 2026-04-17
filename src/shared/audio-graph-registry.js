/**
 * Shared audio-graph registry.
 *
 * Provides a single WeakMap that maps HTMLMediaElements to shared
 * AudioContext + MediaElementSourceNode entries.  Both the inline
 * mini-visualizer and the Milkdrop panel consume the same graph so
 * createMediaElementSource() is only called once per element.
 *
 * Consumers register themselves via acquireGraph() and release via
 * releaseGraph().  The graph (AudioContext + source) is torn down only
 * when the last consumer releases.
 *
 * @module audio-graph-registry
 */

/** @type {WeakMap<HTMLMediaElement, GraphEntry>} */
const MEDIA_GRAPH_BY_ELEMENT = new WeakMap();

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

/**
 * Get or create a shared audio graph for a media element.
 *
 * On first call for an element, creates an AudioContext and
 * MediaElementSourceNode.  Subsequent calls return the same entry
 * and increment refCount.
 *
 * @param {HTMLMediaElement} mediaElement
 * @returns {Promise<GraphEntry|null>} null on failure (CORS, no AudioContext, etc.)
 */
export async function acquireGraph(mediaElement) {
  const existing = MEDIA_GRAPH_BY_ELEMENT.get(mediaElement);
  if (existing) {
    existing.refCount += 1;
    if (existing.audioContext?.state === "suspended") {
      try { await existing.audioContext.resume(); } catch { /* best effort */ }
    }
    return existing;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;

  const audioContext = new AudioContextCtor();
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

  /** @type {GraphEntry} */
  const entry = { audioContext, sourceNode, consumers: new Set(), refCount: 1 };
  MEDIA_GRAPH_BY_ELEMENT.set(mediaElement, entry);
  return entry;
}

/**
 * Decrement the refCount for a graph entry.  When refCount reaches 0 the
 * AudioContext and source node are torn down and the entry is removed.
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

  if (entry.refCount <= 0) {
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
  }
}

/**
 * Force-destroy the graph for an element regardless of refCount.
 * Used when the media element itself is being disposed.
 *
 * @param {HTMLMediaElement} mediaElement
 * @returns {boolean} true if a graph was found and destroyed
 */
export function destroyGraphForElement(mediaElement) {
  const entry = MEDIA_GRAPH_BY_ELEMENT.get(mediaElement);
  if (!entry) return false;

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
