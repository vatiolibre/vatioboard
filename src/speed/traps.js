import KDBush from "kdbush";
import { around as geoAround, distance as geoDistanceKm } from "geokdbush";

export function buildTrapIndex(traps, KDBushClass = KDBush) {
  const index = new KDBushClass(traps.length);
  for (const [longitude, latitude] of traps) {
    index.add(longitude, latitude);
  }
  index.finish();
  return index;
}

export function sanitizeTrapRecords(compact) {
  const traps = Array.isArray(compact?.traps) ? compact.traps : [];
  return traps.filter((trap) =>
    Array.isArray(trap)
    && trap.length >= 2
    && Number.isFinite(trap[0])
    && Number.isFinite(trap[1]));
}

export function updateNearestTrap(trapIndex, trapRecords, longitude, latitude, options = {}) {
  const around = options.around || geoAround;
  const distanceKm = options.distanceKm || geoDistanceKm;

  if (!trapIndex || !Array.isArray(trapRecords) || trapRecords.length === 0) {
    return {
      nearestTrapId: null,
      nearestTrapDistanceM: null,
      nearestTrapSpeedKph: null,
    };
  }

  const nearestIds = around(trapIndex, longitude, latitude, 1);
  if (nearestIds.length === 0) {
    return {
      nearestTrapId: null,
      nearestTrapDistanceM: null,
      nearestTrapSpeedKph: null,
    };
  }

  const nearestTrapId = nearestIds[0];
  const nearestTrap = trapRecords[nearestTrapId];

  return {
    nearestTrapId,
    nearestTrapDistanceM: distanceKm(longitude, latitude, nearestTrap[0], nearestTrap[1]) * 1000,
    nearestTrapSpeedKph: Number.isFinite(nearestTrap[2]) ? nearestTrap[2] : null,
  };
}

export function formatTrapDistance(distanceM, unit, awayLabel = "away") {
  if (!Number.isFinite(distanceM)) {
    return { value: "—", unit: awayLabel };
  }

  if (unit === "m") {
    if (distanceM < 1000) {
      return { value: Math.round(distanceM).toString(), unit: "m" };
    }

    const kilometers = distanceM / 1000;
    return {
      value: kilometers < 10 ? kilometers.toFixed(1) : Math.round(kilometers).toString(),
      unit: "km",
    };
  }

  const feet = distanceM * 3.2808398950131;
  if (feet < 5280) {
    return { value: Math.round(feet).toString(), unit: "ft" };
  }

  const miles = distanceM / 1609.344;
  return {
    value: miles < 10 ? miles.toFixed(1) : Math.round(miles).toString(),
    unit: "mi",
  };
}

export function formatTrapSpeed(speedKph, unit) {
  if (!Number.isFinite(speedKph)) return null;
  if (unit === "kmh") return `${Math.round(speedKph)} km/h`;
  return `${Math.round(speedKph / 1.609344)} mph`;
}

export function createTrapLoader({
  state,
  dataUrl,
  indexUrl,
  renderMetrics,
  afterLoad,
  fetchImpl = fetch,
  KDBushClass = KDBush,
}) {
  let trapLoadPromise = null;

  function isTrapDataReady() {
    return !state.trapLoadPending && !state.trapLoadError;
  }

  async function loadTrapArtifacts() {
    if (trapLoadPromise) {
      return trapLoadPromise;
    }

    if (isTrapDataReady()) {
      return state.trapIndex;
    }

    state.trapLoadPending = true;
    state.trapLoadError = null;
    renderMetrics();

    trapLoadPromise = (async () => {
      try {
        const [dataResponse, indexResponse] = await Promise.all([
          fetchImpl(dataUrl, { cache: "no-cache" }),
          fetchImpl(indexUrl, { cache: "no-cache" }),
        ]);

        if (!dataResponse.ok) {
          throw new Error(`Trap dataset request failed with ${dataResponse.status}`);
        }

        state.trapRecords = sanitizeTrapRecords(await dataResponse.json());

        if (indexResponse.ok) {
          state.trapIndex = KDBushClass.from(await indexResponse.arrayBuffer());
        } else {
          state.trapIndex = buildTrapIndex(state.trapRecords, KDBushClass);
        }

        state.trapLoadError = null;
      } catch (error) {
        state.trapRecords = [];
        state.trapIndex = null;
        state.nearestTrapId = null;
        state.nearestTrapDistanceM = null;
        state.nearestTrapSpeedKph = null;
        state.trapLoadError = error;
      } finally {
        state.trapLoadPending = false;
        trapLoadPromise = null;
      }

      if (typeof afterLoad === "function") {
        afterLoad();
      }

      renderMetrics();
      return state.trapIndex;
    })();

    return trapLoadPromise;
  }

  function ensureTrapArtifactsLoaded() {
    if (!state.trapAlertEnabled) return;
    if (state.trapLoadPending || isTrapDataReady()) return;
    void loadTrapArtifacts();
  }

  return {
    ensureTrapArtifactsLoaded,
    isTrapDataReady,
    loadTrapArtifacts,
  };
}
