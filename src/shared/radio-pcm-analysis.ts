/**
 * Analysis-only radio decoder.
 *
 * Safari can play the relay through an HTMLAudioElement while returning an
 * empty MediaElementAudioSourceNode.  This module deliberately never touches
 * that element. It fetches the first-party relay, decodes MP3 or AAC ADTS
 * frames with WebCodecs when available, and feeds a bounded AudioWorklet ring
 * buffer.
 */

import { getRadioStreamRelayUrl } from "./radio-browser.js";

export type AnalysisTransport = "media-element" | "decoded-pcm";

export interface AnalysisGraph {
  audioContext: AudioContext;
  sourceNode: AudioNode;
  analyser?: AnalyserNode;
  transport: AnalysisTransport;
  stationUuid?: string;
  signalState?: "graph-ready" | "signal-present" | "signal-zero" | "decoder-unsupported" | "decoder-error" | "network-error";
  dispose?: () => void;
}

type RadioAnalysisSession = {
  graph: AnalysisGraph;
  abort: AbortController;
  workletUrl: string;
  decoder?: any;
  disposed: boolean;
};

type ParsedRadioFrames = {
  frames: Uint8Array[];
  remainder: Uint8Array;
  sampleRate: number;
  channels: number;
  codec: string;
  frameDurationUs: number;
};

const sessions = new Map<string, RadioAnalysisSession>();
let primedContext: AudioContext | null = null;

const WORKLET_SOURCE = `
class VatioRadioPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = [];
    this.read = 0;
    this.write = 0;
    this.length = 0;
    this.capacity = Math.max(1, Math.ceil(sampleRate * 0.25));
    this.port.onmessage = ({ data }) => {
      if (!data || data.type !== 'pcm') return;
      const channels = Array.isArray(data.channels) ? data.channels : [];
      if (!channels.length) return;
      const frames = Number(data.frames) || channels[0].length;
      if (!this.channels.length || this.channels.length !== channels.length) {
        this.channels = channels.map(() => new Float32Array(this.capacity));
        this.read = this.write = this.length = 0;
      }
      // Keep the newest audio. Dropping old frames is preferable to growing
      // latency forever when a decoder briefly outruns the render thread.
      const drop = Math.max(0, this.length + frames - this.capacity);
      this.read = (this.read + drop) % this.capacity;
      this.length = Math.max(0, this.length - drop);
      for (let i = 0; i < frames; i++) {
        const at = (this.write + i) % this.capacity;
        for (let c = 0; c < this.channels.length; c++) {
          this.channels[c][at] = Number(channels[c]?.[i] || 0);
        }
      }
      this.write = (this.write + frames) % this.capacity;
      this.length = Math.min(this.capacity, this.length + frames);
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0] || [];
    for (let i = 0; i < (output[0]?.length || 128); i++) {
      const has = this.length > 0;
      for (let c = 0; c < output.length; c++) {
        output[c][i] = has ? (this.channels[c % this.channels.length]?.[this.read] || 0) : 0;
      }
      if (has) {
        this.read = (this.read + 1) % this.capacity;
        this.length--;
      }
    }
    return true;
  }
}
registerProcessor('vatio-radio-pcm', VatioRadioPcmProcessor);
`;

function isSafariLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  const vendor = String(navigator.vendor || "");
  const isApple = /Apple/i.test(vendor) || /iPad|iPhone|iPod/i.test(ua);
  return isApple && /Safari|CriOS|FxiOS/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua);
}

export function requiresRadioPcmAnalysis(): boolean {
  return isSafariLike();
}

/** Prime the independent analysis context from a trusted visualization tap. */
export function primeRadioPcmAnalysisContext(): boolean {
  const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return false;
  try {
    if (!primedContext || primedContext.state === "closed") primedContext = new Ctor();
    if (primedContext.state !== "running" && primedContext.state !== "closed") void primedContext.resume().catch(() => {});
    return primedContext.state === "running";
  } catch { return false; }
}

function makeContext(): AudioContext | null {
  const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    const context = primedContext && primedContext.state !== "closed" ? primedContext : new Ctor();
    primedContext = null;
    return context;
  } catch { return null; }
}

