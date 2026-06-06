import {
  activateAudioElement,
  createSilentLoopAudioUrl,
  primeAudioElement,
  resetAudioElementPlaybackRate,
} from "../../shared/audio-channel-retainer.js";
import {
  acquireBackgroundAudioLease,
  isBackgroundAudioLeaseActive,
  releaseBackgroundAudioLease,
} from "../../shared/audio-system.js";
import {
  PIPER_VOICE_BY_ID,
  PIPER_VOICES,
  PIPER_VOICES_BY_LANG,
  getDefaultPiperVoiceForLang,
  getLangForPiperVoice,
  isPiperVoiceId,
  isTtsLangId,
  type PiperVoiceId,
  type TtsLangId,
} from "../../apps/tts/tts-resources.js";
import type {
  TtsLoadVoiceRequest,
  TtsService,
  TtsSnapshot,
  TtsSpeakRequest,
  TtsSpeechResult,
  TtsStatusUpdate,
  TtsStopRequest,
  TtsVoiceLoadResult,
  TtsVoiceOption,
  Unsubscribe,
} from "../../types/services";
import type { TtsWorkerRequest, TtsWorkerRequestPayload, TtsWorkerResponse } from "../../apps/tts/tts-worker-protocol.js";

type ManagedAudioElement = HTMLAudioElement & { playsInline?: boolean };
type PendingWorkerRequest = {
  reject: (error: Error) => void;
  resolve: (message: TtsWorkerResponse) => void;
  onStatus?: ((status: TtsStatusUpdate) => void) | null;
  sourceAppId?: string | null;
};
type QueueItem = {
  id: string;
  request: ResolvedSpeakRequest;
  reject: (error: Error) => void;
  resolve: (result: TtsSpeechResult) => void;
  sequence: number;
};
type ResolvedVoiceRequest = {
  lang: TtsLangId;
  onStatus?: ((status: TtsStatusUpdate) => void) | null;
  sourceAppId?: string | null;
  speed: number;
  voice: PiperVoiceId;
};
type ResolvedSpeakRequest = ResolvedVoiceRequest & {
  dedupeKey?: string | null;
  interrupt: boolean;
  priority: NonNullable<TtsSpeakRequest["priority"]>;
  text: string;
  volume: number;
};
type ResolvedPrepareSpeechRequest = ResolvedVoiceRequest & {
  priority: NonNullable<TtsSpeakRequest["priority"]>;
  text: string;
};

const TTS_BACKGROUND_AUDIO_LEASE = "tts";
const DEFAULT_LANG: TtsLangId = "en-us";
const DEFAULT_VOLUME = 1;
const DEFAULT_SPEED = 1;
const MAX_TEXT_CHARS = 700;
const PRIORITY_WEIGHT: Record<ResolvedSpeakRequest["priority"], number> = {
  critical: 0,
  driving: 1,
  system: 2,
  info: 3,
};

function normalizeSourceAppId(value: unknown): string | null {
  const source = String(value || "").trim();
  return source || null;
}

function clampVolume(value: unknown, fallback = DEFAULT_VOLUME): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function clampSpeed(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SPEED;
  return Math.max(0.72, Math.min(1.35, parsed));
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}

function resolveLang(value: unknown): TtsLangId {
  const raw = String(value || "").trim().toLowerCase();
  if (isTtsLangId(raw)) return raw;
  if (raw.startsWith("es")) return raw.includes("-es") ? "es-es" : "es-419";
  if (raw.startsWith("en-gb") || raw.startsWith("en-uk")) return "en-gb";
  if (raw.startsWith("en")) return "en-us";
  if (raw.startsWith("pt")) return "pt-br";
  if (raw.startsWith("it")) return "it";
  if (raw.startsWith("fr")) return "fr";
  if (raw.startsWith("de")) return "de";
  return DEFAULT_LANG;
}

