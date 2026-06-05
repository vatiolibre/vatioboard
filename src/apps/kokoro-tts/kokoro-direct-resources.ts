export const KOKORO_SAMPLE_RATE = 24000;

export const KOKORO_LANGS = [
  { id: "en-us", label: "EN", name: "English US" },
  { id: "en-gb", label: "UK", name: "English UK" },
  { id: "es-419", label: "ES", name: "Spanish" },
  { id: "pt-br", label: "PT", name: "Portuguese" },
  { id: "it", label: "IT", name: "Italian" },
  { id: "ja", label: "JA", name: "Japanese" },
  { id: "cmn", label: "ZH", name: "Chinese" },
  { id: "hi", label: "HI", name: "Hindi" },
] as const;

export type KokoroLangId = (typeof KOKORO_LANGS)[number]["id"];

export const TTS_ENGINES = [
  {
    id: "piper",
    label: "Neural",
    detail: "Piper",
    title: "Piper ONNX voice, best local quality and speed balance",
  },
  {
    id: "espeak",
    label: "Tiny",
    detail: "Fallback",
    title: "eSpeak NG WASM, smallest emergency local voice",
  },
  {
    id: "kokoro",
    label: "Lab",
    detail: "Kokoro",
    title: "Kokoro ONNX neural speech, slower experimental engine",
  },
] as const;

export type TtsEngineId = (typeof TTS_ENGINES)[number]["id"];

export const KOKORO_MODELS = [
  {
    id: "model_q8f16",
    label: "Fast",
    detail: "86 MB",
    quantization: "q8f16",
  },
  {
    id: "model_quantized",
    label: "Classic",
    detail: "92 MB",
    quantization: "q8",
  },
  {
    id: "model_uint8f16",
    label: "Smooth",
    detail: "114 MB",
    quantization: "uint8f16",
  },
  {
    id: "model_q4f16",
    label: "Wide",
    detail: "154 MB",
    quantization: "q4f16",
  },
] as const;

export type KokoroDirectModelId = (typeof KOKORO_MODELS)[number]["id"];

export const KOKORO_ACCELERATIONS = [
  { id: "auto", label: "Auto", detail: "GPU if ready" },
  { id: "webgpu", label: "GPU", detail: "WebGPU" },
  { id: "wasm", label: "CPU", detail: "WASM" },
] as const;

export type KokoroAcceleration = (typeof KOKORO_ACCELERATIONS)[number]["id"];
export type KokoroExecutionProvider = Exclude<KokoroAcceleration, "auto">;

export const PIPER_VOICES = [
  {
    id: "en_US-lessac-medium",
    name: "Lessac",
    label: "Lessac",
    detail: "EN medium",
    lang: "en-us",
    quality: "medium",
  },
  {
    id: "es_MX-claude-high",
    name: "Claude",
    label: "Claude",
    detail: "ES high",
    lang: "es-419",
    quality: "high",
  },
] as const;

export type PiperVoiceId = (typeof PIPER_VOICES)[number]["id"];

export const KOKORO_VOICES = [
  { id: "af_heart", name: "Heart", lang: "en-us" },
  { id: "af_alloy", name: "Alloy", lang: "en-us" },
  { id: "af_aoede", name: "Aoede", lang: "en-us" },
  { id: "af_bella", name: "Bella", lang: "en-us" },
  { id: "af_jessica", name: "Jessica", lang: "en-us" },
  { id: "af_kore", name: "Kore", lang: "en-us" },
  { id: "af_nicole", name: "Nicole", lang: "en-us" },
  { id: "af_nova", name: "Nova", lang: "en-us" },
  { id: "af_river", name: "River", lang: "en-us" },
  { id: "af_sarah", name: "Sarah", lang: "en-us" },
  { id: "af_sky", name: "Sky", lang: "en-us" },
  { id: "am_adam", name: "Adam", lang: "en-us" },
  { id: "am_echo", name: "Echo", lang: "en-us" },
  { id: "am_eric", name: "Eric", lang: "en-us" },
  { id: "am_fenrir", name: "Fenrir", lang: "en-us" },
  { id: "am_liam", name: "Liam", lang: "en-us" },
  { id: "am_michael", name: "Michael", lang: "en-us" },
  { id: "am_onyx", name: "Onyx", lang: "en-us" },
  { id: "am_puck", name: "Puck", lang: "en-us" },
  { id: "am_santa", name: "Santa", lang: "en-us" },
  { id: "bf_emma", name: "Emma", lang: "en-gb" },
  { id: "bf_isabella", name: "Isabella", lang: "en-gb" },
  { id: "bm_george", name: "George", lang: "en-gb" },
  { id: "bm_lewis", name: "Lewis", lang: "en-gb" },
  { id: "bf_alice", name: "Alice", lang: "en-gb" },
  { id: "bf_lily", name: "Lily", lang: "en-gb" },
  { id: "bm_daniel", name: "Daniel", lang: "en-gb" },
  { id: "bm_fable", name: "Fable", lang: "en-gb" },
  { id: "ef_dora", name: "Dora", lang: "es-419" },
  { id: "em_alex", name: "Alex", lang: "es-419" },
  { id: "em_santa", name: "Santa", lang: "es-419" },
  { id: "jf_alpha", name: "Alpha", lang: "ja" },
  { id: "jf_gongitsune", name: "Gongitsune", lang: "ja" },
  { id: "jf_nezumi", name: "Nezumi", lang: "ja" },
  { id: "jf_tebukuro", name: "Tebukuro", lang: "ja" },
  { id: "jm_kumo", name: "Kumo", lang: "ja" },
  { id: "zf_xiaobei", name: "Xiaobei", lang: "cmn" },
  { id: "zf_xiaoni", name: "Xiaoni", lang: "cmn" },
  { id: "zf_xiaoxiao", name: "Xiaoxiao", lang: "cmn" },
  { id: "zf_xiaoyi", name: "Xiaoyi", lang: "cmn" },
  { id: "zm_yunjian", name: "Yunjian", lang: "cmn" },
  { id: "zm_yunxi", name: "Yunxi", lang: "cmn" },
  { id: "zm_yunxia", name: "Yunxia", lang: "cmn" },
  { id: "zm_yunyang", name: "Yunyang", lang: "cmn" },
  { id: "hf_alpha", name: "Alpha", lang: "hi" },
  { id: "hf_beta", name: "Beta", lang: "hi" },
  { id: "hm_omega", name: "Omega", lang: "hi" },
  { id: "hm_psi", name: "Psi", lang: "hi" },
  { id: "if_sara", name: "Sara", lang: "it" },
  { id: "im_nicola", name: "Nicola", lang: "it" },
  { id: "pf_dora", name: "Dora", lang: "pt-br" },
  { id: "pm_alex", name: "Alex", lang: "pt-br" },
  { id: "pm_santa", name: "Santa", lang: "pt-br" },
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICES)[number]["id"];

