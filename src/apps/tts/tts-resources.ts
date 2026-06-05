export const TTS_LANGS = [
  { id: "en-us", label: "EN", name: "English US" },
  { id: "en-gb", label: "UK", name: "English UK" },
  { id: "es-419", label: "MX", name: "Spanish Latin America" },
  { id: "es-es", label: "ES", name: "Spanish Spain" },
  { id: "pt-br", label: "PT", name: "Portuguese Brazil" },
  { id: "it", label: "IT", name: "Italian" },
  { id: "fr", label: "FR", name: "French" },
  { id: "de", label: "DE", name: "German" },
] as const;

export type TtsLangId = (typeof TTS_LANGS)[number]["id"];

export const PIPER_VOICES = [
  {
    id: "en_US-lessac-medium",
    name: "Lessac",
    label: "Lessac",
    detail: "US balanced",
    lang: "en-us",
    quality: "medium",
  },
  {
    id: "en_US-hfc_female-medium",
    name: "HFC Female",
    label: "HFC F",
    detail: "US warm",
    lang: "en-us",
    quality: "medium",
  },
  {
    id: "en_US-hfc_male-medium",
    name: "HFC Male",
    label: "HFC M",
    detail: "US clear",
    lang: "en-us",
    quality: "medium",
  },
  {
    id: "en_US-libritts_r-medium",
    name: "LibriTTS",
    label: "Libri",
    detail: "US crisp",
    lang: "en-us",
    quality: "medium",
  },
  {
    id: "en_US-amy-medium",
    name: "Amy",
    label: "Amy",
    detail: "US soft",
    lang: "en-us",
    quality: "medium",
  },
  {
    id: "en_GB-cori-medium",
    name: "Cori",
    label: "Cori",
    detail: "UK calm",
    lang: "en-gb",
    quality: "medium",
  },
  {
    id: "en_GB-alan-medium",
    name: "Alan",
    label: "Alan",
    detail: "UK clear",
    lang: "en-gb",
    quality: "medium",
  },
  {
    id: "en_GB-alba-medium",
    name: "Alba",
    label: "Alba",
    detail: "UK bright",
    lang: "en-gb",
    quality: "medium",
  },
  {
    id: "es_MX-claude-high",
    name: "Claude",
    label: "Claude",
    detail: "MX high",
    lang: "es-419",
    quality: "high",
  },
  {
    id: "es_MX-ald-medium",
    name: "Ald",
    label: "Ald",
    detail: "MX medium",
    lang: "es-419",
    quality: "medium",
  },
  {
    id: "es_ES-davefx-medium",
    name: "Dave",
    label: "Dave",
    detail: "ES medium",
    lang: "es-es",
    quality: "medium",
  },
  {
    id: "es_ES-sharvard-medium",
    name: "Sharvard",
    label: "Sharv",
    detail: "ES medium",
    lang: "es-es",
    quality: "medium",
  },
  {
    id: "pt_BR-cadu-medium",
    name: "Cadu",
    label: "Cadu",
    detail: "BR medium",
    lang: "pt-br",
    quality: "medium",
  },
  {
    id: "pt_BR-faber-medium",
    name: "Faber",
    label: "Faber",
    detail: "BR medium",
    lang: "pt-br",
    quality: "medium",
  },
  {
    id: "it_IT-paola-medium",
    name: "Paola",
    label: "Paola",
    detail: "IT medium",
    lang: "it",
    quality: "medium",
  },
  {
    id: "fr_FR-mls-medium",
    name: "MLS",
    label: "MLS",
    detail: "FR medium",
    lang: "fr",
    quality: "medium",
  },
  {
    id: "fr_FR-siwis-medium",
    name: "Siwis",
    label: "Siwis",
    detail: "FR medium",
    lang: "fr",
    quality: "medium",
  },
  {
    id: "de_DE-thorsten-medium",
    name: "Thorsten",
    label: "Thor",
    detail: "DE medium",
    lang: "de",
    quality: "medium",
  },
] as const;

export type PiperVoiceId = (typeof PIPER_VOICES)[number]["id"];

export const TTS_LANG_BY_ID = Object.fromEntries(TTS_LANGS.map((lang) => [lang.id, lang])) as Record<
  TtsLangId,
  (typeof TTS_LANGS)[number]
>;

export const PIPER_VOICE_BY_ID = Object.fromEntries(PIPER_VOICES.map((voice) => [voice.id, voice])) as Record<
  PiperVoiceId,
  (typeof PIPER_VOICES)[number]
>;

export const PIPER_VOICES_BY_LANG = TTS_LANGS.reduce((map, lang) => {
  map[lang.id] = PIPER_VOICES.filter((voice) => voice.lang === lang.id);
  return map;
}, {} as Record<TtsLangId, typeof PIPER_VOICES[number][]>);

const DEFAULT_PIPER_VOICE_BY_LANG: Record<TtsLangId, PiperVoiceId> = {
  "en-us": "en_US-hfc_male-medium",
  "en-gb": "en_GB-cori-medium",
  "es-419": "es_MX-claude-high",
  "es-es": "es_ES-davefx-medium",
  "pt-br": "pt_BR-cadu-medium",
  it: "it_IT-paola-medium",
  fr: "fr_FR-siwis-medium",
  de: "de_DE-thorsten-medium",
};

export function isTtsLangId(value: unknown): value is TtsLangId {
  return typeof value === "string" && value in TTS_LANG_BY_ID;
}

export function isPiperVoiceId(value: unknown): value is PiperVoiceId {
  return typeof value === "string" && value in PIPER_VOICE_BY_ID;
}

export function getDefaultPiperVoiceForLang(lang: TtsLangId): PiperVoiceId {
  return DEFAULT_PIPER_VOICE_BY_LANG[lang] || "en_US-hfc_male-medium";
}

export function getLangForPiperVoice(voice: string): TtsLangId {
  return isPiperVoiceId(voice) ? PIPER_VOICE_BY_ID[voice].lang : "en-us";
}
