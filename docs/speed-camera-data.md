# Speed Camera Data

Vatio Speed and Camera Map use generated local/static artifacts for camera alerts and map overlays. Browser runtime does not query Overpass, fetch live camera APIs, or parse road geometry while driving.

## Runtime Artifacts

Generated runtime files live under `public/geo/cameras`:

- `manifest.json`: countries, counts, hashes, bounding boxes, and country or tile artifact URLs.
- `countries/<code>.json`: compact traps as `[lon, lat, speedKphOrNull, osmId?, speedMeta?]`.
- `countries/<code>.kdbush`: the matching KDBush index.
- `countries/<code>/manifest.json` plus `tiles/<tile-id>.json` and `tiles/<tile-id>.kdbush`: optional split artifacts for large countries.

`speedMeta` can include compact provenance for inferred limits and approach matching. Explicit camera `maxspeed` tags stay highest-confidence. Missing camera maxspeed can be enriched from nearby OSM roads with `maxspeed`, `maxspeed:forward`, or `maxspeed:backward`; unknown remains `null`, never `0`.

## Source And Cache Roles

- Commit `data-src/ANSV.csv`; it is the editable ANSV source of truth for Colombia official cameras.
- `data-src/ansv_cameras_maplibre.geojson` is regenerated from `data-src/ANSV.csv`.
- Commit `data-src/osm_speed_cameras_overpass.json`; it is the compact raw OSM camera source used by offline builds.
- Commit `data-src/osm_speed_cameras_maxspeed_enrichment.json`; it is the compact inferred-speed sidecar.
- Do not commit `data-src/osm-road-speeds/`; it is a large restartable Overpass road tile cache.
- Do not commit `logs/`; fetch logs are local diagnostics.
- Do not commit `public/geo/cameras/`; `predev`, `prebuild`, and deployment builds regenerate it.

`public/geo/` may be missing in a fresh checkout until `pnpm run prepare:geo`, `pnpm run dev`, or `pnpm run build` runs.

## Local Commands

`pnpm run prepare:geo` is offline-safe. It converts `data-src/ANSV.csv` when present, builds from cached OSM camera/enrichment data when present, and falls back to generated Colombia ANSV data when the OSM cache is unavailable.

```bash
pnpm run prepare:geo
pnpm run analyze:cameras:maxspeed
```

`pnpm run fetch:cameras` is the network/update command. By default it reuses cached global camera data, resumes cached road-speed tiles from `data-src/osm-road-speeds/`, fetches missing road-speed tiles, writes `data-src/osm_speed_cameras_maxspeed_enrichment.json`, and rebuilds `public/geo/cameras`.

```bash
pnpm run fetch:cameras
```

Useful switches:

- `CAMERA_REFRESH_CACHE=1`: refresh the global camera Overpass source.
- `CAMERA_ROAD_FETCH_MISSING=0`: avoid fetching missing road-speed tiles.
- `CAMERA_ROAD_REFRESH_CACHE=1`: deliberately re-download every road-speed tile. This is much heavier than a normal refresh.

For a slow first road-enrichment pass from a partly empty road cache:

```bash
mkdir -p logs
CAMERA_ROAD_FETCH_MISSING=1 \
OVERPASS_MAX_RETRIES=8 \
OVERPASS_RETRY_INITIAL_DELAY_MS=10000 \
OVERPASS_RETRY_MAX_DELAY_MS=180000 \
CAMERA_ROAD_REQUEST_DELAY_MS=8000 \
CAMERA_ROAD_PROGRESS_EVERY=25 \
CAMERA_ROAD_SLOW_TILE_MS=5000 \
OVERPASS_PROGRESS_INTERVAL_MS=30000 \
pnpm run fetch:cameras 2>&1 | tee "logs/fetch-cameras-first-pass-$(date +%Y%m%d-%H%M%S).log"
```

## Runtime Behavior

GPS matching happens locally. The app-level GPS service keeps one shared browser `watchPosition()` for active consumers, normalizes speed/heading/timestamps, and broadcasts local updates for Speed, Camera Map, recording, driving alerts, and other shells.

