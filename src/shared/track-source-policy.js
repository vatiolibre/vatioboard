/**
 * Source policy for player tracks.
 *
 * Demo/static tracks are public assets and must never be resolved through
 * authenticated backend media endpoints. Backend media assets are the only
 * tracks eligible for signed access URLs and auto-cache downloads.
 */

function str(value) {
  return typeof value === "string" ? value : "";
}

export function isDemoTrackName(name) {
  return str(name).startsWith("demo:");
}

export function hasStaticPlaybackSource(track) {
  return Boolean(str(track?.src));
}

export function isPublicStaticTrack(assetName, asset = {}) {
  return Boolean(
    isDemoTrackName(assetName)
      || isDemoTrackName(asset?.name)
      || asset?._demo
      || hasStaticPlaybackSource(asset),
  );
}

export function shouldUseBackendMediaAccess(assetName, asset = {}) {
  return Boolean(assetName) && !isPublicStaticTrack(assetName, asset);
}

