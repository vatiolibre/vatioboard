import '../styles/gps-rate.less';
import { applyTranslations, getLang, t, toggleLang } from '../i18n.js';
import { loadBoolean, loadJson, loadText, saveJson, saveText } from '../shared/storage.js';
import { NOMINATIM_DEFAULT_BASE_URL } from '../shared/nominatim.js';
import { applyButtonIcon } from '../shared/tools-menu.js';
import {
  IconClose,
  IconPlay,
  IconRestart,
} from '../icons.js';
import { APP_NAME, GEO_ERROR_CODE, GEO_OPTIONS, STORAGE_KEYS } from './constants.js';
import { createGpsRateController } from './controller.js';
import { createGpsRateRenderer } from './render.js';
import { createGpsRateState } from './session-state.js';
import { normalizeStoredSummary } from './summary.js';

interface GpsRateController {
  init(): void;
}

function hasWakeLockSupport(navigatorRef: Navigator): boolean {
  const wakeLock = navigatorRef.wakeLock;
  return Boolean(wakeLock && typeof wakeLock.request === 'function');
}

applyTranslations();

const elements = {
  langToggle: document.getElementById('langToggle'),
  langToggleButtons: Array.from(document.querySelectorAll('[data-lang-toggle], #langToggle')),
  pageDescriptionMeta: document.querySelector('meta[name="description"]'),
  permissionChipValue: document.getElementById('permissionChipValue'),
  visibilityChipValue: document.getElementById('visibilityChipValue'),
  headerStatusText: document.getElementById('headerStatusText'),
  startQuickTest: document.getElementById('gpsRateStartQuick'),
  stopQuickTest: document.getElementById('gpsRateStopQuick'),
  resetQuickTest: document.getElementById('gpsRateResetQuick'),
  statusBadge: document.getElementById('statusBadge'),
  startTest: document.getElementById('startTest'),
  stopTest: document.getElementById('stopTest'),
  resetTest: document.getElementById('resetTest'),
  exportJson: document.getElementById('exportJson'),
  exportCsv: document.getElementById('exportCsv'),
  copySummary: document.getElementById('copySummary'),
  wakeLockToggle: document.getElementById('wakeLockToggle'),
  wakeLockStateText: document.getElementById('wakeLockStateText'),
  permissionSummaryText: document.getElementById('permissionSummaryText'),
  visibilitySummaryText: document.getElementById('visibilitySummaryText'),
  sessionNotes: document.getElementById('sessionNotes'),
  actionNotice: document.getElementById('actionNotice'),
  nominatimBaseUrl: document.getElementById('nominatimBaseUrl'),
  nominatimApiButtons: {
    search: document.getElementById('nominatimApiSearch'),
    reverse: document.getElementById('nominatimApiReverse'),
    lookup: document.getElementById('nominatimApiLookup'),
    status: document.getElementById('nominatimApiStatus'),
    details: document.getElementById('nominatimApiDetails'),
  },
  nominatimPanels: {
    search: document.getElementById('nominatimSearchPanel'),
    reverse: document.getElementById('nominatimReversePanel'),
    lookup: document.getElementById('nominatimLookupPanel'),
    status: document.getElementById('nominatimStatusPanel'),
    details: document.getElementById('nominatimDetailsPanel'),
  },
  nominatimSearchQuery: document.getElementById('nominatimSearchQuery'),
  nominatimReverseLat: document.getElementById('nominatimReverseLat'),
  nominatimReverseLon: document.getElementById('nominatimReverseLon'),
  nominatimLookupIds: document.getElementById('nominatimLookupIds'),
  nominatimDetailsPlaceId: document.getElementById('nominatimDetailsPlaceId'),
  nominatimSearchRun: document.getElementById('nominatimSearchRun'),
  nominatimReverseRun: document.getElementById('nominatimReverseRun'),
  nominatimReverseUseLatest: document.getElementById('nominatimReverseUseLatest'),
  nominatimLookupRun: document.getElementById('nominatimLookupRun'),
  nominatimStatusRun: document.getElementById('nominatimStatusRun'),
  nominatimDetailsRun: document.getElementById('nominatimDetailsRun'),
  nominatimDetailsPolicyNote: document.getElementById('nominatimDetailsPolicyNote'),
  nominatimRequestStateValue: document.getElementById('nominatimRequestStateValue'),
  nominatimRequestEndpointValue: document.getElementById('nominatimRequestEndpointValue'),
  nominatimRequestSourceValue: document.getElementById('nominatimRequestSourceValue'),
  nominatimRequestUrlValue: document.getElementById('nominatimRequestUrlValue'),
  nominatimResponseOutput: document.getElementById('nominatimResponseOutput'),
  currentIntervalValue: document.getElementById('currentIntervalValue'),
  effectiveHzValue: document.getElementById('effectiveHzValue'),
  sampleCountValue: document.getElementById('sampleCountValue'),
  elapsedValue: document.getElementById('elapsedValue'),
  liveAccuracyValue: document.getElementById('liveAccuracyValue'),
  movementValue: document.getElementById('movementValue'),
  summarySourcePill: document.getElementById('summarySourcePill'),
  summarySavedAt: document.getElementById('summarySavedAt'),
  summaryGrid: document.getElementById('summaryGrid'),
  summaryDurationValue: document.getElementById('summaryDurationValue'),
  summarySampleCountValue: document.getElementById('summarySampleCountValue'),
  summaryBestIntervalValue: document.getElementById('summaryBestIntervalValue'),
  summaryAverageIntervalValue: document.getElementById('summaryAverageIntervalValue'),
  summaryMedianIntervalValue: document.getElementById('summaryMedianIntervalValue'),
  summaryAverageHzValue: document.getElementById('summaryAverageHzValue'),
  summaryBestHzValue: document.getElementById('summaryBestHzValue'),
  summarySpeedFieldValue: document.getElementById('summarySpeedFieldValue'),
  summaryHeadingFieldValue: document.getElementById('summaryHeadingFieldValue'),
  summaryAltitudeFieldValue: document.getElementById('summaryAltitudeFieldValue'),
  summaryAccuracyValue: document.getElementById('summaryAccuracyValue'),
  summaryPlaceValue: document.getElementById('summaryPlaceValue'),
  summaryStatusNotesValue: document.getElementById('summaryStatusNotesValue'),
  summaryEmptyState: document.getElementById('summaryEmptyState'),
  warningBadges: document.getElementById('warningBadges'),
  jitterValue: document.getElementById('jitterValue'),
  staleCountValue: document.getElementById('staleCountValue'),
  nullSpeedValue: document.getElementById('nullSpeedValue'),
  nullHeadingValue: document.getElementById('nullHeadingValue'),
  missingAltitudeValue: document.getElementById('missingAltitudeValue'),
  bestObservedHzValue: document.getElementById('bestObservedHzValue'),
  fiveSecondHzValue: document.getElementById('fiveSecondHzValue'),
  wholeSessionHzValue: document.getElementById('wholeSessionHzValue'),
  sparklineRangeLabel: document.getElementById('sparklineRangeLabel'),
  intervalSparklineLine: document.getElementById('intervalSparklineLine'),
  histogramList: document.getElementById('histogramList'),
  availabilitySpeedValue: document.getElementById('availabilitySpeedValue'),
  availabilityHeadingValue: document.getElementById('availabilityHeadingValue'),
  availabilityAltitudeValue: document.getElementById('availabilityAltitudeValue'),
  availabilityAltitudeAccuracyValue: document.getElementById('availabilityAltitudeAccuracyValue'),
  availabilityAccuracyValue: document.getElementById('availabilityAccuracyValue'),
  latestLatitudeValue: document.getElementById('latestLatitudeValue'),
  latestLongitudeValue: document.getElementById('latestLongitudeValue'),
  latestSpeedValue: document.getElementById('latestSpeedValue'),
  latestHeadingValue: document.getElementById('latestHeadingValue'),
  latestAccuracyValue: document.getElementById('latestAccuracyValue'),
  latestAltitudeValue: document.getElementById('latestAltitudeValue'),
  latestAltitudeAccuracyValue: document.getElementById('latestAltitudeAccuracyValue'),
  latestGeoTimestampValue: document.getElementById('latestGeoTimestampValue'),
  latestPerfTimestampValue: document.getElementById('latestPerfTimestampValue'),
  latestSampleAgeValue: document.getElementById('latestSampleAgeValue'),
  latestCallbackDeltaValue: document.getElementById('latestCallbackDeltaValue'),
  latestGeoDeltaValue: document.getElementById('latestGeoDeltaValue'),
  motionStateValue: document.getElementById('motionStateValue'),
  motionSourceValue: document.getElementById('motionSourceValue'),
  movingHzValue: document.getElementById('movingHzValue'),
  stationaryHzValue: document.getElementById('stationaryHzValue'),
  movingSamplesValue: document.getElementById('movingSamplesValue'),
  stationarySamplesValue: document.getElementById('stationarySamplesValue'),
  clearLog: document.getElementById('clearLog'),
  logEmptyState: document.getElementById('logEmptyState'),
  logTableWrap: document.getElementById('logTableWrap'),
  eventLogBody: document.getElementById('eventLogBody'),
};

