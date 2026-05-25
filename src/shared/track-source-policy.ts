/**
 * Source policy for player tracks.
 *
 * Demo/static tracks are public assets and must never be resolved through
 * authenticated backend media endpoints. Backend media assets are the only
 * tracks eligible for signed access URLs and auto-cache downloads.
 */

export interface TrackSourcePolicyAsset {
  name?: unknown;
  src?: unknown;
  _demo?: unknown;
  [key: string]: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isDemoTrackName(name: unknown): boolean {
  return str(name).startsWith("demo:");
}

export function hasStaticPlaybackSource(track: TrackSourcePolicyAsset | null | undefined): boolean {
  return Boolean(str(track?.src));
}

export function isPublicStaticTrack(
  assetName: unknown,
  asset: TrackSourcePolicyAsset | null | undefined = {},
): boolean {
  return Boolean(
    isDemoTrackName(assetName)
      || isDemoTrackName(asset?.name)
      || asset?._demo
      || hasStaticPlaybackSource(asset),
  );
}

export function shouldUseBackendMediaAccess(
  assetName: unknown,
  asset: TrackSourcePolicyAsset | null | undefined = {},
): boolean {
  return Boolean(assetName) && !isPublicStaticTrack(assetName, asset);
}
