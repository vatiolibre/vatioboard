export interface MapOverlayProviderContext {
  map: Record<string, any> | null;
  maplibregl: Record<string, any> | null;
  view?: Record<string, any>;
}

/** Lifecycle contract for overlays that augment the Map route without owning it. */
export interface MapOverlayProvider {
  id: string;
  onMapReady?(context: MapOverlayProviderContext): void;
  onStyleReady?(context: MapOverlayProviderContext): void;
  onViewportChanged?(context: MapOverlayProviderContext): void;
  destroy?(context: MapOverlayProviderContext): void;
}
