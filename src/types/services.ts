export type Unsubscribe = () => void;

export interface Subscription {
  unsubscribe(): void;
}

export interface GpsCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitudeM?: number | null;
  altitudeAccuracyM?: number | null;
}

export type GpsPermissionState = PermissionState | "unsupported" | "unknown";

export interface GpsPositionSnapshot extends GpsCoordinates {
  speedMs: number | null;
  heading?: number | null;
  headingDeg: number | null;
  fixTimestampMs?: number | null;
  timestampMs: number;
  receivedAtMs: number;
  stale?: boolean;
}

export interface NormalizedGpsPosition {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitudeM?: number | null;
  altitudeAccuracyM?: number | null;
  speedMs: number | null;
  heading?: number | null;
  headingDeg: number | null;
  fixTimestampMs?: number | null;
  timestampMs: number;
  receivedAtMs: number;
  lastCallbackAtMs?: number | null;
  freshnessTimestampMs?: number | null;
  timestampSkewMs?: number | null;
  timestampSource?: "browser" | "received";
  stale: boolean;
}

export interface GpsErrorSnapshot {
  code: number;
  message: string;
  receivedAtMs: number;
}

export interface GpsSnapshot {
  status: "idle" | "unsupported" | "starting" | "active" | "degraded" | "error";
  lastPosition: GeolocationPosition | null;
  normalized: NormalizedGpsPosition | null;
  lastError: GpsErrorSnapshot | null;
  lastCallbackAtMs: number;
  subscriberCount: number;
  nativeWatchActive: boolean;
  consumers: string[];
}

export interface GpsConsumerOptions {
  enableHighAccuracy?: boolean;
  reason?: string;
}

