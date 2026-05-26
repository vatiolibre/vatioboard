import { t } from "../i18n.js";
import {
  IconClose,
  IconFullscreen,
  IconFullscreenExit,
  IconGpsLab,
  IconRestart,
  IconSpeed,
  IconWorld,
} from "../icons.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import { registerFloatingPanel } from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";
import { loadMapLibre } from "../shared/maplibre-loader.js";
import {
  buildCirclePolygonFeature,
  createCameraMapDataSource,
  resolveCameraApproachDetails,
} from "./camera-map-data-source.js";
import {
  angularDifferenceDegrees,
  bearingDegrees,
  buildUserPositionFeature,
  computeNavigationCameraUpdate,
  createNavigationCameraState,
  distanceMeters,
  normalizeLivePosition,
  shouldShowHeading,
  shouldUseNavigationCamera,
} from "./camera-map-navigation.js";
import {
  haversineDistanceMeters,
  scoreApproachCandidate,
} from "./camera-approach.js";
import {
  CAMERA_MAP_BASEMAP_AUTO_ID,
  CAMERA_MAP_BASEMAP_STORAGE_KEY,
  CAMERA_MAP_BASEMAPS,
  CAMERA_MAP_COLOR_SCHEME_QUERY,
  createCameraMapStyle,
  getDefaultCameraMapBasemapId,
  getCameraMapBasemap,
  isCameraMapBasemapId,
} from "./camera-map-layers.js";
import {
  loadCameraApproachOptionsPreference,
  loadDistanceUnitPreference,
  loadTrapAlertDistancePreference,
  loadUnitPreference,
} from "./preferences.js";
import { formatCameraLimitSpeed } from "./render.js";
import { formatTrapDistance } from "./traps.js";

type AnyRecord = Record<string, any>;

export const CAMERA_MAP_WINDOW_ID = "camera-map";

const CAMERA_SOURCE_ID = "camera-map-cameras";
const CAMERA_CLUSTER_LAYER_ID = "camera-map-camera-clusters";
const CAMERA_CLUSTER_COUNT_LAYER_ID = "camera-map-camera-cluster-count";
const CAMERA_POINT_LAYER_ID = "camera-map-camera-points";
const CAMERA_APPROACH_SOURCE_ID = "camera-map-camera-approaches";
const CAMERA_APPROACH_FALLBACK_LAYER_ID = "camera-map-camera-approach-fallback";
const CAMERA_APPROACH_SEGMENT_LAYER_ID = "camera-map-camera-approach-segments";
const CAMERA_APPROACH_BEARING_LAYER_ID = "camera-map-camera-approach-bearings";
const CAMERA_SELECTED_APPROACH_SOURCE_ID = "camera-map-selected-approach";
const CAMERA_SELECTED_APPROACH_FALLBACK_LAYER_ID = "camera-map-selected-approach-fallback";
const CAMERA_SELECTED_APPROACH_CORRIDOR_BAND_LAYER_ID = "camera-map-selected-approach-corridor-band";
const CAMERA_SELECTED_APPROACH_CORRIDOR_LAYER_ID = "camera-map-selected-approach-corridor";
const CAMERA_SELECTED_APPROACH_DIRECTION_LAYER_ID = "camera-map-selected-approach-direction";
const CAMERA_CURRENT_APPROACH_SOURCE_ID = "camera-map-current-approach";
const CAMERA_CURRENT_APPROACH_FALLBACK_LAYER_ID = "camera-map-current-approach-fallback";
const CAMERA_CURRENT_APPROACH_CORRIDOR_BAND_LAYER_ID = "camera-map-current-approach-corridor-band";
const CAMERA_CURRENT_APPROACH_CORRIDOR_LAYER_ID = "camera-map-current-approach-corridor";
const CAMERA_CURRENT_APPROACH_DIRECTION_LAYER_ID = "camera-map-current-approach-direction";
const CAMERA_CURRENT_APPROACH_BEARING_LAYER_ID = "camera-map-current-approach-bearing-line";
const USER_POSITION_SOURCE_ID = "camera-map-user-position";
const USER_POSITION_ACCURACY_LAYER_ID = "camera-map-user-accuracy";
const USER_POSITION_GLOW_LAYER_ID = "camera-map-user-glow";
const USER_POSITION_DOT_LAYER_ID = "camera-map-user-dot";
const USER_POSITION_HEADING_LAYER_ID = "camera-map-user-heading-arrow";
const POS_KEY = "camera_map_widget_pos_v1";
const VISIBILITY_KEY = "camera_map_widget_visible_v1";
const FOLLOW_STORAGE_KEY = "vatioboard.cameraMap.follow.v1";
const ORIENTATION_STORAGE_KEY = "vatioboard.cameraMap.orientation.v1";
const PROJECTION_STORAGE_KEY = "vatioboard.cameraMap.projection.v1";
const APPROACH_LAYER_STORAGE_KEY = "vatioboard.cameraMap.approachLayer.v1";
const APPROACH_FILTER_STORAGE_KEY = "vatioboard.cameraMap.approachFilter.v1";
const DRAG_THRESHOLD_PX = 6;
const DEFAULT_CENTER = [0, 20];
const DEFAULT_ZOOM = 1.5;
const RESIZE_MARGIN_PX = 8;
const RESIZE_MIN_WIDTH = 320;
const RESIZE_MIN_HEIGHT = 320;
const POSITION_POLL_MS = 1000;
const CAMERA_LOOKAHEAD_M = 1400;
const CAMERA_AHEAD_ANGLE_DEGREES = 60;
const GPS_DEBUG_STORAGE_KEY = "vatioboard.debug.gps";
const CAMERA_APPROACH_RAY_M = 130;
const CAMERA_APPROACH_FALLBACK_HALO_M = 160;
const APPROACH_FILTERS = ["all", "review", "missing", "nearby"];
const APPROACH_NEARBY_DISTANCE_M = 1600;

function getEmptyFeatureCollection(): any {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function createElement(tagName, attributes: AnyRecord = {}, children: any[] = []): any {
  const element = document.createElement(tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "html") element.innerHTML = value;
    else if (value !== null && value !== undefined) element.setAttribute(key, String(value));
  }
  element.append(...children.filter(Boolean));
  return element;
}

function isGpsDebugEnabled() {
  try {
    return localStorage.getItem(GPS_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function debugCameraGps(label, payload: AnyRecord = {}) {
  const debug = globalThis.console?.debug;
  if (!isGpsDebugEnabled() || typeof debug !== "function") return;
  debug.call(globalThis.console, `[vatioboard:camera-map:gps] ${label}`, payload);
}

function logCameraApproach(label, payload: AnyRecord = {}) {
  const debug = globalThis.console?.debug;
  if (!isGpsDebugEnabled() || typeof debug !== "function") return;
  debug.call(globalThis.console, `[vatioboard:camera-map:approach] ${label}`, payload);
}

function parseApproachJson(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isFiniteCoordinatePair(value) {
  return Boolean(normalizeMapCoordinate(value));
}

function normalizeMapCoordinate(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
  }
  const longitude = Number(value?.longitude ?? value?.lon ?? value?.lng);
  const latitude = Number(value?.latitude ?? value?.lat);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
}

function destinationPoint([longitude, latitude], bearingDeg, distanceM) {
  const bearingRad = bearingDeg * Math.PI / 180;
  const latDelta = Math.cos(bearingRad) * distanceM / 111320;
  const metersPerDegreeLon = Math.max(1, Math.cos(latitude * Math.PI / 180) * 111320);
  const lonDelta = Math.sin(bearingRad) * distanceM / metersPerDegreeLon;
  return [longitude + lonDelta, latitude + latDelta];
}

function getApproachBearingsForVisualization(approach: AnyRecord = {}) {
  const bearingDeg = Number(approach.bearingDeg);
  const reverseBearingDeg = Number(approach.reverseBearingDeg);
  const direction = String(approach.direction || "both").toLowerCase();
  if (direction === "forward") return Number.isFinite(bearingDeg) ? [{ bearingDeg, direction }] : [];
  if (direction === "backward") {
    return Number.isFinite(reverseBearingDeg) ? [{ bearingDeg: reverseBearingDeg, direction }] : [];
  }
  return [
    Number.isFinite(bearingDeg) ? { bearingDeg, direction: "forward" } : null,
    Number.isFinite(reverseBearingDeg) ? { bearingDeg: reverseBearingDeg, direction: "backward" } : null,
  ].filter(Boolean);
}

function shouldShowApproachFeature(feature, { filter = "all", position = null }: AnyRecord = {}) {
  const props = feature?.properties || {};
  if (filter === "missing") return Number(props.approachCount || 0) === 0;
  if (filter === "review") {
    return props.approachAmbiguous === true
      || props.approachConfidenceSummary === "ambiguous"
      || props.approachConfidenceSummary === "low"
      || Number(props.approachCount || 0) === 0;
  }
  if (filter === "nearby") {
    if (!position) return true;
    const coordinates = feature?.geometry?.coordinates;
    if (!isFiniteCoordinatePair(coordinates)) return false;
    return haversineDistanceMeters(position, {
      longitude: Number(coordinates[0]),
      latitude: Number(coordinates[1]),
    }) <= APPROACH_NEARBY_DISTANCE_M;
  }
  return true;
}

function getFeatureCameraId(feature) {
  const props = feature?.properties || {};
  return String(feature?.id || props.osmId || `${props.country || "camera"}:${props.tile || "country"}`);
}

function getApproachFeatureBaseProperties({
  feature,
  approach,
  approachIndex,
  kind,
  direction,
  mode = "global",
  isMatched = false,
}) {
  const props = feature?.properties || {};
  const confidence = String(approach?.confidence || props.approachConfidenceSummary || "none");
  return {
    kind,
    cameraId: getFeatureCameraId(feature),
    approachIndex,
    role: String(approach?.role || "primary"),
    confidence,
    direction: String(direction || approach?.direction || "unknown"),
    wayId: approach?.wayId ?? props.sourceWayId ?? null,
    roadDistanceM: Number.isFinite(Number(approach?.roadDistanceM)) ? Number(approach.roadDistanceM) : null,
    clusterIndex: Number.isFinite(Number(approach?.clusterIndex)) ? Number(approach.clusterIndex) : null,
    candidateRank: Number.isFinite(Number(approach?.candidateRank)) ? Number(approach.candidateRank) : approachIndex + 1,
    ambiguous: approach?.ambiguous === true || props.approachAmbiguous === true,
    ambiguityReason: approach?.ambiguityReason || props.approachAmbiguityReason || null,
    isSelected: mode === "selected",
    isCurrentMatch: mode === "current",
    isMatched: isMatched === true,
  };
}

function buildApproachVisualizationFeaturesForCamera(feature, options: AnyRecord = {}) {
  const {
    mode = "global",
    decision = null,
    fallbackRadiusM = CAMERA_APPROACH_FALLBACK_HALO_M,
    includeFallback = mode !== "global",
    onlyMatched = false,
  } = options;
  const cameraCoordinates = feature?.geometry?.coordinates;
  if (!isFiniteCoordinatePair(cameraCoordinates)) return [];
  const props = feature?.properties || {};
  const approaches = parseApproachJson(props.approachJson);
  const hasUnresolvedApproachSummary = approaches.length === 0 && Number(props.approachCount || 0) > 0;
  const cameraId = getFeatureCameraId(feature);
  const matchedApproachIndex = Number.isFinite(Number(decision?.matchedApproachIndex))
    ? Number(decision.matchedApproachIndex)
    : null;
  const approachFeatures = [];

  for (let index = 0; index < approaches.length; index += 1) {
    if (onlyMatched && matchedApproachIndex !== index) continue;
    const approach = approaches[index];
    const isMatched = matchedApproachIndex === index;
    const segmentStart = normalizeMapCoordinate(approach.segment?.[0]);
    const segmentEnd = normalizeMapCoordinate(approach.segment?.[1]);
    if (segmentStart && segmentEnd) {
      approachFeatures.push({
        type: "Feature",
        id: `${cameraId}:corridor:${index}:${mode}`,
        geometry: {
          type: "LineString",
          coordinates: [segmentStart, segmentEnd],
        },
        properties: getApproachFeatureBaseProperties({
          feature,
          approach,
          approachIndex: index,
          kind: "corridor",
          direction: approach.direction,
          mode,
          isMatched,
        }),
      });
    }

    for (const bearing of getApproachBearingsForVisualization(approach)) {
      approachFeatures.push({
        type: "Feature",
        id: `${cameraId}:direction:${index}:${bearing.direction}:${mode}`,
        geometry: {
          type: "LineString",
          coordinates: [
            [Number(cameraCoordinates[0]), Number(cameraCoordinates[1])],
            destinationPoint(
              [Number(cameraCoordinates[0]), Number(cameraCoordinates[1])],
              bearing.bearingDeg,
              CAMERA_APPROACH_RAY_M,
            ),
          ],
        },
        properties: {
          ...getApproachFeatureBaseProperties({
            feature,
            approach,
            approachIndex: index,
            kind: "direction",
            direction: bearing.direction,
            mode,
            isMatched,
          }),
          bearingDeg: Math.round(bearing.bearingDeg),
        },
      });
    }
  }

  if (includeFallback && approaches.length === 0 && !hasUnresolvedApproachSummary) {
    const radius = Number.isFinite(Number(decision?.alertDistanceM))
      ? Math.min(Number(decision.alertDistanceM), CAMERA_APPROACH_FALLBACK_HALO_M)
      : fallbackRadiusM;
    const fallbackFeature = buildCirclePolygonFeature(
      { longitude: Number(cameraCoordinates[0]), latitude: Number(cameraCoordinates[1]) },
      radius,
      {
        id: `${cameraId}:fallback:${mode}`,
        segments: mode === "global" ? 24 : 40,
        properties: {
          kind: "fallback-radius",
          cameraId,
          approachIndex: null,
          role: "fallback",
          confidence: "none",
          direction: "unknown",
          wayId: null,
          roadDistanceM: null,
          clusterIndex: null,
          candidateRank: null,
          ambiguous: props.approachAmbiguous === true,
          ambiguityReason: props.approachAmbiguityReason || "no-road-corridor",
          isSelected: mode === "selected",
          isCurrentMatch: mode === "current",
          isMatched: decision?.accepted === true || decision?.state === "legacy-radius" || decision?.state === "missing-metadata",
        },
      },
    );
    if (fallbackFeature) approachFeatures.push(fallbackFeature);
  }

  if (
    mode === "current"
    && currentLivePositionFromOptions(options)
    && Array.isArray(cameraCoordinates)
  ) {
    const position = currentLivePositionFromOptions(options);
    approachFeatures.push({
      type: "Feature",
      id: `${cameraId}:bearing-line:${mode}`,
      geometry: {
        type: "LineString",
        coordinates: [
          [position.longitude, position.latitude],
          [Number(cameraCoordinates[0]), Number(cameraCoordinates[1])],
        ],
      },
      properties: {
        kind: "fallback-bearing",
        cameraId,
        approachIndex: matchedApproachIndex,
        role: decision?.matchedRole || "current-match",
        confidence: decision?.matchedConfidence || decision?.confidence || "none",
        direction: decision?.matchedDirection || "unknown",
        wayId: decision?.matchedWayId || null,
        roadDistanceM: null,
        clusterIndex: null,
        candidateRank: null,
        ambiguous: props.approachAmbiguous === true,
        ambiguityReason: props.approachAmbiguityReason || null,
        isSelected: false,
        isCurrentMatch: true,
        isMatched: decision?.accepted === true,
      },
    });
  }

  return approachFeatures;
}

function currentLivePositionFromOptions(options: AnyRecord = {}) {
  const longitude = Number(options.position?.longitude);
  const latitude = Number(options.position?.latitude);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude } : null;
}

export function buildCameraApproachFeatureCollection(cameraFeatures: any = {}, options: AnyRecord = {}) {
  const features = Array.isArray(cameraFeatures)
    ? cameraFeatures
    : (Array.isArray(cameraFeatures?.features) ? cameraFeatures.features : []);
  const approachFeatures = [];

  for (const feature of features) {
    if (!shouldShowApproachFeature(feature, options)) continue;
    approachFeatures.push(...buildApproachVisualizationFeaturesForCamera(feature, {
      ...options,
      mode: options.mode || "global",
      includeFallback: options.includeFallback === true,
    }));
  }

  return {
    type: "FeatureCollection",
    features: approachFeatures,
  };
}

export function buildSelectedCameraApproachFeatureCollection(feature, options: AnyRecord = {}) {
  return {
    type: "FeatureCollection",
    features: feature ? buildApproachVisualizationFeaturesForCamera(feature, {
      ...options,
      mode: options.mode || "selected",
      includeFallback: true,
    }) : [],
  };
}

function featureToApproachTrap(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!isFiniteCoordinatePair(coordinates)) return null;
  const props = feature.properties || {};
  const speedKph = Number(props.speedKph);
  const speedMeta = {
    source: props.speedSource || "",
    confidence: props.speedConfidence || "",
    wayId: props.sourceWayId || null,
    distanceM: Number.isFinite(Number(props.distanceM)) ? Number(props.distanceM) : null,
    approach: parseApproachJson(props.approachJson),
    ambiguous: props.approachAmbiguous === true,
    ambiguityReason: props.approachAmbiguityReason || null,
    nearbyCandidateCount: Number.isFinite(Number(props.approachNearbyCandidateCount))
      ? Number(props.approachNearbyCandidateCount)
      : null,
  };
  return [
    Number(coordinates[0]),
    Number(coordinates[1]),
    Number.isFinite(speedKph) ? speedKph : null,
    props.osmId || feature.id || null,
    speedMeta,
    props.sourceMeta || null,
  ];
}

export function evaluateCameraFeatureApproachDecision(feature, position, options: AnyRecord = {}) {
  const trap = featureToApproachTrap(feature);
  if (!trap || !position) return null;
  const distanceM = haversineDistanceMeters(position, {
    longitude: trap[0],
    latitude: trap[1],
  });
  if (!Number.isFinite(distanceM)) return null;
  const evaluation = scoreApproachCandidate({ trap, distanceM }, position, options);
  return {
    ...evaluation,
    featureId: feature.id || feature.properties?.osmId || null,
    speedKph: trap[2],
    cameraCoordinates: [trap[0], trap[1]],
  };
}

function evaluateVisibleCameraApproachDecision(cameraFeatures, position, options: AnyRecord = {}) {
  if (!position) {
    return {
      state: "no-position",
      reason: "gps-unavailable",
      candidateCount: 0,
      accepted: false,
    };
  }
  const alertDistanceM = options.alertDistanceM;
  const evaluations = [];

  for (const feature of cameraFeatures) {
    const trap = featureToApproachTrap(feature);
    if (!trap) continue;
    const evaluation = evaluateCameraFeatureApproachDecision(feature, position, options);
    if (!evaluation) continue;
    evaluations.push({
      ...evaluation,
      featureId: feature.id || feature.properties?.osmId || null,
      speedKph: trap[2],
      cameraCoordinates: [trap[0], trap[1]],
    });
  }

  if (evaluations.length === 0) {
    return {
      state: "no-candidate",
      reason: "no-visible-camera-candidate",
      candidateCount: 0,
      accepted: false,
      alertDistanceM,
    };
  }

  const accepted = evaluations
    .filter((evaluation) => evaluation.accepted)
    .sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);
  const nearest = evaluations
    .slice()
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  const selected = accepted[0] || nearest;
  return {
    state: selected.state,
    confidence: selected.confidence,
    reason: selected.reason,
    accepted: selected.accepted,
    candidateCount: evaluations.length,
    acceptedCount: accepted.length,
    featureId: selected.featureId,
    distanceM: selected.distanceM,
    speedKph: selected.speedKph,
    headingDeg: selected.headingDeg,
    headingSource: selected.headingSource,
    bearingToCameraDeg: selected.bearingToCameraDeg,
    headingDifferenceDeg: selected.headingDifferenceDeg,
    distanceDecreasing: selected.distanceDecreasing,
    metadataConfidence: selected.metadataConfidence,
    metadataMatched: selected.metadataMatched,
    matchedApproachIndex: selected.matchedApproachIndex,
    matchedWayId: selected.matchedWayId,
    matchedRole: selected.matchedRole,
    matchedConfidence: selected.matchedConfidence,
    matchedBearingDeg: selected.matchedBearingDeg,
    matchedDirection: selected.matchedDirection,
    corridorCount: selected.corridorCount,
    cameraCoordinates: selected.cameraCoordinates,
    alertDistanceM,
  };
}