function resolveVoice(lang: TtsLangId, voice: unknown): PiperVoiceId {
  if (isPiperVoiceId(voice) && getLangForPiperVoice(voice) === lang) return voice;
  return getDefaultPiperVoiceForLang(lang);
}

function resolveVoiceRequest(request: TtsLoadVoiceRequest = {}): ResolvedVoiceRequest {
  const requestedVoice = isPiperVoiceId(request.voice) ? request.voice : null;
  const lang = request.lang
    ? resolveLang(request.lang)
    : requestedVoice
      ? getLangForPiperVoice(requestedVoice)
      : resolveLang(typeof navigator !== "undefined" ? navigator.language : DEFAULT_LANG);

  return {
    lang,
    onStatus: typeof request.onStatus === "function" ? request.onStatus : null,
    sourceAppId: normalizeSourceAppId(request.sourceAppId),
    speed: clampSpeed(request.speed),
    voice: resolveVoice(lang, requestedVoice),
  };
}

function resolveSpeakRequest(request: TtsSpeakRequest): ResolvedSpeakRequest {
  return {
    ...resolveVoiceRequest(request),
    dedupeKey: typeof request.dedupeKey === "string" && request.dedupeKey.trim()
      ? request.dedupeKey.trim()
      : null,
    interrupt: request.interrupt === true || request.priority === "critical",
    priority: request.priority || "system",
    text: normalizeText(request.text),
    volume: clampVolume(request.volume, DEFAULT_VOLUME),
  };
}

function snapshotStatusFromWorker(status: string): TtsSnapshot["status"] {
  const normalized = status.toLowerCase();
  if (normalized.includes("generating") || normalized.includes("phonemizing")) return "generating";
  if (normalized.includes("speaking")) return "speaking";
  if (normalized.includes("ready")) return "ready";
  if (normalized.includes("loading") || normalized.includes("preparing")) return "loading";
  return "idle";
}

function createInitialSnapshot(): TtsSnapshot {
  return {
    status: "idle",
    progress: "Voice service idle",
    ratio: null,
    muted: false,
    volume: DEFAULT_VOLUME,
    primed: false,
    loading: false,
    generating: false,
    speaking: false,
    queueLength: 0,
    loadedVoice: null,
    activeVoice: null,
    activeLang: null,
    provider: null,
    error: null,
    currentSourceAppId: null,
  };
}

