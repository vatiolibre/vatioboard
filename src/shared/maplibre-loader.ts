type MapLibreModule = typeof import("maplibre-gl");
type MapLibreApi = MapLibreModule;

let mapLibrePromise: Promise<MapLibreApi> | null = null;

export function loadMapLibre(): Promise<MapLibreApi> {
  if (!mapLibrePromise) {
    mapLibrePromise = Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]).then(([module]) => ((module as { default?: MapLibreModule }).default || module) as MapLibreApi);
  }
  return mapLibrePromise;
}