function normalizePosition(value) {
  const coords = value?.coords || value || {};
  const latitude = Number(coords.latitude);
  const longitude = Number(coords.longitude);
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readPopupNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPopupDistance(distanceM, distanceUnit) {
  if (!Number.isFinite(distanceM)) return null;
  const distance = formatTrapDistance(distanceM, distanceUnit, "");
  return `${distance.value} ${distance.unit}`.trim();
}

function parsePopupSources(value) {
  if (Array.isArray(value)) return value.map((source) => String(source).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsePopupSources(parsed);
    } catch {
      return [];
    }
  }
  return String(value || "")
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean);
}

function getPopupSourceLabel(props: AnyRecord = {}) {
  const sourceMeta = props.sourceMeta && typeof props.sourceMeta === "object" ? props.sourceMeta : null;
  const sources = parsePopupSources(props.cameraSources?.length ? props.cameraSources : sourceMeta?.sources);
  const labels = [];
  if (sources.includes("osm")) labels.push("OSM");
  if (sources.includes("ansv")) labels.push("ANSV official");
  if (sources.includes("nyc")) labels.push("NYC local");
  if (!labels.length) {
    const primary = String(props.primarySource || sourceMeta?.primarySource || "").trim();
    if (primary === "ansv") labels.push("ANSV official");
    else if (primary === "nyc") labels.push("NYC local");
    else if (primary === "osm") labels.push("OSM");
  }
  return labels.length ? labels.join(" + ") : null;
}

function titleCase(value) {
  const text = String(value || "").replaceAll("-", " ").trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function getApproachDirectionLabel(direction) {
  if (direction === "forward") return "Forward";
  if (direction === "backward") return "Backward";
  if (direction === "both") return "Both directions";
  if (direction === "mixed") return "Multiple directions";
  return "Unknown";
}

function getApproachRoleLabel(role) {
  if (role === "primary") return "Primary road";
  if (role === "intersection") return "Intersection candidate";
  if (role === "secondary") return "Secondary road";
  if (role === "ambiguous") return "Ambiguous candidate";
  return "Approach corridor";
}

function getApproachStatusLabel(props: AnyRecord = {}) {
  if (props.approachAmbiguous === true || props.approachConfidenceSummary === "ambiguous") return "Ambiguous";
  if (Number(props.approachCount || 0) <= 0) return "No approach data";
  return `${titleCase(props.approachConfidenceSummary || "low")} confidence`;
}

function getApproachExplanation(props: AnyRecord = {}) {
  if (props.approachAmbiguous === true || props.approachConfidenceSummary === "ambiguous") {
    return "Multiple nearby road matches look plausible. This camera may need review.";
  }
  if (Number(props.approachCount || 0) <= 0) {
    return "Fallback may use heading or radius because approach metadata is missing.";
  }
  return "Alerts when you are moving toward the camera along this approach.";
}

function getDecisionSummary(decision = null) {
  if (!decision) return null;
  if (decision.accepted) return "Would alert now";
  if (decision.state === "near-not-approaching") return "Near but not approaching";
  if (decision.state === "unknown-heading") return "Heading unavailable";
  if (decision.state === "legacy-radius") return "Using fallback";
  if (decision.state === "missing-metadata") return "No approach data";
  return titleCase(decision.state || "No match");
}

function getApproachBearingLabel(approach: AnyRecord = {}) {
  return [
    Number.isFinite(Number(approach.bearingDeg)) ? `${Math.round(Number(approach.bearingDeg))}°` : null,
    Number.isFinite(Number(approach.reverseBearingDeg)) ? `${Math.round(Number(approach.reverseBearingDeg))}° reverse` : null,
  ].filter(Boolean).join(" / ");
}

function renderApproachCorridorsHtml(approaches, currentDecision) {
  if (!approaches.length) return "";
  return `
    <ol class="camera-map-popup-approach-list">
      ${approaches.map((approach, index) => {
        const matched = currentDecision?.matchedApproachIndex === index;
        const bearingLabel = getApproachBearingLabel(approach);
        const roadDistanceLabel = Number.isFinite(Number(approach.roadDistanceM))
          ? `${Math.round(Number(approach.roadDistanceM))} m`
          : "n/a";
        return `
          <li${matched ? ' class="is-matched"' : ""}>
            <strong>${escapeHtml(getApproachRoleLabel(approach.role))}${matched ? " - matched" : ""}</strong>
            <span><b>Direction</b><em>${escapeHtml(getApproachDirectionLabel(approach.direction))}</em></span>
            ${bearingLabel ? `<span><b>Bearing</b><em>${escapeHtml(bearingLabel)}</em></span>` : ""}
            <span><b>Confidence</b><em>${escapeHtml(titleCase(approach.confidence || "low"))}</em></span>
            <span><b>Road match</b><em>${escapeHtml(roadDistanceLabel)}</em></span>
            ${approach.wayId ? `<span><b>Way</b><em>${escapeHtml(approach.wayId)}</em></span>` : ""}
          </li>
        `;
      }).join("")}
    </ol>
  `;
}

export function createCameraReviewPayload(feature, decision = null) {
  const props = feature?.properties || {};
  const approaches = parseApproachJson(props.approachJson);
  const primaryApproach = approaches[0] || {};
  return {
    cameraId: String(feature?.id || props.osmId || ""),
    coordinates: Array.isArray(feature?.geometry?.coordinates)
      ? feature.geometry.coordinates.slice(0, 2).map(Number)
      : null,
    approach: approaches,
    confidence: props.approachConfidenceSummary || "none",
    direction: props.approachDirections || "none",
    ambiguous: props.approachAmbiguous === true,
    ambiguityReason: props.approachAmbiguityReason || null,
    matchedWayId: props.sourceWayId || primaryApproach.wayId || null,
    roadDistanceM: readPopupNumber(props.approachRoadDistanceMMin ?? props.distanceM),
    bearingSpreadDeg: readPopupNumber(props.approachBearingSpreadDeg),
    nearbyCandidateCount: readPopupNumber(props.approachNearbyCandidateCount),
    sources: parsePopupSources(props.cameraSources),
    country: props.country || "",
    speedSource: props.speedSource || "",
    fallbackReason: approaches.length > 0 ? null : "no-road-corridor-available",
    reason: decision?.reason || null,
    currentDecision: decision
      ? {
        state: decision.state || "none",
        accepted: decision.accepted === true,
        distanceM: Number.isFinite(decision.distanceM) ? Math.round(decision.distanceM) : null,
        headingDeg: Number.isFinite(decision.headingDeg) ? Math.round(decision.headingDeg) : null,
        bearingToCameraDeg: Number.isFinite(decision.bearingToCameraDeg) ? Math.round(decision.bearingToCameraDeg) : null,
        headingDifferenceDeg: Number.isFinite(decision.headingDifferenceDeg) ? Math.round(decision.headingDifferenceDeg) : null,
        matchedApproachIndex: Number.isFinite(decision.matchedApproachIndex) ? decision.matchedApproachIndex : null,
        matchedWayId: decision.matchedWayId || null,
        matchedRole: decision.matchedRole || null,
        matchedConfidence: decision.matchedConfidence || null,
        matchedDirection: decision.matchedDirection || null,
      }
      : null,
  };
}

export function buildPopupHtml(feature, options: AnyRecord = {}) {
  const {
    unit = loadUnitPreference(),
    distanceUnit = loadDistanceUnitPreference(),
    currentDecision = null,
    approachDetails = null,
  } = options;
  const props = feature?.properties || {};
  const speed = readPopupNumber(props.speedKph);
  const speedSource = String(props.speedSource || "");
  const isInferred = speedSource.startsWith("nearest_road:");
  const distanceM = readPopupNumber(props.distanceM);
  const speedLabel = formatCameraLimitSpeed(speed, unit);
  const roadDistanceLabel = formatPopupDistance(distanceM, distanceUnit);
  const sourceLabel = getPopupSourceLabel(props);
  const approachCount = readPopupNumber(props.approachCount);
  const approachRoadDistanceLabel = formatPopupDistance(
    readPopupNumber(props.approachRoadDistanceMMin),
    distanceUnit,
  );
  const approaches = parseApproachJson(props.approachJson);
  const detailsUnavailable = approachDetails?.hasUnresolvedApproachDetails === true
    || props.approachDetailsUnavailable === true
    || (approaches.length === 0 && Number(approachCount || 0) > 0);
  const approachStatus = getApproachStatusLabel(props);
  const decisionSummary = getDecisionSummary(currentDecision);
  const reviewPayload = createCameraReviewPayload(feature, currentDecision);
  const reviewPayloadJson = JSON.stringify(reviewPayload);
  const primaryApproach = approaches[0] || null;
  const matchedWayId = props.sourceWayId || primaryApproach?.wayId;
  const bearingLabel = primaryApproach ? getApproachBearingLabel(primaryApproach) : null;
  const speedRow = Number.isFinite(speed)
    ? [
      isInferred ? "Estimated limit" : "Speed limit",
      isInferred
        ? `${speedLabel} from nearby OSM road`
        : speedLabel,
    ]
    : ["Speed limit", "Unknown"];
  const rows = [
    speedRow,
    ...(Number.isFinite(speed) && isInferred && roadDistanceLabel
      ? [["Road distance", roadDistanceLabel]]
      : []),
    ...(sourceLabel ? [["Source", sourceLabel]] : []),
    ["Country", props.countryName || props.country || "Unknown"],
    ["Tile", props.tile || "country"],
    ["OSM id", props.osmId || "unknown"],
  ];
  return `
    <div class="camera-map-popup">
      <strong>Speed camera</strong>
      ${rows.map(([label, value]) => `
        <span>
          <b>${escapeHtml(label)}</b>
          <em>${escapeHtml(value)}</em>
        </span>
      `).join("")}
      <section class="camera-map-popup-approach">
        <strong>Camera approach</strong>
        <span>
          <b>Status</b>
          <em>${escapeHtml(approachStatus)}</em>
        </span>
        <span>
          <b>Direction</b>
          <em>${escapeHtml(getApproachDirectionLabel(props.approachDirections))}</em>
        </span>
        ${approachRoadDistanceLabel ? `
          <span>
            <b>Matched road</b>
            <em>${escapeHtml(approachRoadDistanceLabel)} away</em>
          </span>
        ` : ""}
        ${decisionSummary ? `
          <span>
            <b>Current match</b>
            <em>${escapeHtml(decisionSummary)}</em>
          </span>
          <span>
            <b>Why</b>
            <em>${escapeHtml(currentDecision?.reason || "n/a")}</em>
          </span>
        ` : ""}
        <p>${escapeHtml(detailsUnavailable
    ? "Approach details unavailable in this view."
    : getApproachExplanation(props))}</p>
        ${!decisionSummary && approaches.length > 0 ? `
          <p>Live match unavailable - showing configured camera approaches.</p>
        ` : ""}
        ${approaches.length === 0 && !detailsUnavailable ? `
          <p>No road corridor available.</p>
          <p>Alerts may use heading/radius fallback because no matched road segment is available.</p>
          <p>This camera needs road-direction data for precise approach filtering.</p>
        ` : ""}
        <details>
          <summary>Details</summary>
          <span>
            <b>Approaches</b>
            <em>${escapeHtml(String(approachCount || 0))}</em>
          </span>
          ${renderApproachCorridorsHtml(approaches, currentDecision)}
          ${bearingLabel ? `
            <span>
              <b>Approach bearing</b>
              <em>${escapeHtml(bearingLabel)}</em>
            </span>
          ` : ""}
          ${matchedWayId ? `
            <span>
              <b>Matched way</b>
              <em>${escapeHtml(matchedWayId)}</em>
            </span>
          ` : ""}
          ${props.approachNearbyCandidateCount ? `
            <span>
              <b>Nearby matches</b>
              <em>${escapeHtml(props.approachNearbyCandidateCount)}</em>
            </span>
          ` : ""}
          ${props.approachBearingSpreadDeg ? `
            <span>
              <b>Bearing spread</b>
              <em>${escapeHtml(`${props.approachBearingSpreadDeg}°`)}</em>
            </span>
          ` : ""}
          <button type="button" class="camera-map-copy-review" data-review-payload="${escapeHtml(reviewPayloadJson)}">Copy camera review info</button>
        </details>
      </section>
    </div>
  `;
}

function getStatusMessage(status: AnyRecord = {}) {
  if (status.status === "loading-manifest") return t("cameraMapLoading");
  if (status.status === "loading-cameras") return t("cameraMapLoadingCameras");
  if (status.status === "waiting-zoom") return t("cameraMapZoomIn");
  if (status.status === "offline-cached") return t("cameraMapOfflineCached");
  if (status.status === "gps-live") return t("cameraMapGpsLive");
  if (status.status === "gps-stale") return t("cameraMapGpsStale");
  if (status.status === "gps-unavailable") return t("cameraMapGpsUnavailable");
  if (status.status === "following") return t("cameraMapFollowing");
  if (status.status === "follow-paused") return t("cameraMapFollowPaused");
  if (status.status === "heading-unavailable") return t("cameraMapHeadingUnavailable");
  if (status.status === "camera-ahead") return t("cameraMapCameraAhead", { distance: status.distance || "" });
  if (status.status === "ready") return t("cameraMapReady", { count: status.featureCount || 0 });
  if (status.status === "unavailable" || status.status === "error") return t("cameraMapUnavailable");
  return t("cameraMapLoading");
}

function getInitialView({ gpsService = null, getCurrentPosition = null }: AnyRecord = {}) {
  const currentPosition = normalizePosition(
    gpsService?.getCurrentPosition?.()
      || getCurrentPosition?.()
      || window.__vatioboardGpsGetCurrentPosition?.()
      || window.__vatioboardSpeedGetCurrentPosition?.()
  );
  if (currentPosition) {
    return {
      center: [currentPosition.longitude, currentPosition.latitude],
      zoom: 12,
    };
  }
  return {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  };
}

function pxToNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadBasemapPreference() {
  try {
    return localStorage.getItem(CAMERA_MAP_BASEMAP_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveBasemapPreference(basemapId) {
  try {
    localStorage.setItem(CAMERA_MAP_BASEMAP_STORAGE_KEY, basemapId);
  } catch {
    // Basemap persistence is convenience only.
  }
}

function clearBasemapPreference() {
  try {
    localStorage.removeItem(CAMERA_MAP_BASEMAP_STORAGE_KEY);
  } catch {
    // Basemap persistence is convenience only.
  }
}

function loadBooleanPreference(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // Preference persistence is convenience only.
  }
  return fallback;
}

function hasStoredPreference(key) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function saveBooleanPreference(key, value) {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Preference persistence is convenience only.
  }
}

function loadEnumPreference(key, allowedValues, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (allowedValues.includes(value)) return value;
  } catch {
    // Preference persistence is convenience only.
  }
  return fallback;
}

function saveEnumPreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference persistence is convenience only.
  }
}