export interface GpsService {
  watchPosition(
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
  startConsumer(consumerId: string, options?: GpsConsumerOptions): Unsubscribe;
  stopConsumer(consumerId: string): void;
  subscribe(listener: (snapshot: GpsSnapshot) => void): Unsubscribe;
  getSnapshot(): GpsSnapshot;
  getCurrentPosition(): NormalizedGpsPosition | null;
  requestHighAccuracy(reason?: string): Unsubscribe;
  releaseHighAccuracy(reason?: string): void;
  installGlobalShim(): boolean;
  destroy(): void;
}

export interface DrivingAlertSnapshot {
  status: string;
  started?: boolean;
  currentSpeedMs: number;
  latestPosition: NormalizedGpsPosition | null;
  alertUiState: unknown;
  audio: unknown;
  preferences: unknown;
  [key: string]: unknown;
}

export interface DrivingAlertService {
  start(options?: { fromUserGesture?: boolean; reason?: string }): DrivingAlertSnapshot;
  stop(options?: { reason?: string }): DrivingAlertSnapshot;
  subscribe(listener: (snapshot: DrivingAlertSnapshot) => void): Unsubscribe;
  getSnapshot(): DrivingAlertSnapshot;
  primeAudioFromUserGesture?(): Promise<boolean>;
  setAlertSoundEnabled?(value: unknown, options?: { fromUserGesture?: boolean; startIfNeeded?: boolean }): DrivingAlertSnapshot;
  setManualAlertEnabled?(value: unknown, options?: { fromUserGesture?: boolean; startIfNeeded?: boolean }): DrivingAlertSnapshot;
  setManualAlertLimitMs?(value: unknown, options?: { fromUserGesture?: boolean; startIfNeeded?: boolean }): DrivingAlertSnapshot;
  setMuted?(value: unknown, options?: { fromUserGesture?: boolean; startIfNeeded?: boolean }): DrivingAlertSnapshot;
  setPreference?(key: string, value: unknown, options?: { fromUserGesture?: boolean }): DrivingAlertSnapshot;
  setTrapAlertDistanceM?(value: unknown, options?: { fromUserGesture?: boolean; startIfNeeded?: boolean }): DrivingAlertSnapshot;
  setTrapAlertEnabled?(value: unknown, options?: { fromUserGesture?: boolean; startIfNeeded?: boolean }): DrivingAlertSnapshot;
  setTrapSoundEnabled?(value: unknown, options?: { fromUserGesture?: boolean; startIfNeeded?: boolean }): DrivingAlertSnapshot;
  setUnits?(options?: { unit?: string; distanceUnit?: string }): DrivingAlertSnapshot;
  destroy(): void;
}

export interface DriveRecordingSnapshot {
  state: "idle" | "recording" | "paused" | "finalizing" | string;
  sessionId: string;
  startedAtMs: number | null;
  sampleCount: number;
  totalDistanceM: number;
  currentSpeedMs: number;
  maxSpeedMs: number;
  lastPosition: NormalizedGpsPosition | null;
  lastHeadingDeg: number | null;
  lastPersistedAtMs: number;
  localOnly: boolean;
  pendingCloudSync: boolean;
}

export interface DriveRecordingService {
  startRecording(options?: { source?: string }): DriveRecordingSnapshot;
  pauseRecording(): DriveRecordingSnapshot;
  resumeRecording(): DriveRecordingSnapshot;
  stopRecording(): Promise<DriveRecordingSnapshot>;
  subscribe(listener: (snapshot: DriveRecordingSnapshot) => void): Unsubscribe;
  getSnapshot(): DriveRecordingSnapshot;
  getCurrentSession(): unknown;
  persistNow(): Promise<unknown>;
  destroy(): void;
}

export interface AudioRuntimeState {
  queue: unknown[];
  playedHistory: unknown[];
  currentIndex: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  backgroundMode: boolean;
  sourceType: "blob" | "remote" | null;
  currentTrack: unknown;
  loading: boolean;
  error: unknown;
  remoteSessionActive: boolean;
  currentTime?: number;
  duration?: number;
  playing?: boolean;
}

export interface AudioRuntime {
  getState(): AudioRuntimeState;
  subscribe(listener: (state: AudioRuntimeState) => void): Unsubscribe;
  setMediaSessionEnabled(enabled: boolean): void;
  primeAudio(): Promise<boolean>;
  play(options?: unknown): Promise<boolean> | boolean;
  pause(options?: unknown): void;
  stopPlayback(options?: unknown): void;
}

export type TtsPriority = "critical" | "driving" | "system" | "info";

export interface TtsVoiceOption {
  id: string;
  name: string;
  label?: string;
  detail?: string;
  lang: string;
  quality?: string;
}

export interface TtsStatusUpdate {
  status: string;
  progress?: string;
  ratio?: number | null;
}

export interface TtsLoadVoiceRequest {
  lang?: string;
  sourceAppId?: string;
  voice?: string;
  speed?: number;
  onStatus?: (status: TtsStatusUpdate) => void;
}

export interface TtsSpeakRequest extends TtsLoadVoiceRequest {
  text: string;
  volume?: number;
  priority?: TtsPriority;
  interrupt?: boolean;
  dedupeKey?: string;
}

export interface TtsStopRequest {
  reason?: string;
  resetEngine?: boolean;
  sourceAppId?: string;
}

export interface TtsVoiceLoadResult {
  model: string;
  provider: "wasm";
}

export interface TtsSpeechResult extends TtsVoiceLoadResult {
  id: string;
  size: number;
  durationMs: number;
  audioSeconds: number;
}

export interface TtsSnapshot {
  status: "idle" | "loading" | "ready" | "generating" | "speaking" | "blocked" | "error";
  progress: string;
  ratio: number | null;
  muted: boolean;
  volume: number;
  primed: boolean;
  loading: boolean;
  generating: boolean;
  speaking: boolean;
  queueLength: number;
  loadedVoice: string | null;
  activeVoice: string | null;
  activeLang: string | null;
  provider: "wasm" | null;
  error: string | null;
  currentSourceAppId?: string | null;
}

export interface TtsService {
  getSnapshot(): TtsSnapshot;
  subscribe(listener: (snapshot: TtsSnapshot) => void): Unsubscribe;
  listVoices(lang?: string): TtsVoiceOption[];
  getDefaultVoice(lang?: string): string;
  primeFromUserGesture(options?: { keepAlive?: boolean }): Promise<boolean>;
  loadVoice(request?: TtsLoadVoiceRequest): Promise<TtsVoiceLoadResult>;
  preloadVoice(request?: TtsLoadVoiceRequest): Promise<TtsVoiceLoadResult>;
  prepareSpeech(request: Omit<TtsSpeakRequest, "interrupt" | "volume">): Promise<TtsSpeechResult>;
  speak(request: TtsSpeakRequest): Promise<TtsSpeechResult>;
  stop(options?: TtsStopRequest): void;
  cancel(options?: TtsStopRequest): void;
  setMuted(value: boolean): TtsSnapshot;
  setVolume(value: number): TtsSnapshot;
}
