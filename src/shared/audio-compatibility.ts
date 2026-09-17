/** Document-wide experiment settings. Reload to change them before services start. */
export function readAudioCompatibilityOptions(url: URL) {
  const enabled = url.searchParams.get("audioCompatibility") === "1"
    || (url.pathname.endsWith("/tesla-background-audio.html")
      && url.searchParams.get("audioCompatibility") !== "0");
  const flag = (name: string, fallback: boolean) => url.searchParams.has(name)
    ? url.searchParams.get(name) === "1" : fallback;
  return Object.freeze({
    enabled,
    attachedElement: flag("audioAttach", enabled),
    silentDuringPlayback: flag("audioSilence", !enabled),
    primeOtherConsumers: flag("audioPrimeOthers", !enabled),
    mediaSessionWrites: flag("audioMediaSession", !enabled),
    audioSessionHints: flag("audioSessionHints", !enabled),
  });
}

export const audioCompatibility = readAudioCompatibilityOptions(new URL(
  typeof window === "undefined" ? "https://localhost/" : window.location.href,
));
