import "../styles/gps-rate.less";
import { applyTranslations, getLang, t, toggleLang } from "../i18n.js";
import { loadBoolean, loadJson, loadText, saveJson, saveText } from "../shared/storage.js";
import { applyButtonIcon, initToolsMenu } from "../shared/tools-menu.js";
import { IconAccel, IconBoard, IconCalculator, IconSpeed } from "../icons.js";
import { APP_NAME, GEO_ERROR_CODE, GEO_OPTIONS, STORAGE_KEYS } from "./constants.js";
import { createGpsRateController } from "./controller.js";
import { createGpsRateRenderer } from "./render.js";
import { createGpsRateState } from "./session-state.js";
import { normalizeStoredSummary } from "./summary.js";

applyTranslations();

const elements = {
  langToggle: document.getElementById("langToggle"),
  pageDescriptionMeta: document.querySelector('meta[name="description"]'),
  toolsMenuBtn: document.getElementById("gpsRateToolsMenuBtn"),
  toolsMenuList: document.getElementById("gpsRateToolsMenuList"),
  openSpeedMenu: document.getElementById("openGpsRateSpeedMenu"),
  openAccelMenu: document.getElementById("openGpsRateAccelMenu"),
  openCalculatorMenu: document.getElementById("openGpsRateCalculatorMenu"),
  openBoardMenu: document.getElementById("openGpsRateBoardMenu"),
  permissionChipValue: document.getElementById("permissionChipValue"),
  visibilityChipValue: document.getElementById("visibilityChipValue"),
  headerStatusText: document.getElementById("headerStatusText"),
  statusBadge: document.getElementById("statusBadge"),
  startTest: document.getElementById("startTest"),
  stopTest: document.getElementById("stopTest"),
  resetTest: document.getElementById("resetTest"),
  exportJson: document.getElementById("exportJson"),
  exportCsv: document.getElementById("exportCsv"),
  copySummary: document.getElementById("copySummary"),
  wakeLockToggle: document.getElementById("wakeLockToggle"),
  wakeLockStateText: document.getElementById("wakeLockStateText"),
  permissionSummaryText: document.getElementById("permissionSummaryText"),
  visibilitySummaryText: document.getElementById("visibilitySummaryText"),
  sessionNotes: document.getElementById("sessionNotes"),
  actionNotice: document.getElementById("actionNotice"),
  currentIntervalValue: document.getElementById("currentIntervalValue"),
  effectiveHzValue: document.getElementById("effectiveHzValue"),
  sampleCountValue: document.getElementById("sampleCountValue"),
  elapsedValue: document.getElementById("elapsedValue"),
  liveAccuracyValue: document.getElementById("liveAccuracyValue"),
  movementValue: document.getElementById("movementValue"),
  summarySourcePill: document.getElementById("summarySourcePill"),
  summarySavedAt: document.getElementById("summarySavedAt"),
  summaryGrid: document.getElementById("summaryGrid"),
  summaryDurationValue: document.getElementById("summaryDurationValue"),
  summarySampleCountValue: document.getElementById("summarySampleCountValue"),
  summaryBestIntervalValue: document.getElementById("summaryBestIntervalValue"),
  summaryAverageIntervalValue: document.getElementById("summaryAverageIntervalValue"),
  summaryMedianIntervalValue: document.getElementById("summaryMedianIntervalValue"),
  summaryAverageHzValue: document.getElementById("summaryAverageHzValue"),
  summaryBestHzValue: document.getElementById("summaryBestHzValue"),
  summarySpeedFieldValue: document.getElementById("summarySpeedFieldValue"),
  summaryHeadingFieldValue: document.getElementById("summaryHeadingFieldValue"),
  summaryAltitudeFieldValue: document.getElementById("summaryAltitudeFieldValue"),
  summaryAccuracyValue: document.getElementById("summaryAccuracyValue"),
  summaryStatusNotesValue: document.getElementById("summaryStatusNotesValue"),
  summaryEmptyState: document.getElementById("summaryEmptyState"),
  warningBadges: document.getElementById("warningBadges"),
  jitterValue: document.getElementById("jitterValue"),
  staleCountValue: document.getElementById("staleCountValue"),
  nullSpeedValue: document.getElementById("nullSpeedValue"),
  nullHeadingValue: document.getElementById("nullHeadingValue"),
  missingAltitudeValue: document.getElementById("missingAltitudeValue"),
  bestObservedHzValue: document.getElementById("bestObservedHzValue"),
  fiveSecondHzValue: document.getElementById("fiveSecondHzValue"),
  wholeSessionHzValue: document.getElementById("wholeSessionHzValue"),
  sparklineRangeLabel: document.getElementById("sparklineRangeLabel"),
  intervalSparklineLine: document.getElementById("intervalSparklineLine"),
  histogramList: document.getElementById("histogramList"),
  availabilitySpeedValue: document.getElementById("availabilitySpeedValue"),
  availabilityHeadingValue: document.getElementById("availabilityHeadingValue"),
  availabilityAltitudeValue: document.getElementById("availabilityAltitudeValue"),
  availabilityAltitudeAccuracyValue: document.getElementById("availabilityAltitudeAccuracyValue"),
  availabilityAccuracyValue: document.getElementById("availabilityAccuracyValue"),
  latestLatitudeValue: document.getElementById("latestLatitudeValue"),
  latestLongitudeValue: document.getElementById("latestLongitudeValue"),
  latestSpeedValue: document.getElementById("latestSpeedValue"),
  latestHeadingValue: document.getElementById("latestHeadingValue"),
  latestAccuracyValue: document.getElementById("latestAccuracyValue"),
  latestAltitudeValue: document.getElementById("latestAltitudeValue"),
  latestAltitudeAccuracyValue: document.getElementById("latestAltitudeAccuracyValue"),
  latestGeoTimestampValue: document.getElementById("latestGeoTimestampValue"),
  latestPerfTimestampValue: document.getElementById("latestPerfTimestampValue"),
  latestSampleAgeValue: document.getElementById("latestSampleAgeValue"),
  latestCallbackDeltaValue: document.getElementById("latestCallbackDeltaValue"),
  latestGeoDeltaValue: document.getElementById("latestGeoDeltaValue"),
  motionStateValue: document.getElementById("motionStateValue"),
  motionSourceValue: document.getElementById("motionSourceValue"),
  movingHzValue: document.getElementById("movingHzValue"),
  stationaryHzValue: document.getElementById("stationaryHzValue"),
  movingSamplesValue: document.getElementById("movingSamplesValue"),
  stationarySamplesValue: document.getElementById("stationarySamplesValue"),
  clearLog: document.getElementById("clearLog"),
  logEmptyState: document.getElementById("logEmptyState"),
  logTableWrap: document.getElementById("logTableWrap"),
  eventLogBody: document.getElementById("eventLogBody"),
};

const toolsMenu = initToolsMenu({
  button: elements.toolsMenuBtn,
  list: elements.toolsMenuList,
});

applyButtonIcon(elements.openSpeedMenu, IconSpeed);
applyButtonIcon(elements.openAccelMenu, IconAccel);
applyButtonIcon(elements.openCalculatorMenu, IconCalculator);
applyButtonIcon(elements.openBoardMenu, IconBoard);

const state = createGpsRateState({
  hiddenNow: document.hidden,
  wakeLockSupported: Boolean(navigator.wakeLock && typeof navigator.wakeLock.request === "function"),
  keepAwakeRequested: loadBoolean(STORAGE_KEYS.keepAwake, false),
  notes: loadText(STORAGE_KEYS.notes, ""),
  lastSavedSummary: normalizeStoredSummary(loadJson(STORAGE_KEYS.lastSummary)),
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
  toolsMenu,
  t,
  getLang,
  toggleLang,
  applyTranslations,
  saveJson,
  saveText,
});

controller.init();