function findMp3Frames(bytes: Uint8Array): ParsedRadioFrames {
  const frames: Uint8Array[] = [];
  let offset = 0;
  // ID3v2 is metadata, not an MPEG frame. Skip complete tags.
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    if (bytes.length < size + 10) {
      return { frames, remainder: bytes, sampleRate: 44100, channels: 2, codec: "mp3", frameDurationUs: 26_000 };
    }
    offset = size + 10;
  }
  let sampleRate = 44100;
  let channels = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) { offset++; continue; }
    const version = (bytes[offset + 1] >> 3) & 3;
    const layer = (bytes[offset + 1] >> 1) & 3;
    const bitrateIndex = (bytes[offset + 2] >> 4) & 15;
    const rateIndex = (bytes[offset + 2] >> 2) & 3;
    if (layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) { offset++; continue; }
    const rates = version === 3 ? [44100, 48000, 32000] : version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
    sampleRate = rates[rateIndex];
    const bitrates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const length = Math.floor((version === 3 ? 144 : 72) * bitrates[bitrateIndex] * 1000 / sampleRate) + (((bytes[offset + 2] >> 1) & 1) ? 1 : 0);
    if (length < 4 || offset + length > bytes.length) break;
    channels = ((bytes[offset + 3] >> 6) & 3) === 3 ? 1 : 2;
    frames.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  return { frames, remainder: bytes.slice(offset), sampleRate, channels, codec: "mp3", frameDurationUs: 26_000 };
}

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const AAC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 8];

function findAacFrames(bytes: Uint8Array): ParsedRadioFrames {
  const frames: Uint8Array[] = [];
  let offset = 0;
  let sampleRate = 44100;
  let channels = 2;
  let codec = "mp4a.40.2";
  while (offset + 7 <= bytes.length) {
    const first = bytes[offset];
    const second = bytes[offset + 1];
    if (first !== 0xff || (second & 0xf6) !== 0xf0) {
      offset++;
      continue;
    }
    const profile = ((bytes[offset + 2] >> 6) & 3) + 1;
    const sampleRateIndex = (bytes[offset + 2] >> 2) & 0xf;
    const rate = AAC_SAMPLE_RATES[sampleRateIndex];
    const channelConfig = ((bytes[offset + 2] & 1) << 2) | ((bytes[offset + 3] >> 6) & 3);
    const channelCount = AAC_CHANNELS[channelConfig];
    const frameLength = ((bytes[offset + 3] & 3) << 11)
      | (bytes[offset + 4] << 3)
      | ((bytes[offset + 5] >> 5) & 7);
    // Multiple raw data blocks require parsing inside one ADTS frame. Keep
    // those streams on the native playback path rather than feeding an
    // incorrectly timestamped analysis chunk.
    const rawDataBlocks = bytes[offset + 6] & 3;
    const headerLength = (second & 1) ? 7 : 9;
    if (!rate || !channelCount || profile > 4 || rawDataBlocks !== 0 || frameLength < headerLength) {
      offset++;
      continue;
    }
    if (offset + frameLength > bytes.length) break;
    sampleRate = rate;
    channels = channelCount;
    codec = `mp4a.40.${profile}`;
    frames.push(bytes.slice(offset, offset + frameLength));
    offset += frameLength;
  }
  return {
    frames,
    remainder: bytes.slice(offset),
    sampleRate,
    channels,
    codec,
    frameDurationUs: Math.round(1_024_000_000 / sampleRate),
  };
}

function findRadioFrames(bytes: Uint8Array): ParsedRadioFrames {
  // ADTS uses layer bits 00; MPEG audio uses layer bits 01/10/11. Detecting
  // the first sync header avoids treating an incomplete AAC frame as MP3.
  for (let offset = 0; offset + 2 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue;
    return ((bytes[offset + 1] >> 1) & 3) === 0
      ? findAacFrames(bytes)
      : findMp3Frames(bytes);
  }
  return { frames: [], remainder: bytes, sampleRate: 44100, channels: 2, codec: "mp3", frameDurationUs: 26_000 };
}

/** Test/diagnostic hook for verifying frame parsing across network boundaries. */
export function parseMp3FramesForTesting(bytes: Uint8Array) {
  return findMp3Frames(bytes);
}

/** Test/diagnostic hook for verifying AAC ADTS parsing across network boundaries. */
export function parseAacFramesForTesting(bytes: Uint8Array) {
  return findAacFrames(bytes);
}

async function configureDecoder(session: RadioAnalysisSession, sampleRate: number, channels: number, codec: string): Promise<boolean> {
  const Decoder = (globalThis as any).AudioDecoder;
  if (typeof Decoder === "undefined") {
    session.graph.signalState = "decoder-unsupported";
    return false;
  }
  const config = { codec, sampleRate, numberOfChannels: channels };
  try {
    const support = await Decoder.isConfigSupported(config);
    if (!support?.supported) {
      session.graph.signalState = "decoder-unsupported";
      return false;
    }
    session.decoder = new Decoder({
      output: (audioData) => {
        if (session.disposed) { audioData.close(); return; }
        const count = audioData.numberOfChannels;
        const frames = audioData.numberOfFrames;
        const data: Float32Array[] = [];
        for (let c = 0; c < count; c++) {
          const target = new Float32Array(frames);
          try { audioData.copyTo(target, { planeIndex: c, format: "f32-planar" }); }
          catch { audioData.copyTo(target, { planeIndex: c }); }
          data.push(target);
        }
        audioData.close();
        let energy = 0;
        for (const channel of data) for (const sample of channel) energy += sample * sample;
        session.graph.signalState = energy > 1e-8 ? "signal-present" : "signal-zero";
        (session.graph.sourceNode as any).port?.postMessage({ type: "pcm", channels: data, frames }, data.map((v) => v.buffer));
      },
      error: () => { session.graph.signalState = "decoder-error"; },
    });
    session.decoder.configure(config);
    return true;
  } catch { return false; }
}

