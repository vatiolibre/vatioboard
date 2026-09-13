const ARTWORK_SIZE = 512;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 12;

type CachedArtwork = {
  promise: Promise<MediaImage[] | null>;
  objectUrl: string | null;
};

const artworkCache = new Map<string, CachedArtwork>();

export const DEFAULT_PLAYER_ARTWORK: MediaImage[] = [
  { src: "/web-app-manifest-192x192.png", sizes: "192x192", type: "image/png" },
  { src: "/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png" },
];

function evictOldestArtwork() {
  while (artworkCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = artworkCache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    const entry = artworkCache.get(oldestKey);
    artworkCache.delete(oldestKey);
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });
}

async function decodeArtwork(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
} | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      return null;
    }
  }

  if (typeof Image !== "function") return null;
  const inputUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = inputUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("artwork-decode-failed"));
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => {},
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(inputUrl);
  }
}

async function normalizeArtwork(sourceUrl: string): Promise<{ artwork: MediaImage[]; objectUrl: string } | null> {
  try {
    const response = await fetch(sourceUrl, { mode: "cors", credentials: "omit" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.toLowerCase().startsWith("image/") || blob.size <= 0 || blob.size > MAX_ARTWORK_BYTES) {
      return null;
    }

    const decoded = await decodeArtwork(blob);
    if (!decoded || decoded.width <= 0 || decoded.height <= 0) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = ARTWORK_SIZE;
      canvas.height = ARTWORK_SIZE;
      const context = canvas.getContext("2d");
      if (!context) return null;

      context.fillStyle = "#111827";
      context.fillRect(0, 0, ARTWORK_SIZE, ARTWORK_SIZE);
      const scale = Math.min(ARTWORK_SIZE / decoded.width, ARTWORK_SIZE / decoded.height);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      context.drawImage(
        decoded.source,
        Math.round((ARTWORK_SIZE - width) / 2),
        Math.round((ARTWORK_SIZE - height) / 2),
        width,
        height,
      );

      const normalizedBlob = await canvasToBlob(canvas);
      if (!normalizedBlob) return null;
      const objectUrl = URL.createObjectURL(normalizedBlob);
      return {
        objectUrl,
        artwork: [{ src: objectUrl, sizes: "512x512", type: "image/png" }],
      };
    } finally {
      decoded.dispose();
    }
  } catch {
    return null;
  }
}

/** Normalize arbitrary station artwork to a truthful 512×512 PNG for Media Session. */
export function getNormalizedMediaSessionArtwork(
  cacheKey: string,
  sourceUrl: string,
): Promise<MediaImage[] | null> {
  const key = String(cacheKey || sourceUrl || "");
  if (!key || !sourceUrl) return Promise.resolve(null);

  const cached = artworkCache.get(key);
  if (cached) {
    artworkCache.delete(key);
    artworkCache.set(key, cached);
    return cached.promise;
  }

  const entry: CachedArtwork = { promise: Promise.resolve(null), objectUrl: null };
  entry.promise = normalizeArtwork(sourceUrl).then((result) => {
    if (result?.objectUrl && artworkCache.get(key) !== entry) {
      URL.revokeObjectURL(result.objectUrl);
      return null;
    }
    entry.objectUrl = result?.objectUrl || null;
    return result?.artwork || null;
  });
  artworkCache.set(key, entry);
  evictOldestArtwork();
  return entry.promise;
}

export function clearMediaSessionArtworkCache() {
  for (const entry of artworkCache.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  artworkCache.clear();
}