export const KOKORO_LANG_BY_ID = Object.fromEntries(KOKORO_LANGS.map((lang) => [lang.id, lang])) as Record<
  KokoroLangId,
  (typeof KOKORO_LANGS)[number]
>;

export const KOKORO_MODEL_BY_ID = Object.fromEntries(KOKORO_MODELS.map((model) => [model.id, model])) as Record<
  KokoroDirectModelId,
  (typeof KOKORO_MODELS)[number]
>;

export const KOKORO_VOICE_BY_ID = Object.fromEntries(KOKORO_VOICES.map((voice) => [voice.id, voice])) as Record<
  KokoroVoiceId,
  (typeof KOKORO_VOICES)[number]
>;

export const PIPER_VOICE_BY_ID = Object.fromEntries(PIPER_VOICES.map((voice) => [voice.id, voice])) as Record<
  PiperVoiceId,
  (typeof PIPER_VOICES)[number]
>;

export const KOKORO_VOICES_BY_LANG = KOKORO_LANGS.reduce((map, lang) => {
  map[lang.id] = KOKORO_VOICES.filter((voice) => voice.lang === lang.id);
  return map;
}, {} as Record<KokoroLangId, typeof KOKORO_VOICES[number][]>);

export const PIPER_VOICES_BY_LANG = KOKORO_LANGS.reduce((map, lang) => {
  map[lang.id] = PIPER_VOICES.filter((voice) => voice.lang === lang.id);
  return map;
}, {} as Record<KokoroLangId, typeof PIPER_VOICES[number][]>);

export function isKokoroLangId(value: unknown): value is KokoroLangId {
  return typeof value === "string" && value in KOKORO_LANG_BY_ID;
}

export function isTtsEngineId(value: unknown): value is TtsEngineId {
  return typeof value === "string" && TTS_ENGINES.some((item) => item.id === value);
}

export function isKokoroDirectModelId(value: unknown): value is KokoroDirectModelId {
  return typeof value === "string" && value in KOKORO_MODEL_BY_ID;
}

export function isKokoroAcceleration(value: unknown): value is KokoroAcceleration {
  return typeof value === "string" && KOKORO_ACCELERATIONS.some((item) => item.id === value);
}

export function isKokoroVoiceId(value: unknown): value is KokoroVoiceId {
  return typeof value === "string" && value in KOKORO_VOICE_BY_ID;
}

export function isPiperVoiceId(value: unknown): value is PiperVoiceId {
  return typeof value === "string" && value in PIPER_VOICE_BY_ID;
}

export function getDefaultVoiceForLang(lang: KokoroLangId): KokoroVoiceId {
  return (KOKORO_VOICES_BY_LANG[lang]?.[0]?.id || "af_heart") as KokoroVoiceId;
}

export function getDefaultPiperVoiceForLang(lang: KokoroLangId): PiperVoiceId {
  return (PIPER_VOICES_BY_LANG[lang]?.[0]?.id || "en_US-lessac-medium") as PiperVoiceId;
}

export function getLangForVoice(voice: string): KokoroLangId {
  return isKokoroVoiceId(voice) ? KOKORO_VOICE_BY_ID[voice].lang : "en-us";
}

export function getLangForPiperVoice(voice: string): KokoroLangId {
  return isPiperVoiceId(voice) ? PIPER_VOICE_BY_ID[voice].lang : "en-us";
}