applyButtonIcon(elements.startQuickTest, IconPlay);
applyButtonIcon(elements.stopQuickTest, IconClose);
applyButtonIcon(elements.resetQuickTest, IconRestart);

const state = createGpsRateState({
  hiddenNow: document.hidden,
  wakeLockSupported: hasWakeLockSupport(navigator),
  keepAwakeRequested: loadBoolean(STORAGE_KEYS.keepAwake, false),
  notes: loadText(STORAGE_KEYS.notes, ''),
  lastSavedSummary: normalizeStoredSummary(loadJson(STORAGE_KEYS.lastSummary)),
  nominatimBaseUrl: loadText(STORAGE_KEYS.nominatimBaseUrl, NOMINATIM_DEFAULT_BASE_URL),
  nominatimActiveApi: loadText(STORAGE_KEYS.nominatimActiveApi, 'search'),
});

const renderer = createGpsRateRenderer({
  elements,
  state,
  t,
  getLang,
});

const controller = createGpsRateController({
  appName: APP_NAME,
  geoOptions: GEO_OPTIONS,
  geoErrorCode: GEO_ERROR_CODE,
  storageKeys: STORAGE_KEYS,
  elements,
  state,
  renderer,
  t,
  getLang,
  toggleLang,
  applyTranslations,
  saveJson,
  saveText,
}) as GpsRateController;

controller.init();