export function createTtsService(): TtsService {
  let snapshot = createInitialSnapshot();
  const listeners = new Set<(snapshot: TtsSnapshot) => void>();
  const pendingWorkerRequests = new Map<number, PendingWorkerRequest>();
  const queue: QueueItem[] = [];
  const recentDedupe = new Map<string, number>();
  let worker: Worker | null = null;
  let workerRequestId = 0;
  let workerChain: Promise<void> = Promise.resolve();
  let queueSequence = 0;
  let processingQueue = false;
  let activeItem: QueueItem | null = null;
  let activePlaybackReject: ((error: Error) => void) | null = null;
  let activePlaybackCleanup: (() => void) | null = null;
  let audio: ManagedAudioElement | null = null;
  let audioUrl = "";
  let primeAudioUrl = "";

  function emit() {
    const nextSnapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(nextSnapshot);
      } catch {
        // Advisory listeners must not break TTS.
      }
    }
  }

  function setSnapshot(patch: Partial<TtsSnapshot>) {
    snapshot = {
      ...snapshot,
      ...patch,
      queueLength: queue.length,
    };
    emit();
  }

  function getSnapshot(): TtsSnapshot {
    return { ...snapshot, queueLength: queue.length };
  }

  function reportStatus(
    status: string,
    progress = "",
    ratio: number | null = null,
    pending?: PendingWorkerRequest | null,
  ) {
    const update = { status, progress, ratio };
    pending?.onStatus?.(update);
    setSnapshot({
      status: snapshotStatusFromWorker(status),
      progress: progress || status,
      ratio,
      error: null,
      loading: snapshotStatusFromWorker(status) === "loading",
      generating: snapshotStatusFromWorker(status) === "generating",
      speaking: snapshotStatusFromWorker(status) === "speaking",
    });
  }

  function rejectPendingWorkerRequests(error: Error) {
    for (const pending of pendingWorkerRequests.values()) pending.reject(error);
    pendingWorkerRequests.clear();
  }

  function hasPendingWorkerRequestForSource(sourceAppId: string | null): boolean {
    for (const pending of pendingWorkerRequests.values()) {
      if (!sourceAppId || pending.sourceAppId === sourceAppId) return true;
    }
    return false;
  }

  function resetWorker(reason = "TTS worker reset") {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    rejectPendingWorkerRequests(new Error(reason));
    setSnapshot({
      activeLang: null,
      activeVoice: null,
      currentSourceAppId: null,
      error: null,
      generating: false,
      loading: false,
      loadedVoice: null,
      provider: null,
      speaking: false,
      status: "idle",
      progress: reason,
      ratio: null,
    });
  }

  function handleWorkerMessage(message: TtsWorkerResponse) {
    const pending = pendingWorkerRequests.get(message.id);
    if (message.type === "status") {
      reportStatus(message.status, message.progress || "", message.ratio ?? null, pending);
      return;
    }

    if (!pending) return;
    pendingWorkerRequests.delete(message.id);
    if (message.type === "error") {
      pending.reject(new Error(message.message));
      return;
    }
    pending.resolve(message);
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("../../apps/tts/tts-worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<TtsWorkerResponse>) => {
      handleWorkerMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "TTS worker failed.");
      rejectPendingWorkerRequests(error);
      worker?.terminate();
      worker = null;
      setSnapshot({
        error: error.message,
        generating: false,
        loading: false,
        speaking: false,
        status: "error",
        progress: error.message,
        ratio: null,
      });
    });
    return worker;
  }

  function sendWorkerRequest(
    request: TtsWorkerRequestPayload,
    pendingOptions: Pick<PendingWorkerRequest, "onStatus" | "sourceAppId"> = {},
  ): Promise<TtsWorkerResponse> {
    const id = ++workerRequestId;
    const nextRequest = { ...request, id } as TtsWorkerRequest;
    const targetWorker = ensureWorker();
    return new Promise((resolve, reject) => {
      pendingWorkerRequests.set(id, { resolve, reject, ...pendingOptions });
      targetWorker.postMessage(nextRequest);
    });
  }

  function runWorkerOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = workerChain.catch(() => undefined).then(operation);
    workerChain = result.then(() => undefined, () => undefined);
    return result;
  }

  function getAudio() {
    if (audio) return audio;
    audio = new Audio() as ManagedAudioElement;
    audio.preload = "auto";
    audio.playsInline = true;
    resetAudioElementPlaybackRate(audio);
    return audio;
  }

  function clearAudioSource() {
    const target = audio;
    if (!target) return;
    try {
      target.pause();
      target.removeAttribute("src");
      target.load();
    } catch {
      // Audio cleanup is best effort.
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = "";
    }
  }

  function stopPlayback(reason = "TTS stopped") {
    const reject = activePlaybackReject;
    activePlaybackReject = null;
    activePlaybackCleanup?.();
    activePlaybackCleanup = null;
    clearAudioSource();
    if (reject) reject(new Error(reason));
    setSnapshot({
      currentSourceAppId: null,
      speaking: false,
      status: queue.length ? "idle" : snapshot.loadedVoice ? "ready" : "idle",
      progress: reason,
    });
  }

  function playSpeechBlob(blob: Blob, request: ResolvedSpeakRequest): Promise<void> {
    if (snapshot.muted) return Promise.reject(new Error("TTS is muted."));
    if (activePlaybackReject || audioUrl) stopPlayback("TTS playback replaced");
    else clearAudioSource();

    const target = getAudio();
    audioUrl = URL.createObjectURL(blob);
    target.src = audioUrl;
    activateAudioElement(target, clampVolume(request.volume, snapshot.volume));
    target.muted = false;

    setSnapshot({
      activeLang: request.lang,
      activeVoice: request.voice,
      currentSourceAppId: request.sourceAppId || null,
      generating: false,
      loading: false,
      speaking: true,
      status: "speaking",
      progress: `${PIPER_VOICE_BY_ID[request.voice]?.name || request.voice} speaking`,
      ratio: 1,
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        target.removeEventListener("ended", handleEnded);
        target.removeEventListener("error", handleError);
        activePlaybackCleanup = null;
        activePlaybackReject = null;
      };
      const settle = (handler: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler();
      };
      const handleEnded = () => settle(() => {
        clearAudioSource();
        setSnapshot({
          currentSourceAppId: null,
          speaking: false,
          status: queue.length ? "idle" : "ready",
          progress: "Speech complete",
        });
        resolve();
      });
      const handleError = () => settle(() => {
        const message = "TTS audio playback failed.";
        clearAudioSource();
        setSnapshot({
          currentSourceAppId: null,
          error: message,
          speaking: false,
          status: "error",
          progress: message,
        });
        reject(new Error(message));
      });

      activePlaybackCleanup = cleanup;
      activePlaybackReject = (error) => settle(() => reject(error));
      target.addEventListener("ended", handleEnded);
      target.addEventListener("error", handleError);

      target.play()
        .then(() => {
          setSnapshot({ primed: true, error: null, status: "speaking" });
        })
        .catch((error) => {
          settle(() => {
            const message = error instanceof Error ? error.message : "TTS playback was blocked.";
            clearAudioSource();
            setSnapshot({
              error: message,
              speaking: false,
              status: "blocked",
              progress: message,
            });
            reject(new Error(message));
          });
        });
    });
  }

  async function loadVoice(request: TtsLoadVoiceRequest = {}): Promise<TtsVoiceLoadResult> {
    const resolved = resolveVoiceRequest(request);
    setSnapshot({
      activeLang: resolved.lang,
      activeVoice: resolved.voice,
      currentSourceAppId: resolved.sourceAppId || null,
      error: null,
      loading: true,
      status: "loading",
      progress: "Loading Piper voice",
      ratio: null,
    });

    const message = await runWorkerOperation(() => sendWorkerRequest({
      type: "load",
      lang: resolved.lang,
      piperVoice: resolved.voice,
      speed: resolved.speed,
    }, {
      onStatus: resolved.onStatus,
      sourceAppId: resolved.sourceAppId,
    }));

    if (message.type !== "loaded") throw new Error("TTS worker did not load a voice.");
    setSnapshot({
      activeLang: resolved.lang,
      activeVoice: resolved.voice,
      currentSourceAppId: null,
      loadedVoice: message.model,
      loading: false,
      provider: message.provider,
      status: "ready",
      progress: `${PIPER_VOICE_BY_ID[message.model]?.name || message.model} ready`,
      ratio: 1,
    });
    return { model: message.model, provider: message.provider };
  }

  function shouldDropDedupe(request: ResolvedSpeakRequest): boolean {
    if (!request.dedupeKey) return false;
    const now = Date.now();
    const previous = recentDedupe.get(request.dedupeKey) || 0;
    recentDedupe.set(request.dedupeKey, now);
    return now - previous < 2500;
  }

  async function requestSpeechFromWorker(request: ResolvedPrepareSpeechRequest): Promise<Extract<TtsWorkerResponse, { type: "speech" }>> {
    const message = await runWorkerOperation(() => sendWorkerRequest({
      type: "speak",
      lang: request.lang,
      piperVoice: request.voice,
      speed: request.speed,
      text: request.text,
    }, {
      onStatus: request.onStatus,
      sourceAppId: request.sourceAppId,
    }));

    if (message.type !== "speech") throw new Error("TTS worker did not return speech.");
    setSnapshot({
      loadedVoice: message.model,
      provider: message.provider,
    });
    return message;
  }

  async function runSpeakItem(item: QueueItem): Promise<TtsSpeechResult> {
    const request = item.request;
    if (!request.text) throw new Error("No text was provided.");
    if (snapshot.muted) throw new Error("TTS is muted.");

    setSnapshot({
      activeLang: request.lang,
      activeVoice: request.voice,
      currentSourceAppId: request.sourceAppId || null,
      error: null,
      generating: true,
      status: "generating",
      progress: "Generating Piper speech",
      ratio: null,
    });

    const message = await requestSpeechFromWorker(request);
    await playSpeechBlob(message.blob, request);
    return {
      id: item.id,
      audioSeconds: message.audioSeconds,
      durationMs: message.durationMs,
      model: message.model,
      provider: message.provider,
      size: message.size,
    };
  }

  async function prepareSpeech(request: Omit<TtsSpeakRequest, "interrupt" | "volume">): Promise<TtsSpeechResult> {
    const resolved = {
      ...resolveVoiceRequest(request),
      priority: request.priority || "info",
      text: normalizeText(request.text),
    } satisfies ResolvedPrepareSpeechRequest;
    if (!resolved.text) throw new Error("No text was provided.");
    const ownsSnapshot = !activePlaybackReject && !snapshot.speaking && !processingQueue;

    if (ownsSnapshot) {
      setSnapshot({
        activeLang: resolved.lang,
        activeVoice: resolved.voice,
        currentSourceAppId: resolved.sourceAppId || null,
        error: null,
        generating: true,
        status: "generating",
        progress: "Preparing Piper speech cache",
        ratio: null,
      });
    }

    try {
      const message = await requestSpeechFromWorker(resolved);
      return {
        id: `tts-prepared-${Date.now()}`,
        audioSeconds: message.audioSeconds,
        durationMs: message.durationMs,
        model: message.model,
        provider: message.provider,
        size: message.size,
      };
    } finally {
      if (ownsSnapshot) {
        setSnapshot({
          currentSourceAppId: null,
          generating: false,
          loading: false,
          speaking: false,
          status: snapshot.error ? "error" : snapshot.loadedVoice ? "ready" : "idle",
        });
      }
    }
  }

  function sortQueue() {
    queue.sort((left, right) => {
      const priorityDelta = PRIORITY_WEIGHT[left.request.priority] - PRIORITY_WEIGHT[right.request.priority];
      return priorityDelta || left.sequence - right.sequence;
    });
  }

  function rejectQueuedForSource(sourceAppId: string | null, error: Error) {
    for (let index = queue.length - 1; index >= 0; index--) {
      const item = queue[index];
      if (sourceAppId && item.request.sourceAppId !== sourceAppId) continue;
      queue.splice(index, 1);
      item.reject(error);
    }
  }

  async function processQueue() {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (queue.length) {
        const item = queue.shift()!;
        activeItem = item;
        setSnapshot({ queueLength: queue.length });
        try {
          item.resolve(await runSpeakItem(item));
        } catch (error) {
          item.reject(error instanceof Error ? error : new Error("TTS speech failed."));
          setSnapshot({
            currentSourceAppId: null,
            error: error instanceof Error ? error.message : "TTS speech failed.",
            generating: false,
            loading: false,
            speaking: false,
            status: "error",
            progress: error instanceof Error ? error.message : "TTS speech failed.",
          });
        } finally {
          activeItem = null;
        }
      }
    } finally {
      processingQueue = false;
      setSnapshot({
        currentSourceAppId: null,
        generating: false,
        loading: false,
        speaking: false,
        status: snapshot.error ? "error" : snapshot.loadedVoice ? "ready" : "idle",
      });
    }
  }

  function speak(request: TtsSpeakRequest): Promise<TtsSpeechResult> {
    const resolved = resolveSpeakRequest(request);
    if (!resolved.text) return Promise.reject(new Error("No text was provided."));
    if (shouldDropDedupe(resolved)) {
      return Promise.reject(new Error("Duplicate TTS announcement suppressed."));
    }

    if (resolved.interrupt) {
      cancel({
        reason: "Interrupted by higher priority announcement.",
      });
    }

    return new Promise((resolve, reject) => {
      queue.push({
        id: `tts-${Date.now()}-${++queueSequence}`,
        request: resolved,
        resolve,
        reject,
        sequence: queueSequence,
      });
      sortQueue();
      setSnapshot({
        error: null,
        progress: "Speech queued",
        queueLength: queue.length,
      });
      void processQueue();
    });
  }

  async function primeFromUserGesture({ keepAlive = false }: { keepAlive?: boolean } = {}) {
    if (snapshot.primed && (!keepAlive || isBackgroundAudioLeaseActive(TTS_BACKGROUND_AUDIO_LEASE))) {
      return true;
    }

    const target = getAudio();
    if (!primeAudioUrl) primeAudioUrl = createSilentLoopAudioUrl({ durationSeconds: 1 });
    if (!target.src) target.src = primeAudioUrl;
    setSnapshot({ status: "loading", progress: "Priming voice audio", ratio: null });
    try {
      if (keepAlive) {
        await acquireBackgroundAudioLease(TTS_BACKGROUND_AUDIO_LEASE, {
          shouldContinue: () => !snapshot.muted,
        });
      }
      const primed = await primeAudioElement(target);
      setSnapshot({
        primed,
        status: primed ? "ready" : "blocked",
        progress: primed ? "Voice audio ready" : "Voice audio needs another tap",
      });
      return primed;
    } catch {
      setSnapshot({
        primed: false,
        status: "blocked",
        progress: "Voice audio needs another tap",
      });
      return false;
    }
  }

  function stop(options: TtsStopRequest = {}) {
    const sourceAppId = normalizeSourceAppId(options.sourceAppId);
    if (!sourceAppId || activeItem?.request.sourceAppId === sourceAppId || snapshot.currentSourceAppId === sourceAppId) {
      stopPlayback(options.reason || "TTS stopped");
    }
    rejectQueuedForSource(sourceAppId, new Error(options.reason || "TTS stopped"));
    setSnapshot({ queueLength: queue.length });
  }

  function cancel(options: TtsStopRequest = {}) {
    const sourceAppId = normalizeSourceAppId(options.sourceAppId);
    const reason = options.reason || "TTS cancelled";
    const shouldResetWorker = options.resetEngine === true || hasPendingWorkerRequestForSource(sourceAppId);
    stop(options);
    rejectQueuedForSource(sourceAppId, new Error(reason));
    if (shouldResetWorker) {
      resetWorker(reason);
    }
  }

  function setMuted(value: boolean): TtsSnapshot {
    const muted = Boolean(value);
    if (muted) {
      stopPlayback("TTS muted");
      releaseBackgroundAudioLease(TTS_BACKGROUND_AUDIO_LEASE);
    }
    setSnapshot({ muted });
    return getSnapshot();
  }

  function setVolume(value: number): TtsSnapshot {
    const volume = clampVolume(value, snapshot.volume);
    if (audio) audio.volume = volume;
    setSnapshot({ volume });
    return getSnapshot();
  }

  function listVoices(lang?: string): TtsVoiceOption[] {
    const resolvedLang = lang ? resolveLang(lang) : null;
    const voices = resolvedLang ? PIPER_VOICES_BY_LANG[resolvedLang] || [] : PIPER_VOICES;
    return voices.map((voice) => ({ ...voice }));
  }

  function getDefaultVoice(lang?: string): string {
    return getDefaultPiperVoiceForLang(resolveLang(lang));
  }

  return {
    cancel,
    getDefaultVoice,
    getSnapshot,
    listVoices,
    loadVoice,
    prepareSpeech,
    preloadVoice: loadVoice,
    primeFromUserGesture,
    setMuted,
    setVolume,
    speak,
    stop,
    subscribe(listener: (nextSnapshot: TtsSnapshot) => void): Unsubscribe {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    },
  };
}