Camera matching loads the manifest, chooses the current country or nearby tile from the GPS fix, tries IndexedDB first, and revalidates in the background. If the network drops during an update, the last good cached country/tile stays intact. With no cache and no network, the speedometer still works and trap alerts show an unavailable/offline camera database status.

## Approach Matching

Camera alerts are approach-aware instead of purely circular. Runtime uses the point KDBush/geokdbush index for bounded candidate lookup, then evaluates nearby cameras by distance, heading, whether the vehicle is moving toward the camera, whether distance is decreasing, and any build-time road approach metadata.

Build-time enrichment stores plausible approach corridors for cameras near intersections, divided roads, ramps, frontage roads, and other multi-road geometry. High- and medium-confidence corridors can require vehicle heading to match an allowed approach bearing and, when segment geometry exists, to be plausibly near that road corridor.

Low, missing, or ambiguous metadata degrades conservatively. Heading-only matching is used when available, and legacy radius fallback remains available when heading is unavailable so old cached artifacts do not silently miss cameras.

Development tuning keys:

- `vatio_speed_camera_approach_fallback_mode`: `legacy-radius` (default), `heading-only`, or `silent`.
- `vatio_speed_camera_approach_heading_tolerance_deg`: accepted approach angle, default `45`.
- `vatio_speed_camera_approach_minimum_speed_ms`: low-speed suppression threshold, default `1.5`.

## Camera Map

Camera Map reads the same local/static camera artifacts. The browser does not call Overpass or any camera API from the map panel.

The map can show local camera points, live position, follow/orientation controls, and an Approach overlay. The overlay visualizes matched camera road segments, allowed detection directions, confidence styling, fallback halos for cameras without road corridors, and a compact legend. Tapping a camera can show confidence, direction, matched-road distance, bearing, source context, and the current match decision when live position is available.

Basemap imagery and tiles come from third-party tile services and must keep visible attribution. Production or high-volume deployments should use an approved commercial/dedicated tile provider or self-hosted tiles.

## Contributing Camera Data

The best way to improve coverage is to improve OpenStreetMap. VatioBoard artifacts are derived from OSM `highway=speed_camera` nodes plus local/official sources, so upstream fixes benefit this app and other OSM consumers after the next data refresh.

Before editing OSM, read the OSM wiki pages for [`highway=speed_camera`](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dspeed_camera), [speed limits](https://wiki.openstreetmap.org/wiki/Speed_limit), [`maxspeed=*`](https://wiki.openstreetmap.org/wiki/Key:maxspeed), [verifiability](https://wiki.openstreetmap.org/wiki/Verifiability), and [good practice](https://wiki.openstreetmap.org/wiki/Good_practice).

Do not copy camera locations or speed limits from Google Maps, Waze, TomTom, Apple Maps, commercial camera databases, or any other source that is not explicitly compatible with OSM. If using a government or open-data camera list, follow the OSM [Import Guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines) and [Automated Edits code of conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct), discuss the plan with the local OSM community first, and keep the import reviewable.

For one-off manual fixes:

1. Create or log in to an OpenStreetMap account.
2. Use iD for small edits or JOSM for careful road/camera cleanup.
3. Confirm the camera from ground survey, your own geotagged imagery, street-level imagery allowed for OSM editing, or another OSM-compatible source.
4. Add `highway=speed_camera`.
5. Add `maxspeed=*` when the enforced limit is known and verifiable.
6. Add `direction=*` or an OSM `type=enforcement` relation when the monitored direction is known.
7. Add factual provenance tags such as `operator=*`, `ref=*`, `source=*`, `check_date=*`, or `survey:date=*` when known.
8. Save with a clear changeset comment and include the source used.

If a camera exists but VatioBoard picks the wrong corridor, improve nearby road data instead of adding duplicate cameras. Check `maxspeed=*`, directional speed limits, one-way tags, carriageway splits, turn restrictions, and access tags that distinguish private, bus-only, pedestrian, cycling, driveway, parking, and emergency-only roads.

After an upstream OSM edit is saved, wait for Overpass and downstream OSM mirrors to catch up, then regenerate local artifacts:

```bash
pnpm run fetch:cameras
pnpm run analyze:cameras:maxspeed
```
