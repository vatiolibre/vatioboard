let mapLibrePromise = null;

export function loadMapLibre() {
  if (!mapLibrePromise) {
    mapLibrePromise = Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]).then(([module]) => module.default || module);
  }
  return mapLibrePromise;
}
