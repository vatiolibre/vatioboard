import KDBush from "kdbush";
import { around as geoAround, distance as geoDistanceKm } from "geokdbush";
import type { DistanceUnit, SpeedUnit } from "./constants.js";
import type { SpeedTrapMeta } from "./alerts.js";

export type TrapRecord = [
  longitude: number,
  latitude: number,
  speedKph?: number | null,
  id?: unknown,
  meta?: SpeedTrapMeta | null,
];

export interface TrapCompactPayload {
  traps?: unknown;
}

export interface NearestTrapState {
  nearestTrapId: string | number | null;
  nearestTrapDistanceM: number | null;
  nearestTrapSpeedKph: number | null;
  nearestTrapSpeedMeta: SpeedTrapMeta | null;
}

export interface NearestTrapAcrossDatasetsState extends NearestTrapState {
  nearestTrapDataset: TrapDataset | null;
}

export interface TrapDataset {
  key?: string;
  id?: string;
  country?: string;
  index?: unknown;
  trapIndex?: unknown;
  traps?: TrapRecord[];
  trapRecords?: TrapRecord[];
  [key: string]: unknown;
}

export interface TrapDistanceDisplay {
  value: string;
  unit: string;
}

export interface TrapLoaderState extends NearestTrapState {
  trapAlertEnabled: boolean;
  trapLoadPending: boolean;
  trapLoadError: unknown;
  trapRecords: TrapRecord[];
  trapIndex: unknown;
}

export interface TrapSearchOptions {
  around?: (index: unknown, longitude: number, latitude: number, maxResults: number) => number[];
  distanceKm?: (
    longitude: number,
    latitude: number,
    trapLongitude: number,
    trapLatitude: number,
  ) => number;
}

export interface TrapIndexClass {
  new (numItems: number): {
    add(longitude: number, latitude: number): unknown;
    finish(): unknown;
  };
  from(data: ArrayBuffer): unknown;
}

export interface TrapLoaderOptions {
  state: TrapLoaderState;
  dataUrl: string;
  indexUrl: string;
  renderMetrics: () => void;
  afterLoad?: (() => void) | null;
  fetchImpl?: typeof fetch;
  KDBushClass?: TrapIndexClass;
}

export interface TrapLoader {
  ensureTrapArtifactsLoaded(): void;
  isTrapDataReady(): boolean;
  loadTrapArtifacts(): Promise<unknown>;
}

type TrapAround = NonNullable<TrapSearchOptions["around"]>;
type TrapDistanceKm = NonNullable<TrapSearchOptions["distanceKm"]>;

const defaultAround = geoAround as TrapAround;
const defaultDistanceKm = geoDistanceKm as TrapDistanceKm;

function isTrapRecord(trap: unknown): trap is TrapRecord {
  return Array.isArray(trap)
    && trap.length >= 2
    && Number.isFinite(trap[0])
    && Number.isFinite(trap[1]);
}

function createEmptyNearestTrapState(): NearestTrapState {
  return {
    nearestTrapId: null,
    nearestTrapDistanceM: null,
    nearestTrapSpeedKph: null,
    nearestTrapSpeedMeta: null,
  };
}

export function buildTrapIndex(traps: TrapRecord[], KDBushClass: TrapIndexClass = KDBush): unknown {
  const index = new KDBushClass(traps.length);
  for (const [longitude, latitude] of traps) {
    index.add(longitude, latitude);
  }
  index.finish();
  return index;
}

export function sanitizeTrapRecords(compact: TrapCompactPayload | null | undefined): TrapRecord[] {
  const traps = Array.isArray(compact?.traps) ? compact.traps : [];
  return traps.filter(isTrapRecord);
}

export function updateNearestTrap(
  trapIndex: unknown,
  trapRecords: TrapRecord[] | null | undefined,
  longitude: number,
  latitude: number,
  options: TrapSearchOptions = {},
): NearestTrapState {
  const around = options.around || defaultAround;
  const distanceKm = options.distanceKm || defaultDistanceKm;

  if (!trapIndex || !Array.isArray(trapRecords) || trapRecords.length === 0) {
    return createEmptyNearestTrapState();
  }

  const nearestIds = around(trapIndex, longitude, latitude, 1);
  if (nearestIds.length === 0) {
    return createEmptyNearestTrapState();
  }

  const nearestTrapId = nearestIds[0];
  const nearestTrap = trapRecords[nearestTrapId];

  return {
    nearestTrapId,
    nearestTrapDistanceM: distanceKm(longitude, latitude, nearestTrap[0], nearestTrap[1]) * 1000,
    nearestTrapSpeedKph: Number.isFinite(nearestTrap[2]) ? nearestTrap[2] : null,
    nearestTrapSpeedMeta: nearestTrap[4] || null,
  };
}

export function updateNearestTrapAcrossDatasets(
  datasets: TrapDataset[] | null | undefined,
  longitude: number,
  latitude: number,
  options: TrapSearchOptions = {},
): NearestTrapAcrossDatasetsState {
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return {
      nearestTrapId: null,
      nearestTrapDistanceM: null,
      nearestTrapSpeedKph: null,
      nearestTrapSpeedMeta: null,
      nearestTrapDataset: null,
    };
  }

  let bestTrap: NearestTrapAcrossDatasetsState = {
    nearestTrapId: null,
    nearestTrapDistanceM: null,
    nearestTrapSpeedKph: null,
    nearestTrapSpeedMeta: null,
    nearestTrapDataset: null,
  };

  for (const dataset of datasets) {
    const trapIndex = dataset?.index ?? dataset?.trapIndex;
    const trapRecords = dataset?.traps ?? dataset?.trapRecords;
    const nextTrap = updateNearestTrap(trapIndex, trapRecords, longitude, latitude, options);
    if (!Number.isFinite(nextTrap.nearestTrapDistanceM)) continue;
    if (
      !Number.isFinite(bestTrap.nearestTrapDistanceM)
      || nextTrap.nearestTrapDistanceM < bestTrap.nearestTrapDistanceM
    ) {
      const datasetId = dataset?.key || dataset?.id || dataset?.country || "dataset";
      bestTrap = {
        ...nextTrap,
        nearestTrapId: `${datasetId}:${nextTrap.nearestTrapId}`,
        nearestTrapDataset: dataset,
      };
    }
  }

  return bestTrap;
}

export function formatTrapDistance(distanceM: number, unit: DistanceUnit, awayLabel = "away"): TrapDistanceDisplay {
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

export function formatTrapSpeed(speedKph: number | null | undefined, unit: SpeedUnit): string | null {
  if (typeof speedKph !== "number" || !Number.isFinite(speedKph)) return null;
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
}: TrapLoaderOptions): TrapLoader {
  let trapLoadPromise: Promise<unknown> | null = null;

  function isTrapDataReady(): boolean {
    return !state.trapLoadPending && !state.trapLoadError;
  }

  async function loadTrapArtifacts(): Promise<unknown> {
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
        state.nearestTrapSpeedMeta = null;
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

  function ensureTrapArtifactsLoaded(): void {
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