export async function acquireRadioPcmAnalysis(stationUuid: string): Promise<AnalysisGraph | null> {
  if (!requiresRadioPcmAnalysis() || !stationUuid) return null;
  const existing = sessions.get(stationUuid);
  if (existing && !existing.disposed) return existing.graph;
  const relay = getRadioStreamRelayUrl(stationUuid);
  if (!relay) return null;
  const context = makeContext();
  if (!context || !context.audioWorklet || typeof AudioWorkletNode === "undefined") {
    try { await context?.close(); } catch { /* ignore */ }
    return null;
  }
  try {
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") {
      try { await context.close(); } catch { /* ignore */ }
      return null;
    }
    const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    await context.audioWorklet.addModule(workletUrl);
    const pcmNode = new AudioWorkletNode(context, "vatio-radio-pcm", { numberOfOutputs: 1, outputChannelCount: [2] });
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.62;
    const mute = context.createGain();
    mute.gain.value = 0;
    pcmNode.connect(analyser);
    pcmNode.connect(mute);
    mute.connect(context.destination);
    const abort = new AbortController();
    const session: RadioAnalysisSession = {
      graph: { audioContext: context, sourceNode: pcmNode, analyser, transport: "decoded-pcm", stationUuid, signalState: "graph-ready" },
      abort, workletUrl, disposed: false,
    };
    session.graph.dispose = () => disposeRadioPcmAnalysis(stationUuid);
    sessions.set(stationUuid, session);
    void fetchAndDecode(session, relay);
    return session.graph;
  } catch {
    try { await context.close(); } catch { /* ignore */ }
    return null;
  }
}

async function fetchAndDecode(session: RadioAnalysisSession, relay: string): Promise<void> {
  try {
    const response = await fetch(relay, { signal: session.abort.signal, headers: { Accept: "audio/mpeg,audio/aac" } });
    if (!response.ok || !response.body) throw new Error(`radio-analysis-http-${response.status}`);
    const reader = response.body.getReader();
    let pending = new Uint8Array(0);
    let configured = false;
    let timestamp = 0;
    while (!session.abort.signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      const merged = new Uint8Array(pending.length + next.value.length);
      merged.set(pending); merged.set(next.value, pending.length);
      const parsed = findRadioFrames(merged);
      pending = new Uint8Array(parsed.remainder);
      if (!configured && parsed.frames.length === 0) continue;
      if (!configured && parsed.frames.length) {
        configured = await configureDecoder(session, parsed.sampleRate, parsed.channels, parsed.codec);
      }
      if (!configured || !session.decoder) {
        session.abort.abort();
        try { await reader.cancel(); } catch { /* ignore */ }
        try { session.decoder?.close(); } catch { /* ignore */ }
        break;
      }
      for (const frame of parsed.frames) {
        if (session.abort.signal.aborted) break;
        const Chunk = (globalThis as any).EncodedAudioChunk;
        if (!Chunk) break;
        session.decoder.decode(new Chunk({ type: "key", timestamp, data: frame }));
        timestamp += parsed.frameDurationUs;
      }
    }
    if (session.decoder && session.decoder.state === "configured") await session.decoder.flush();
  } catch {
    if (!session.abort.signal.aborted) session.graph.signalState = "network-error";
    /* analysis failure is intentionally isolated from playback */
  }
}

export function disposeRadioPcmAnalysis(stationUuid: string): void {
  const session = sessions.get(stationUuid);
  if (!session) return;
  session.disposed = true;
  session.abort.abort();
  try { session.decoder?.close(); } catch { /* ignore */ }
  try { session.graph.sourceNode.disconnect(); } catch { /* ignore */ }
  try { session.graph.analyser?.disconnect(); } catch { /* ignore */ }
  try { session.graph.audioContext.close(); } catch { /* ignore */ }
  try { URL.revokeObjectURL(session.workletUrl); } catch { /* ignore */ }
  sessions.delete(stationUuid);
}

export function disposeAllRadioPcmAnalysis(): void {
  for (const uuid of [...sessions.keys()]) disposeRadioPcmAnalysis(uuid);
}

export function getRadioPcmAnalysis(stationUuid: string): AnalysisGraph | null {
  return sessions.get(stationUuid)?.graph || null;
}