async function copyTextToClipboard(text) {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let copied;
  try {
    copied = document.execCommand?.("copy") === true;
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function createLayerMenuHeading(labelKey) {
  return createElement("div", {
    class: "camera-map-layer-section-heading",
    role: "presentation",
    text: t(labelKey),
    "data-i18n": labelKey,
  });
}

function createLayerOption({ id, labelKey, selected = false }) {
  return createElement("button", {
    type: "button",
    class: `camera-map-layer-option${selected ? " is-active" : ""}`,
    role: "option",
    "aria-selected": selected ? "true" : "false",
    "data-layer-id": id,
  }, [
    createElement("span", {
      class: "camera-map-layer-option-label",
      text: t(labelKey),
      "data-i18n": labelKey,
    }),
  ]);
}

function createOverlayOption({
  id,
  labelKey,
  descriptionKey = "",
  selected = false,
  group = "overlay",
}) {
  return createElement("button", {
    type: "button",
    class: `camera-map-layer-option camera-map-layer-option--overlay${selected ? " is-active" : ""}`,
    role: group === "filter" ? "radio" : "checkbox",
    "aria-checked": selected ? "true" : "false",
    "data-overlay-id": group === "overlay" ? id : null,
    "data-approach-filter": group === "filter" ? id : null,
  }, [
    createElement("span", {
      class: "camera-map-layer-option-label",
      text: t(labelKey),
      "data-i18n": labelKey,
    }),
    ...(descriptionKey ? [
      createElement("span", {
        class: "camera-map-layer-option-description",
        text: t(descriptionKey),
        "data-i18n": descriptionKey,
      }),
    ] : []),
  ]);
}

function createBasemapLayerControl(selectedBasemapId, {
  auto = false,
  approachLayerEnabled = false,
  approachFilter = "all",
} = {}) {
  const selectedBasemap = getCameraMapBasemap(selectedBasemapId);
  const selectedLabelKey = auto ? "cameraMapLayerAuto" : selectedBasemap.labelKey;
  const layerButtonText = createElement("span", {
    class: "camera-map-layer-button-text",
    text: t(selectedLabelKey),
    "data-i18n": selectedLabelKey,
  });
  const layerButton = createElement("button", {
    type: "button",
    class: "camera-map-layer-button",
    "aria-label": t("cameraMapLayers"),
    title: t("cameraMapLayers"),
    "data-i18n-aria": "cameraMapLayers",
    "data-i18n-title": "cameraMapLayers",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "data-layer-id": auto ? CAMERA_MAP_BASEMAP_AUTO_ID : selectedBasemap.id,
  }, [
    createElement("span", {
      class: "camera-map-layer-icon",
      "aria-hidden": "true",
      html: IconWorld,
    }),
    layerButtonText,
  ]);

  const layerMenu = createElement("div", {
    class: "camera-map-layer-menu",
    role: "listbox",
    "aria-label": t("cameraMapLayers"),
    "data-i18n-aria": "cameraMapLayers",
  });
  layerMenu.hidden = true;
  layerMenu.appendChild(createLayerMenuHeading("cameraMapBasemaps"));
  layerMenu.appendChild(createLayerOption({
    id: CAMERA_MAP_BASEMAP_AUTO_ID,
    labelKey: "cameraMapLayerAuto",
    selected: auto,
  }));

  for (const basemap of CAMERA_MAP_BASEMAPS) {
    layerMenu.appendChild(createLayerOption({
      id: basemap.id,
      labelKey: basemap.labelKey,
      selected: !auto && basemap.id === selectedBasemap.id,
    }));
  }

  layerMenu.appendChild(createLayerMenuHeading("cameraMapOverlays"));
  layerMenu.appendChild(createOverlayOption({
    id: "approach",
    labelKey: "cameraMapApproachLayer",
    descriptionKey: "cameraMapApproachLayerDescription",
    selected: approachLayerEnabled,
  }));
  layerMenu.appendChild(createLayerMenuHeading("cameraMapApproachFilter"));
  for (const filter of APPROACH_FILTERS) {
    layerMenu.appendChild(createOverlayOption({
      id: filter,
      labelKey: `cameraMapApproachFilter${filter[0].toUpperCase()}${filter.slice(1)}`,
      selected: approachFilter === filter,
      group: "filter",
    }));
  }

  const layerControl = createElement("div", {
    class: "camera-map-layer-control",
    title: t("cameraMapLayers"),
    "data-i18n-title": "cameraMapLayers",
  }, [
    layerButton,
    layerMenu,
  ]);

  return {
    layerControl,
    layerButton,
    layerButtonText,
    layerMenu,
  };
}

function buildPanel(selectedBasemapId, {
  autoBasemap = false,
  approachLayerEnabled = false,
  approachFilter = "all",
} = {}) {
  const title = createElement("span", {
    class: "camera-map-title",
    text: t("cameraMapTitle"),
    "data-i18n": "cameraMapTitle",
  });

  const fullscreenBtn = createElement("button", {
    type: "button",
    class: "camera-map-action camera-map-fullscreen",
    "aria-label": t("cameraMapFullscreen"),
    title: t("cameraMapFullscreen"),
    "data-i18n-aria": "cameraMapFullscreen",
    "data-i18n-title": "cameraMapFullscreen",
    html: `<span class="btn-icon">${IconFullscreen}</span>`,
  });

  const speedAlertsBtn = createElement("button", {
    type: "button",
    class: "camera-map-action camera-map-speed-alerts",
    "aria-label": t("speedAlertsTitle"),
    title: t("speedAlertsTitle"),
    "data-i18n-aria": "speedAlertsTitle",
    "data-i18n-title": "speedAlertsTitle",
    html: `<span class="btn-icon">${IconSpeed}</span>`,
  });

  const closeBtn = createElement("button", {
    type: "button",
    class: "camera-map-action camera-map-close",
    "aria-label": t("closeCameraMap"),
    title: t("closeCameraMap"),
    "data-i18n-aria": "closeCameraMap",
    "data-i18n-title": "closeCameraMap",
    html: IconClose,
  });

  const actions = createElement("div", { class: "camera-map-actions" }, [
    fullscreenBtn,
    speedAlertsBtn,
    closeBtn,
  ]);
  const header = createElement("div", { class: "camera-map-header" }, [
    title,
    actions,
  ]);

  const recenterBtn = createElement("button", {
    type: "button",
    class: "camera-map-toolbar-btn camera-map-follow-toggle",
    "aria-label": t("cameraMapFollow"),
    title: t("cameraMapFollow"),
    "data-i18n-aria": "cameraMapFollow",
    "data-i18n-title": "cameraMapFollow",
    html: IconGpsLab,
  });

  const orientationBtn = createElement("button", {
    type: "button",
    class: "camera-map-toolbar-btn camera-map-orientation-toggle",
    "aria-label": t("cameraMapNorthUp"),
    title: t("cameraMapNorthUp"),
    "data-i18n-aria": "cameraMapNorthUp",
    "data-i18n-title": "cameraMapNorthUp",
    text: "N",
  });

  const refreshBtn = createElement("button", {
    type: "button",
    class: "camera-map-toolbar-btn camera-map-refresh",
    "aria-label": t("cameraMapRefreshArea"),
    title: t("cameraMapRefreshArea"),
    "data-i18n-aria": "cameraMapRefreshArea",
    "data-i18n-title": "cameraMapRefreshArea",
    html: IconRestart,
  });

  const statusEl = createElement("p", {
    class: "camera-map-status",
    role: "status",
    "aria-live": "polite",
    text: t("cameraMapLoading"),
  });

  const mapEl = createElement("div", {
    class: "camera-map-container",
    "aria-label": t("cameraMapTitle"),
  });
  const {
    layerControl,
    layerButton,
    layerButtonText,
    layerMenu,
  } = createBasemapLayerControl(selectedBasemapId, {
    auto: autoBasemap,
    approachLayerEnabled,
    approachFilter,
  });
  const overlayControls = createElement("div", { class: "camera-map-overlay-controls camera-map-nav-controls" }, [
    recenterBtn,
    orientationBtn,
    refreshBtn,
    layerControl,
  ]);
  const topOverlay = createElement("div", {
    class: "camera-map-overlay camera-map-overlay--top",
  }, [
    statusEl,
  ]);
  const navOverlay = createElement("div", {
    class: "camera-map-overlay camera-map-overlay--nav",
  }, [
    overlayControls,
  ]);
  const activeBasemap = getCameraMapBasemap(selectedBasemapId);
  const attribution = createElement("a", {
    class: "camera-map-attribution",
    href: activeBasemap.attributionUrl,
    target: "_blank",
    rel: "noopener noreferrer",
    text: t(activeBasemap.attributionKey),
    "data-i18n": activeBasemap.attributionKey,
  });
  const privacy = createElement("span", {
    class: "camera-map-privacy",
    text: t("cameraMapLocalLookup"),
    "data-i18n": "cameraMapLocalLookup",
  });
  const bottomOverlay = createElement("div", {
    class: "camera-map-overlay camera-map-overlay--bottom",
  }, [
    attribution,
    privacy,
  ]);
  const approachPanel = createElement("div", {
    class: "camera-map-approach-panel",
  }, [
    createElement("strong", { text: t("cameraMapApproachPanel"), "data-i18n": "cameraMapApproachPanel" }),
    createElement("div", { class: "camera-map-approach-legend" }, [
      createElement("span", { class: "camera-map-approach-legend-row camera-map-approach-legend-row--solid", text: t("cameraMapApproachLegendSolid"), "data-i18n": "cameraMapApproachLegendSolid" }),
      createElement("span", { class: "camera-map-approach-legend-row camera-map-approach-legend-row--dash", text: t("cameraMapApproachLegendDashed"), "data-i18n": "cameraMapApproachLegendDashed" }),
      createElement("span", { class: "camera-map-approach-legend-row camera-map-approach-legend-row--arrow", text: t("cameraMapApproachLegendArrow"), "data-i18n": "cameraMapApproachLegendArrow" }),
    ]),
    createElement("dl", { class: "camera-map-approach-panel-list" }),
  ]);
  approachPanel.hidden = true;
  const body = createElement("div", { class: "camera-map-body" }, [
    mapEl,
    topOverlay,
    navOverlay,
    approachPanel,
    bottomOverlay,
  ]);
  const resizeHandle = createElement("button", {
    type: "button",
    class: "camera-map-resize-handle",
    "aria-label": t("cameraMapResize"),
    title: t("cameraMapResize"),
    "data-i18n-aria": "cameraMapResize",
    "data-i18n-title": "cameraMapResize",
  });
  const panel = createElement("section", {
    class: "camera-map-panel",
    "aria-label": t("cameraMapTitle"),
    "data-vb-floating-panel": "",
  }, [header, body, resizeHandle]);
  panel.hidden = true;

  return {
    panel,
    header,
    closeBtn,
    fullscreenBtn,
    speedAlertsBtn,
    recenterBtn,
    orientationBtn,
    refreshBtn,
    approachPanel,
    statusEl,
    mapEl,
    layerButton,
    layerButtonText,
    layerMenu,
    resizeHandle,
    attribution,
  };
}

export function createCameraMapWidget(options: AnyRecord = {}) {
  const {
    mount = document.body,
    floating = false,
    button = null,
    restoreVisibility = false,
    persistVisibility = false,
    visibilityKey = VISIBILITY_KEY,
    shellManager = getDefaultShellWindowManager(),
    gpsService = null,
    getCurrentPosition = null,
    getCameraDatabase = null,
    dataSource = null,
    navigationDefaultMode = "auto",
    autoEnableFollowFromSpeed = true,
    autoFrameCamera = true,
  } = options;

  const storedBasemapId = loadBasemapPreference();
  let hasUserBasemapPreference = isCameraMapBasemapId(storedBasemapId);
  let hasUserFollowPreference = hasStoredPreference(FOLLOW_STORAGE_KEY);
  let hasUserOrientationPreference = hasStoredPreference(ORIENTATION_STORAGE_KEY);
  let activeBasemap = getCameraMapBasemap(hasUserBasemapPreference
    ? storedBasemapId
    : getDefaultCameraMapBasemapId());
  const initialNavigationDefaultMode = ["drive", "browse", "auto"].includes(navigationDefaultMode)
    ? navigationDefaultMode
    : "auto";
  let followEnabled = loadBooleanPreference(FOLLOW_STORAGE_KEY, false);
  let followPaused = false;
  let navigationMode = followEnabled ? "drive" : "browse";
  let orientationMode = loadEnumPreference(ORIENTATION_STORAGE_KEY, ["north-up", "heading-up"], "north-up");
  let projectionMode = loadEnumPreference(PROJECTION_STORAGE_KEY, ["auto", "flat", "globe"], "auto");
  let approachLayerEnabled = loadBooleanPreference(APPROACH_LAYER_STORAGE_KEY, false);
  let approachFilter = loadEnumPreference(APPROACH_FILTER_STORAGE_KEY, APPROACH_FILTERS, "all");
  let activeProjection = null;
  const refs = buildPanel(activeBasemap.id, {
    autoBasemap: !hasUserBasemapPreference,
    approachLayerEnabled,
    approachFilter,
  });
  const {
    panel,
    header,
    closeBtn,
    fullscreenBtn,
    speedAlertsBtn,
    recenterBtn,
    orientationBtn,
    refreshBtn,
    approachPanel,
    statusEl,
    mapEl,
    layerButton,
    layerButtonText,
    layerMenu,
    resizeHandle,
    attribution,
  } = refs;

  const cameraDataSource = dataSource || createCameraMapDataSource({
    getCameraDatabase,
    includeApproachVisualization: approachLayerEnabled,
    onStatusChange: (nextStatus) => updateStatus(nextStatus),
  });

  let cleanupLayer = () => {};
  let maplibregl = null;
  let map = null;
  let mapReady = false;
  let initPromise = null;
  let resolveReadyPromise = null;
  let readyPromise = null;
  let destroyed = false;
  let refreshController = null;
  let refreshTimer = 0;
  let fullscreenResizeTimer = 0;
  let positionPollTimer = 0;
  let isNativeFullscreen = false;
  let isFallbackFullscreen = false;
  let currentCameraFeatures = [];
  let currentApproachFeatureCount = 0;
  let cameraStatus = { status: "idle", featureCount: 0 };
  let navigationStatus = null;
  let lastApproachDecision = null;
  let selectedCameraDetails = null;
  let previousLivePosition = null;
  let currentLivePosition = null;
  let lastHeadingState = null;
  let currentUserPositionFeature = null;
  let navigationCameraState = createNavigationCameraState();
  let lastCameraCommand = null;
  let basemapErrorCount = 0;
  let cameraLayerEventsBound = false;
  let basemapSwitchInProgress = false;
  let basemapStyleVersion = 0;
  let suppressViewportRefresh = false;
  let resizeObserver = null;
  let resizePointerId = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeLastX = 0;
  let resizeLastY = 0;
  let resizeRafId = 0;
  let resizeInProgress = false;
  let colorSchemeMediaQuery = null;
  let cleanupColorSchemeListener = () => {};
  let programmaticCameraMoveDepth = 0;
  let suppressManualPauseUntilMs = 0;
  let speedPositionListenerActive = false;
  let gpsConsumerCleanup = null;
  let gpsSnapshotUnsubscribe = null;

  function loadPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function savePos(pos) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // Position persistence is convenience only.
    }
    if (pos?.panel?.left && pos?.panel?.top) {
      const bounds = getPanelBounds();
      shellManager.updateWindowBounds(CAMERA_MAP_WINDOW_ID, {
        left: parseFloat(pos.panel.left),
        top: parseFloat(pos.panel.top),
        width: bounds.width,
        height: bounds.height,
      }, {
        preserveSnap: Boolean(shellManager.getWindow(CAMERA_MAP_WINDOW_ID)?.snap),
      });
    }
  }

  function loadVisibility() {
    if (!restoreVisibility) return false;
    try {
      return localStorage.getItem(visibilityKey) === "open";
    } catch {
      return false;
    }
  }

  function saveVisibility(open) {
    if (!persistVisibility) return;
    try {
      localStorage.setItem(visibilityKey, open ? "open" : "closed");
    } catch {
      // ignore
    }
  }

  function renderStatusChip() {
    const navStatus = navigationStatus?.status || "";
    const cameraDataStatus = cameraStatus?.status || "";
    const highPriorityNav = navStatus === "camera-ahead"
      || navStatus === "follow-paused"
      || navStatus === "following"
      || navStatus === "heading-unavailable"
      || (followEnabled && (navStatus === "gps-stale" || navStatus === "gps-unavailable"));
    const safeStatus = highPriorityNav
      ? navigationStatus
      : (cameraDataStatus === "offline-cached" ? cameraStatus : (navigationStatus || cameraStatus || {}));
    statusEl.textContent = getStatusMessage(safeStatus);
    statusEl.dataset.status = safeStatus.status || "idle";
  }

  function updateStatus(nextStatus = cameraDataSource.getStatus?.()) {
    cameraStatus = nextStatus || {};
    renderStatusChip();
  }

  function setNavigationStatus(nextStatus = null) {
    navigationStatus = nextStatus;
    renderStatusChip();
  }

  function formatPanelNumber(value, suffix = "") {
    return Number.isFinite(value) ? `${Math.round(value)}${suffix}` : "n/a";
  }

  function getApproachDecisionLabel(decision: AnyRecord = {}) {
    if (decision.accepted) return t("cameraMapApproachWouldAlert");
    if (decision.state === "near-not-approaching") return t("cameraMapApproachNotApproaching");
    if (decision.state === "unknown-heading") return t("cameraMapApproachHeadingUnavailable");
    if (decision.state === "legacy-radius") return t("cameraMapApproachUsingFallback");
    if (decision.state === "missing-metadata") return t("cameraMapApproachNoData");
    return decision.state || "n/a";
  }

  function renderApproachPanel() {
    approachPanel.hidden = !approachLayerEnabled;
    if (approachPanel.hidden) return;

    const list = approachPanel.querySelector(".camera-map-approach-panel-list");
    if (!list) return;
    const decision = lastApproachDecision || {};
    const rows = [
      [t("cameraMapApproachDecision"), getApproachDecisionLabel(decision)],
      [t("cameraMapApproachWhy"), decision.reason || "n/a"],
      [t("cameraMapApproachConfidence"), decision.confidence || decision.metadataConfidence || "none"],
      [t("cameraMapApproachDistance"), formatPanelNumber(decision.distanceM, " m")],
      [t("cameraMapApproachHeading"), `${formatPanelNumber(decision.headingDeg, "°")} ${decision.headingSource || ""}`.trim()],
      [t("cameraMapApproachBearing"), formatPanelNumber(decision.bearingToCameraDeg, "°")],
      [t("cameraMapApproachDelta"), formatPanelNumber(decision.headingDifferenceDeg, "°")],
      [t("cameraMapApproachCandidates"), `${decision.acceptedCount ?? 0}/${decision.candidateCount ?? 0}`],
      [t("cameraMapApproachVisibleRules"), `${currentApproachFeatureCount}`],
    ];
    list.replaceChildren(...rows.flatMap(([label, value]) => [
      createElement("dt", { text: label }),
      createElement("dd", { text: value }),
    ]));
  }

  function setApproachLayerEnabled(visible, { refreshData = true }: AnyRecord = {}) {
    approachLayerEnabled = Boolean(visible);
    saveBooleanPreference(APPROACH_LAYER_STORAGE_KEY, approachLayerEnabled);
    updateLayerMenuState();
    updateApproachLayers();
    renderApproachPanel();
    if (refreshData) queueRefresh();
  }

  function setApproachFilter(filter) {
    if (!APPROACH_FILTERS.includes(filter)) return;
    approachFilter = filter;
    saveEnumPreference(APPROACH_FILTER_STORAGE_KEY, approachFilter);
    updateLayerMenuState();
    updateApproachLayers();
    renderApproachPanel();
  }

  function getApproachMatcherOptions() {
    const distanceUnit = loadDistanceUnitPreference();
    return {
      alertDistanceM: loadTrapAlertDistancePreference(distanceUnit),
      ...loadCameraApproachOptionsPreference(),
    };
  }

  function resolveCameraDetailsForFeature(feature) {
    if (!feature) return resolveCameraApproachDetails(feature);
    try {
      return cameraDataSource.resolveCameraDetails?.(feature) || resolveCameraApproachDetails(feature);
    } catch {
      return resolveCameraApproachDetails(feature);
    }
  }

  function findCameraFeatureById(featureId) {
    if (featureId === null || featureId === undefined) return null;
    const id = String(featureId);
    return currentCameraFeatures.find((feature) =>
      String(feature?.id || "") === id
      || String(feature?.properties?.osmId || "") === id
      || getFeatureCameraId(feature) === id
    ) || null;
  }

  function setSelectedCameraDetails(details) {
    selectedCameraDetails = details || null;
    updateSelectedApproachLayer();
  }

  function clearSelectedCameraDetails() {
    if (!selectedCameraDetails) return;
    selectedCameraDetails = null;
    updateSelectedApproachLayer();
  }

  function updateApproachDecision(position = currentLivePosition) {
    lastApproachDecision = evaluateVisibleCameraApproachDecision(
      currentCameraFeatures,
      position
        ? {
          ...position,
          previousPosition: previousLivePosition,
        }
        : null,
      getApproachMatcherOptions(),
    );
    logCameraApproach("decision", lastApproachDecision);
    updateCurrentMatchLayer(lastApproachDecision);
    renderApproachPanel();
    return lastApproachDecision;
  }

  function updateNavigationButtons() {
    recenterBtn.classList.toggle("is-active", followEnabled && !followPaused);
    recenterBtn.classList.toggle("is-paused", followEnabled && followPaused);
    recenterBtn.dataset.follow = followEnabled ? (followPaused ? "paused" : "on") : "off";
    recenterBtn.dataset.navigationMode = navigationMode;
    orientationBtn.dataset.mode = orientationMode;
    orientationBtn.textContent = orientationMode === "heading-up" ? "HDG" : "N";
    const orientationLabel = orientationMode === "heading-up" ? t("cameraMapHeadingUp") : t("cameraMapNorthUp");
    orientationBtn.setAttribute("aria-label", orientationLabel);
    orientationBtn.setAttribute("title", orientationLabel);
    orientationBtn.dataset.i18nAria = orientationMode === "heading-up" ? "cameraMapHeadingUp" : "cameraMapNorthUp";
    orientationBtn.dataset.i18nTitle = orientationMode === "heading-up" ? "cameraMapHeadingUp" : "cameraMapNorthUp";
    renderApproachPanel();
  }

  function getMapSize() {
    const panelBounds = getPanelBounds();
    return {
      width: Math.round(mapEl.clientWidth || panelBounds.width || 720),
      height: Math.round(mapEl.clientHeight || Math.max(320, panelBounds.height - 52) || 520),
    };
  }

  function runProgrammaticCameraMove(callback) {
    programmaticCameraMoveDepth += 1;
    suppressManualPauseUntilMs = Date.now() + 900;
    try {
      return callback();
    } finally {
      window.setTimeout(() => {
        programmaticCameraMoveDepth = Math.max(0, programmaticCameraMoveDepth - 1);
      }, 0);
    }
  }

  function setLayerMenuOpen(open) {
    layerMenu.hidden = !open;
    layerButton.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function getLayerOptionElements(): any[] {
    return Array.from(layerMenu.querySelectorAll(".camera-map-layer-option"));
  }

  function getSelectedLayerValue() {
    return hasUserBasemapPreference ? activeBasemap.id : CAMERA_MAP_BASEMAP_AUTO_ID;
  }

  function focusLayerOption(value = getSelectedLayerValue()) {
    const options = getLayerOptionElements();
    const selectedOption = options.find((option) => option.dataset.layerId === value) || options[0];
    selectedOption?.focus();
  }

  function moveLayerOptionFocus(delta) {
    const options = getLayerOptionElements();
    if (!options.length) return;
    const currentIndex = Math.max(0, options.indexOf(document.activeElement));
    const nextIndex = (currentIndex + delta + options.length) % options.length;
    options[nextIndex]?.focus();
  }

  function updateLayerControlSelection(value = getSelectedLayerValue()) {
    const labelKey = value === CAMERA_MAP_BASEMAP_AUTO_ID
      ? "cameraMapLayerAuto"
      : getCameraMapBasemap(value).labelKey;
    layerButton.dataset.layerId = value;
    layerButtonText.textContent = t(labelKey);
    layerButtonText.dataset.i18n = labelKey;
    for (const option of getLayerOptionElements()) {
      if (!option.dataset.layerId) continue;
      const active = option.dataset.layerId === value;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
    }
  }

  function updateLayerMenuState() {
    updateLayerControlSelection();
    for (const option of getLayerOptionElements()) {
      if (option.dataset.overlayId === "approach") {
        option.classList.toggle("is-active", approachLayerEnabled);
        option.setAttribute("aria-checked", approachLayerEnabled ? "true" : "false");
      }
      if (option.dataset.approachFilter) {
        const active = option.dataset.approachFilter === approachFilter;
        option.classList.toggle("is-active", active);
        option.setAttribute("aria-checked", active ? "true" : "false");
      }
    }
  }

  function updateBasemapUi(basemap = activeBasemap) {
    updateLayerControlSelection(hasUserBasemapPreference ? basemap.id : CAMERA_MAP_BASEMAP_AUTO_ID);
    attribution.href = basemap.attributionUrl;
    attribution.textContent = t(basemap.attributionKey);
    attribution.dataset.i18n = basemap.attributionKey;
  }

  function createReadyPromise() {
    readyPromise = new Promise((resolve) => {
      resolveReadyPromise = resolve;
    });
    return readyPromise;
  }

  function resolveReady() {
    resolveReadyPromise?.();
    resolveReadyPromise = null;
    if (!readyPromise) readyPromise = Promise.resolve();
  }

  function resizeMap() {
    if (!map || panel.hidden) return;
    try {
      map.resize?.();
    } catch {
      // Resize is best effort across synthetic test maps.
    }
  }

  function getPanelBounds() {
    const rect = panel.getBoundingClientRect?.() || {};
    const width = Math.round(rect.width || panel.offsetWidth || pxToNumber(panel.style.width, 720));
    const height = Math.round(rect.height || panel.offsetHeight || pxToNumber(panel.style.height, 520));
    const left = pxToNumber(panel.style.left, Number.isFinite(rect.left) ? rect.left : 0);
    const top = pxToNumber(panel.style.top, Number.isFinite(rect.top) ? rect.top : 0);
    return {
      left,
      top,
      width,
      height,
    };
  }

  function clampResizeBounds(width, height, bounds = getPanelBounds()) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
    const maxWidth = Math.max(240, viewportWidth - bounds.left - RESIZE_MARGIN_PX);
    const maxHeight = Math.max(240, viewportHeight - bounds.top - RESIZE_MARGIN_PX);
    const minWidth = Math.min(RESIZE_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(RESIZE_MIN_HEIGHT, maxHeight);
    return {
      left: bounds.left,
      top: bounds.top,
      width: Math.round(clampNumber(width, minWidth, maxWidth)),
      height: Math.round(clampNumber(height, minHeight, maxHeight)),
    };
  }

  function applyPanelResize(width, height, { flush = false } = {}) {
    if (isFullscreenActive()) return;
    const bounds = clampResizeBounds(width, height);
    panel.style.position = "fixed";
    panel.style.left = `${Math.round(bounds.left)}px`;
    panel.style.top = `${Math.round(bounds.top)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${bounds.width}px`;
    panel.style.height = `${bounds.height}px`;
    shellManager.updateWindowBounds(CAMERA_MAP_WINDOW_ID, bounds, { flush });
    resizeMap();
  }

  function applyHandleResize() {
    resizeRafId = 0;
    if (!resizeInProgress || isFullscreenActive()) return;
    const dx = resizeLastX - resizeStartX;
    const dy = resizeLastY - resizeStartY;
    applyPanelResize(resizeStartWidth + dx, resizeStartHeight + dy);
  }

  function scheduleHandleResize() {
    if (resizeRafId) return;
    resizeRafId = window.requestAnimationFrame?.(applyHandleResize) || window.setTimeout(applyHandleResize, 0);
  }

  function endHandleResize(event = null) {
    if (event && resizePointerId !== null && event.pointerId !== resizePointerId) return;
    if (resizeRafId) {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(resizeRafId);
      } else {
        window.clearTimeout(resizeRafId);
      }
      resizeRafId = 0;
      applyHandleResize();
    }
    if (!resizeInProgress) return;
    resizeInProgress = false;
    resizePointerId = null;
    panel.classList.remove("is-resizing");
    document.documentElement.classList.remove("vb-floating-drag-active");
    const bounds = getPanelBounds();
    shellManager.updateWindowBounds(CAMERA_MAP_WINDOW_ID, bounds, { flush: true });
    resizeMap();
  }

  function resizePanelBy(deltaWidth, deltaHeight) {
    const bounds = getPanelBounds();
    applyPanelResize(bounds.width + deltaWidth, bounds.height + deltaHeight, { flush: true });
  }

  function readMapView() {
    if (!map) return null;
    const centerValue = map.getCenter?.();
    const center = Array.isArray(centerValue)
      ? centerValue
      : Number.isFinite(Number(centerValue?.lng)) && Number.isFinite(Number(centerValue?.lat))
        ? [Number(centerValue.lng), Number(centerValue.lat)]
        : null;
    const zoom = Number(map.getZoom?.());
    const bearing = Number(map.getBearing?.());
    const pitch = Number(map.getPitch?.());
    return {
      ...(center ? { center } : {}),
      ...(Number.isFinite(zoom) ? { zoom } : {}),
      ...(Number.isFinite(bearing) ? { bearing } : {}),
      ...(Number.isFinite(pitch) ? { pitch } : {}),
    };
  }

  function restoreMapView(view) {
    if (!map?.jumpTo || !view || Object.keys(view).length === 0) return;
    suppressViewportRefresh = true;
    try {
      map.jumpTo(view);
    } catch {
      // The map will usually preserve camera state across setStyle anyway.
    } finally {
      window.setTimeout(() => {
        suppressViewportRefresh = false;
      }, 0);
    }
  }

  function onceMapEvent(eventName, handler) {
    if (!map?.on) return;
    if (typeof map.once === "function") {
      map.once(eventName, handler);
      return;
    }
    const wrapped = (...args) => {
      map?.off?.(eventName, wrapped);
      handler(...args);
    };
    map.on(eventName, wrapped);
  }

  function startResizeObserver() {
    if (resizeObserver || typeof ResizeObserver !== "function") return;
    resizeObserver = new ResizeObserver(() => resizeMap());
    resizeObserver.observe(panel);
    resizeObserver.observe(mapEl);
  }

  function stopResizeObserver() {
    resizeObserver?.disconnect?.();
    resizeObserver = null;
  }

  function startColorSchemeListener() {
    if (typeof globalThis.matchMedia !== "function") return;

    try {
      colorSchemeMediaQuery = globalThis.matchMedia(CAMERA_MAP_COLOR_SCHEME_QUERY);
    } catch {
      colorSchemeMediaQuery = null;
      return;
    }

    const handleColorSchemeChange = () => {
      if (destroyed || hasUserBasemapPreference) return;
      switchBasemap(getDefaultCameraMapBasemapId(), { persist: false });
    };

    if (typeof colorSchemeMediaQuery.addEventListener === "function") {
      colorSchemeMediaQuery.addEventListener("change", handleColorSchemeChange);
      cleanupColorSchemeListener = () => {
        colorSchemeMediaQuery?.removeEventListener?.("change", handleColorSchemeChange);
        colorSchemeMediaQuery = null;
      };
      return;
    }

    if (typeof colorSchemeMediaQuery.addListener === "function") {
      colorSchemeMediaQuery.addListener(handleColorSchemeChange);
      cleanupColorSchemeListener = () => {
        colorSchemeMediaQuery?.removeListener?.(handleColorSchemeChange);
        colorSchemeMediaQuery = null;
      };
    }
  }

  function isFullscreenActive() {
    return isNativeFullscreen || isFallbackFullscreen;
  }

  function updateFullscreenButton() {
    const active = isFullscreenActive();
    const label = active ? t("cameraMapExitFullscreen") : t("cameraMapFullscreen");
    const iconEl = fullscreenBtn.querySelector(".btn-icon");
    if (iconEl) iconEl.innerHTML = active ? IconFullscreenExit : IconFullscreen;
    fullscreenBtn.setAttribute("aria-label", label);
    fullscreenBtn.setAttribute("title", label);
    fullscreenBtn.dataset.fullscreen = active ? "true" : "false";
  }

  function syncShellBoundsBeforeFullscreen() {
    const record = shellManager.getWindow?.(CAMERA_MAP_WINDOW_ID);
    if (record?.state === "fullscreen") return record;
    const bounds = getPanelBounds();
    return shellManager.updateWindowBounds?.(CAMERA_MAP_WINDOW_ID, bounds, {
      persist: false,
      preserveSnap: true,
    }) || record;
  }

  function enterShellFullscreen() {
    syncShellBoundsBeforeFullscreen();
    return shellManager.fullscreenWindow?.(CAMERA_MAP_WINDOW_ID, { persist: false });
  }

  function exitShellFullscreen() {
    return shellManager.exitFullscreenWindow?.(CAMERA_MAP_WINDOW_ID, { persist: false });
  }

  function resizeAfterFullscreenTransition() {
    resizeMap();
    window.clearTimeout(fullscreenResizeTimer);
    fullscreenResizeTimer = window.setTimeout(() => {
      resizeMap();
      queueRefresh();
    }, 120);
  }

  function enterFallbackFullscreen() {
    enterShellFullscreen();
    isFallbackFullscreen = true;
    panel.classList.add("is-fullscreen", "is-window-fullscreen");
    updateFullscreenButton();
    resizeAfterFullscreenTransition();
  }

  function exitFallbackFullscreen() {
    if (!isFallbackFullscreen) return;
    isFallbackFullscreen = false;
    panel.classList.remove("is-window-fullscreen");
    if (!isNativeFullscreen) {
      panel.classList.remove("is-fullscreen");
    }
    exitShellFullscreen();
    updateFullscreenButton();
    resizeAfterFullscreenTransition();
  }

  async function enterFullscreen() {
    enterShellFullscreen();
    if (typeof panel.requestFullscreen === "function") {
      try {
        await panel.requestFullscreen();
        if (document.fullscreenElement === panel) {
          isNativeFullscreen = true;
          isFallbackFullscreen = false;
          panel.classList.add("is-fullscreen");
          panel.classList.remove("is-window-fullscreen");
          updateFullscreenButton();
          resizeAfterFullscreenTransition();
          return;
        }
      } catch {
        // Fall back to a fixed viewport-sized shell window.
      }
    }
    enterFallbackFullscreen();
  }

  async function exitFullscreenMode() {
    if (isFallbackFullscreen) {
      exitFallbackFullscreen();
      return;
    }
    if (document.fullscreenElement === panel && typeof document.exitFullscreen === "function") {
      try {
        await document.exitFullscreen();
      } catch {
        // Manual state reset below keeps the shell usable if the browser rejects.
      }
    }
    if (isNativeFullscreen) {
      isNativeFullscreen = false;
      panel.classList.remove("is-fullscreen");
      exitShellFullscreen();
      updateFullscreenButton();
      resizeAfterFullscreenTransition();
    }
  }

  async function toggleFullscreen() {
    if (isFullscreenActive() || document.fullscreenElement === panel) {
      await exitFullscreenMode();
      return;
    }
    await enterFullscreen();
  }

  function onFullscreenChange() {
    const wasNativeFullscreen = isNativeFullscreen;
    isNativeFullscreen = document.fullscreenElement === panel;
    if (isNativeFullscreen) {
      if (shellManager.getWindow?.(CAMERA_MAP_WINDOW_ID)?.state !== "fullscreen") {
        enterShellFullscreen();
      }
      isFallbackFullscreen = false;
      panel.classList.remove("is-window-fullscreen");
    }
    panel.classList.toggle("is-fullscreen", isNativeFullscreen || isFallbackFullscreen);
    if (wasNativeFullscreen && !isNativeFullscreen && !isFallbackFullscreen) {
      exitShellFullscreen();
    }
    updateFullscreenButton();
    resizeAfterFullscreenTransition();
  }

  function exitFullscreenBeforeHide() {
    if (isFallbackFullscreen) {
      exitFallbackFullscreen();
    }
    if (document.fullscreenElement === panel && typeof document.exitFullscreen === "function") {
      document.exitFullscreen().catch(() => {});
    } else if (isNativeFullscreen) {
      isNativeFullscreen = false;
      panel.classList.remove("is-fullscreen");
      exitShellFullscreen();
      updateFullscreenButton();
      resizeAfterFullscreenTransition();
    }
  }

  function hasMapLayer(id) {
    return Boolean(map?.getLayer?.(id));
  }

  function getUserPositionFeatureCollection() {
    return {
      type: "FeatureCollection",
      features: currentUserPositionFeature ? [currentUserPositionFeature] : [],
    };
  }

  function addUserPositionLayers() {
    if (!map) return;

    if (!map.getSource?.(USER_POSITION_SOURCE_ID)) {
      map.addSource?.(USER_POSITION_SOURCE_ID, {
        type: "geojson",
        data: getUserPositionFeatureCollection(),
      });
    }

    if (!hasMapLayer(USER_POSITION_ACCURACY_LAYER_ID)) {
      map.addLayer?.({
        id: USER_POSITION_ACCURACY_LAYER_ID,
        type: "circle",
        source: USER_POSITION_SOURCE_ID,
        paint: {
          "circle-color": ["case", ["get", "stale"], "#f59e0b", "#22c55e"],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "accuracy"], 24],
            0,
            18,
            50,
            26,
            200,
            44,
            1000,
            72,
          ],
          "circle-opacity": ["case", ["get", "stale"], 0.12, 0.16],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 0.42,
          "circle-stroke-width": 1,
        },
      });
    }

    if (!hasMapLayer(USER_POSITION_GLOW_LAYER_ID)) {
      map.addLayer?.({
        id: USER_POSITION_GLOW_LAYER_ID,
        type: "circle",
        source: USER_POSITION_SOURCE_ID,
        paint: {
          "circle-color": ["case", ["get", "stale"], "#f59e0b", "#22c55e"],
          "circle-radius": ["case", ["get", "stale"], 18, 20],
          "circle-opacity": ["case", ["get", "stale"], 0.34, 0.5],
          "circle-blur": 0.45,
        },
      });
    }

    if (!hasMapLayer(USER_POSITION_DOT_LAYER_ID)) {
      map.addLayer?.({
        id: USER_POSITION_DOT_LAYER_ID,
        type: "circle",
        source: USER_POSITION_SOURCE_ID,
        paint: {
          "circle-color": ["case", ["get", "stale"], "#9ca3af", "#19e36a"],
          "circle-radius": 8.5,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": ["case", ["get", "stale"], 0.72, 1],
        },
      });
    }

    if (!hasMapLayer(USER_POSITION_HEADING_LAYER_ID)) {
      map.addLayer?.({
        id: USER_POSITION_HEADING_LAYER_ID,
        type: "symbol",
        source: USER_POSITION_SOURCE_ID,
        filter: ["==", ["get", "headingAvailable"], true],
        layout: {
          "text-field": "▲",
          "text-size": 28,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-rotation-alignment": "map",
          "text-pitch-alignment": "map",
          "text-rotate": ["get", "heading"],
          "text-offset": [0, -0.68],
          "text-anchor": "center",
        },
        paint: {
          "text-color": "#19e36a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2.2,
          "text-opacity": ["case", ["get", "headingAvailable"], 1, 0],
        },
      });
    }

    map.getSource?.(USER_POSITION_SOURCE_ID)?.setData?.(getUserPositionFeatureCollection());
  }

  function setUserPositionFeature(feature) {
    currentUserPositionFeature = feature;
    const source = map?.getSource?.(USER_POSITION_SOURCE_ID);
    source?.setData?.(getUserPositionFeatureCollection());
  }

  function bindCameraLayerEvents() {
    if (cameraLayerEventsBound || !map?.on) return;
    cameraLayerEventsBound = true;

    map.on("click", CAMERA_POINT_LAYER_ID, (event) => {
      const feature = event?.features?.[0];
      const coordinates = feature?.geometry?.coordinates;
      if (!feature || !Array.isArray(coordinates) || !maplibregl?.Popup) return;
      const resolvedDetails = resolveCameraDetailsForFeature(feature);
      const popupFeature = resolvedDetails?.feature || feature;
      const decision = currentLivePosition
        ? evaluateCameraFeatureApproachDecision(popupFeature, {
          ...currentLivePosition,
          previousPosition: previousLivePosition,
        }, getApproachMatcherOptions())
        : null;
      if (decision) {
        lastApproachDecision = decision;
        updateCurrentMatchLayer(decision);
        renderApproachPanel();
      }
      setSelectedCameraDetails(resolvedDetails);
      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(coordinates)
        .setHTML(buildPopupHtml(popupFeature, {
          includeApproachVisualization: approachLayerEnabled,
          currentDecision: decision,
          approachDetails: resolvedDetails,
        }))
        .addTo(map);
      popup?.on?.("close", clearSelectedCameraDetails);
    });

    map.on("mouseenter", CAMERA_POINT_LAYER_ID, () => {
      if (map?.getCanvas?.()) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", CAMERA_POINT_LAYER_ID, () => {
      if (map?.getCanvas?.()) map.getCanvas().style.cursor = "";
    });
  }

  function addCameraLayers() {
    if (!map) return;

    if (!map.getSource?.(CAMERA_SOURCE_ID)) {
      map.addSource?.(CAMERA_SOURCE_ID, {
        type: "geojson",
        data: getEmptyFeatureCollection(),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 13,
      });
    }

    if (!map.getSource?.(CAMERA_APPROACH_SOURCE_ID)) {
      map.addSource?.(CAMERA_APPROACH_SOURCE_ID, {
        type: "geojson",
        data: getEmptyFeatureCollection(),
      });
    }

    if (!map.getSource?.(CAMERA_SELECTED_APPROACH_SOURCE_ID)) {
      map.addSource?.(CAMERA_SELECTED_APPROACH_SOURCE_ID, {
        type: "geojson",
        data: getEmptyFeatureCollection(),
      });
    }

    if (!map.getSource?.(CAMERA_CURRENT_APPROACH_SOURCE_ID)) {
      map.addSource?.(CAMERA_CURRENT_APPROACH_SOURCE_ID, {
        type: "geojson",
        data: getEmptyFeatureCollection(),
      });
    }

    if (!hasMapLayer(CAMERA_CLUSTER_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CLUSTER_LAYER_ID,
        type: "circle",
        source: CAMERA_SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#fbbf24",
            50,
            "#fb923c",
            200,
            "#ef4444",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            17,
            50,
            22,
            200,
            28,
          ],
          "circle-opacity": 0.9,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 1.5,
        },
      });
    }

    if (!hasMapLayer(CAMERA_CLUSTER_COUNT_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CLUSTER_COUNT_LAYER_ID,
        type: "symbol",
        source: CAMERA_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#111827",
        },
      });
    }

    if (!hasMapLayer(CAMERA_POINT_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_POINT_LAYER_ID,
        type: "circle",
        source: CAMERA_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "case",
            ["==", ["get", "approachAmbiguous"], true],
            "#a855f7",
            ["==", ["get", "approachCount"], 0],
            "#9ca3af",
            ["==", ["get", "approachConfidenceSummary"], "low"],
            "#f97316",
            "#f59e0b",
          ],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            5.5,
            14,
            7.5,
          ],
          "circle-opacity": 0.95,
          "circle-stroke-color": [
            "case",
            ["==", ["get", "approachAmbiguous"], true],
            "#7e22ce",
            ["==", ["get", "approachCount"], 0],
            "#374151",
            "#111827",
          ],
          "circle-stroke-width": [
            "case",
            ["==", ["get", "approachAmbiguous"], true],
            2.4,
            ["==", ["get", "approachCount"], 0],
            2,
            1.4,
          ],
        },
      });
    }

    if (!hasMapLayer(CAMERA_APPROACH_FALLBACK_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_APPROACH_FALLBACK_LAYER_ID,
        type: "fill",
        source: CAMERA_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "fallback-radius"],
        paint: {
          "fill-color": "#f97316",
          "fill-opacity": [
            "case",
            ["==", ["get", "ambiguous"], true],
            0.13,
            0.09,
          ],
          "fill-outline-color": "#ea580c",
        },
      });
    }

    if (!hasMapLayer(CAMERA_APPROACH_SEGMENT_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_APPROACH_SEGMENT_LAYER_ID,
        type: "line",
        source: CAMERA_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "corridor"],
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "ambiguous"], true],
            "#a855f7",
            [
              "match",
              ["get", "confidence"],
              "high",
              "#10b981",
              "medium",
              "#f59e0b",
              "low",
              "#ef4444",
              "#60a5fa",
            ],
          ],
          "line-width": [
            "case",
            ["==", ["get", "role"], "primary"],
            4.5,
            [
              "match",
              ["get", "confidence"],
              "high",
              4,
              "medium",
              3.2,
              2.4,
            ],
          ],
          "line-opacity": [
            "match",
            ["get", "confidence"],
            "high",
            0.9,
            "medium",
            0.78,
            0.58,
          ],
          "line-dasharray": [
            "case",
            ["any", ["==", ["get", "ambiguous"], true], ["==", ["get", "confidence"], "low"]],
            ["literal", [1.2, 1]],
            ["literal", [1, 0]],
          ],
        },
      });
    }

    if (!hasMapLayer(CAMERA_APPROACH_BEARING_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_APPROACH_BEARING_LAYER_ID,
        type: "line",
        source: CAMERA_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "direction"],
        paint: {
          "line-color": [
            "match",
            ["get", "direction"],
            "forward",
            "#22c55e",
            "backward",
            "#3b82f6",
            "#a855f7",
          ],
          "line-width": [
            "case",
            ["==", ["get", "role"], "primary"],
            3,
            2.3,
          ],
          "line-opacity": 0.9,
          "line-dasharray": [1.2, 1],
        },
      });
    }

    if (!hasMapLayer(CAMERA_SELECTED_APPROACH_FALLBACK_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_SELECTED_APPROACH_FALLBACK_LAYER_ID,
        type: "fill",
        source: CAMERA_SELECTED_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "fallback-radius"],
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.18,
          "fill-outline-color": "#92400e",
        },
      });
    }

    if (!hasMapLayer(CAMERA_SELECTED_APPROACH_CORRIDOR_BAND_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_SELECTED_APPROACH_CORRIDOR_BAND_LAYER_ID,
        type: "line",
        source: CAMERA_SELECTED_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "corridor"],
        paint: {
          "line-color": "#ffffff",
          "line-width": 10,
          "line-opacity": 0.58,
        },
      });
    }

    if (!hasMapLayer(CAMERA_SELECTED_APPROACH_CORRIDOR_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_SELECTED_APPROACH_CORRIDOR_LAYER_ID,
        type: "line",
        source: CAMERA_SELECTED_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "corridor"],
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "ambiguous"], true],
            "#a855f7",
            [
              "match",
              ["get", "confidence"],
              "high",
              "#059669",
              "medium",
              "#d97706",
              "low",
              "#dc2626",
              "#2563eb",
            ],
          ],
          "line-width": [
            "case",
            ["==", ["get", "isMatched"], true],
            6.5,
            5,
          ],
          "line-opacity": 0.95,
          "line-dasharray": [
            "case",
            ["any", ["==", ["get", "ambiguous"], true], ["==", ["get", "confidence"], "low"]],
            ["literal", [1.3, 0.8]],
            ["literal", [1, 0]],
          ],
        },
      });
    }

    if (!hasMapLayer(CAMERA_SELECTED_APPROACH_DIRECTION_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_SELECTED_APPROACH_DIRECTION_LAYER_ID,
        type: "line",
        source: CAMERA_SELECTED_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "direction"],
        paint: {
          "line-color": [
            "match",
            ["get", "direction"],
            "forward",
            "#16a34a",
            "backward",
            "#2563eb",
            "#7c3aed",
          ],
          "line-width": 4,
          "line-opacity": 0.96,
          "line-dasharray": [1.2, 0.8],
        },
      });
    }

    if (!hasMapLayer(CAMERA_CURRENT_APPROACH_FALLBACK_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CURRENT_APPROACH_FALLBACK_LAYER_ID,
        type: "fill",
        source: CAMERA_CURRENT_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "fallback-radius"],
        paint: {
          "fill-color": "#2563eb",
          "fill-opacity": 0.18,
          "fill-outline-color": "#1d4ed8",
        },
      });
    }

    if (!hasMapLayer(CAMERA_CURRENT_APPROACH_CORRIDOR_BAND_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CURRENT_APPROACH_CORRIDOR_BAND_LAYER_ID,
        type: "line",
        source: CAMERA_CURRENT_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "corridor"],
        paint: {
          "line-color": "#ffffff",
          "line-width": 13,
          "line-opacity": 0.68,
        },
      });
    }

    if (!hasMapLayer(CAMERA_CURRENT_APPROACH_CORRIDOR_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CURRENT_APPROACH_CORRIDOR_LAYER_ID,
        type: "line",
        source: CAMERA_CURRENT_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "corridor"],
        paint: {
          "line-color": "#2563eb",
          "line-width": 7,
          "line-opacity": 0.98,
        },
      });
    }

    if (!hasMapLayer(CAMERA_CURRENT_APPROACH_DIRECTION_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CURRENT_APPROACH_DIRECTION_LAYER_ID,
        type: "line",
        source: CAMERA_CURRENT_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "direction"],
        paint: {
          "line-color": "#1d4ed8",
          "line-width": 4.8,
          "line-opacity": 0.98,
          "line-dasharray": [1, 0.65],
        },
      });
    }

    if (!hasMapLayer(CAMERA_CURRENT_APPROACH_BEARING_LAYER_ID)) {
      map.addLayer?.({
        id: CAMERA_CURRENT_APPROACH_BEARING_LAYER_ID,
        type: "line",
        source: CAMERA_CURRENT_APPROACH_SOURCE_ID,
        filter: ["==", ["get", "kind"], "fallback-bearing"],
        paint: {
          "line-color": "#2563eb",
          "line-width": 2.8,
          "line-opacity": 0.86,
          "line-dasharray": [0.8, 1.2],
        },
      });
    }

    bindCameraLayerEvents();
    updateApproachLayers();
  }

  function setCameraFeatures(features, { cache = true } = {}) {
    const safeFeatures = Array.isArray(features) ? features : [];
    if (cache) currentCameraFeatures = safeFeatures;
    const source = map?.getSource?.(CAMERA_SOURCE_ID);
    source?.setData?.({
      type: "FeatureCollection",
      features: safeFeatures,
    });
    if (
      selectedCameraDetails?.feature
      && !safeFeatures.some((feature) => getFeatureCameraId(feature) === getFeatureCameraId(selectedCameraDetails.feature))
    ) {
      selectedCameraDetails = null;
    }
    updateApproachLayers();
    updateApproachDecision();
    updateSelectedApproachLayer();
  }

  function updateApproachLayers() {
    const source = map?.getSource?.(CAMERA_APPROACH_SOURCE_ID);
    if (!source?.setData) return;
    const collection = approachLayerEnabled
      ? buildCameraApproachFeatureCollection(currentCameraFeatures, {
        filter: approachFilter,
        position: currentLivePosition,
        includeFallback: true,
      })
      : getEmptyFeatureCollection();
    currentApproachFeatureCount = collection.features.length;
    source.setData(collection);
    updateCurrentMatchLayer(lastApproachDecision);
    updateSelectedApproachLayer();
    renderApproachPanel();
  }

  function updateSelectedApproachLayer() {
    const source = map?.getSource?.(CAMERA_SELECTED_APPROACH_SOURCE_ID);
    if (!source?.setData) return;
    const feature = selectedCameraDetails?.feature;
    if (!feature || selectedCameraDetails?.hasUnresolvedApproachDetails === true) {
      source.setData(getEmptyFeatureCollection());
      return;
    }
    source.setData(buildSelectedCameraApproachFeatureCollection(feature, {
      decision: lastApproachDecision?.featureId === getFeatureCameraId(feature) ? lastApproachDecision : null,
      fallbackRadiusM: Math.min(getApproachMatcherOptions().alertDistanceM, CAMERA_APPROACH_FALLBACK_HALO_M),
    }));
  }

  function updateCurrentMatchLayer(decision = lastApproachDecision) {
    const source = map?.getSource?.(CAMERA_CURRENT_APPROACH_SOURCE_ID);
    if (!source?.setData) return;
    if (
      !currentLivePosition
      || currentUserPositionFeature?.properties?.stale === true
      || !Array.isArray(decision?.cameraCoordinates)
      || !isFiniteCoordinatePair(decision.cameraCoordinates)
    ) {
      source.setData(getEmptyFeatureCollection());
      return;
    }

    const shouldShowCurrent = decision.accepted === true
      || decision.state === "approaching"
      || decision.state === "legacy-radius"
      || decision.state === "missing-metadata";
    if (!shouldShowCurrent) {
      source.setData(getEmptyFeatureCollection());
      return;
    }

    const baseFeature = findCameraFeatureById(decision.featureId) || {
      type: "Feature",
      id: decision.featureId || "current-camera",
      geometry: { type: "Point", coordinates: decision.cameraCoordinates },
      properties: {
        osmId: decision.featureId || null,
        speedKph: decision.speedKph ?? null,
        approachCount: Number.isFinite(Number(decision.corridorCount)) ? Number(decision.corridorCount) : 0,
        approachConfidenceSummary: decision.matchedConfidence || decision.confidence || "none",
        approachDirections: decision.matchedDirection || "none",
      },
    };
    const details = resolveCameraDetailsForFeature(baseFeature);
    const feature = details?.feature || baseFeature;
    const matchedApproachIndex = Number.isFinite(Number(decision.matchedApproachIndex))
      ? Number(decision.matchedApproachIndex)
      : null;
    const hasApproaches = parseApproachJson(feature?.properties?.approachJson).length > 0;
    source.setData({
      type: "FeatureCollection",
      features: details?.hasUnresolvedApproachDetails === true
        ? []
        : buildApproachVisualizationFeaturesForCamera(feature, {
          mode: "current",
          decision,
          position: currentLivePosition,
          onlyMatched: hasApproaches && matchedApproachIndex !== null,
          includeFallback: true,
          fallbackRadiusM: Math.min(getApproachMatcherOptions().alertDistanceM, CAMERA_APPROACH_FALLBACK_HALO_M),
        }),
    });
  }

  function readCurrentPosition(now = Date.now()) {
    const servicePosition = gpsService?.getCurrentPosition?.();
    if (servicePosition) return normalizeLivePosition(servicePosition, now);
    const reader = getCurrentPosition || (() => (
      window.__vatioboardGpsGetCurrentPosition?.()
      || window.__vatioboardSpeedGetCurrentPosition?.()
      || null
    ));
    return normalizeLivePosition(reader?.(), now);
  }

  function readCurrentOrCachedPosition(now = Date.now()) {
    return readCurrentPosition(now) || normalizeLivePosition(currentLivePosition, now);
  }

  function reapplyNavigationFromLatestPosition({ now = Date.now(), source = "reopen" } = {}) {
    if (destroyed || panel.hidden || !mapReady) return null;
    return updatePosition(readCurrentOrCachedPosition(now), { now, source });
  }

  function maybeEnableDriveNavigationFromCurrentPosition({ force = false } = {}) {
    if (initialNavigationDefaultMode === "browse" && !force) return false;
    if (!autoEnableFollowFromSpeed && !force) return false;
    if (hasUserFollowPreference && !followEnabled && !force && initialNavigationDefaultMode !== "drive") return false;
    const position = readCurrentPosition();
    if (!position) {
      if (initialNavigationDefaultMode === "drive" || force) setNavigationStatus({ status: "gps-unavailable" });
      return false;
    }
    navigationMode = "drive";
    followEnabled = true;
    followPaused = false;
    updateNavigationButtons();
    return true;
  }

  function handleSpeedPositionEvent(event) {
    if (destroyed || panel.hidden) return;
    const detail = event.detail?.normalized || event.detail;
    updatePosition(detail, {
      now: Date.now(),
      source: event.type === "vatioboard:gps-position" ? "gps-event" : "speed-event",
    });
  }

  function startSpeedPositionEvents() {
    if (speedPositionListenerActive) return;
    speedPositionListenerActive = true;
    gpsConsumerCleanup = gpsService?.startConsumer?.("camera-map", {
      enableHighAccuracy: true,
      reason: "camera-map-open",
    }) || null;
    gpsSnapshotUnsubscribe = gpsService?.subscribe?.((snapshot) => {
      if (destroyed || panel.hidden || !snapshot?.normalized) return;
      updatePosition(snapshot.normalized, { now: Date.now(), source: "gps-service" });
    }) || null;
    window.addEventListener("vatioboard:gps-position", handleSpeedPositionEvent);
    window.addEventListener("vatioboard:speed-position", handleSpeedPositionEvent);
  }

  function stopSpeedPositionEvents() {
    if (!speedPositionListenerActive) return;
    speedPositionListenerActive = false;
    window.removeEventListener("vatioboard:gps-position", handleSpeedPositionEvent);
    window.removeEventListener("vatioboard:speed-position", handleSpeedPositionEvent);
    gpsSnapshotUnsubscribe?.();
    gpsSnapshotUnsubscribe = null;
    gpsConsumerCleanup?.();
    gpsConsumerCleanup = null;
  }

  function featurePosition(feature) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return { longitude, latitude };
  }

  function cameraFeatureKey(feature, index = 0) {
    return String(feature?.id || feature?.properties?.osmId || `${feature?.properties?.country || "camera"}:${index}`);
  }

  function findRelevantCamera(position, headingState) {
    if (!position || currentCameraFeatures.length === 0) return null;
    const origin = { latitude: position.latitude, longitude: position.longitude };
    const heading = headingState?.headingAvailable ? headingState.heading : null;
    const candidates = currentCameraFeatures
      .map((feature, index) => {
        const cameraPosition = featurePosition(feature);
        if (!cameraPosition) return null;
        const target = { latitude: cameraPosition.latitude, longitude: cameraPosition.longitude };
        const distance = distanceMeters(origin, target);
        const bearing = bearingDegrees(origin, target);
        const headingDelta = heading === null ? Infinity : angularDifferenceDegrees(heading, bearing);
        return {
          feature,
          index,
          key: cameraFeatureKey(feature, index),
          coordinates: [cameraPosition.longitude, cameraPosition.latitude],
          distance,
          bearing,
          ahead: heading !== null && headingDelta <= CAMERA_AHEAD_ANGLE_DEGREES,
          headingDelta,
        };
      })
      .filter(Boolean)
      .filter((candidate) => Number.isFinite(candidate.distance));

    const ahead = candidates
      .filter((candidate) => candidate.ahead && candidate.distance >= 25 && candidate.distance <= CAMERA_LOOKAHEAD_M)
      .sort((a, b) => a.distance - b.distance)[0];
    if (ahead) return ahead;

    return candidates
      .filter((candidate) => candidate.distance >= 25 && candidate.distance <= CAMERA_LOOKAHEAD_M)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

  function executeNavigationCameraCommand(command) {
    if (!map || !command || command.method === "none") return command;
    lastCameraCommand = command;
    navigationCameraState = {
      ...navigationCameraState,
      latestBearingApplied: Number.isFinite(command.bearing) ? command.bearing : navigationCameraState.latestBearingApplied,
      latestHeading: command.latestHeading ?? navigationCameraState.latestHeading,
      headingAvailable: command.headingAvailable === true,
      headingSource: command.headingSource || "none",
      lastCameraCommandReason: command.reason || "following",
      lastCommandAtMs: Date.now(),
      lastCameraKey: command.relevantCameraKey || navigationCameraState.lastCameraKey,
      lastCameraDistance: Number.isFinite(command.relevantCameraDistance)
        ? command.relevantCameraDistance
        : navigationCameraState.lastCameraDistance,
    };

    const movement = {
      center: command.center,
      zoom: command.zoom,
      bearing: command.bearing,
      pitch: command.pitch ?? 0,
      offset: command.offset,
      duration: command.duration,
      essential: true,
      ...(command.padding ? { padding: command.padding } : {}),
    };

    runProgrammaticCameraMove(() => {
      if (command.method === "jumpTo" && map.jumpTo) {
        map.jumpTo(movement);
      } else if (map.easeTo) {
        map.easeTo(movement);
      } else if (map.jumpTo) {
        map.jumpTo(movement);
      }
    });

    if (command.reason === "heading-unavailable") {
      setNavigationStatus({ status: "heading-unavailable" });
    } else if (command.reason === "camera-ahead") {
      setNavigationStatus({ status: "camera-ahead", distance: `${Math.round(command.relevantCameraDistance || 0)} m` });
    } else {
      setNavigationStatus({ status: "following" });
    }

    if (command.shouldRefreshViewport) queueRefresh();
    return command;
  }

  function maybeAutoSelectHeadingUp(position, headingState) {
    if (hasUserOrientationPreference || orientationMode === "heading-up") return;
    if (navigationMode !== "drive" || !followEnabled || followPaused) return;
    if (headingState?.headingAvailable !== true) return;
    if ((position?.speedMs ?? 0) < 1.5) return;
    orientationMode = "heading-up";
    updateNavigationButtons();
  }

  function applyFollowCamera(position, headingState, { now = Date.now() } = {}) {
    if (!map || currentUserPositionFeature?.properties?.stale) return null;
    if (!shouldUseNavigationCamera({
      followEnabled,
      followPaused,
      panelVisible: !panel.hidden,
      mapReady,
      position,
      navigationMode,
    })) return null;

    const relevantCamera = autoFrameCamera ? findRelevantCamera(position, headingState) : null;
    const command = computeNavigationCameraUpdate({
      position,
      headingState,
      previousCameraState: navigationCameraState,
      orientationMode,
      navigationMode,
      relevantCamera,
      mapSize: getMapSize(),
      currentZoom: map.getZoom?.(),
      currentBearing: map.getBearing?.(),
      currentPitch: map.getPitch?.(),
      now,
    });
    return executeNavigationCameraCommand(command);
  }

  function updatePosition(input, { now = Date.now(), source = "manual" } = {}) {
    const position = normalizeLivePosition(input === undefined ? readCurrentPosition(now) : input, now);
    if (!position) {
      if (followEnabled) setNavigationStatus({ status: "gps-unavailable" });
      debugCameraGps("position-rejected", {
        source,
        input,
        followEnabled,
        followPaused,
      });
      return null;
    }

    const headingState = shouldShowHeading(position, previousLivePosition, lastHeadingState, now);
    if (headingState.headingAvailable) lastHeadingState = headingState;
    const feature = buildUserPositionFeature(position, headingState, now);
    previousLivePosition = currentLivePosition || position;
    currentLivePosition = position;
    setUserPositionFeature(feature);
    updateApproachDecision(position);
    updateApproachLayers();
    maybeAutoSelectHeadingUp(position, headingState);
    debugCameraGps("position-update", {
      source,
      latitude: position.latitude,
      longitude: position.longitude,
      timestampMs: position.timestampMs,
      receivedAtMs: position.receivedAtMs,
      lastCallbackAtMs: position.lastCallbackAtMs,
      freshnessTimestampMs: position.freshnessTimestampMs,
      stale: feature?.properties?.stale ?? null,
      heading: headingState.heading,
      headingAvailable: headingState.headingAvailable,
      speed: position.speedMs,
      followEnabled,
      followPaused,
      navigationMode,
      orientationMode,
    });

    if (feature?.properties?.stale) {
      setNavigationStatus({ status: "gps-stale" });
      return feature;
    }

    if (followEnabled && !followPaused) {
      applyFollowCamera(position, headingState, { now });
    } else if (!navigationStatus || ["gps-stale", "gps-unavailable", "following", "heading-unavailable"].includes(navigationStatus.status)) {
      setNavigationStatus({ status: "gps-live" });
    }
    return feature;
  }

  function applyProjection() {
    if (!map?.setProjection) return;
    const zoom = Number(map.getZoom?.());
    let nextProjection = activeProjection || "mercator";
    if (projectionMode === "globe") nextProjection = "globe";
    else if (projectionMode === "flat") nextProjection = "mercator";
    else if (Number.isFinite(zoom)) {
      if (zoom <= 3.5) nextProjection = "globe";
      else if (zoom >= 4.5) nextProjection = "mercator";
    }
    if (nextProjection === activeProjection) return;
    activeProjection = nextProjection;
    try {
      map.setProjection(nextProjection);
      addCameraLayers();
      setCameraFeatures(currentCameraFeatures, { cache: false });
      addUserPositionLayers();
    } catch {
      // Projection support varies by MapLibre build; navigation remains usable.
    }
  }

  function restoreCameraLayersAfterStyle(version, view) {
    if (destroyed || version !== basemapStyleVersion || !map) return;
    basemapSwitchInProgress = false;
    addCameraLayers();
    setCameraFeatures(currentCameraFeatures, { cache: false });
    addUserPositionLayers();
    restoreMapView(view);
    applyProjection();
    resizeMap();
  }

  function switchBasemap(nextBasemapId, { persist = true } = {}) {
    const nextBasemap = getCameraMapBasemap(nextBasemapId);
    if (nextBasemap.id === activeBasemap.id) {
      updateBasemapUi(nextBasemap);
      return;
    }

    activeBasemap = nextBasemap;
    updateBasemapUi(nextBasemap);
    if (persist) saveBasemapPreference(nextBasemap.id);

    if (!map) return;

    const view = readMapView();
    const version = ++basemapStyleVersion;

    if (typeof map.setStyle !== "function") {
      addCameraLayers();
      setCameraFeatures(currentCameraFeatures, { cache: false });
      addUserPositionLayers();
      resizeMap();
      return;
    }

    basemapSwitchInProgress = true;
    onceMapEvent("style.load", () => restoreCameraLayersAfterStyle(version, view));

    try {
      map.setStyle(createCameraMapStyle(nextBasemap), { diff: false });
    } catch (error) {
      basemapSwitchInProgress = false;
      updateStatus({ status: "unavailable", error });
    }
  }

  function selectLayerValue(layerId) {
    setLayerMenuOpen(false);
    if (!layerId) return;
    if (layerId === CAMERA_MAP_BASEMAP_AUTO_ID) {
      hasUserBasemapPreference = false;
      clearBasemapPreference();
      switchBasemap(getDefaultCameraMapBasemapId(), { persist: false });
      layerButton.focus();
      return;
    }

    hasUserBasemapPreference = true;
    switchBasemap(layerId);
    layerButton.focus();
  }

  function selectOverlayValue(option) {
    if (option?.dataset?.overlayId === "approach") {
      setApproachLayerEnabled(!approachLayerEnabled);
      return;
    }
    if (option?.dataset?.approachFilter) {
      setApproachFilter(option.dataset.approachFilter);
    }
  }

  function queueRefresh() {
    if (destroyed || panel.hidden || basemapSwitchInProgress || suppressViewportRefresh) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refresh().catch(() => {});
    }, 220);
  }

  function stopPositionPolling() {
    window.clearTimeout(positionPollTimer);
    positionPollTimer = 0;
  }

  function schedulePositionPoll() {
    if (destroyed || panel.hidden || positionPollTimer) return;
    positionPollTimer = window.setTimeout(() => {
      positionPollTimer = 0;
      updatePosition(readCurrentPosition(), { now: Date.now(), source: "poll" });
      schedulePositionPoll();
    }, POSITION_POLL_MS);
  }

  function startPositionPolling() {
    if (destroyed || panel.hidden) return;
    const now = Date.now();
    updatePosition(readCurrentOrCachedPosition(now), { now, source: "poll" });
    schedulePositionPoll();
  }

  async function initMap() {
    if (destroyed || !mapEl) return Promise.resolve();
    if (mapReady) return Promise.resolve();
    if (initPromise) return initPromise;
    if (panel.hidden) return Promise.resolve();

    startResizeObserver();
    createReadyPromise();
    updateStatus({ status: "loading-manifest" });

    initPromise = (async () => {
      try {
        maplibregl = await loadMapLibre();
        if (destroyed || panel.hidden || map) {
          resolveReady();
          return;
        }

        const initialView = getInitialView({ gpsService, getCurrentPosition });
        map = new maplibregl.Map({
          container: mapEl,
          antialias: true,
          attributionControl: false,
          center: initialView.center,
          zoom: initialView.zoom,
          style: createCameraMapStyle(activeBasemap),
        });

        if (maplibregl.NavigationControl) {
          map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
        }

        map.on?.("load", () => {
          if (destroyed || !map) {
            resolveReady();
            return;
          }
          mapReady = true;
          addCameraLayers();
          addUserPositionLayers();
          applyProjection();
          updatePosition(readCurrentPosition(), { now: Date.now(), source: "load" });
          resizeMap();
          refresh().catch(() => {});
          resolveReady();
        });

        map.on?.("moveend", queueRefresh);
        map.on?.("zoomend", () => {
          applyProjection();
          queueRefresh();
        });
        const pauseFollowForManualMove = () => {
          if (programmaticCameraMoveDepth > 0 || Date.now() < suppressManualPauseUntilMs) return;
          if (!followEnabled || followPaused) return;
          followPaused = true;
          navigationMode = "browse";
          updateNavigationButtons();
          setNavigationStatus({ status: "follow-paused" });
        };
        map.on?.("dragstart", pauseFollowForManualMove);
        map.on?.("rotatestart", pauseFollowForManualMove);
        map.on?.("pitchstart", pauseFollowForManualMove);
        map.on?.("zoomstart", pauseFollowForManualMove);
        map.on?.("error", () => {
          basemapErrorCount += 1;
          if (basemapErrorCount >= 3) {
            updateStatus({
              ...(cameraStatus || {}),
              status: "offline-cached",
              featureCount: currentCameraFeatures.length,
              cacheHit: currentCameraFeatures.length > 0,
              offline: true,
            });
          }
        });
      } catch (error) {
        if (!destroyed) {
          updateStatus({ status: "unavailable", error });
        }
        resolveReady();
      }
    })().finally(() => {
      initPromise = null;
    });

    return readyPromise ?? initPromise;
  }

  async function refresh() {
    if (destroyed) return null;
    if (basemapSwitchInProgress) return null;
    if (!map) {
      await initMap();
    }
    if (!map || !mapReady) return null;

    refreshController?.abort();
    refreshController = new AbortController();

    try {
      const result = await cameraDataSource.loadViewport({
        bounds: map.getBounds?.(),
        zoom: map.getZoom?.() ?? 0,
        includeApproachVisualization: approachLayerEnabled,
        signal: refreshController.signal,
      });
      const nextStatus = result?.status || cameraDataSource.getStatus?.();
      const nextFeatures = Array.isArray(result?.features) ? result.features : [];
      const shouldPreserveExisting = currentCameraFeatures.length > 0
        && nextFeatures.length === 0
        && (nextStatus?.offline || nextStatus?.status === "offline-cached" || nextStatus?.status === "unavailable");
      if (!shouldPreserveExisting) {
        setCameraFeatures(nextFeatures);
      }
      updateStatus(nextStatus);
      return result;
    } catch (error) {
      if (error?.name !== "AbortError") {
        updateStatus({
          status: currentCameraFeatures.length > 0 ? "offline-cached" : "unavailable",
          featureCount: currentCameraFeatures.length,
          cacheHit: currentCameraFeatures.length > 0,
          offline: true,
          error,
        });
      }
      return null;
    }
  }

  function focusCurrentLocation() {
    const currentPosition = readCurrentPosition();
    if (!currentPosition) {
      setNavigationStatus({ status: "gps-unavailable" });
      return false;
    }

    if (!map) {
      open();
    }

    const center = [currentPosition.longitude, currentPosition.latitude];
    const currentZoom = Number(map?.getZoom?.());
    const zoom = Number.isFinite(currentZoom) ? Math.max(currentZoom, 12) : 12;

    runProgrammaticCameraMove(() => {
      if (map?.easeTo) {
        map.easeTo({ center, zoom, duration: 450, essential: true });
      } else if (map?.jumpTo) {
        map.jumpTo({ center, zoom });
      }
    });
    queueRefresh();
    return true;
  }

  function resumeFollow() {
    const position = readCurrentPosition();
    if (!position) {
      setNavigationStatus({ status: "gps-unavailable" });
      return false;
    }
    navigationMode = "drive";
    followEnabled = true;
    followPaused = false;
    hasUserFollowPreference = true;
    saveBooleanPreference(FOLLOW_STORAGE_KEY, true);
    updateNavigationButtons();
    updatePosition(position, { now: Date.now(), source: "follow" });
    return true;
  }

  function toggleFollow() {
    if (!followEnabled || followPaused) {
      resumeFollow();
      return;
    }
    followEnabled = false;
    followPaused = false;
    navigationMode = "browse";
    hasUserFollowPreference = true;
    saveBooleanPreference(FOLLOW_STORAGE_KEY, false);
    navigationCameraState = createNavigationCameraState();
    updateNavigationButtons();
    setNavigationStatus(currentLivePosition ? { status: "gps-live" } : null);
  }

  function cycleOrientationMode() {
    orientationMode = orientationMode === "heading-up" ? "north-up" : "heading-up";
    hasUserOrientationPreference = true;
    saveEnumPreference(ORIENTATION_STORAGE_KEY, orientationMode);
    updateNavigationButtons();
    if (followEnabled && currentLivePosition) {
      updatePosition(currentLivePosition, { now: Date.now(), source: "orientation" });
    }
  }

  function setProjectionMode(nextMode) {
    if (!["auto", "flat", "globe"].includes(nextMode)) return projectionMode;
    projectionMode = nextMode;
    saveEnumPreference(PROJECTION_STORAGE_KEY, projectionMode);
    activeProjection = null;
    applyProjection();
    return projectionMode;
  }

  function showPanel({ persist = true }: AnyRecord = {}) {
    panel.hidden = false;
    startResizeObserver();
    startSpeedPositionEvents();
    maybeEnableDriveNavigationFromCurrentPosition();
    startPositionPolling();
    if (persist) saveVisibility(true);
    if (panel.style.left && panel.style.top) {
      clampElementToViewport(panel);
    }
    window.setTimeout(() => {
      resizeMap();
      initMap().then(() => {
        resizeMap();
        reapplyNavigationFromLatestPosition({ source: "reopen" });
        refresh().catch(() => {});
      });
    }, 0);
  }

  function hidePanel({ persist = true }: AnyRecord = {}) {
    exitFullscreenBeforeHide();
    panel.hidden = true;
    if (persist) saveVisibility(false);
    window.clearTimeout(refreshTimer);
    window.clearTimeout(fullscreenResizeTimer);
    stopResizeObserver();
    stopPositionPolling();
    stopSpeedPositionEvents();
    refreshController?.abort();
  }

  function minimizePanel(_options: AnyRecord = {}) {
    exitFullscreenBeforeHide();
    panel.hidden = true;
    window.clearTimeout(refreshTimer);
    window.clearTimeout(fullscreenResizeTimer);
    stopResizeObserver();
    stopPositionPolling();
    stopSpeedPositionEvents();
    refreshController?.abort();
  }

  function open(openOptions: AnyRecord = {}) {
    showPanel(openOptions);
    shellManager.openWindow(CAMERA_MAP_WINDOW_ID, { ...openOptions, invokeLifecycle: false });
  }

  function close(closeOptions: AnyRecord = {}) {
    hidePanel(closeOptions);
    shellManager.closeWindow(CAMERA_MAP_WINDOW_ID, { ...closeOptions, invokeLifecycle: false });
  }

  function minimize(minimizeOptions: AnyRecord = {}) {
    minimizePanel(minimizeOptions);
    shellManager.minimizeWindow(CAMERA_MAP_WINDOW_ID, { ...minimizeOptions, invokeLifecycle: false });
  }

  function restore(restoreOptions: AnyRecord = {}) {
    showPanel(restoreOptions);
    shellManager.restoreWindow(CAMERA_MAP_WINDOW_ID, { ...restoreOptions, invokeLifecycle: false });
  }

  function toggle() {
    panel.hidden ? open() : close();
  }

  function getApproachSnapshot() {
    return {
      approachLayerEnabled,
      approachFilter,
      featureCount: currentCameraFeatures.length,
      approachOverlayFeatureCount: currentApproachFeatureCount,
      cameraStatus: { ...(cameraStatus || {}) },
      navigationStatus: navigationStatus ? { ...navigationStatus } : null,
      currentPosition: currentLivePosition ? { ...currentLivePosition } : null,
      previousPosition: previousLivePosition ? { ...previousLivePosition } : null,
      decision: lastApproachDecision ? { ...lastApproachDecision } : null,
      matcherOptions: getApproachMatcherOptions(),
    };
  }

  const approachGlobal = {
    getSnapshot: getApproachSnapshot,
    setLayerEnabled: (visible) => setApproachLayerEnabled(visible),
    setFilter: (filter) => setApproachFilter(filter),
    refresh: () => refresh(),
  };

  if (typeof window !== "undefined") {
    window.__vatioboardCameraMapApproach = approachGlobal;
  }

  function closeLayerMenuOnDocumentPointerDown(event) {
    if (!layerMenu.hidden && !layerMenu.parentElement?.contains?.(event.target)) {
      setLayerMenuOpen(false);
    }
  }

  function handleCopyReviewInfo(event) {
    const buttonEl = event.target?.closest?.(".camera-map-copy-review");
    if (!buttonEl) return;
    const payload = buttonEl.getAttribute("data-review-payload") || "";
    if (!payload) return;
    event.preventDefault();
    copyTextToClipboard(payload).then((copied) => {
      buttonEl.textContent = copied ? "Copied" : "Copy failed";
    }).catch(() => {
      buttonEl.textContent = "Copy failed";
    });
  }

  function destroy() {
    destroyed = true;
    exitFullscreenBeforeHide();
    window.clearTimeout(refreshTimer);
    window.clearTimeout(fullscreenResizeTimer);
    stopPositionPolling();
    stopSpeedPositionEvents();
    endHandleResize();
    window.removeEventListener("resize", resizeMap);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    document.removeEventListener("pointerdown", closeLayerMenuOnDocumentPointerDown, true);
    document.removeEventListener("click", handleCopyReviewInfo);
    stopResizeObserver();
    cleanupColorSchemeListener();
    cleanupColorSchemeListener = () => {};
    refreshController?.abort();
    cleanupLayer();
    if (button) button.removeEventListener("click", toggle);
    cameraDataSource.destroy?.();
    map?.remove?.();
    map = null;
    mapReady = false;
    if (typeof window !== "undefined" && window.__vatioboardCameraMapApproach === approachGlobal) {
      delete window.__vatioboardCameraMapApproach;
    }
    panel.remove();
  }

  {
    const pos = loadPos();
    panel.style.position = "fixed";
    if (pos?.panel?.left && pos?.panel?.top) {
      panel.style.left = pos.panel.left;
      panel.style.top = pos.panel.top;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    } else {
      panel.style.right = "18px";
      panel.style.bottom = "78px";
    }
  }

  cleanupLayer = registerFloatingPanel(panel, {
    id: CAMERA_MAP_WINDOW_ID,
    kind: "tool",
    title: "Camera Map",
    shellManager,
    storageKey: visibilityKey,
    lazy: true,
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
      fullscreen: true,
      maximizable: true,
      snap: true,
      snapZones: ["left", "right", "top", "bottom", "center", "top-left", "top-right", "bottom-left", "bottom-right"],
    },
    lifecycle: {
      open: showPanel,
      close: hidePanel,
      minimize: minimizePanel,
      restore: showPanel,
    },
  });

  makePanelDraggable({
    panel,
    header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
    shellWindowId: CAMERA_MAP_WINDOW_ID,
    shellManager,
    enableSnapPreview: shellManager.getShellPreference?.("snapEnabled") !== false,
  });

  closeBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  closeBtn.addEventListener("pointerup", (event) => event.stopPropagation());
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  fullscreenBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  fullscreenBtn.addEventListener("pointerup", (event) => event.stopPropagation());
  fullscreenBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFullscreen().catch(() => {});
  });

  speedAlertsBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  speedAlertsBtn.addEventListener("pointerup", (event) => event.stopPropagation());
  speedAlertsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (window.__vatioboardFloatingTools?.openSpeedAlerts) {
      window.__vatioboardFloatingTools.openSpeedAlerts();
      return;
    }
    shellManager.openWindow?.("speed-alerts");
  });

  recenterBtn.addEventListener("click", () => toggleFollow());
  orientationBtn.addEventListener("click", () => cycleOrientationMode());
  refreshBtn.addEventListener("click", () => {
    refresh().catch(() => {});
  });

  layerButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  layerButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setLayerMenuOpen(layerMenu.hidden);
  });
  layerButton.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setLayerMenuOpen(true);
      focusLayerOption();
    } else if (event.key === "Escape") {
      setLayerMenuOpen(false);
    }
  });
  layerMenu.addEventListener("pointerdown", (event) => event.stopPropagation());
  layerMenu.addEventListener("click", (event) => {
    const option = event.target?.closest?.(".camera-map-layer-option");
    if (!option) return;
    event.stopPropagation();
    if (option.dataset.layerId) {
      selectLayerValue(option.dataset.layerId);
      return;
    }
    selectOverlayValue(option);
  });
  layerMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setLayerMenuOpen(false);
      layerButton.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveLayerOptionFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveLayerOptionFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      getLayerOptionElements()[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      getLayerOptionElements().at(-1)?.focus();
    }
  });

  resizeHandle.addEventListener("pointerdown", (event) => {
    if (isFullscreenActive()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    if (shellManager.getWindow(CAMERA_MAP_WINDOW_ID)?.snap) {
      shellManager.unsnapWindow?.(CAMERA_MAP_WINDOW_ID, { preserveSnap: false });
    }
    setLayerMenuOpen(false);

    const bounds = getPanelBounds();
    resizeInProgress = true;
    resizePointerId = event.pointerId;
    resizeStartX = resizeLastX = event.clientX;
    resizeStartY = resizeLastY = event.clientY;
    resizeStartWidth = bounds.width;
    resizeStartHeight = bounds.height;
    panel.classList.add("is-resizing");
    document.documentElement.classList.add("vb-floating-drag-active");

    try {
      resizeHandle.setPointerCapture?.(resizePointerId);
    } catch {
      // Pointer capture is best effort on older Chromium builds.
    }
  }, { passive: false });

  resizeHandle.addEventListener("pointermove", (event) => {
    if (!resizeInProgress || event.pointerId !== resizePointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeLastX = event.clientX;
    resizeLastY = event.clientY;
    scheduleHandleResize();
  }, { passive: false });

  resizeHandle.addEventListener("pointerup", (event) => {
    if (event.pointerId !== resizePointerId) return;
    event.preventDefault();
    event.stopPropagation();
    endHandleResize(event);
  });
  resizeHandle.addEventListener("pointercancel", endHandleResize);
  resizeHandle.addEventListener("lostpointercapture", endHandleResize);
  resizeHandle.addEventListener("keydown", (event) => {
    if (isFullscreenActive()) return;
    const step = event.shiftKey ? 80 : 32;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      resizePanelBy(step, 0);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      resizePanelBy(-step, 0);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      resizePanelBy(0, step);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      resizePanelBy(0, -step);
    }
  });

  window.addEventListener("resize", resizeMap, { passive: true });
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("pointerdown", closeLayerMenuOnDocumentPointerDown, true);
  document.addEventListener("click", handleCopyReviewInfo);
  startColorSchemeListener();

  if (button) {
    button.addEventListener("click", toggle);
  }

  mount.appendChild(panel);
  updateLayerMenuState();
  updateNavigationButtons();
  updateStatus({ status: "idle" });

  if (floating) {
    // The shell taskbar/start menu owns launchers in the SPA.  Keeping this
    // branch intentionally empty preserves the calculator-style option without
    // introducing a second dock.
  }

  if (loadVisibility()) {
    open({ persist: false });
  }

  return {
    open,
    close,
    minimize,
    restore,
    destroy,
    isOpen: () => !panel.hidden,
    isFullscreen: isFullscreenActive,
    toggleFullscreen,
    refresh,
    focusCurrentLocation,
    updatePosition,
    setProjectionMode,
    getApproachSnapshot,
    getNavigationState: () => ({
      followEnabled,
      followPaused,
      navigationMode,
      orientationMode,
      projectionMode,
      currentLivePosition,
      position: currentLivePosition,
      latestHeading: navigationCameraState.latestHeading ?? lastHeadingState?.heading ?? null,
      headingAvailable: navigationCameraState.headingAvailable || lastHeadingState?.headingAvailable === true,
      headingSource: navigationCameraState.headingSource || lastHeadingState?.source || "none",
      latestBearingApplied: navigationCameraState.latestBearingApplied,
      lastCameraCommandReason: navigationCameraState.lastCameraCommandReason,
      lastCameraCommand,
      heading: lastHeadingState,
    }),
  };
}
