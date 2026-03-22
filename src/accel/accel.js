import "../styles/accel.less";
import Chart from "chart.js/auto";
import { createAnalogSpeedometer } from "../shared/analog-speedometer.js";

(function () {
  var LANG_KEY = "vatio_board_lang";
  var SHARED_SPEED_UNIT_KEY = "vatio_speed_unit";
  var SHARED_DISTANCE_UNIT_KEY = "vatio_speed_distance_unit";
  var SHARED_LEGACY_ALTITUDE_UNIT_KEY = "vatio_speed_altitude_unit";
  var STORAGE_KEYS = {
    runs: "vatioboard.accel.runs",
    settings: "vatioboard.accel.settings",
  };

  var MPH_TO_MS = 0.44704;
  var KMH_TO_MS = 1000 / 3600;
  var FT_TO_M = 0.3048;
  var EIGHTH_MILE_M = 201.168;
  var QUARTER_MILE_M = 402.336;
  var SPEED_UNIT_CONFIG = {
    mph: { factor: 2.2369362920544, labelKey: "accelMphUnit" },
    kmh: { factor: 3.6, labelKey: "accelKmhUnit" },
  };
  var DISTANCE_UNIT_CONFIG = {
    ft: { factor: 3.2808398950131, label: "ft" },
    m: { factor: 1, label: "m" },
  };
  var GEO_OPTIONS = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000,
  };
  var GEO_ERROR_CODE = {
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
  var MAX_RUNS = 40;
  var MAX_PLAUSIBLE_SPEED_MS = 90;
  var READY_SAMPLE_AGE_MS = 2500;
  var STALE_INTERVAL_MS = 1500;
  var SPARSE_INTERVAL_MS = 1800;
  var RECENT_INTERVAL_WINDOW = 12;
  var TIMER_TICK_MS = 50;
  var TRACE_DUPLICATE_EPSILON_MS = 0.01;
  var MIN_VALID_RUN_SAMPLES = 4;
  var MIN_VALID_RUN_DURATION_MS = 800;
  var FINISH_SOUND_URL = "/audio/finish.m4a";
  var RESULT_GRAPH_HEIGHT = 220;
  var finishAudio = typeof Audio === "function" ? new Audio(FINISH_SOUND_URL) : null;
  var finishAudioPrimePromise = null;
  var finishAudioPrimed = false;
  var resultGraphChart = null;
  var resultGraphResizeObserver = null;
  var resultGraphRefreshFrame = 0;
  var resultGraphRenderKey = "";
  var resultGraphSelectionResultId = "";
  var resultGraphSelectionPointKey = "";
  var resultGraphObservedPanelWidth = 0;
  var RESULT_GRAPH_GUIDE_PLUGIN = {
    id: "resultGraphGuide",
    afterDatasetsDraw: function (chart, args, options) {
      if (!chart || !chart.tooltip || !chart.chartArea) return;

      var activeElements = chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (!activeElements || !activeElements.length) return;

      var activeElement = activeElements[0].element;
      if (!activeElement || !isFiniteNumber(activeElement.x) || !isFiniteNumber(activeElement.y)) return;

      var chartArea = chart.chartArea;
      var ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = options && options.color ? options.color : "rgba(128, 128, 128, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(activeElement.x, chartArea.top);
      ctx.lineTo(activeElement.x, chartArea.bottom);
      ctx.moveTo(chartArea.left, activeElement.y);
      ctx.lineTo(chartArea.right, activeElement.y);
      ctx.stroke();
      ctx.restore();
    },
  };

  if (finishAudio) {
    finishAudio.preload = "auto";
    finishAudio.loop = false;
  }

  var translations = {
    en: {
      accelPageTitle: "Vatio Accel - Browser Acceleration Timer for Tesla and Mobile",
      accelPageDescription: "Browser-based acceleration timer using only geolocation and local processing. Built for Tesla browser testing and honest run quality scoring.",
      accelPageH1: "Vatio Accel browser acceleration timer",
      accelTagline: "Browser acceleration timer by Vatio Libre",
      accelRoute: "ACCEL",
      accelToolbar: "Acceleration tools",
      accelGpsLab: "GPS Lab",
      accelSetup: "Setup",
      accelResultsPanel: "Results",
      accelOpenSetup: "Open setup",
      accelOpenResults: "Open results and history",
      accelHeroKicker: "Browser acceleration timer",
      accelHeroTitle: "Browser-based acceleration testing for Tesla and mobile",
      accelHeroLead: "Uses browser geolocation only. Results are estimates based on observed GPS callbacks, not certified timing.",
      accelDisclaimer: "Accuracy depends on browser callback rate, GPS quality, visibility state, and device behavior. Use repeated runs and quality grades honestly.",
      accelStorageNote: "Runs and settings stay in local storage on this browser only",
      accelLocalOnly: "Local only",
      accelStatusPanel: "Status panel",
      accelStatusLead: "Live browser GPS readiness and signal quality.",
      accelTestSelector: "Test selector",
      accelTestLead: "Available tests update with the selected speed and distance units.",
      accelCustomRange: "Custom speed range",
      accelStartSpeed: "Start speed",
      accelEndSpeed: "End speed",
      accelUnitsLead: "Choose how speed, distance, altitude, and accuracy are shown.",
      accelDistanceAltitude: "Distance + altitude",
      accelDistanceTest: "Distance test",
      accelImperialTests: "Imperial tests",
      accelMetricTests: "Metric tests",
      accelMileDistanceTests: "Mile-based distances",
      accelMetricDistanceTests: "Metric distances",
      accelControls: "Controls",
      accelControlsLead: "Choose rollout and notes before starting a run.",
      accelArm: "Start test",
      accelCancel: "Cancel test",
      accelRunAgain: "Run again",
      accelReset: "Reset",
      accelRollout: "Rollout",
      accelRolloutOneFoot: "1 ft",
      accelLaunchThreshold: "Launch threshold",
      accelLaunchThresholdHalf: "0.5 mph",
      accelLaunchThresholdOne: "1.0 mph",
      accelNotes: "Run notes",
      accelNotesPlaceholder: "Example: 90% SOC, flat road",
      accelLiveRun: "Live run",
      accelLiveLead: "Large timer, speed, distance, and target progress during the run.",
      accelElapsed: "Elapsed",
      accelCurrentSpeed: "Current speed",
      accelCurrentTarget: "Current target",
      accelProgress: "Progress",
      accelResult: "Result",
      accelResultLead: "Latest completed run stored locally on this browser.",
      accelNoResult: "Arm and complete a run to see the result here.",
      accelSelectedTest: "Selected test",
      accelFinalTime: "Final time",
      accelSpeedGraph: "Speed graph",
      accelSpeedGraphLead: "Time vs speed",
      accelSpeedGraphEmpty: "Speed graph data is available for new runs.",
      accelSpeedGraphAria: "Interactive speed graph",
      accelSpeedGraphHint: "Touch or click the graph to inspect each sample.",
      accelGraphPointTime: "Time",
      accelGraphPointSpeed: "Speed",
      accelGraphPointDistance: "Distance",
      accelGraphPointAccuracy: "Accuracy",
      accelGraphPointSlope: "Slope",
      accelFinishSpeed: "Finish speed",
      accelTrapSpeed: "Trap speed",
      accelRolloutUsed: "Rollout",
      accelAverageAccuracy: "Average accuracy",
      accelSlope: "Slope",
      accelElevationChange: "Elevation change",
      accelRunHz: "Run avg Hz",
      accelQualityGrade: "Quality grade",
      accelTimestamp: "Timestamp",
      accelBestComparison: "Best vs latest",
      accelDiagnostics: "Diagnostics",
      accelDiagnosticsLead: "Observed callback timing, uncertainty, and warning flags.",
      accelPartials: "Partials",
      accelPartialWaiting: "Waiting",
      accelPartialNotCaptured: "Not captured",
      accelPartial60ft: "60 ft",
      accelPartial1000ft: "1000 ft",
      accelPartial100m: "100 m",
      accelPartial0to130: "0-130 mph",
      accelPartial0to200Kmh: "0-200 km/h",
      accelAverageInterval: "Average interval",
      accelJitter: "Jitter",
      accelSparseUpdates: "Sparse updates",
      accelStaleSamples: "Stale samples",
      accelSpeedSource: "Speed source",
      accelSamples: "Samples",
      accelHistory: "History",
      accelHistoryLead: "Saved locally in this browser. Newest runs first.",
      accelNoHistory: "No saved runs yet.",
      accelClearHistory: "Clear all",
      accelLoadResult: "Load result",
      accelViewingResult: "Viewing",
      accelResultLoadedNotice: "Saved result loaded.",
      accelGpsReady: "GPS ready",
      accelLatestAccuracy: "Latest accuracy",
      accelObservedHz: "Observed Hz",
      accelQuality: "Quality",
      accelState: "State",
      accelPermissionPrompt: "Prompt",
      accelPermissionGranted: "Granted",
      accelPermissionDenied: "Denied",
      accelPermissionUnsupported: "Unsupported",
      accelPermissionUnknown: "Unknown",
      accelReadyYes: "Ready",
      accelReadyNo: "Not ready",
      accelQualityGood: "Good",
      accelQualityFair: "Fair",
      accelQualityPoor: "Poor",
      accelQualityInvalid: "Invalid",
      accelStateIdle: "Idle",
      accelStateArmed: "Armed",
      accelStateWaitingLaunch: "Waiting launch",
      accelStateWaitingRollout: "Waiting rollout",
      accelStateRunning: "Running",
      accelStateCompleted: "Completed",
      accelStateCancelled: "Cancelled",
      accelStateGpsWaiting: "Waiting GPS",
      accelStateError: "Error",
      accelPreset0to30: "0-30 mph",
      accelPreset0to40: "0-40 mph",
      accelPreset0to50: "0-50 mph",
      accelPreset0to60: "0-60 mph",
      accelPreset0to50Kmh: "0-50 km/h",
      accelPreset0to60Kmh: "0-60 km/h",
      accelPreset0to80Kmh: "0-80 km/h",
      accelPreset0to100Kmh: "0-100 km/h",
      accelPreset60to130: "60-130 mph",
      accelPreset100to200Kmh: "100-200 km/h",
      accelPresetEighthMile: "1/8 mile",
      accelPresetQuarterMile: "1/4 mile",
      accelPreset200M: "200 m",
      accelPreset400M: "400 m",
      accelPresetCustom: "Custom range",
      accelRolloutOff: "Off",
      accelRolloutOn: "1 ft rollout",
      accelRolloutIgnored: "Ignored on rolling tests",
      accelRolloutUnavailable: "Not used",
      accelStandingStart: "Standing start",
      accelRollingStart: "Rolling start",
      accelQualityCurrent: "Current quality",
      accelWarningAccuracy: "Accuracy warning",
      accelWarningSparse: "Sparse updates",
      accelWarningStale: "Stale samples",
      accelWarningDerived: "Derived speed",
      accelWarningNoWarnings: "No active warnings",
      accelSpeedReported: "Reported GPS speed",
      accelSpeedDerivedLabel: "Derived from displacement",
      accelNeedGps: "Need a current GPS fix before arming.",
      accelNoGeolocation: "This browser does not expose geolocation.",
      accelWaitingForFix: "Waiting for a cleaner GPS fix.",
      accelCustomInvalid: "Custom range must end above the start speed.",
      accelArmedStandingNotice: "Test ready. Waiting for launch.",
      accelArmedRollingNotice: "Test ready. Waiting for the start speed crossing.",
      accelRunCancelledNotice: "Run cancelled.",
      accelRunResetNotice: "Live run state reset.",
      accelRunSavedNotice: "Run completed and saved locally.",
      accelHistoryClearedNotice: "Saved run history cleared.",
      accelDeleteRunConfirm: 'Delete run "{label}"?',
      accelClearHistoryConfirm: "Delete all saved acceleration runs?",
      accelBestRun: "Best saved run",
      accelNoComparison: "No saved comparison yet",
      accelFasterBy: "{value} faster than best saved",
      accelSlowerBy: "{value} slower than best saved",
      accelInvalidBySignal: "Invalid due to low-quality signal",
      accelNoSavedRunsShort: "No saved runs",
      accelMphUnit: "mph",
      accelKmhUnit: "km/h",
      accelUnavailable: "—",
      accelSamplesShort: "{count} samples",
      accelOff: "Off",
      accelOn: "On",
      permission: "Permission",
      speedometer: "Speedometer",
      openBoard: "Open board",
      changeLanguage: "Change language",
      heading: "Heading",
      altitude: "Altitude",
      distance: "Distance",
      units: "Units",
      off: "Off",
      on: "On",
      done: "Done",
      delete: "Delete",
      speed: "Speed",
      accuracy: "Accuracy",
    },
    es: {
      accelPageTitle: "Vatio Accel - Temporizador de aceleracion para Tesla y movil",
      accelPageDescription: "Temporizador de aceleracion basado en navegador usando solo geolocalizacion y procesamiento local. Pensado para pruebas en el navegador de Tesla y con puntuacion honesta de calidad.",
      accelPageH1: "Vatio Accel temporizador de aceleracion en navegador",
      accelTagline: "Temporizador de aceleracion en navegador por Vatio Libre",
      accelRoute: "ACCEL",
      accelToolbar: "Herramientas de aceleracion",
      accelGpsLab: "GPS Lab",
      accelSetup: "Configurar",
      accelResultsPanel: "Resultados",
      accelOpenSetup: "Abrir configuracion",
      accelOpenResults: "Abrir resultados e historial",
      accelHeroKicker: "Temporizador en navegador",
      accelHeroTitle: "Pruebas de aceleracion en navegador para Tesla y movil",
      accelHeroLead: "Usa solo geolocalizacion del navegador. Los resultados son estimaciones basadas en callbacks GPS observados, no tiempos certificados.",
      accelDisclaimer: "La precision depende de la frecuencia de callbacks del navegador, la calidad GPS, la visibilidad de la pestaña y el comportamiento del dispositivo. Usa repeticiones y grados de calidad con honestidad.",
      accelStorageNote: "Las corridas y ajustes quedan guardados solo en el almacenamiento local de este navegador",
      accelLocalOnly: "Solo local",
      accelStatusPanel: "Panel de estado",
      accelStatusLead: "Disponibilidad GPS y calidad de senal en vivo.",
      accelTestSelector: "Selector de prueba",
      accelTestLead: "Las pruebas disponibles cambian segun las unidades de velocidad y distancia.",
      accelCustomRange: "Rango de velocidad personalizado",
      accelStartSpeed: "Velocidad inicial",
      accelEndSpeed: "Velocidad final",
      accelUnitsLead: "Elige como se muestran la velocidad, la distancia, la altitud y la precision.",
      accelDistanceAltitude: "Distancia + altitud",
      accelDistanceTest: "Prueba de distancia",
      accelImperialTests: "Pruebas imperiales",
      accelMetricTests: "Pruebas metricas",
      accelMileDistanceTests: "Distancias en millas",
      accelMetricDistanceTests: "Distancias metricas",
      accelControls: "Controles",
      accelControlsLead: "Ajusta rollout y notas antes de iniciar una corrida.",
      accelArm: "Iniciar prueba",
      accelCancel: "Cancelar prueba",
      accelRunAgain: "Repetir prueba",
      accelReset: "Reiniciar",
      accelRollout: "Rollout",
      accelRolloutOneFoot: "1 pie",
      accelLaunchThreshold: "Umbral de salida",
      accelLaunchThresholdHalf: "0.5 mph",
      accelLaunchThresholdOne: "1.0 mph",
      accelNotes: "Notas de la corrida",
      accelNotesPlaceholder: "Ejemplo: 90% SOC, via plana",
      accelLiveRun: "Corrida en vivo",
      accelLiveLead: "Temporizador grande, velocidad, distancia y progreso del objetivo.",
      accelElapsed: "Tiempo",
      accelCurrentSpeed: "Velocidad actual",
      accelCurrentTarget: "Objetivo actual",
      accelProgress: "Progreso",
      accelResult: "Resultado",
      accelResultLead: "Ultima corrida completada guardada localmente en este navegador.",
      accelNoResult: "Arma y completa una corrida para ver el resultado aqui.",
      accelSelectedTest: "Prueba seleccionada",
      accelFinalTime: "Tiempo final",
      accelSpeedGraph: "Grafica de velocidad",
      accelSpeedGraphLead: "Tiempo vs velocidad",
      accelSpeedGraphEmpty: "Los datos de la grafica de velocidad estaran disponibles para nuevas corridas.",
      accelSpeedGraphAria: "Grafica interactiva de velocidad",
      accelSpeedGraphHint: "Toca o haz clic en la grafica para inspeccionar cada muestra.",
      accelGraphPointTime: "Tiempo",
      accelGraphPointSpeed: "Velocidad",
      accelGraphPointDistance: "Distancia",
      accelGraphPointAccuracy: "Precision",
      accelGraphPointSlope: "Pendiente",
      accelFinishSpeed: "Velocidad final",
      accelTrapSpeed: "Velocidad de trampa",
      accelRolloutUsed: "Rollout",
      accelAverageAccuracy: "Precision promedio",
      accelSlope: "Pendiente",
      accelElevationChange: "Cambio de altitud",
      accelRunHz: "Hz promedio de la corrida",
      accelQualityGrade: "Calidad",
      accelTimestamp: "Fecha",
      accelBestComparison: "Mejor vs ultima",
      accelDiagnostics: "Diagnosticos",
      accelDiagnosticsLead: "Tiempos observados de callback, incertidumbre y alertas.",
      accelPartials: "Parciales",
      accelPartialWaiting: "Esperando",
      accelPartialNotCaptured: "Sin captura",
      accelPartial60ft: "60 pies",
      accelPartial1000ft: "1000 pies",
      accelPartial100m: "100 m",
      accelPartial0to130: "0-130 mph",
      accelPartial0to200Kmh: "0-200 km/h",
      accelAverageInterval: "Intervalo promedio",
      accelJitter: "Jitter",
      accelSparseUpdates: "Actualizaciones dispersas",
      accelStaleSamples: "Muestras antiguas",
      accelSpeedSource: "Fuente de velocidad",
      accelSamples: "Muestras",
      accelHistory: "Historial",
      accelHistoryLead: "Guardado localmente en este navegador. Corridas mas nuevas primero.",
      accelNoHistory: "Aun no hay corridas guardadas.",
      accelClearHistory: "Borrar todo",
      accelLoadResult: "Cargar resultado",
      accelViewingResult: "Viendo",
      accelResultLoadedNotice: "Resultado guardado cargado.",
      accelGpsReady: "GPS listo",
      accelLatestAccuracy: "Precision actual",
      accelObservedHz: "Hz observados",
      accelQuality: "Calidad",
      accelState: "Estado",
      accelPermissionPrompt: "Solicitar",
      accelPermissionGranted: "Permitido",
      accelPermissionDenied: "Bloqueado",
      accelPermissionUnsupported: "No soportado",
      accelPermissionUnknown: "Desconocido",
      accelReadyYes: "Listo",
      accelReadyNo: "No listo",
      accelQualityGood: "Buena",
      accelQualityFair: "Aceptable",
      accelQualityPoor: "Pobre",
      accelQualityInvalid: "Invalida",
      accelStateIdle: "En espera",
      accelStateArmed: "Armado",
      accelStateWaitingLaunch: "Esperando salida",
      accelStateWaitingRollout: "Esperando rollout",
      accelStateRunning: "Corriendo",
      accelStateCompleted: "Completada",
      accelStateCancelled: "Cancelada",
      accelStateGpsWaiting: "Esperando GPS",
      accelStateError: "Error",
      accelPreset0to30: "0-30 mph",
      accelPreset0to40: "0-40 mph",
      accelPreset0to50: "0-50 mph",
      accelPreset0to60: "0-60 mph",
      accelPreset0to50Kmh: "0-50 km/h",
      accelPreset0to60Kmh: "0-60 km/h",
      accelPreset0to80Kmh: "0-80 km/h",
      accelPreset0to100Kmh: "0-100 km/h",
      accelPreset60to130: "60-130 mph",
      accelPreset100to200Kmh: "100-200 km/h",
      accelPresetEighthMile: "1/8 de milla",
      accelPresetQuarterMile: "1/4 de milla",
      accelPreset200M: "200 m",
      accelPreset400M: "400 m",
      accelPresetCustom: "Rango personalizado",
      accelRolloutOff: "Apagado",
      accelRolloutOn: "Rollout de 1 pie",
      accelRolloutIgnored: "Ignorado en pruebas lanzadas",
      accelRolloutUnavailable: "No aplica",
      accelStandingStart: "Desde parado",
      accelRollingStart: "Lanzada",
      accelQualityCurrent: "Calidad actual",
      accelWarningAccuracy: "Precision pobre",
      accelWarningSparse: "Actualizaciones dispersas",
      accelWarningStale: "Muestras antiguas",
      accelWarningDerived: "Velocidad derivada",
      accelWarningNoWarnings: "Sin alertas activas",
      accelSpeedReported: "Velocidad GPS reportada",
      accelSpeedDerivedLabel: "Derivada por desplazamiento",
      accelNeedGps: "Necesitas una fijacion GPS actual antes de armar.",
      accelNoGeolocation: "Este navegador no expone geolocalizacion.",
      accelWaitingForFix: "Esperando una fijacion GPS mas limpia.",
      accelCustomInvalid: "El rango personalizado debe terminar por encima de la velocidad inicial.",
      accelArmedStandingNotice: "Prueba lista. Esperando la salida.",
      accelArmedRollingNotice: "Prueba lista. Esperando el cruce de velocidad inicial.",
      accelRunCancelledNotice: "Corrida cancelada.",
      accelRunResetNotice: "Estado de corrida reiniciado.",
      accelRunSavedNotice: "Corrida completada y guardada localmente.",
      accelHistoryClearedNotice: "Historial de corridas borrado.",
      accelDeleteRunConfirm: 'Borrar la corrida "{label}"?',
      accelClearHistoryConfirm: "Borrar todas las corridas guardadas?",
      accelBestRun: "Mejor corrida guardada",
      accelNoComparison: "Aun no hay comparacion guardada",
      accelFasterBy: "{value} mas rapida que la mejor guardada",
      accelSlowerBy: "{value} mas lenta que la mejor guardada",
      accelInvalidBySignal: "Invalida por calidad de senal insuficiente",
      accelNoSavedRunsShort: "Sin corridas guardadas",
      accelMphUnit: "mph",
      accelKmhUnit: "km/h",
      accelUnavailable: "—",
      accelSamplesShort: "{count} muestras",
      accelOff: "Apagado",
      accelOn: "Encendido",
      permission: "Permiso",
      speedometer: "Velocimetro",
      openBoard: "Abrir tablero",
      changeLanguage: "Cambiar idioma",
      heading: "Rumbo",
      altitude: "Altitud",
      distance: "Distancia",
      units: "Unidades",
      off: "Apagado",
      on: "Encendido",
      done: "Listo",
      delete: "Borrar",
      speed: "Velocidad",
      accuracy: "Precision",
    },
  };

  var presetDefinitions = [
    { id: "0-30-mph", type: "speed", labelKey: "accelPreset0to30", standingStart: true, startSpeedMs: 0, targetSpeedMs: 30 * MPH_TO_MS, speedSystem: "mph", variantGroup: "launch-1" },
    { id: "0-40-mph", type: "speed", labelKey: "accelPreset0to40", standingStart: true, startSpeedMs: 0, targetSpeedMs: 40 * MPH_TO_MS, speedSystem: "mph", variantGroup: "launch-2" },
    { id: "0-50-mph", type: "speed", labelKey: "accelPreset0to50", standingStart: true, startSpeedMs: 0, targetSpeedMs: 50 * MPH_TO_MS, speedSystem: "mph", variantGroup: "launch-3" },
    { id: "0-60-mph", type: "speed", labelKey: "accelPreset0to60", standingStart: true, startSpeedMs: 0, targetSpeedMs: 60 * MPH_TO_MS, speedSystem: "mph", variantGroup: "launch-4" },
    { id: "60-130-mph", type: "speed", labelKey: "accelPreset60to130", standingStart: false, startSpeedMs: 60 * MPH_TO_MS, targetSpeedMs: 130 * MPH_TO_MS, speedSystem: "mph", variantGroup: "roll-1" },
    { id: "0-50-kmh", type: "speed", labelKey: "accelPreset0to50Kmh", standingStart: true, startSpeedMs: 0, targetSpeedMs: 50 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "launch-1" },
    { id: "0-60-kmh", type: "speed", labelKey: "accelPreset0to60Kmh", standingStart: true, startSpeedMs: 0, targetSpeedMs: 60 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "launch-2" },
    { id: "0-80-kmh", type: "speed", labelKey: "accelPreset0to80Kmh", standingStart: true, startSpeedMs: 0, targetSpeedMs: 80 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "launch-3" },
    { id: "0-100-kmh", type: "speed", labelKey: "accelPreset0to100Kmh", standingStart: true, startSpeedMs: 0, targetSpeedMs: 100 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "launch-4" },
    { id: "100-200-kmh", type: "speed", labelKey: "accelPreset100to200Kmh", standingStart: false, startSpeedMs: 100 * KMH_TO_MS, targetSpeedMs: 200 * KMH_TO_MS, speedSystem: "kmh", variantGroup: "roll-1" },
    { id: "eighth-mile", type: "distance", labelKey: "accelPresetEighthMile", standingStart: true, distanceTargetM: EIGHTH_MILE_M, distanceSystem: "ft", variantGroup: "distance-short" },
    { id: "quarter-mile", type: "distance", labelKey: "accelPresetQuarterMile", standingStart: true, distanceTargetM: QUARTER_MILE_M, distanceSystem: "ft", variantGroup: "distance-long" },
    { id: "200-m", type: "distance", labelKey: "accelPreset200M", standingStart: true, distanceTargetM: 200, distanceSystem: "m", variantGroup: "distance-short" },
    { id: "400-m", type: "distance", labelKey: "accelPreset400M", standingStart: true, distanceTargetM: 400, distanceSystem: "m", variantGroup: "distance-long" },
    { id: "custom", type: "custom", labelKey: "accelPresetCustom", standingStart: false, variantGroup: "custom" },
  ];

  var distancePartialDefinitions = {
    ft: [
      { id: "60-ft", kind: "distance", labelKey: "accelPartial60ft", distanceM: 60 * FT_TO_M, showTrapSpeed: false },
      { id: "eighth-mile", kind: "distance", labelKey: "accelPresetEighthMile", distanceM: EIGHTH_MILE_M, showTrapSpeed: true },
      { id: "1000-ft", kind: "distance", labelKey: "accelPartial1000ft", distanceM: 1000 * FT_TO_M, showTrapSpeed: true },
      { id: "quarter-mile", kind: "distance", labelKey: "accelPresetQuarterMile", distanceM: QUARTER_MILE_M, showTrapSpeed: true },
    ],
    m: [
      { id: "100-m", kind: "distance", labelKey: "accelPartial100m", distanceM: 100, showTrapSpeed: false },
      { id: "200-m", kind: "distance", labelKey: "accelPreset200M", distanceM: 200, showTrapSpeed: true },
      { id: "400-m", kind: "distance", labelKey: "accelPreset400M", distanceM: 400, showTrapSpeed: true },
    ],
  };

  var speedPartialDefinitions = {
    mph: [
      { id: "0-60-mph", kind: "speed", labelKey: "accelPreset0to60", startSpeedMs: 0, targetSpeedMs: 60 * MPH_TO_MS },
      { id: "60-130-mph", kind: "speed", labelKey: "accelPreset60to130", startSpeedMs: 60 * MPH_TO_MS, targetSpeedMs: 130 * MPH_TO_MS },
      { id: "0-130-mph", kind: "speed", labelKey: "accelPartial0to130", startSpeedMs: 0, targetSpeedMs: 130 * MPH_TO_MS },
    ],
    kmh: [
      { id: "0-100-kmh", kind: "speed", labelKey: "accelPreset0to100Kmh", startSpeedMs: 0, targetSpeedMs: 100 * KMH_TO_MS },
      { id: "100-200-kmh", kind: "speed", labelKey: "accelPreset100to200Kmh", startSpeedMs: 100 * KMH_TO_MS, targetSpeedMs: 200 * KMH_TO_MS },
      { id: "0-200-kmh", kind: "speed", labelKey: "accelPartial0to200Kmh", startSpeedMs: 0, targetSpeedMs: 200 * KMH_TO_MS },
    ],
  };

  var elements = {
    langToggle: document.getElementById("langToggle"),
    pageDescriptionMeta: document.querySelector('meta[name="description"]'),
    sheetBackdrop: document.getElementById("accelSheetBackdrop"),
    setupTrigger: document.getElementById("setupTrigger"),
    setupTriggerValue: document.getElementById("setupTriggerValue"),
    setupTriggerMeta: document.getElementById("setupTriggerMeta"),
    resultsTrigger: document.getElementById("resultsTrigger"),
    resultsTriggerValue: document.getElementById("resultsTriggerValue"),
    resultsTriggerMeta: document.getElementById("resultsTriggerMeta"),
    toolbarPermissionValue: document.getElementById("toolbarPermissionValue"),
    toolbarQualityValue: document.getElementById("toolbarQualityValue"),
    toolbarStateValue: document.getElementById("toolbarStateValue"),
    setupPanel: document.getElementById("setupPanel"),
    closeSetupPanel: document.getElementById("closeSetupPanel"),
    setupPanelStatus: document.getElementById("setupPanelStatus"),
    resultsPanel: document.getElementById("resultsPanel"),
    closeResultsPanel: document.getElementById("closeResultsPanel"),
    resultsPanelStatus: document.getElementById("resultsPanelStatus"),
    permissionValue: document.getElementById("permissionValue"),
    gpsReadyValue: document.getElementById("gpsReadyValue"),
    latestAccuracyValue: document.getElementById("latestAccuracyValue"),
    observedHzValue: document.getElementById("observedHzValue"),
    statusSpeedValue: document.getElementById("statusSpeedValue"),
    statusHeadingValue: document.getElementById("statusHeadingValue"),
    statusAltitudeValue: document.getElementById("statusAltitudeValue"),
    speedSourceValue: document.getElementById("speedSourceValue"),
    presetGrid: document.getElementById("presetGrid"),
    customRangePanel: document.getElementById("customRangePanel"),
    customStartInput: document.getElementById("customStartInput"),
    customEndInput: document.getElementById("customEndInput"),
    speedUnitMph: document.getElementById("speedUnitMph"),
    speedUnitKmh: document.getElementById("speedUnitKmh"),
    distanceUnitFt: document.getElementById("distanceUnitFt"),
    distanceUnitM: document.getElementById("distanceUnitM"),
    customRangeNotice: document.getElementById("customRangeNotice"),
    armRun: document.getElementById("armRun"),
    cancelRun: document.getElementById("cancelRun"),
    rolloutOff: document.getElementById("rolloutOff"),
    rolloutOn: document.getElementById("rolloutOn"),
    launchThresholdHalf: document.getElementById("launchThresholdHalf"),
    launchThresholdOne: document.getElementById("launchThresholdOne"),
    runNotes: document.getElementById("runNotes"),
    actionNotice: document.getElementById("actionNotice"),
    liveElapsedValue: document.getElementById("liveElapsedValue"),
    liveSpeedGaugeStage: document.getElementById("liveSpeedGaugeStage"),
    liveSpeedGaugeInner: document.getElementById("liveSpeedGaugeInner"),
    liveSpeedDial: document.getElementById("liveSpeedDial"),
    liveSpeedNeedle: document.getElementById("liveSpeedNeedle"),
    liveSpeedValue: document.getElementById("liveSpeedValue"),
    liveSpeedUnit: document.getElementById("liveSpeedUnit"),
    liveSpeedSubstatus: document.getElementById("liveSpeedSubstatus"),
    liveDistanceValue: document.getElementById("liveDistanceValue"),
    liveSlopeValue: document.getElementById("liveSlopeValue"),
    liveTargetValue: document.getElementById("liveTargetValue"),
    liveStateValue: document.getElementById("liveStateValue"),
    liveQualityValue: document.getElementById("liveQualityValue"),
    livePartialsSection: document.getElementById("livePartialsSection"),
    livePartialsList: document.getElementById("livePartialsList"),
    progressLabel: document.getElementById("progressLabel"),
    progressFill: document.getElementById("progressFill"),
    resultEmptyState: document.getElementById("resultEmptyState"),
    resultContent: document.getElementById("resultContent"),
    resultPrimaryHeader: document.getElementById("resultPrimaryHeader"),
    resultElapsedValue: document.getElementById("resultElapsedValue"),
    resultGraphMeta: document.getElementById("resultGraphMeta"),
    resultGraphEmptyState: document.getElementById("resultGraphEmptyState"),
    resultGraphFrame: document.getElementById("resultGraphFrame"),
    resultGraphCanvas: document.getElementById("resultGraphCanvas"),
    resultGraphTimeValue: document.getElementById("resultGraphTimeValue"),
    resultGraphSpeedValue: document.getElementById("resultGraphSpeedValue"),
    resultGraphDistanceValue: document.getElementById("resultGraphDistanceValue"),
    resultGraphAltitudeValue: document.getElementById("resultGraphAltitudeValue"),
    resultGraphAccuracyValue: document.getElementById("resultGraphAccuracyValue"),
    resultGraphSlopeValue: document.getElementById("resultGraphSlopeValue"),
    resultPartialsSection: document.getElementById("resultPartialsSection"),
    resultPartialsList: document.getElementById("resultPartialsList"),
    resultPresetValue: document.getElementById("resultPresetValue"),
    resultFinishSpeedValue: document.getElementById("resultFinishSpeedValue"),
    resultRolloutValue: document.getElementById("resultRolloutValue"),
    resultAccuracyValue: document.getElementById("resultAccuracyValue"),
    resultSlopeValue: document.getElementById("resultSlopeValue"),
    resultElevationValue: document.getElementById("resultElevationValue"),
    resultHzValue: document.getElementById("resultHzValue"),
    resultQualityValue: document.getElementById("resultQualityValue"),
    resultTimestampValue: document.getElementById("resultTimestampValue"),
    resultComparisonValue: document.getElementById("resultComparisonValue"),
    resultNotesRow: document.getElementById("resultNotesRow"),
    resultNotesValue: document.getElementById("resultNotesValue"),
    warningBadges: document.getElementById("warningBadges"),
    diagnosticAverageIntervalValue: document.getElementById("diagnosticAverageIntervalValue"),
    diagnosticJitterValue: document.getElementById("diagnosticJitterValue"),
    diagnosticSparseValue: document.getElementById("diagnosticSparseValue"),
    diagnosticStaleValue: document.getElementById("diagnosticStaleValue"),
    diagnosticSpeedSourceValue: document.getElementById("diagnosticSpeedSourceValue"),
    diagnosticSamplesValue: document.getElementById("diagnosticSamplesValue"),
    clearHistory: document.getElementById("clearHistory"),
    historyEmptyState: document.getElementById("historyEmptyState"),
    historyList: document.getElementById("historyList"),
  };

  var liveSpeedometer = createAnalogSpeedometer({
    stageElement: elements.liveSpeedGaugeStage,
    stageInnerElement: elements.liveSpeedGaugeInner,
    dialCanvas: elements.liveSpeedDial,
    needleCanvas: elements.liveSpeedNeedle,
    valueElement: elements.liveSpeedValue,
    unitElement: elements.liveSpeedUnit,
    substatusElement: elements.liveSpeedSubstatus,
    styleSourceElement: elements.liveSpeedGaugeStage,
  });

  var defaultSettings = {
    selectedPresetId: "0-60-mph",
    rolloutEnabled: false,
    launchThresholdMs: 0.5 * MPH_TO_MS,
    speedUnit: "mph",
    distanceUnit: "ft",
    customStart: 0,
    customEnd: 60,
    notes: "",
  };

  var state = {
    lang: detectLang(),
    permissionState: "prompt",
    permissionStatus: null,
    geolocationSupported: Boolean(navigator.geolocation),
    watchId: null,
    uiTimerId: null,
    sessionSampleCount: 0,
    sessionIntervals: [],
    recentIntervals: [],
    latestSample: null,
    currentQuality: null,
    runs: loadRuns(),
    settings: loadSettings(),
    run: null,
    latestResult: null,
    selectedResultId: "",
    openPanel: null,
    actionNoticeTimerId: null,
  };

  state.latestResult = state.runs.length ? state.runs[0] : null;
  state.selectedResultId = state.latestResult ? state.latestResult.id : "";

  init();

  function init() {
    applyTranslations();
    elements.runNotes.value = state.settings.notes;
    if (syncSelectedPresetForUnits()) saveSettings();
    renderPresetButtons();
    renderControlSelections();
    bindEvents();
    setupResultGraphObservers();
    renderAll();
    startUiTimer();
    updatePermissionState();
    ensureWatch();
  }

  function detectLang() {
    try {
      var stored = localStorage.getItem(LANG_KEY);
      if (stored === "en" || stored === "es") return stored;
    } catch (error) {
      // Ignore storage failures.
    }

    if (window.__lang === "es" || window.__lang === "en") return window.__lang;
    return navigator.language && navigator.language.startsWith("es") ? "es" : "en";
  }

  function primeFinishAudio() {
    if (!finishAudio) return Promise.resolve(false);
    if (finishAudioPrimed) return Promise.resolve(true);
    if (finishAudioPrimePromise) return finishAudioPrimePromise;

    finishAudioPrimePromise = (async function () {
      var previousMuted = finishAudio.muted;
      var previousVolume = finishAudio.volume;
      var previousLoop = finishAudio.loop;

      try {
        finishAudio.muted = true;
        finishAudio.volume = 0;
        finishAudio.loop = false;
        finishAudio.currentTime = 0;
        var playPromise = finishAudio.play();
        if (playPromise && typeof playPromise.then === "function") await playPromise;
        finishAudio.pause();
        finishAudio.currentTime = 0;
        finishAudioPrimed = true;
        return true;
      } catch (error) {
        finishAudio.pause();
        finishAudio.currentTime = 0;
        finishAudioPrimed = false;
        return false;
      } finally {
        finishAudio.muted = previousMuted;
        finishAudio.volume = previousVolume;
        finishAudio.loop = previousLoop;
        finishAudioPrimePromise = null;
      }
    })();

    return finishAudioPrimePromise;
  }

  function playFinishAudio() {
    if (!finishAudio) return;

    try {
      finishAudio.pause();
      finishAudio.currentTime = 0;
      var playPromise = finishAudio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(function () {
          // Ignore autoplay or playback failures.
        });
      }
    } catch (error) {
      // Ignore autoplay or playback failures.
    }
  }

  function t(key, params) {
    var pack = translations[state.lang] || translations.en;
    var fallbackPack = translations.en;
    var text = pack[key] || fallbackPack[key] || key;

    if (!params) return text;

    return text.replace(/\{(\w+)\}/g, function (match, token) {
      return Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : match;
    });
  }

  function applyTranslations() {
    document.title = t("accelPageTitle");
    if (elements.pageDescriptionMeta) elements.pageDescriptionMeta.setAttribute("content", t("accelPageDescription"));
    if (elements.langToggle) elements.langToggle.textContent = state.lang.toUpperCase();

    var textNodes = document.querySelectorAll("[data-i18n]");
    for (var index = 0; index < textNodes.length; index += 1) {
      var node = textNodes[index];
      var key = node.getAttribute("data-i18n");
      node.textContent = t(key);
    }

    var titleNodes = document.querySelectorAll("[data-i18n-title]");
    for (var titleIndex = 0; titleIndex < titleNodes.length; titleIndex += 1) {
      var titleNode = titleNodes[titleIndex];
      titleNode.setAttribute("title", t(titleNode.getAttribute("data-i18n-title")));
    }

    var ariaNodes = document.querySelectorAll("[data-i18n-aria]");
    for (var ariaIndex = 0; ariaIndex < ariaNodes.length; ariaIndex += 1) {
      var ariaNode = ariaNodes[ariaIndex];
      ariaNode.setAttribute("aria-label", t(ariaNode.getAttribute("data-i18n-aria")));
    }

    var placeholderNodes = document.querySelectorAll("[data-i18n-placeholder]");
    for (var placeholderIndex = 0; placeholderIndex < placeholderNodes.length; placeholderIndex += 1) {
      var placeholderNode = placeholderNodes[placeholderIndex];
      placeholderNode.setAttribute("placeholder", t(placeholderNode.getAttribute("data-i18n-placeholder")));
    }
  }

  function bindEvents() {
    elements.langToggle.addEventListener("click", handleLangToggle);
    elements.setupTrigger.addEventListener("click", function () {
      togglePanel("setup");
    });
    elements.resultsTrigger.addEventListener("click", function () {
      togglePanel("results");
    });
    elements.closeSetupPanel.addEventListener("click", closePanel);
    elements.closeResultsPanel.addEventListener("click", closePanel);
    elements.sheetBackdrop.addEventListener("click", closePanel);
    elements.presetGrid.addEventListener("click", handlePresetClick);
    elements.customStartInput.addEventListener("input", handleCustomInput);
    elements.customEndInput.addEventListener("input", handleCustomInput);
    elements.speedUnitMph.addEventListener("click", handleSpeedUnitClick);
    elements.speedUnitKmh.addEventListener("click", handleSpeedUnitClick);
    elements.distanceUnitFt.addEventListener("click", handleDistanceUnitClick);
    elements.distanceUnitM.addEventListener("click", handleDistanceUnitClick);
    elements.armRun.addEventListener("click", handleArm);
    elements.cancelRun.addEventListener("click", handleCancel);
    elements.rolloutOff.addEventListener("click", handleRolloutClick);
    elements.rolloutOn.addEventListener("click", handleRolloutClick);
    elements.launchThresholdHalf.addEventListener("click", handleThresholdClick);
    elements.launchThresholdOne.addEventListener("click", handleThresholdClick);
    elements.runNotes.addEventListener("input", handleNotesInput);
    elements.clearHistory.addEventListener("click", handleClearHistory);
    elements.historyList.addEventListener("click", handleHistoryClick);
    document.addEventListener("visibilitychange", renderAll);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pagehide", destroyResultGraph);
    window.addEventListener("resize", requestResultGraphRefresh);
  }

  function setupResultGraphObservers() {
    if (!elements.resultsPanel || typeof ResizeObserver !== "function") return;

    resultGraphResizeObserver = new ResizeObserver(function () {
      var panelWidth = Math.floor(elements.resultsPanel.clientWidth || elements.resultsPanel.getBoundingClientRect().width || 0);
      if (panelWidth < 120 || panelWidth === resultGraphObservedPanelWidth) return;
      resultGraphObservedPanelWidth = panelWidth;
      requestResultGraphRefresh();
    });
    resultGraphResizeObserver.observe(elements.resultsPanel);
  }

  function handleLangToggle() {
    state.lang = state.lang === "en" ? "es" : "en";

    try {
      localStorage.setItem(LANG_KEY, state.lang);
    } catch (error) {
      // Ignore storage failures.
    }

    document.documentElement.lang = state.lang;
    applyTranslations();
    renderPresetButtons();
    renderAll();
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape" || !state.openPanel) return;
    event.preventDefault();
    closePanel();
  }

  function openPanel(panelName) {
    if (state.openPanel === panelName) return;
    state.openPanel = panelName;
    if (panelName === "results" && elements.resultsPanel) {
      resultGraphObservedPanelWidth = Math.floor(elements.resultsPanel.clientWidth || elements.resultsPanel.getBoundingClientRect().width || 0);
    }
    renderSheetUi();

    var focusTarget = panelName === "setup" ? elements.closeSetupPanel : elements.closeResultsPanel;
    if (focusTarget) focusTarget.focus();
  }

  function closePanel() {
    if (!state.openPanel) return;

    var previouslyOpen = state.openPanel;
    state.openPanel = null;
    renderSheetUi();

    var trigger = previouslyOpen === "setup" ? elements.setupTrigger : elements.resultsTrigger;
    if (trigger) trigger.focus();
  }

  function togglePanel(panelName) {
    if (state.openPanel === panelName) {
      closePanel();
      return;
    }

    openPanel(panelName);
  }

  function normalizeSpeedUnit(unit) {
    return unit === "kmh" ? "kmh" : "mph";
  }

  function normalizeDistanceUnit(unit) {
    return unit === "m" ? "m" : "ft";
  }

  function loadSharedSpeedUnitPreference() {
    try {
      var unit = localStorage.getItem(SHARED_SPEED_UNIT_KEY);
      return unit && SPEED_UNIT_CONFIG[unit] ? unit : null;
    } catch (error) {
      return null;
    }
  }

  function loadSharedDistanceUnitPreference() {
    try {
      var unit = localStorage.getItem(SHARED_DISTANCE_UNIT_KEY);
      if (unit && DISTANCE_UNIT_CONFIG[unit]) return unit;

      var legacyUnit = localStorage.getItem(SHARED_LEGACY_ALTITUDE_UNIT_KEY);
      return legacyUnit && DISTANCE_UNIT_CONFIG[legacyUnit] ? legacyUnit : null;
    } catch (error) {
      return null;
    }
  }

  function getDefaultSpeedUnit(selectedPresetId) {
    var sharedUnit = loadSharedSpeedUnitPreference();
    if (sharedUnit) return sharedUnit;
    var preset = findPresetDefinition(selectedPresetId);
    if (preset && preset.speedSystem) return preset.speedSystem;
    return "mph";
  }

  function getDefaultDistanceUnit(selectedPresetId) {
    var sharedUnit = loadSharedDistanceUnitPreference();
    if (sharedUnit) return sharedUnit;
    var preset = findPresetDefinition(selectedPresetId);
    if (preset && preset.distanceSystem) return preset.distanceSystem;
    return "ft";
  }

  function loadSettings() {
    var raw = loadJson(STORAGE_KEYS.settings);
    var settings = raw && typeof raw === "object" ? raw : {};
    var selectedPresetId = typeof settings.selectedPresetId === "string" ? settings.selectedPresetId : defaultSettings.selectedPresetId;
    var speedUnit = normalizeSpeedUnit(settings.speedUnit || settings.customUnit || getDefaultSpeedUnit(selectedPresetId));
    var distanceUnit = normalizeDistanceUnit(settings.distanceUnit || getDefaultDistanceUnit(selectedPresetId));
    var defaultCustomEnd = speedUnit === "kmh" ? 100 : defaultSettings.customEnd;
    var launchThresholdMs = isFiniteNumber(settings.launchThresholdMs)
      ? settings.launchThresholdMs
      : ((settings.launchThresholdMph === 1 ? 1 : 0.5) * MPH_TO_MS);

    return {
      selectedPresetId: selectedPresetId,
      rolloutEnabled: Boolean(settings.rolloutEnabled),
      launchThresholdMs: launchThresholdMs,
      speedUnit: speedUnit,
      distanceUnit: distanceUnit,
      customStart: toFiniteNumber(settings.customStart, defaultSettings.customStart),
      customEnd: toFiniteNumber(settings.customEnd, defaultCustomEnd),
      notes: typeof settings.notes === "string" ? settings.notes : "",
    };
  }

  function saveSettings() {
    saveJson(STORAGE_KEYS.settings, state.settings);
  }

  function loadRuns() {
    var raw = loadJson(STORAGE_KEYS.runs);
    if (!Array.isArray(raw)) return [];

    var runs = [];
    for (var index = 0; index < raw.length; index += 1) {
      var run = normalizeStoredRun(raw[index]);
      if (run) runs.push(run);
    }

    runs.sort(function (left, right) {
      return right.savedAtMs - left.savedAtMs;
    });

    return runs.slice(0, MAX_RUNS);
  }

  function saveRuns() {
    saveJson(STORAGE_KEYS.runs, state.runs.slice(0, MAX_RUNS));
  }

  function normalizeStoredRun(run) {
    if (!run || typeof run !== "object") return null;
    if (!isFiniteNumber(run.savedAtMs) || !isFiniteNumber(run.elapsedMs)) return null;

    var presetId = typeof run.presetId === "string" ? run.presetId : "custom";
    var startSpeedMs = isFiniteNumber(run.startSpeedMs) ? run.startSpeedMs : 0;
    var targetSpeedMs = isFiniteNumber(run.targetSpeedMs) ? run.targetSpeedMs : null;
    var presetKind = typeof run.presetKind === "string" ? run.presetKind : "speed";
    var speedTrace = normalizeStoredSpeedTrace(run.speedTrace);
    var partials = normalizeStoredPartials(run.partials);
    var finishSpeedMs = isFiniteNumber(run.finishSpeedMs)
      ? run.finishSpeedMs
      : (isFiniteNumber(run.trapSpeedMs)
        ? run.trapSpeedMs
        : (presetKind === "speed" && isFiniteNumber(targetSpeedMs) ? targetSpeedMs : null));
    var presetSignature = typeof run.presetSignature === "string" ? run.presetSignature : presetId;
    var comparisonSignature = typeof run.comparisonSignature === "string"
      ? run.comparisonSignature
      : buildComparisonSignature({
        presetId: presetId,
        presetSignature: presetSignature,
        startSpeedMs: startSpeedMs,
        targetSpeedMs: targetSpeedMs,
      });

    if (presetId === "custom" && isFiniteNumber(startSpeedMs) && isFiniteNumber(targetSpeedMs)) {
      presetSignature = getCustomPresetSignature(startSpeedMs, targetSpeedMs);
    }

    return {
      id: typeof run.id === "string" ? run.id : "run-" + String(run.savedAtMs),
      savedAtMs: run.savedAtMs,
      presetId: presetId,
      presetSignature: presetSignature,
      comparisonSignature: comparisonSignature,
      presetKind: presetKind,
      standingStart: Boolean(run.standingStart),
      customStart: isFiniteNumber(run.customStart) ? run.customStart : null,
      customEnd: isFiniteNumber(run.customEnd) ? run.customEnd : null,
      customUnit: run.customUnit === "kmh" ? "kmh" : (run.customUnit === "mph" ? "mph" : null),
      startSpeedMs: startSpeedMs,
      targetSpeedMs: targetSpeedMs,
      distanceTargetM: isFiniteNumber(run.distanceTargetM) ? run.distanceTargetM : null,
      displayUnit: run.displayUnit === "kmh" ? "kmh" : "mph",
      distanceDisplay: run.distanceDisplay === "m" ? "m" : "ft",
      elapsedMs: run.elapsedMs,
      speedTrace: speedTrace,
      partials: partials,
      finishSpeedMs: finishSpeedMs,
      trapSpeedMs: isFiniteNumber(run.trapSpeedMs) ? run.trapSpeedMs : null,
      rolloutApplied: Boolean(run.rolloutApplied),
      launchThresholdMs: isFiniteNumber(run.launchThresholdMs) ? run.launchThresholdMs : null,
      rolloutDistanceM: isFiniteNumber(run.rolloutDistanceM) ? run.rolloutDistanceM : null,
      averageAccuracyM: isFiniteNumber(run.averageAccuracyM) ? run.averageAccuracyM : null,
      runDistanceM: isFiniteNumber(run.runDistanceM) ? run.runDistanceM : null,
      finishDistanceM: isFiniteNumber(run.finishDistanceM) ? run.finishDistanceM : null,
      startAccuracyM: isFiniteNumber(run.startAccuracyM) ? run.startAccuracyM : null,
      startAltitudeM: isFiniteNumber(run.startAltitudeM) ? run.startAltitudeM : null,
      finishAltitudeM: isFiniteNumber(run.finishAltitudeM) ? run.finishAltitudeM : null,
      elevationDeltaM: isFiniteNumber(run.elevationDeltaM) ? run.elevationDeltaM : null,
      slopePercent: isFiniteNumber(run.slopePercent) ? run.slopePercent : null,
      averageHz: isFiniteNumber(run.averageHz) ? run.averageHz : null,
      averageIntervalMs: isFiniteNumber(run.averageIntervalMs) ? run.averageIntervalMs : null,
      jitterMs: isFiniteNumber(run.jitterMs) ? run.jitterMs : null,
      qualityGrade: typeof run.qualityGrade === "string" ? run.qualityGrade : "invalid",
      qualityScore: isFiniteNumber(run.qualityScore) ? run.qualityScore : 0,
      warningKeys: Array.isArray(run.warningKeys) ? run.warningKeys.slice(0, 8) : [],
      sampleCount: isFiniteNumber(run.sampleCount) ? run.sampleCount : 0,
      sparseCount: isFiniteNumber(run.sparseCount) ? run.sparseCount : 0,
      staleCount: isFiniteNumber(run.staleCount) ? run.staleCount : 0,
      nullSpeedCount: isFiniteNumber(run.nullSpeedCount) ? run.nullSpeedCount : 0,
      derivedSpeedCount: isFiniteNumber(run.derivedSpeedCount) ? run.derivedSpeedCount : 0,
      speedSource: typeof run.speedSource === "string" ? run.speedSource : "reported",
      startSpeedSource: typeof run.startSpeedSource === "string" ? run.startSpeedSource : null,
      notes: typeof run.notes === "string" ? run.notes : "",
    };
  }

  function loadJson(key) {
    try {
      var value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Ignore storage failures in constrained browsers.
    }
  }

  function toFiniteNumber(value, fallback) {
    return isFiniteNumber(Number(value)) ? Number(value) : fallback;
  }

  function isFiniteNumber(value) {
    return Number.isFinite(value);
  }

  function normalizeStoredSpeedTrace(trace) {
    if (!Array.isArray(trace) || !trace.length) return [];

    var normalized = [];
    for (var index = 0; index < trace.length; index += 1) {
      var point = trace[index];
      if (!point || typeof point !== "object") continue;
      if (!isFiniteNumber(point.elapsedMs) || !isFiniteNumber(point.speedMs)) continue;
      var normalizedPoint = {
        elapsedMs: Math.max(0, point.elapsedMs),
        speedMs: Math.max(0, point.speedMs),
      };
      if (isFiniteNumber(point.distanceM)) normalizedPoint.distanceM = Math.max(0, point.distanceM);
      if (isFiniteNumber(point.altitudeM)) normalizedPoint.altitudeM = point.altitudeM;
      if (isFiniteNumber(point.accuracyM)) normalizedPoint.accuracyM = Math.max(0, point.accuracyM);
      if (typeof point.speedSource === "string") normalizedPoint.speedSource = point.speedSource;
      normalized.push(normalizedPoint);
    }

    if (!normalized.length) return [];
    normalized.sort(function (left, right) {
      return left.elapsedMs - right.elapsedMs;
    });
    return compactSpeedTrace(normalized);
  }

  function normalizeStoredPartials(partials) {
    if (!Array.isArray(partials) || !partials.length) return [];

    var normalized = [];
    for (var index = 0; index < partials.length; index += 1) {
      var partial = partials[index];
      if (!partial || typeof partial !== "object" || typeof partial.kind !== "string") continue;

      if (partial.kind === "distance") {
        if (!isFiniteNumber(partial.distanceM)) continue;
        normalized.push({
          id: typeof partial.id === "string" ? partial.id : "distance-" + String(index),
          kind: "distance",
          labelKey: typeof partial.labelKey === "string" ? partial.labelKey : "accelUnavailable",
          distanceM: Math.max(0, partial.distanceM),
          showTrapSpeed: Boolean(partial.showTrapSpeed),
          elapsedMs: isFiniteNumber(partial.elapsedMs) ? Math.max(0, partial.elapsedMs) : null,
          trapSpeedMs: isFiniteNumber(partial.trapSpeedMs) ? Math.max(0, partial.trapSpeedMs) : null,
        });
        continue;
      }

      if (partial.kind === "speed") {
        if (!isFiniteNumber(partial.startSpeedMs) || !isFiniteNumber(partial.targetSpeedMs)) continue;
        normalized.push({
          id: typeof partial.id === "string" ? partial.id : "speed-" + String(index),
          kind: "speed",
          labelKey: typeof partial.labelKey === "string" ? partial.labelKey : "accelUnavailable",
          startSpeedMs: Math.max(0, partial.startSpeedMs),
          targetSpeedMs: Math.max(0, partial.targetSpeedMs),
          elapsedMs: isFiniteNumber(partial.elapsedMs) ? Math.max(0, partial.elapsedMs) : null,
        });
      }
    }

    return normalized;
  }

  function serializeRunPartials(partials) {
    if (!Array.isArray(partials) || !partials.length) return [];

    var serialized = [];
    for (var index = 0; index < partials.length; index += 1) {
      var partial = partials[index];
      if (!partial || typeof partial !== "object" || typeof partial.kind !== "string") continue;

      if (partial.kind === "distance") {
        if (!isFiniteNumber(partial.distanceM)) continue;
        serialized.push({
          id: partial.id,
          kind: "distance",
          labelKey: partial.labelKey,
          distanceM: partial.distanceM,
          showTrapSpeed: Boolean(partial.showTrapSpeed),
          elapsedMs: isFiniteNumber(partial.elapsedMs) ? partial.elapsedMs : null,
          trapSpeedMs: isFiniteNumber(partial.trapSpeedMs) ? partial.trapSpeedMs : null,
        });
        continue;
      }

      if (partial.kind === "speed") {
        if (!isFiniteNumber(partial.startSpeedMs) || !isFiniteNumber(partial.targetSpeedMs)) continue;
        serialized.push({
          id: partial.id,
          kind: "speed",
          labelKey: partial.labelKey,
          startSpeedMs: partial.startSpeedMs,
          targetSpeedMs: partial.targetSpeedMs,
          elapsedMs: isFiniteNumber(partial.elapsedMs) ? partial.elapsedMs : null,
        });
      }
    }

    return serialized;
  }

  function findPresetDefinition(presetId) {
    for (var index = 0; index < presetDefinitions.length; index += 1) {
      if (presetDefinitions[index].id === presetId) return presetDefinitions[index];
    }
    return null;
  }

  function isPresetAvailableForUnits(preset, speedUnit, distanceUnit) {
    if (!preset) return false;
    if (preset.id === "custom") return true;
    if (preset.type === "speed") return preset.speedSystem === normalizeSpeedUnit(speedUnit);
    if (preset.type === "distance") return preset.distanceSystem === normalizeDistanceUnit(distanceUnit);
    return false;
  }

  function getAvailablePresetDefinitions(speedUnit, distanceUnit) {
    var normalizedSpeedUnit = normalizeSpeedUnit(speedUnit || state.settings.speedUnit);
    var normalizedDistanceUnit = normalizeDistanceUnit(distanceUnit || state.settings.distanceUnit);
    var available = [];

    for (var index = 0; index < presetDefinitions.length; index += 1) {
      var preset = presetDefinitions[index];
      if (isPresetAvailableForUnits(preset, normalizedSpeedUnit, normalizedDistanceUnit)) available.push(preset);
    }

    return available;
  }

  function getDefaultSpeedPresetId(speedUnit) {
    return normalizeSpeedUnit(speedUnit) === "kmh" ? "0-100-kmh" : "0-60-mph";
  }

  function getDefaultDistancePresetId(distanceUnit) {
    return normalizeDistanceUnit(distanceUnit) === "m" ? "400-m" : "quarter-mile";
  }

  function resolvePresetIdForUnits(presetId, speedUnit, distanceUnit) {
    if (presetId === "custom") return "custom";

    var preset = findPresetDefinition(presetId);
    if (!preset) return getDefaultSpeedPresetId(speedUnit);
    if (isPresetAvailableForUnits(preset, speedUnit, distanceUnit)) return preset.id;

    for (var index = 0; index < presetDefinitions.length; index += 1) {
      var candidate = presetDefinitions[index];
      if (candidate.variantGroup !== preset.variantGroup) continue;
      if (isPresetAvailableForUnits(candidate, speedUnit, distanceUnit)) return candidate.id;
    }

    if (preset.type === "distance") return getDefaultDistancePresetId(distanceUnit);
    return getDefaultSpeedPresetId(speedUnit);
  }

  function syncSelectedPresetForUnits() {
    var resolvedPresetId = resolvePresetIdForUnits(
      state.settings.selectedPresetId,
      state.settings.speedUnit,
      state.settings.distanceUnit
    );

    if (resolvedPresetId === state.settings.selectedPresetId) return false;
    state.settings.selectedPresetId = resolvedPresetId;
    return true;
  }

  function getSelectedPreset() {
    var selectedPresetId = resolvePresetIdForUnits(
      state.settings.selectedPresetId,
      state.settings.speedUnit,
      state.settings.distanceUnit
    );

    if (selectedPresetId === "custom") return buildCustomPreset();

    for (var index = 0; index < presetDefinitions.length; index += 1) {
      if (presetDefinitions[index].id === selectedPresetId) return copyPreset(presetDefinitions[index]);
    }

    return copyPreset(findPresetDefinition(getDefaultSpeedPresetId(state.settings.speedUnit)));
  }

  function copyPreset(preset) {
    return {
      id: preset.id,
      type: preset.type,
      labelKey: preset.labelKey,
      standingStart: Boolean(preset.standingStart),
      startSpeedMs: isFiniteNumber(preset.startSpeedMs) ? preset.startSpeedMs : 0,
      targetSpeedMs: isFiniteNumber(preset.targetSpeedMs) ? preset.targetSpeedMs : null,
      distanceTargetM: isFiniteNumber(preset.distanceTargetM) ? preset.distanceTargetM : null,
      speedSystem: preset.speedSystem || null,
      distanceSystem: preset.distanceSystem || null,
      variantGroup: preset.variantGroup || preset.id,
      customStart: null,
      customEnd: null,
      customUnit: null,
    };
  }

  function buildCustomPreset() {
    var start = Math.max(0, Number(state.settings.customStart) || 0);
    var end = Math.max(0, Number(state.settings.customEnd) || 0);
    var unit = state.settings.speedUnit;
    var factor = unit === "kmh" ? KMH_TO_MS : MPH_TO_MS;

    return {
      id: "custom",
      type: "speed",
      labelKey: "accelPresetCustom",
      standingStart: start <= 0,
      startSpeedMs: start * factor,
      targetSpeedMs: end * factor,
      distanceTargetM: null,
      customStart: start,
      customEnd: end,
      customUnit: unit,
    };
  }

  function getPresetLabel(presetOrRun) {
    if (!presetOrRun) return t("accelUnavailable");

    if (presetOrRun.id === "custom" || presetOrRun.presetId === "custom") {
      if (!isFiniteNumber(presetOrRun.targetSpeedMs)) {
        return t("accelPresetCustom");
      }
      var speedUnit = state.settings.speedUnit;
      var start = msToSpeedUnit(presetOrRun.startSpeedMs || 0, speedUnit);
      var end = msToSpeedUnit(presetOrRun.targetSpeedMs || 0, speedUnit);
      return t("accelPresetCustom") + " · " + formatAdaptiveNumber(start) + "-" + formatAdaptiveNumber(end) + " " + getSpeedUnitLabel(speedUnit);
    }

    return t(presetOrRun.labelKey || presetKeyFromId(presetOrRun.presetId));
  }

  function getPresetMetaLabel(presetOrRun) {
    if (!presetOrRun) return t("accelUnavailable");
    if (presetOrRun.id === "custom" || presetOrRun.presetId === "custom") return t("accelCustomRange");
    if (presetOrRun.type === "distance" || presetOrRun.presetKind === "distance") return t("accelDistanceTest");
    return presetOrRun.standingStart ? t("accelStandingStart") : t("accelRollingStart");
  }

  function buildRunPartials(preset) {
    var partials = [];
    var speedUnit = normalizeSpeedUnit(state.settings.speedUnit);
    var distanceUnit = normalizeDistanceUnit(state.settings.distanceUnit);
    var minimumStartSpeedMs = preset && !preset.standingStart && isFiniteNumber(preset.startSpeedMs) ? preset.startSpeedMs : 0;
    var distanceDefinitions = distancePartialDefinitions[distanceUnit] || [];
    var speedDefinitions = speedPartialDefinitions[speedUnit] || [];

    if (shouldIncludeDistancePartials(preset, speedUnit)) {
      for (var distanceIndex = 0; distanceIndex < distanceDefinitions.length; distanceIndex += 1) {
        var distanceDefinition = distanceDefinitions[distanceIndex];
        if (preset.type === "distance" && isFiniteNumber(preset.distanceTargetM) && distanceDefinition.distanceM > (preset.distanceTargetM + 0.01)) {
          continue;
        }
        partials.push(createDistancePartial(distanceDefinition));
      }
    }

    for (var speedIndex = 0; speedIndex < speedDefinitions.length; speedIndex += 1) {
      var speedDefinition = speedDefinitions[speedIndex];
      if (speedDefinition.startSpeedMs + 0.01 < minimumStartSpeedMs) continue;
      if (preset.type === "speed" && isFiniteNumber(preset.targetSpeedMs) && speedDefinition.targetSpeedMs > (preset.targetSpeedMs + 0.01)) continue;
      partials.push(createSpeedPartial(speedDefinition));
    }

    return partials;
  }

  function shouldIncludeDistancePartials(preset, speedUnit) {
    if (!preset) return false;
    if (preset.type === "distance") return true;
    if (!preset.standingStart) return false;
    if (!isFiniteNumber(preset.targetSpeedMs)) return false;
    return preset.targetSpeedMs >= getLongRunSpeedThreshold(speedUnit);
  }

  function getLongRunSpeedThreshold(speedUnit) {
    return normalizeSpeedUnit(speedUnit) === "kmh" ? (200 * KMH_TO_MS) : (130 * MPH_TO_MS);
  }

  function createDistancePartial(definition) {
    return {
      id: definition.id,
      kind: "distance",
      labelKey: definition.labelKey,
      distanceM: definition.distanceM,
      showTrapSpeed: Boolean(definition.showTrapSpeed),
      elapsedMs: null,
      trapSpeedMs: null,
    };
  }

  function createSpeedPartial(definition) {
    return {
      id: definition.id,
      kind: "speed",
      labelKey: definition.labelKey,
      startSpeedMs: definition.startSpeedMs,
      targetSpeedMs: definition.targetSpeedMs,
      startCrossPerfMs: null,
      elapsedMs: null,
    };
  }

  function presetKeyFromId(presetId) {
    for (var index = 0; index < presetDefinitions.length; index += 1) {
      if (presetDefinitions[index].id === presetId) return presetDefinitions[index].labelKey;
    }
    return "accelPresetCustom";
  }

  function getPresetSignature(preset) {
    if (preset.id === "custom") {
      return getCustomPresetSignature(preset.startSpeedMs, preset.targetSpeedMs);
    }
    return preset.id;
  }

  function buildComparisonSignature(presetLike) {
    if (!presetLike) return "unknown";

    var presetId = presetLike.id || presetLike.presetId || "";
    if (presetId === "custom") {
      return getCustomPresetSignature(presetLike.startSpeedMs, presetLike.targetSpeedMs);
    }

    var definition = findPresetDefinition(presetId);
    if (definition && definition.variantGroup) return definition.variantGroup;

    if (typeof presetLike.variantGroup === "string" && presetLike.variantGroup) return presetLike.variantGroup;
    if (typeof presetLike.presetSignature === "string" && presetLike.presetSignature) return presetLike.presetSignature;
    return presetId || "unknown";
  }

  function getCustomPresetSignature(startSpeedMs, targetSpeedMs) {
    return "custom:" + formatSignatureNumber(startSpeedMs) + ":" + formatSignatureNumber(targetSpeedMs);
  }

  function formatSignatureNumber(value) {
    if (!isFiniteNumber(value)) return "0";
    return String(Math.round(value * 1000000) / 1000000);
  }

  function renderPresetButtons() {
    var html = "";
    var selectedId = resolvePresetIdForUnits(
      state.settings.selectedPresetId,
      state.settings.speedUnit,
      state.settings.distanceUnit
    );
    var availablePresets = getAvailablePresetDefinitions();

    for (var index = 0; index < availablePresets.length; index += 1) {
      var preset = availablePresets[index];
      var pressed = preset.id === selectedId ? "true" : "false";
      var presetCopy = copyPreset(preset);
      html += '<button type="button" class="accel-preset-btn" data-preset-id="' + escapeHtml(preset.id) + '" aria-pressed="' + pressed + '">';
      html += '<span class="accel-preset-title">' + escapeHtml(getPresetLabel(presetCopy)) + "</span>";
      html += '<span class="accel-preset-meta">' + escapeHtml(getPresetMetaLabel(presetCopy)) + "</span>";
      html += "</button>";
    }

    elements.presetGrid.innerHTML = html;
    elements.customRangePanel.hidden = selectedId !== "custom";
    elements.customStartInput.value = formatInputSpeedValue(state.settings.customStart);
    elements.customEndInput.value = formatInputSpeedValue(state.settings.customEnd);
  }

  function renderControlSelections() {
    var rolloutPressed = state.settings.rolloutEnabled;
    elements.rolloutOff.setAttribute("aria-pressed", String(!rolloutPressed));
    elements.rolloutOn.setAttribute("aria-pressed", String(rolloutPressed));
    elements.launchThresholdHalf.setAttribute("aria-pressed", String(isSameNumber(state.settings.launchThresholdMs, 0.5 * MPH_TO_MS)));
    elements.launchThresholdOne.setAttribute("aria-pressed", String(isSameNumber(state.settings.launchThresholdMs, 1 * MPH_TO_MS)));
    elements.speedUnitMph.setAttribute("aria-pressed", String(state.settings.speedUnit === "mph"));
    elements.speedUnitKmh.setAttribute("aria-pressed", String(state.settings.speedUnit === "kmh"));
    elements.distanceUnitFt.setAttribute("aria-pressed", String(state.settings.distanceUnit === "ft"));
    elements.distanceUnitM.setAttribute("aria-pressed", String(state.settings.distanceUnit === "m"));
    elements.launchThresholdHalf.textContent = formatThresholdOptionLabel(0.5 * MPH_TO_MS);
    elements.launchThresholdOne.textContent = formatThresholdOptionLabel(1 * MPH_TO_MS);

    if (state.settings.selectedPresetId === "custom" && !isCustomRangeValid()) {
      elements.customRangeNotice.textContent = t("accelCustomInvalid");
    } else {
      elements.customRangeNotice.textContent = "";
    }
  }

  function startUiTimer() {
    if (state.uiTimerId) window.clearInterval(state.uiTimerId);
    state.uiTimerId = window.setInterval(renderRealtimeUi, TIMER_TICK_MS);
  }

  function renderRealtimeUi() {
    renderControlState();
    renderStatusPanel();
    renderLivePanel();
    renderDiagnostics();
  }

  function handlePresetClick(event) {
    var button = event.target.closest("[data-preset-id]");
    if (!button) return;

    state.settings.selectedPresetId = button.getAttribute("data-preset-id");
    saveSettings();
    renderPresetButtons();
    renderControlSelections();
    renderAll();
  }

  function handleCustomInput() {
    state.settings.customStart = normalizeCustomSpeedInput(elements.customStartInput.value, 0);
    state.settings.customEnd = normalizeCustomSpeedInput(elements.customEndInput.value, 0);
    saveSettings();
    renderControlSelections();
    renderAll();
  }

  function handleSpeedUnitClick(event) {
    var button = event.currentTarget;
    var nextUnit = normalizeSpeedUnit(button.getAttribute("data-unit"));
    if (nextUnit === state.settings.speedUnit) return;

    state.settings.customStart = convertSpeedInputValue(state.settings.customStart, state.settings.speedUnit, nextUnit);
    state.settings.customEnd = convertSpeedInputValue(state.settings.customEnd, state.settings.speedUnit, nextUnit);
    state.settings.speedUnit = nextUnit;
    syncSelectedPresetForUnits();
    saveSettings();
    renderControlSelections();
    renderPresetButtons();
    renderAll();
  }

  function handleDistanceUnitClick(event) {
    var button = event.currentTarget;
    var nextUnit = normalizeDistanceUnit(button.getAttribute("data-unit"));
    if (nextUnit === state.settings.distanceUnit) return;

    state.settings.distanceUnit = nextUnit;
    syncSelectedPresetForUnits();
    saveSettings();
    renderControlSelections();
    renderPresetButtons();
    renderAll();
  }

  function handleRolloutClick(event) {
    state.settings.rolloutEnabled = event.currentTarget.getAttribute("data-rollout") === "on";
    saveSettings();
    renderControlSelections();
    renderAll();
  }

  function handleThresholdClick(event) {
    state.settings.launchThresholdMs = event.currentTarget.getAttribute("data-threshold") === "1" ? 1 * MPH_TO_MS : 0.5 * MPH_TO_MS;
    saveSettings();
    renderControlSelections();
    renderAll();
  }

  function handleNotesInput() {
    state.settings.notes = elements.runNotes.value || "";
    saveSettings();
  }

  function isRunActive(run) {
    return Boolean(run && (run.stage === "armed" || run.stage === "waiting_rollout" || run.stage === "running"));
  }

  function handleArm() {
    var preset = getSelectedPreset();

    primeFinishAudio();

    if (!state.geolocationSupported) {
      setActionNotice("accelNoGeolocation");
      renderAll();
      return;
    }

    if (state.settings.selectedPresetId === "custom" && !isCustomRangeValid()) {
      setActionNotice("accelCustomInvalid");
      renderAll();
      return;
    }

    if (!isGpsReady()) {
      setActionNotice("accelNeedGps");
      renderAll();
      return;
    }

    if (isRunActive(state.run)) {
      return;
    }

    state.run = createRun(preset);
    setActionNotice(preset.standingStart ? "accelArmedStandingNotice" : "accelArmedRollingNotice");
    renderAll();
  }

  function handleCancel() {
    if (!state.run || state.run.stage === "completed") return;
    state.run = null;
    setActionNotice("accelRunCancelledNotice");
    renderAll();
  }

  function handleClearHistory() {
    if (!state.runs.length) return;
    if (!window.confirm(t("accelClearHistoryConfirm"))) return;

    state.runs = [];
    state.latestResult = null;
    state.selectedResultId = "";
    saveRuns();
    setActionNotice("accelHistoryClearedNotice");
    renderAll();
  }

  function handleHistoryClick(event) {
    var button = event.target.closest("[data-history-action][data-run-id]");
    if (!button) return;

    var runId = button.getAttribute("data-run-id");
    var run = findRunById(runId);
    if (!run) return;

    var action = button.getAttribute("data-history-action");
    if (action === "load") {
      selectResult(runId);
      openPanel("results");
      scrollResultsPanelToTop();
      setActionNotice("accelResultLoadedNotice");
      renderAll();
      return;
    }

    if (action !== "delete") return;
    if (!window.confirm(t("accelDeleteRunConfirm", { label: getPresetLabel(run) }))) return;

    state.runs = state.runs.filter(function (entry) {
      return entry.id !== runId;
    });
    state.latestResult = state.runs.length ? state.runs[0] : null;
    if (state.selectedResultId === runId) selectResult(null);
    saveRuns();
    renderAll();
  }

  function findRunById(runId) {
    for (var index = 0; index < state.runs.length; index += 1) {
      if (state.runs[index].id === runId) return state.runs[index];
    }
    return null;
  }

  function getDisplayedResult() {
    if (state.selectedResultId) {
      var selectedRun = findRunById(state.selectedResultId);
      if (selectedRun) return selectedRun;
    }
    return state.latestResult;
  }

  function selectResult(runId) {
    var run = runId ? findRunById(runId) : null;
    state.selectedResultId = run ? run.id : (state.latestResult ? state.latestResult.id : "");
  }

  function scrollResultsPanelToTop() {
    if (!elements.resultsPanel) return;
    var body = elements.resultsPanel.querySelector(".accel-sheet-body");
    if (body && typeof body.scrollTo === "function") body.scrollTo({ top: 0, behavior: "smooth" });
    else if (body) body.scrollTop = 0;
  }

  function createRun(preset) {
    return {
      id: "run-" + Date.now() + "-" + String(Math.floor(Math.random() * 100000)),
      preset: preset,
      stage: "armed",
      createdAtMs: Date.now(),
      armedAtPerfMs: performance.now(),
      speedUnit: state.settings.speedUnit,
      distanceUnit: state.settings.distanceUnit,
      launchThresholdMs: state.settings.launchThresholdMs,
      rolloutApplied: Boolean(state.settings.rolloutEnabled && preset.standingStart),
      rolloutDistanceM: state.settings.rolloutEnabled && preset.standingStart ? FT_TO_M : 0,
      partials: buildRunPartials(preset),
      speedTrace: [],
      sampleCount: 0,
      intervalValues: [],
      accuracyValues: [],
      sparseCount: 0,
      staleCount: 0,
      nullSpeedCount: 0,
      derivedSpeedCount: 0,
      distanceSinceArmM: 0,
      prevDistanceSinceArmM: 0,
      launchCrossPerfMs: null,
      launchCrossDistanceM: null,
      launchCrossAltitudeM: null,
      startPerfMs: null,
      startDistanceM: null,
      startAltitudeM: null,
      startAccuracyM: null,
      startTraceSpeedMs: null,
      startSpeedSource: null,
      finishPerfMs: null,
      finishDistanceM: null,
      finishSpeedMs: null,
      finishAltitudeM: null,
      lastSample: null,
      result: null,
    };
  }

  function ensureWatch() {
    if (!state.geolocationSupported || state.watchId !== null) return;

    try {
      state.watchId = navigator.geolocation.watchPosition(handlePosition, handleGeoError, GEO_OPTIONS);
    } catch (error) {
      state.watchId = null;
      setActionNotice("accelNoGeolocation");
    }
  }

  function updatePermissionState() {
    if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
      state.permissionState = state.geolocationSupported ? "unknown" : "unsupported";
      renderAll();
      return;
    }

    navigator.permissions.query({ name: "geolocation" }).then(function (status) {
      state.permissionStatus = status;
      state.permissionState = status.state;
      renderAll();

      var handler = function () {
        state.permissionState = status.state;
        renderAll();
      };

      if (typeof status.addEventListener === "function") status.addEventListener("change", handler);
      else status.onchange = handler;
    }).catch(function () {
      state.permissionState = state.geolocationSupported ? "unknown" : "unsupported";
      renderAll();
    });
  }

  function handleGeoError(error) {
    if (!error) return;

    if (error.code === GEO_ERROR_CODE.PERMISSION_DENIED) state.permissionState = "denied";
    if (!state.latestSample && error.code === GEO_ERROR_CODE.PERMISSION_DENIED) setActionNotice("accelNeedGps");
    renderAll();
  }

  function handlePosition(position) {
    var perfMs = performance.now();
    var receivedAtMs = Date.now();
    var geoMs = isFiniteNumber(Number(position.timestamp)) ? Number(position.timestamp) : receivedAtMs;
    var coords = position && position.coords ? position.coords : {};
    var latitude = isFiniteNumber(coords.latitude) ? coords.latitude : null;
    var longitude = isFiniteNumber(coords.longitude) ? coords.longitude : null;
    var accuracyM = isFiniteNumber(coords.accuracy) ? Math.max(0, coords.accuracy) : null;
    var altitudeM = isFiniteNumber(coords.altitude) ? coords.altitude : null;
    var headingDeg = isFiniteNumber(coords.heading) && coords.heading >= 0 ? coords.heading : null;
    var rawSpeedMs = isFiniteNumber(coords.speed) && coords.speed >= 0 ? coords.speed : null;

    var previousSample = state.latestSample;
    var deltaMs = previousSample ? perfMs - previousSample.perfMs : null;
    var segmentDistanceM = previousSample ? getDistanceM(previousSample.latitude, previousSample.longitude, latitude, longitude) : 0;
    var derivedSpeedMs = null;

    if (rawSpeedMs === null && previousSample && isFiniteNumber(deltaMs) && deltaMs > 0) {
      derivedSpeedMs = segmentDistanceM / (deltaMs / 1000);
      var blendedAccuracy = averageFinite(previousSample.accuracyM, accuracyM);
      var noiseFloor = blendedAccuracy !== null ? clamp(blendedAccuracy * 0.35, 2, 12) : 3;
      if (segmentDistanceM <= noiseFloor && derivedSpeedMs < 3) derivedSpeedMs = 0;
      derivedSpeedMs = clamp(derivedSpeedMs, 0, MAX_PLAUSIBLE_SPEED_MS);
    }

    var speedMs = rawSpeedMs !== null ? rawSpeedMs : (derivedSpeedMs !== null ? derivedSpeedMs : 0);
    var sample = {
      perfMs: perfMs,
      receivedAtMs: receivedAtMs,
      geoMs: geoMs,
      latitude: latitude,
      longitude: longitude,
      accuracyM: accuracyM,
      altitudeM: altitudeM,
      headingDeg: headingDeg,
      rawSpeedMs: rawSpeedMs,
      derivedSpeedMs: derivedSpeedMs,
      speedMs: speedMs,
      speedSource: rawSpeedMs !== null ? "reported" : "derived",
      deltaMs: deltaMs,
      segmentDistanceM: segmentDistanceM,
      stale: isFiniteNumber(deltaMs) && deltaMs >= STALE_INTERVAL_MS,
      sparse: isFiniteNumber(deltaMs) && deltaMs >= SPARSE_INTERVAL_MS,
    };

    state.latestSample = sample;
    state.sessionSampleCount += 1;

    if (isFiniteNumber(deltaMs) && deltaMs > 0) {
      state.sessionIntervals.push(deltaMs);
      state.recentIntervals.push(deltaMs);
      if (state.recentIntervals.length > RECENT_INTERVAL_WINDOW) state.recentIntervals.shift();
    }

    state.currentQuality = buildLiveQuality();

    if (state.run && (state.run.stage === "armed" || state.run.stage === "waiting_rollout" || state.run.stage === "running")) {
      processRunSample(sample);
    }

    renderAll();
  }

  function processRunSample(sample) {
    var run = state.run;
    if (!run) return;

    if (run.sampleCount === 0) {
      run.sampleCount = 1;
      if (sample.accuracyM !== null) run.accuracyValues.push(sample.accuracyM);
      if (sample.rawSpeedMs === null) run.nullSpeedCount += 1;
      if (sample.speedSource === "derived") run.derivedSpeedCount += 1;
      run.lastSample = sample;
      return;
    }

    var previousSample = run.lastSample;
    if (!previousSample) {
      run.lastSample = sample;
      return;
    }

    run.sampleCount += 1;
    if (isFiniteNumber(sample.deltaMs) && sample.deltaMs > 0) run.intervalValues.push(sample.deltaMs);
    if (sample.accuracyM !== null) run.accuracyValues.push(sample.accuracyM);
    if (sample.rawSpeedMs === null) run.nullSpeedCount += 1;
    if (sample.speedSource === "derived") run.derivedSpeedCount += 1;
    if (sample.stale) run.staleCount += 1;
    if (sample.sparse) run.sparseCount += 1;

    run.prevDistanceSinceArmM = run.distanceSinceArmM;
    run.distanceSinceArmM += sample.segmentDistanceM;

    var previousSpeed = previousSample.speedMs;
    var currentSpeed = sample.speedMs;

    if (run.preset.standingStart) {
      if (run.launchCrossPerfMs === null) {
        var launchCross = interpolateSpeedCrossing(previousSample, sample, run.launchThresholdMs);
        if (launchCross) {
          run.launchCrossPerfMs = launchCross.perfMs;
          run.launchCrossDistanceM = interpolateValue(run.prevDistanceSinceArmM, run.distanceSinceArmM, launchCross.ratio);
          run.launchCrossAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, launchCross.ratio);
        }
      }

      if (run.launchCrossPerfMs !== null && run.startPerfMs === null) {
        if (!run.rolloutApplied) {
          run.startPerfMs = run.launchCrossPerfMs;
          run.startDistanceM = run.launchCrossDistanceM;
          run.startAltitudeM = run.launchCrossAltitudeM;
          run.startAccuracyM = averageFinite(previousSample.accuracyM, sample.accuracyM);
          run.startTraceSpeedMs = run.launchThresholdMs;
          run.startSpeedSource = sample.speedSource;
          run.stage = "running";
        } else {
          run.stage = "waiting_rollout";
          var rolloutTarget = run.launchCrossDistanceM + run.rolloutDistanceM;
          var rolloutCross = interpolateRangeCrossing(
            run.prevDistanceSinceArmM,
            run.distanceSinceArmM,
            rolloutTarget,
            previousSample.perfMs,
            sample.perfMs
          );

          if (rolloutCross) {
            run.startPerfMs = rolloutCross.perfMs;
            run.startDistanceM = rolloutTarget;
            run.startAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, rolloutCross.ratio);
            run.startAccuracyM = averageFinite(previousSample.accuracyM, sample.accuracyM);
            run.startTraceSpeedMs = interpolateValue(previousSpeed, currentSpeed, rolloutCross.ratio);
            run.startSpeedSource = sample.speedSource;
            run.stage = "running";
          }
        }
      }
    } else if (run.startPerfMs === null) {
      var rollingCross = interpolateSpeedCrossing(previousSample, sample, run.preset.startSpeedMs);
      if (rollingCross) {
        run.startPerfMs = rollingCross.perfMs;
        run.startDistanceM = interpolateValue(run.prevDistanceSinceArmM, run.distanceSinceArmM, rollingCross.ratio);
        run.startAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, rollingCross.ratio);
        run.startAccuracyM = averageFinite(previousSample.accuracyM, sample.accuracyM);
        run.startTraceSpeedMs = run.preset.startSpeedMs;
        run.startSpeedSource = sample.speedSource;
        run.stage = "running";
      }
    }

    if (run.startPerfMs !== null && run.startAltitudeM === null && isFiniteNumber(sample.altitudeM)) {
      run.startAltitudeM = sample.altitudeM;
    }
    if (run.startPerfMs !== null && run.startAccuracyM === null && isFiniteNumber(sample.accuracyM)) {
      run.startAccuracyM = sample.accuracyM;
    }
    if (run.startPerfMs !== null && !isFiniteNumber(run.startTraceSpeedMs)) {
      run.startTraceSpeedMs = run.preset.standingStart ? 0 : run.preset.startSpeedMs;
    }
    if (run.startPerfMs !== null && !run.startSpeedSource) {
      run.startSpeedSource = sample.speedSource;
    }

    if (run.startPerfMs !== null) {
      ensureSpeedTraceStarted(run);
      seedRunPartialStarts(run);
      updateRunPartials(run, previousSample, sample);
    }

    if (run.startPerfMs !== null && run.finishPerfMs === null) {
      if (run.preset.type === "speed") {
        var targetCross = interpolateSpeedCrossing(previousSample, sample, run.preset.targetSpeedMs);
        if (targetCross && targetCross.perfMs >= run.startPerfMs) {
          run.finishPerfMs = targetCross.perfMs;
          run.finishDistanceM = interpolateValue(run.prevDistanceSinceArmM, run.distanceSinceArmM, targetCross.ratio);
          run.finishSpeedMs = run.preset.targetSpeedMs;
          run.finishAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, targetCross.ratio);
          appendSpeedTracePoint(run, run.finishPerfMs - run.startPerfMs, run.finishSpeedMs, {
            distanceM: Math.max(0, run.finishDistanceM - run.startDistanceM),
            altitudeM: run.finishAltitudeM,
            accuracyM: averageFinite(previousSample.accuracyM, sample.accuracyM),
            speedSource: sample.speedSource,
          });
          completeRun();
        }
      } else if (run.preset.type === "distance") {
        var prevDistanceFromStartM = Math.max(0, run.prevDistanceSinceArmM - run.startDistanceM);
        var currentDistanceFromStartM = Math.max(0, run.distanceSinceArmM - run.startDistanceM);
        var finishCross = interpolateRangeCrossing(
          prevDistanceFromStartM,
          currentDistanceFromStartM,
          run.preset.distanceTargetM,
          previousSample.perfMs,
          sample.perfMs
        );

        if (finishCross) {
          run.finishPerfMs = finishCross.perfMs;
          run.finishDistanceM = run.startDistanceM + run.preset.distanceTargetM;
          run.finishSpeedMs = interpolateValue(previousSpeed, currentSpeed, finishCross.ratio);
          run.finishAltitudeM = interpolateMeasurement(previousSample.altitudeM, sample.altitudeM, finishCross.ratio);
          appendSpeedTracePoint(run, run.finishPerfMs - run.startPerfMs, run.finishSpeedMs, {
            distanceM: Math.max(0, run.finishDistanceM - run.startDistanceM),
            altitudeM: run.finishAltitudeM,
            accuracyM: averageFinite(previousSample.accuracyM, sample.accuracyM),
            speedSource: sample.speedSource,
          });
          completeRun();
        }
      }
    }

    if (run.finishPerfMs === null && sample.perfMs >= run.startPerfMs) {
      appendSpeedTracePoint(run, sample.perfMs - run.startPerfMs, sample.speedMs, {
        distanceM: Math.max(0, run.distanceSinceArmM - run.startDistanceM),
        altitudeM: sample.altitudeM,
        accuracyM: sample.accuracyM,
        speedSource: sample.speedSource,
      });
    }

    run.lastSample = sample;
  }

  function completeRun() {
    var run = state.run;
    if (!run || run.finishPerfMs === null || run.startPerfMs === null) return;

    var result = buildResult(run);
    run.stage = "completed";
    run.result = result;
    state.latestResult = result;
    state.runs.unshift(result);
    if (state.runs.length > MAX_RUNS) state.runs = state.runs.slice(0, MAX_RUNS);
    state.selectedResultId = result.id;
    saveRuns();
    playFinishAudio();
    setActionNotice("accelRunSavedNotice");
    renderAll();
  }

  function buildResult(run) {
    var intervalStats = computeIntervalStats(run.intervalValues);
    var averageAccuracyM = averageArray(run.accuracyValues);
    var nullSpeedShare = run.sampleCount > 0 ? run.nullSpeedCount / run.sampleCount : 1;
    var derivedShare = run.sampleCount > 0 ? run.derivedSpeedCount / run.sampleCount : 1;
    var runDistanceM = getCompletedRunDistance(run);
    var slopeAnalysis = buildSlopeAnalysis(run.startAltitudeM, run.finishAltitudeM, runDistanceM);
    var quality = evaluateQuality({
      sampleCount: run.sampleCount,
      durationMs: run.finishPerfMs - run.startPerfMs,
      averageAccuracyM: averageAccuracyM,
      averageHz: intervalStats.hz,
      averageIntervalMs: intervalStats.averageMs,
      jitterMs: intervalStats.jitterMs,
      staleCount: run.staleCount,
      sparseCount: run.sparseCount,
      nullSpeedShare: nullSpeedShare,
      derivedShare: derivedShare,
    });

    return {
      id: run.id,
      savedAtMs: Date.now(),
      presetId: run.preset.id,
      presetSignature: getPresetSignature(run.preset),
      comparisonSignature: buildComparisonSignature(run.preset),
      presetKind: run.preset.type,
      standingStart: run.preset.standingStart,
      customStart: run.preset.customStart,
      customEnd: run.preset.customEnd,
      customUnit: run.preset.customUnit,
      startSpeedMs: run.preset.startSpeedMs,
      targetSpeedMs: run.preset.targetSpeedMs,
      distanceTargetM: run.preset.distanceTargetM,
      displayUnit: state.settings.speedUnit,
      distanceDisplay: state.settings.distanceUnit,
      elapsedMs: run.finishPerfMs - run.startPerfMs,
      speedTrace: compactSpeedTrace(run.speedTrace),
      partials: serializeRunPartials(run.partials),
      finishSpeedMs: run.finishSpeedMs,
      trapSpeedMs: run.preset.type === "distance" ? run.finishSpeedMs : null,
      rolloutApplied: run.rolloutApplied,
      launchThresholdMs: run.launchThresholdMs,
      rolloutDistanceM: run.rolloutDistanceM,
      averageAccuracyM: averageAccuracyM,
      runDistanceM: runDistanceM,
      finishDistanceM: run.finishDistanceM,
      startAccuracyM: run.startAccuracyM,
      startAltitudeM: run.startAltitudeM,
      finishAltitudeM: run.finishAltitudeM,
      elevationDeltaM: slopeAnalysis.elevationDeltaM,
      slopePercent: slopeAnalysis.slopePercent,
      averageHz: intervalStats.hz,
      averageIntervalMs: intervalStats.averageMs,
      jitterMs: intervalStats.jitterMs,
      qualityGrade: quality.grade,
      qualityScore: quality.score,
      warningKeys: quality.warningKeys,
      sampleCount: run.sampleCount,
      sparseCount: run.sparseCount,
      staleCount: run.staleCount,
      nullSpeedCount: run.nullSpeedCount,
      derivedSpeedCount: run.derivedSpeedCount,
      speedSource: derivedShare > 0.5 ? "derived" : "reported",
      startSpeedSource: run.startSpeedSource,
      notes: state.settings.notes || "",
    };
  }

  function buildLiveQuality() {
    var intervalStats = computeIntervalStats(state.recentIntervals);
    var accuracyM = state.latestSample ? state.latestSample.accuracyM : null;
    var latestSampleStale = isLatestSampleStale();
    var latestSampleSparse = isLatestSampleSparse();
    var quality = evaluateQuality({
      sampleCount: state.sessionSampleCount,
      durationMs: intervalStats.averageMs ? intervalStats.averageMs * Math.max(0, state.recentIntervals.length) : 0,
      averageAccuracyM: accuracyM,
      averageHz: intervalStats.hz,
      averageIntervalMs: intervalStats.averageMs,
      jitterMs: intervalStats.jitterMs,
      staleCount: latestSampleStale ? 1 : 0,
      sparseCount: latestSampleSparse ? 1 : 0,
      nullSpeedShare: state.latestSample && state.latestSample.rawSpeedMs === null ? 1 : 0,
      derivedShare: state.latestSample && state.latestSample.speedSource === "derived" ? 1 : 0,
      isLive: true,
    });

    quality.averageIntervalMs = intervalStats.averageMs;
    quality.jitterMs = intervalStats.jitterMs;
    quality.averageHz = intervalStats.hz;
    quality.samples = state.sessionSampleCount;
    return quality;
  }

  function evaluateQuality(input) {
    var score = 100;
    var warningKeys = [];

    if (!isFiniteNumber(input.sampleCount) || input.sampleCount < (input.isLive ? 2 : MIN_VALID_RUN_SAMPLES)) {
      return { grade: "invalid", score: 0, warningKeys: warningKeys };
    }

    if (!input.isLive && (!isFiniteNumber(input.durationMs) || input.durationMs < MIN_VALID_RUN_DURATION_MS)) {
      return { grade: "invalid", score: 0, warningKeys: warningKeys };
    }

    if (!isFiniteNumber(input.averageAccuracyM)) score -= 15;
    else if (input.averageAccuracyM > 35) {
      score -= 60;
      warningKeys.push("accelWarningAccuracy");
    } else if (input.averageAccuracyM > 20) {
      score -= 35;
      warningKeys.push("accelWarningAccuracy");
    } else if (input.averageAccuracyM > 12) {
      score -= 15;
    }

    if (!isFiniteNumber(input.averageHz) || input.averageHz <= 0) {
      score -= 35;
    } else if (input.averageHz < 0.6) {
      score -= 55;
      warningKeys.push("accelWarningSparse");
    } else if (input.averageHz < 1.0) {
      score -= 30;
      warningKeys.push("accelWarningSparse");
    } else if (input.averageHz < 1.5) {
      score -= 15;
    }

    if (isFiniteNumber(input.averageIntervalMs) && input.averageIntervalMs >= SPARSE_INTERVAL_MS) {
      score -= 15;
      if (warningKeys.indexOf("accelWarningSparse") === -1) warningKeys.push("accelWarningSparse");
    }

    if (isFiniteNumber(input.jitterMs) && input.jitterMs > 900) score -= 18;
    else if (isFiniteNumber(input.jitterMs) && input.jitterMs > 450) score -= 8;

    if (input.staleCount > 0) {
      score -= Math.min(30, input.staleCount * 8);
      warningKeys.push("accelWarningStale");
    }

    if (input.sparseCount > 0) {
      score -= Math.min(25, input.sparseCount * 6);
      if (warningKeys.indexOf("accelWarningSparse") === -1) warningKeys.push("accelWarningSparse");
    }

    if (input.derivedShare > 0.4) {
      score -= input.derivedShare > 0.8 ? 18 : 8;
      warningKeys.push("accelWarningDerived");
    }

    if (input.nullSpeedShare > 0.8) score -= 10;

    score = clamp(score, 0, 100);

    if (score <= 25) return { grade: "invalid", score: score, warningKeys: dedupeList(warningKeys) };
    if (score >= 80) return { grade: "good", score: score, warningKeys: dedupeList(warningKeys) };
    if (score >= 55) return { grade: "fair", score: score, warningKeys: dedupeList(warningKeys) };
    return { grade: "poor", score: score, warningKeys: dedupeList(warningKeys) };
  }

  function dedupeList(values) {
    var deduped = [];
    for (var index = 0; index < values.length; index += 1) {
      if (deduped.indexOf(values[index]) === -1) deduped.push(values[index]);
    }
    return deduped;
  }

  function computeIntervalStats(intervals) {
    if (!intervals || !intervals.length) {
      return {
        averageMs: null,
        jitterMs: null,
        hz: null,
        maxMs: null,
      };
    }

    var total = 0;
    var maxMs = 0;
    for (var index = 0; index < intervals.length; index += 1) {
      total += intervals[index];
      if (intervals[index] > maxMs) maxMs = intervals[index];
    }

    var averageMs = total / intervals.length;
    var variance = 0;
    for (var varianceIndex = 0; varianceIndex < intervals.length; varianceIndex += 1) {
      variance += Math.pow(intervals[varianceIndex] - averageMs, 2);
    }

    variance = variance / intervals.length;

    return {
      averageMs: averageMs,
      jitterMs: Math.sqrt(variance),
      hz: averageMs > 0 ? 1000 / averageMs : null,
      maxMs: maxMs,
    };
  }

  function averageArray(values) {
    if (!values || !values.length) return null;
    var total = 0;
    var count = 0;

    for (var index = 0; index < values.length; index += 1) {
      if (!isFiniteNumber(values[index])) continue;
      total += values[index];
      count += 1;
    }

    return count ? total / count : null;
  }

  function averageFinite(left, right) {
    var values = [];
    if (isFiniteNumber(left)) values.push(left);
    if (isFiniteNumber(right)) values.push(right);
    return values.length ? averageArray(values) : null;
  }

  function interpolateSpeedCrossing(previousSample, currentSample, targetSpeedMs) {
    if (!previousSample || !currentSample) return null;
    if (!isFiniteNumber(previousSample.speedMs) || !isFiniteNumber(currentSample.speedMs)) return null;
    if (previousSample.speedMs >= targetSpeedMs || currentSample.speedMs < targetSpeedMs) return null;

    var speedDelta = currentSample.speedMs - previousSample.speedMs;
    if (!isFiniteNumber(speedDelta) || speedDelta <= 0) return null;

    var ratio = (targetSpeedMs - previousSample.speedMs) / speedDelta;
    ratio = clamp(ratio, 0, 1);

    return {
      ratio: ratio,
      perfMs: interpolateValue(previousSample.perfMs, currentSample.perfMs, ratio),
    };
  }

  function interpolateRangeCrossing(previousValue, currentValue, targetValue, previousPerfMs, currentPerfMs) {
    if (!isFiniteNumber(previousValue) || !isFiniteNumber(currentValue) || !isFiniteNumber(targetValue)) return null;
    if (previousValue >= targetValue || currentValue < targetValue) return null;

    var delta = currentValue - previousValue;
    if (!isFiniteNumber(delta) || delta <= 0) return null;

    var ratio = (targetValue - previousValue) / delta;
    ratio = clamp(ratio, 0, 1);

    return {
      ratio: ratio,
      perfMs: interpolateValue(previousPerfMs, currentPerfMs, ratio),
    };
  }

  function interpolateValue(start, end, ratio) {
    return start + ((end - start) * ratio);
  }

  function interpolateMeasurement(previousValue, currentValue, ratio) {
    if (isFiniteNumber(previousValue) && isFiniteNumber(currentValue)) {
      return interpolateValue(previousValue, currentValue, ratio);
    }
    if (isFiniteNumber(currentValue)) return currentValue;
    if (isFiniteNumber(previousValue)) return previousValue;
    return null;
  }

  function ensureSpeedTraceStarted(run) {
    if (!run || !run.speedTrace) return;
    if (run.startPerfMs === null) return;
    if (run.speedTrace.length) return;
    appendSpeedTracePoint(run, 0, run.startTraceSpeedMs, {
      distanceM: 0,
      altitudeM: run.startAltitudeM,
      accuracyM: run.startAccuracyM,
      speedSource: run.startSpeedSource,
    });
  }

  function appendSpeedTracePoint(run, elapsedMs, speedMs, details) {
    if (!run || !run.speedTrace) return;
    if (!isFiniteNumber(elapsedMs) || !isFiniteNumber(speedMs)) return;

    var normalizedElapsedMs = Math.max(0, elapsedMs);
    var normalizedSpeedMs = Math.max(0, speedMs);
    var trace = run.speedTrace;
    var lastPoint = trace.length ? trace[trace.length - 1] : null;
    var nextPoint = {
      elapsedMs: normalizedElapsedMs,
      speedMs: normalizedSpeedMs,
    };

    if (details && isFiniteNumber(details.distanceM)) nextPoint.distanceM = Math.max(0, details.distanceM);
    if (details && isFiniteNumber(details.altitudeM)) nextPoint.altitudeM = details.altitudeM;
    if (details && isFiniteNumber(details.accuracyM)) nextPoint.accuracyM = Math.max(0, details.accuracyM);
    if (details && typeof details.speedSource === "string") nextPoint.speedSource = details.speedSource;

    if (lastPoint && Math.abs(lastPoint.elapsedMs - normalizedElapsedMs) <= TRACE_DUPLICATE_EPSILON_MS) {
      lastPoint.elapsedMs = nextPoint.elapsedMs;
      lastPoint.speedMs = nextPoint.speedMs;
      if (Object.prototype.hasOwnProperty.call(nextPoint, "distanceM")) lastPoint.distanceM = nextPoint.distanceM;
      if (Object.prototype.hasOwnProperty.call(nextPoint, "altitudeM")) lastPoint.altitudeM = nextPoint.altitudeM;
      if (Object.prototype.hasOwnProperty.call(nextPoint, "accuracyM")) lastPoint.accuracyM = nextPoint.accuracyM;
      if (Object.prototype.hasOwnProperty.call(nextPoint, "speedSource")) lastPoint.speedSource = nextPoint.speedSource;
      return;
    }

    if (lastPoint && normalizedElapsedMs < lastPoint.elapsedMs) return;

    trace.push(nextPoint);
  }

  function compactSpeedTrace(trace) {
    var maxPoints = 120;
    if (!Array.isArray(trace) || trace.length <= maxPoints) return trace ? trace.slice() : [];

    var compacted = [];
    var lastIndex = trace.length - 1;
    for (var index = 0; index < maxPoints; index += 1) {
      var sourceIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
      var point = trace[sourceIndex];
      var compactedPoint = {
        elapsedMs: point.elapsedMs,
        speedMs: point.speedMs,
      };
      if (isFiniteNumber(point.distanceM)) compactedPoint.distanceM = point.distanceM;
      if (isFiniteNumber(point.altitudeM)) compactedPoint.altitudeM = point.altitudeM;
      if (isFiniteNumber(point.accuracyM)) compactedPoint.accuracyM = point.accuracyM;
      if (typeof point.speedSource === "string") compactedPoint.speedSource = point.speedSource;
      compacted.push(compactedPoint);
    }
    return compacted;
  }

  function seedRunPartialStarts(run) {
    if (!run || run.startPerfMs === null || !run.partials || !run.partials.length) return;

    var runStartSpeedMs = run.preset && isFiniteNumber(run.preset.startSpeedMs) ? run.preset.startSpeedMs : 0;
    for (var index = 0; index < run.partials.length; index += 1) {
      var partial = run.partials[index];
      if (partial.kind !== "speed" || partial.startCrossPerfMs !== null) continue;
      if (partial.startSpeedMs <= (runStartSpeedMs + 0.01)) partial.startCrossPerfMs = run.startPerfMs;
    }
  }

  function updateRunPartials(run, previousSample, sample) {
    if (!run || !run.partials || !run.partials.length) return;
    if (!previousSample || !sample || run.startPerfMs === null || run.startDistanceM === null) return;

    var previousSpeed = previousSample.speedMs;
    var currentSpeed = sample.speedMs;
    var previousDistanceFromStartM = Math.max(0, run.prevDistanceSinceArmM - run.startDistanceM);
    var currentDistanceFromStartM = Math.max(0, run.distanceSinceArmM - run.startDistanceM);

    for (var index = 0; index < run.partials.length; index += 1) {
      var partial = run.partials[index];
      if (partial.elapsedMs !== null) continue;

      if (partial.kind === "distance") {
        var distanceCross = interpolateRangeCrossing(
          previousDistanceFromStartM,
          currentDistanceFromStartM,
          partial.distanceM,
          previousSample.perfMs,
          sample.perfMs
        );

        if (!distanceCross) continue;
        partial.elapsedMs = distanceCross.perfMs - run.startPerfMs;
        partial.trapSpeedMs = interpolateValue(previousSpeed, currentSpeed, distanceCross.ratio);
        continue;
      }

      if (partial.startCrossPerfMs === null) {
        var partialStartCross = interpolateSpeedCrossing(previousSample, sample, partial.startSpeedMs);
        if (partialStartCross && partialStartCross.perfMs >= run.startPerfMs) {
          partial.startCrossPerfMs = partialStartCross.perfMs;
        }
      }

      if (partial.startCrossPerfMs === null) continue;

      var partialTargetCross = interpolateSpeedCrossing(previousSample, sample, partial.targetSpeedMs);
      if (!partialTargetCross || partialTargetCross.perfMs < partial.startCrossPerfMs) continue;
      partial.elapsedMs = partialTargetCross.perfMs - partial.startCrossPerfMs;
    }
  }

  function renderAll() {
    renderControlSelections();
    renderControlState();
    renderStatusPanel();
    renderLivePanel();
    renderResultCard();
    renderDiagnostics();
    renderHistory();
    renderSheetUi();
  }

  function renderControlState() {
    var hasActiveRun = isRunActive(state.run);
    var customInvalid = state.settings.selectedPresetId === "custom" && !isCustomRangeValid();
    var primaryLabelKey = state.run && state.run.stage === "completed" ? "accelRunAgain" : "accelArm";
    var gpsReady = isGpsReady();

    elements.armRun.textContent = t(primaryLabelKey);
    elements.cancelRun.textContent = t("accelCancel");
    elements.armRun.hidden = hasActiveRun;
    elements.cancelRun.hidden = !hasActiveRun;
    elements.armRun.disabled = !state.geolocationSupported || customInvalid || !gpsReady;
    elements.cancelRun.disabled = !hasActiveRun;
    elements.clearHistory.disabled = !state.runs.length;
  }

  function renderStatusPanel() {
    var speedUnit = state.settings.speedUnit;
    var permissionLabel = getPermissionLabel(state.permissionState);
    var ready = isGpsReady();
    var liveQuality = isRunActive(state.run) ? buildCurrentRunQuality(state.run) : buildLiveQuality();
    var qualityLabel = liveQuality ? getQualityLabel(liveQuality.grade) : t("accelUnavailable");
    var readyLabel = ready ? t("accelReadyYes") : t("accelReadyNo");
    var accuracyLabel = formatDistanceMeasurement(state.latestSample ? state.latestSample.accuracyM : null);

    elements.toolbarPermissionValue.textContent = readyLabel;
    elements.toolbarQualityValue.textContent = accuracyLabel;
    elements.toolbarStateValue.textContent = qualityLabel;

    elements.permissionValue.textContent = permissionLabel;
    elements.gpsReadyValue.textContent = readyLabel;
    elements.latestAccuracyValue.textContent = accuracyLabel;
    elements.observedHzValue.textContent = formatHz(liveQuality ? liveQuality.averageHz : null);
    elements.statusSpeedValue.textContent = formatSpeedValue(state.latestSample ? state.latestSample.speedMs : null, speedUnit);
    elements.statusHeadingValue.textContent = formatHeading(state.latestSample ? state.latestSample.headingDeg : null);
    elements.statusAltitudeValue.textContent = formatDistanceMeasurement(state.latestSample ? state.latestSample.altitudeM : null);
    elements.speedSourceValue.textContent = getSpeedSourceLabel(state.latestSample ? state.latestSample.speedSource : null);
  }

  function renderSheetUi() {
    var setupOpen = state.openPanel === "setup";
    var resultsOpen = state.openPanel === "results";
    var setupSummary = getSetupSummary();
    var resultsSummary = getResultsSummary();

    elements.setupTriggerValue.textContent = setupSummary.title;
    elements.setupTriggerMeta.textContent = setupSummary.meta;
    elements.resultsTriggerValue.textContent = resultsSummary.title;
    elements.resultsTriggerMeta.textContent = resultsSummary.meta;
    elements.setupPanelStatus.textContent = setupSummary.title + " · " + setupSummary.meta;
    elements.resultsPanelStatus.textContent = getResultsPanelStatusText();

    elements.setupTrigger.setAttribute("aria-expanded", String(setupOpen));
    elements.resultsTrigger.setAttribute("aria-expanded", String(resultsOpen));
    elements.setupTrigger.classList.toggle("is-open", setupOpen);
    elements.resultsTrigger.classList.toggle("is-open", resultsOpen);

    elements.sheetBackdrop.hidden = !(setupOpen || resultsOpen);
    elements.setupPanel.hidden = !setupOpen;
    elements.resultsPanel.hidden = !resultsOpen;

    document.body.classList.toggle("accel-sheet-open", setupOpen || resultsOpen);
    if (resultsOpen) requestResultGraphRefresh();
    else destroyResultGraph();
  }

  function renderLiveSpeedometer(preset, liveState) {
    var speedUnit = state.settings.speedUnit;
    var gaugeStep = speedUnit === "kmh" ? 20 : 10;
    var baseGaugeMax = speedUnit === "kmh" ? 140 : 80;
    var currentSpeedMs = state.latestSample ? state.latestSample.speedMs : null;
    var currentDisplay = Math.max(0, isFiniteNumber(currentSpeedMs) ? msToSpeedUnit(currentSpeedMs, speedUnit) : 0);
    var markerValue = preset && preset.type === "speed" && isFiniteNumber(preset.targetSpeedMs)
      ? msToSpeedUnit(preset.targetSpeedMs, speedUnit)
      : null;
    var peakDisplay = Math.max(baseGaugeMax, currentDisplay, markerValue || 0);

    if (state.run && state.run.result && isFiniteNumber(state.run.result.finishSpeedMs)) {
      peakDisplay = Math.max(peakDisplay, msToSpeedUnit(state.run.result.finishSpeedMs, speedUnit));
    } else if (state.run && state.run.result && isFiniteNumber(state.run.result.trapSpeedMs)) {
      peakDisplay = Math.max(peakDisplay, msToSpeedUnit(state.run.result.trapSpeedMs, speedUnit));
    }

    liveSpeedometer.render({
      value: currentDisplay,
      valueText: formatLiveSpeedNumber(currentSpeedMs, speedUnit),
      unitText: getSpeedUnitLabel(speedUnit),
      substatusText: liveState,
      maxValue: Math.max(baseGaugeMax, Math.ceil(peakDisplay / gaugeStep) * gaugeStep),
      tickStep: gaugeStep,
      markerValue: markerValue,
    });
  }

  function renderLivePanel() {
    var run = state.run;
    var displayPreset = run ? run.preset : getSelectedPreset();
    var liveState = getRunStateLabel();
    var liveQuality = run && run.result
      ? { grade: run.result.qualityGrade }
      : (run && run.stage !== "completed" ? buildCurrentRunQuality(run) : buildLiveQuality());

    elements.liveStateValue.textContent = liveState;
    elements.liveQualityValue.textContent = liveQuality ? getQualityLabel(liveQuality.grade) : t("accelUnavailable");
    elements.liveTargetValue.textContent = getPresetLabel(displayPreset);
    elements.liveSlopeValue.textContent = formatSlopePercent(getLiveSlopePercent(run));
    renderLivePartials(run);
    renderLiveSpeedometer(displayPreset, liveState);

    if (run && run.stage === "completed" && run.result) {
      elements.liveElapsedValue.textContent = formatRunSeconds(run.result.elapsedMs);
      elements.liveDistanceValue.textContent = formatRunDistance(
        isFiniteNumber(run.result.runDistanceM)
          ? run.result.runDistanceM
          : (run.result.presetKind === "distance" && isFiniteNumber(run.result.distanceTargetM)
            ? run.result.distanceTargetM
          : Math.max(0, (run.distanceSinceArmM || 0) - (run.startDistanceM || 0))
          )
      );
      setProgressFromRun(run, displayPreset);
      return;
    }

    if (run && run.startPerfMs !== null) {
      elements.liveElapsedValue.textContent = formatRunSeconds(performance.now() - run.startPerfMs);
    } else {
      elements.liveElapsedValue.textContent = "0.000";
    }

    if (run && run.startPerfMs !== null) {
      elements.liveDistanceValue.textContent = formatRunDistance(
        Math.max(0, run.distanceSinceArmM - run.startDistanceM)
      );
    } else {
      elements.liveDistanceValue.textContent = formatRunDistance(0);
    }

    setProgressFromRun(run, displayPreset);
  }

  function renderLivePartials(run) {
    if (!elements.livePartialsSection || !elements.livePartialsList) return;
    if (!run || !run.partials || !run.partials.length) {
      elements.livePartialsSection.hidden = true;
      elements.livePartialsList.innerHTML = "";
      return;
    }

    var html = "";
    for (var index = 0; index < run.partials.length; index += 1) {
      var partial = run.partials[index];
      var status = partial.elapsedMs !== null ? "done" : (run.stage === "completed" ? "missed" : "waiting");
      html += '<div class="accel-partial-row" data-status="' + status + '">';
      html += '<span class="accel-partial-label">' + escapeHtml(getPartialLabel(partial)) + "</span>";
      html += '<strong class="accel-partial-value">' + escapeHtml(formatPartialValue(partial, run && run.speedUnit ? run.speedUnit : state.settings.speedUnit, run && run.stage === "completed")) + "</strong>";
      html += "</div>";
    }

    elements.livePartialsSection.hidden = false;
    elements.livePartialsList.innerHTML = html;
  }

  function setProgressFromRun(run, preset) {
    var fraction = 0;
    var label = t("accelUnavailable");

    if (!run) {
      fraction = 0;
      label = getTargetProgressLabel(preset, 0);
    } else if (run.stage === "completed" && run.result) {
      fraction = 1;
      if (preset.type === "distance") label = getDistanceProgressLabel(preset.distanceTargetM, preset.distanceTargetM);
      else label = getSpeedProgressLabel(preset.targetSpeedMs, preset.targetSpeedMs, state.settings.speedUnit, preset.startSpeedMs);
    } else if (preset.type === "distance") {
      var distanceValue = run.startPerfMs !== null ? Math.max(0, run.distanceSinceArmM - run.startDistanceM) : 0;
      fraction = preset.distanceTargetM > 0 ? clamp(distanceValue / preset.distanceTargetM, 0, 1) : 0;
      label = getDistanceProgressLabel(distanceValue, preset.distanceTargetM);
    } else {
      var currentSpeed = state.latestSample ? state.latestSample.speedMs : 0;
      var baseline = preset.standingStart ? 0 : preset.startSpeedMs;
      var denominator = Math.max(0.1, preset.targetSpeedMs - baseline);
      fraction = clamp((currentSpeed - baseline) / denominator, 0, 1);
      label = getSpeedProgressLabel(currentSpeed, preset.targetSpeedMs, state.settings.speedUnit, baseline);
    }

    elements.progressLabel.textContent = label;
    elements.progressFill.style.width = String(Math.round(fraction * 1000) / 10) + "%";
  }

  function renderResultCard() {
    var result = getDisplayedResult();

    if (!result) {
      elements.resultEmptyState.hidden = false;
      elements.resultContent.hidden = true;
      if (elements.resultPrimaryHeader) elements.resultPrimaryHeader.hidden = true;
      renderResultPartials(null);
      if (elements.resultNotesRow) elements.resultNotesRow.hidden = true;
      renderResultGraph(null);
      return;
    }

    elements.resultEmptyState.hidden = true;
    elements.resultContent.hidden = false;
    if (elements.resultPrimaryHeader) elements.resultPrimaryHeader.hidden = false;
    elements.resultElapsedValue.textContent = formatRunSeconds(result.elapsedMs) + " s";
    elements.resultPresetValue.textContent = getPresetLabel(result);
    elements.resultFinishSpeedValue.textContent = formatSpeedValue(result.finishSpeedMs, state.settings.speedUnit);
    elements.resultRolloutValue.textContent = getRolloutLabel(result);
    elements.resultAccuracyValue.textContent = formatDistanceMeasurement(result.averageAccuracyM);
    elements.resultSlopeValue.textContent = formatSlopePercent(result.slopePercent);
    elements.resultElevationValue.textContent = formatSignedDistanceMeasurement(result.elevationDeltaM);
    elements.resultHzValue.textContent = formatHz(result.averageHz);
    elements.resultQualityValue.textContent = getQualityLabel(result.qualityGrade);
    elements.resultTimestampValue.textContent = formatTimestamp(result.savedAtMs);
    elements.resultComparisonValue.textContent = buildComparisonText(result);
    renderResultPartials(result);
    if (elements.resultNotesRow && elements.resultNotesValue) {
      var hasNotes = Boolean(result.notes);
      elements.resultNotesRow.hidden = !hasNotes;
      elements.resultNotesValue.textContent = hasNotes ? result.notes : t("accelUnavailable");
    }
    renderResultGraph(result);
  }

  function renderResultPartials(result) {
    if (!elements.resultPartialsSection || !elements.resultPartialsList) return;
    if (!result || !result.partials || !result.partials.length) {
      elements.resultPartialsSection.hidden = true;
      elements.resultPartialsList.innerHTML = "";
      return;
    }

    var html = "";
    for (var index = 0; index < result.partials.length; index += 1) {
      var partial = result.partials[index];
      var status = partial && partial.elapsedMs !== null ? "done" : "missed";
      html += '<div class="accel-partial-row" data-status="' + status + '">';
      html += '<span class="accel-partial-label">' + escapeHtml(getPartialLabel(partial)) + "</span>";
      html += '<strong class="accel-partial-value">' + escapeHtml(formatPartialValue(partial, state.settings.speedUnit, true)) + "</strong>";
      html += "</div>";
    }

    elements.resultPartialsSection.hidden = false;
    elements.resultPartialsList.innerHTML = html;
  }

  function renderResultGraph(result) {
    if (!elements.resultGraphMeta || !elements.resultGraphEmptyState || !elements.resultGraphFrame) return;

    var speedUnit = state.settings.speedUnit;
    elements.resultGraphMeta.textContent = t("accelSpeedGraphLead") + " · " + getSpeedUnitLabel(speedUnit);

    if (!result || !Array.isArray(result.speedTrace) || result.speedTrace.length < 2) {
      elements.resultGraphEmptyState.hidden = false;
      elements.resultGraphFrame.hidden = true;
      resultGraphSelectionResultId = "";
      resultGraphSelectionPointKey = "";
      renderResultGraphDetails(null);
      destroyResultGraph();
      return;
    }

    var graphData = buildResultGraphData(result);
    if (graphData.length < 2) {
      elements.resultGraphEmptyState.hidden = false;
      elements.resultGraphFrame.hidden = true;
      resultGraphSelectionResultId = "";
      resultGraphSelectionPointKey = "";
      renderResultGraphDetails(null);
      destroyResultGraph();
      return;
    }

    elements.resultGraphEmptyState.hidden = true;
    elements.resultGraphFrame.hidden = false;
    var selectedPoint = getSelectedResultGraphPoint(result, graphData);
    renderResultGraphDetails(selectedPoint);

    if (state.openPanel !== "results") return;
    mountResultGraph(result, graphData, selectedPoint);
  }

  function buildResultGraphData(result) {
    if (!result || !Array.isArray(result.speedTrace) || result.speedTrace.length < 2) return [];

    var trace = compactSpeedTrace(result.speedTrace);
    var speedUnit = state.settings.speedUnit;
    var graphData = [];

    for (var index = 0; index < trace.length; index += 1) {
      var point = trace[index];
      var distanceM = isFiniteNumber(point.distanceM) ? point.distanceM : null;
      var altitudeM = isFiniteNumber(point.altitudeM) ? point.altitudeM : null;

      graphData.push({
        key: String(index) + "-" + String(point.elapsedMs),
        elapsedMs: point.elapsedMs,
        elapsedSeconds: point.elapsedMs / 1000,
        speedMs: point.speedMs,
        speedDisplay: msToSpeedUnit(point.speedMs, speedUnit),
        distanceM: distanceM,
        altitudeM: altitudeM,
        accuracyM: isFiniteNumber(point.accuracyM) ? point.accuracyM : null,
        slopePercent: getTraceSlopePercent(result.startAltitudeM, altitudeM, distanceM),
      });
    }

    return graphData;
  }

  function renderResultGraphDetails(point) {
    if (!elements.resultGraphTimeValue) return;

    elements.resultGraphTimeValue.textContent = point ? formatRunSeconds(point.elapsedMs) + " s" : "—";
    elements.resultGraphSpeedValue.textContent = point && isFiniteNumber(point.speedMs) ? formatSpeedValue(point.speedMs, state.settings.speedUnit) : "—";
    elements.resultGraphDistanceValue.textContent = point && isFiniteNumber(point.distanceM) ? formatRunDistance(point.distanceM) : "—";
    elements.resultGraphAltitudeValue.textContent = point && isFiniteNumber(point.altitudeM) ? formatDistanceMeasurement(point.altitudeM) : "—";
    elements.resultGraphAccuracyValue.textContent = point && isFiniteNumber(point.accuracyM) ? formatDistanceMeasurement(point.accuracyM) : "—";
    elements.resultGraphSlopeValue.textContent = point && isFiniteNumber(point.slopePercent) ? formatSlopePercent(point.slopePercent) : "—";
  }

  function getSelectedResultGraphPoint(result, graphData) {
    if (result && result.id === resultGraphSelectionResultId && resultGraphSelectionPointKey) {
      for (var index = 0; index < graphData.length; index += 1) {
        if (graphData[index].key === resultGraphSelectionPointKey) return graphData[index];
      }
    }

    var fallbackPoint = graphData.length ? graphData[graphData.length - 1] : null;
    resultGraphSelectionResultId = result ? result.id : "";
    resultGraphSelectionPointKey = fallbackPoint ? fallbackPoint.key : "";
    return fallbackPoint;
  }

  function getTraceSlopePercent(startAltitudeM, altitudeM, distanceM) {
    if (!isFiniteNumber(startAltitudeM) || !isFiniteNumber(altitudeM) || !isFiniteNumber(distanceM) || distanceM < 1) return null;
    return ((altitudeM - startAltitudeM) / distanceM) * 100;
  }

  function requestResultGraphRefresh() {
    if (resultGraphRefreshFrame || state.openPanel !== "results") return;

    resultGraphRefreshFrame = window.requestAnimationFrame(function () {
      resultGraphRefreshFrame = 0;
      renderResultGraph(getDisplayedResult());
    });
  }

  function destroyResultGraph() {
    if (resultGraphRefreshFrame) {
      window.cancelAnimationFrame(resultGraphRefreshFrame);
      resultGraphRefreshFrame = 0;
    }
    if (resultGraphChart) {
      resultGraphChart.destroy();
      resultGraphChart = null;
    }
    resultGraphRenderKey = "";
  }

  function mountResultGraph(result, graphData, selectedPoint) {
    if (!elements.resultGraphCanvas || !elements.resultGraphFrame || !graphData || graphData.length < 2) return;

    var frameWidth = Math.floor(elements.resultGraphFrame.clientWidth || elements.resultGraphFrame.getBoundingClientRect().width || 0);
    if (frameWidth < 120) return;

    var renderKey = [
      result.id,
      state.settings.speedUnit,
      state.settings.distanceUnit,
      state.lang,
      frameWidth,
      RESULT_GRAPH_HEIGHT,
    ].join(":");
    if (renderKey === resultGraphRenderKey) return;

    var canvasElement = elements.resultGraphCanvas;
    canvasElement.style.width = "100%";
    canvasElement.style.height = RESULT_GRAPH_HEIGHT + "px";
    var config = buildResultGraphConfig(result, graphData, selectedPoint);
    destroyResultGraph();
    resultGraphRenderKey = renderKey;
    resultGraphChart = new Chart(canvasElement, config);
    setResultGraphActivePoint(resultGraphChart, getResultGraphSelectedIndex(selectedPoint, graphData));
  }

  function buildResultGraphConfig(result, graphData, selectedPoint) {
    var speedUnit = state.settings.speedUnit;
    var speedTick = speedUnit === "kmh" ? 20 : 10;
    var maxSpeedDisplay = speedTick;
    var maxElapsedSeconds = 0.1;

    for (var index = 0; index < graphData.length; index += 1) {
      maxSpeedDisplay = Math.max(maxSpeedDisplay, graphData[index].speedDisplay || 0);
      maxElapsedSeconds = Math.max(maxElapsedSeconds, graphData[index].elapsedSeconds || 0);
    }

    var graphMaxSpeedDisplay = Math.max(speedTick, Math.ceil(maxSpeedDisplay / speedTick) * speedTick);
    var palette = getResultGraphPalette();

    return {
      type: "line",
      plugins: [RESULT_GRAPH_GUIDE_PLUGIN],
      data: {
        datasets: [
          {
            label: t("accelSpeedGraph"),
            data: graphData,
            parsing: {
              xAxisKey: "elapsedSeconds",
              yAxisKey: "speedDisplay",
            },
            normalized: true,
            borderColor: palette.line,
            backgroundColor: palette.area,
            fill: true,
            borderWidth: 3,
            cubicInterpolationMode: "monotone",
            tension: 0.24,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 18,
            pointHoverBorderWidth: 2,
            pointHoverBackgroundColor: palette.line,
            pointHoverBorderColor: palette.markerOutline,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 60,
        events: ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
        interaction: {
          mode: "nearest",
          intersect: false,
          axis: "xy",
        },
        layout: {
          padding: {
            top: 12,
            right: 14,
            bottom: 8,
            left: 6,
          },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: maxElapsedSeconds,
            grid: {
              color: palette.grid,
              drawTicks: false,
            },
            border: {
              color: palette.axis,
            },
            ticks: {
              color: palette.label,
              maxTicksLimit: 5,
              padding: 8,
              callback: function (value) {
                var numericValue = Number(value);
                var decimals = maxElapsedSeconds >= 10 ? 1 : 2;
                return formatNumber(numericValue, decimals) + " s";
              },
            },
          },
          y: {
            min: 0,
            max: graphMaxSpeedDisplay,
            grid: {
              color: palette.grid,
              drawTicks: false,
            },
            border: {
              color: palette.axis,
            },
            ticks: {
              color: palette.label,
              maxTicksLimit: 5,
              padding: 8,
              callback: function (value) {
                return formatNumber(Number(value), 0);
              },
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: true,
            displayColors: false,
            backgroundColor: palette.markerBackground,
            titleColor: palette.markerOutline,
            bodyColor: palette.markerOutline,
            borderColor: palette.axis,
            borderWidth: 1,
            cornerRadius: 12,
            padding: 12,
            caretSize: 6,
            caretPadding: 10,
            bodySpacing: 4,
            titleSpacing: 6,
            callbacks: {
              title: function (items) {
                if (!items || !items.length || !items[0].raw) return "";
                return formatRunSeconds(items[0].raw.elapsedMs) + " s";
              },
              label: function (context) {
                return context && context.raw ? formatSpeedValue(context.raw.speedMs, state.settings.speedUnit) : "";
              },
              afterLabel: function (context) {
                return buildResultGraphTooltipLines(context ? context.raw : null);
              },
            },
          },
          resultGraphGuide: {
            color: palette.crosshair,
          },
        },
        onHover: function (event, activeElements, chart) {
          handleResultGraphInteraction(chart, activeElements);
        },
        onClick: function (event, activeElements, chart) {
          handleResultGraphInteraction(chart, activeElements);
        },
      },
    };
  }

  function getResultGraphSelectedIndex(selectedPoint, graphData) {
    if (!selectedPoint || !graphData || !graphData.length) return -1;

    for (var index = 0; index < graphData.length; index += 1) {
      if (graphData[index].key === selectedPoint.key) return index;
    }

    return graphData.length - 1;
  }

  function setResultGraphActivePoint(chart, index) {
    if (!chart || index < 0) return;

    var meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data[index]) return;

    var pointElement = meta.data[index];
    var pointPosition = pointElement.getProps
      ? pointElement.getProps(["x", "y"], true)
      : { x: pointElement.x, y: pointElement.y };
    var activeElements = [{ datasetIndex: 0, index: index }];

    chart.setActiveElements(activeElements);
    if (chart.tooltip && typeof chart.tooltip.setActiveElements === "function") {
      chart.tooltip.setActiveElements(activeElements, pointPosition);
    }
    chart.update("none");
    handleResultGraphInteraction(chart, activeElements);
  }

  function handleResultGraphInteraction(chart, activeElements) {
    if (!chart || !activeElements || !activeElements.length) return;

    var activePoint = activeElements[0];
    var dataset = chart.data && chart.data.datasets && chart.data.datasets[activePoint.datasetIndex]
      ? chart.data.datasets[activePoint.datasetIndex]
      : null;
    var rawPoint = dataset && Array.isArray(dataset.data) ? dataset.data[activePoint.index] : null;
    if (!rawPoint) return;

    var displayedResult = getDisplayedResult();
    resultGraphSelectionResultId = displayedResult ? displayedResult.id : "";
    resultGraphSelectionPointKey = rawPoint.key || "";
    renderResultGraphDetails(rawPoint);
  }

  function buildResultGraphTooltipLines(rawPoint) {
    if (!rawPoint) return [];

    return [
      t("accelGraphPointDistance") + ": " + (isFiniteNumber(rawPoint.distanceM) ? formatRunDistance(rawPoint.distanceM) : "—"),
      t("altitude") + ": " + (isFiniteNumber(rawPoint.altitudeM) ? formatDistanceMeasurement(rawPoint.altitudeM) : "—"),
      t("accelGraphPointAccuracy") + ": " + (isFiniteNumber(rawPoint.accuracyM) ? formatDistanceMeasurement(rawPoint.accuracyM) : "—"),
      t("accelGraphPointSlope") + ": " + (isFiniteNumber(rawPoint.slopePercent) ? formatSlopePercent(rawPoint.slopePercent) : "—"),
    ];
  }

  function getResultGraphPalette() {
    return {
      line: getCssColorValue("--accel-accent", "#10b981"),
      area: getCssColorValue("--accel-accent-soft", "rgba(16, 185, 129, 0.18)"),
      axis: getCssColorValue("--accel-border", "rgba(17, 24, 39, 0.22)"),
      grid: getCssColorValue("--accel-border", "rgba(17, 24, 39, 0.14)"),
      label: getCssColorValue("--accel-muted", "#8d8f95"),
      crosshair: getCssColorValue("--accel-muted", "rgba(141, 143, 149, 0.64)"),
      markerBackground: getCssColorValue("--accel-surface-strong", "#181a20"),
      markerOutline: getCssColorValue("--accel-chip-fg", "#f7f8fa"),
    };
  }

  function getCssColorValue(name, fallback) {
    var sourceElement = elements.resultGraphFrame || elements.liveSpeedGaugeStage || document.documentElement;
    var value = getComputedStyle(sourceElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function renderDiagnostics() {
    var diagnostics = getCurrentDiagnostics();
    elements.diagnosticAverageIntervalValue.textContent = formatMs(diagnostics.averageIntervalMs);
    elements.diagnosticJitterValue.textContent = formatMs(diagnostics.jitterMs);
    elements.diagnosticSparseValue.textContent = formatInteger(diagnostics.sparseCount);
    elements.diagnosticStaleValue.textContent = formatInteger(diagnostics.staleCount);
    elements.diagnosticSpeedSourceValue.textContent = getSpeedSourceLabel(diagnostics.speedSource);
    elements.diagnosticSamplesValue.textContent = formatInteger(diagnostics.sampleCount);

    renderWarningBadges(diagnostics.warningKeys);
  }

  function getCurrentDiagnostics() {
    var displayedResult = getDisplayedResult();
    if (displayedResult) {
      return {
        averageIntervalMs: displayedResult.averageIntervalMs,
        jitterMs: displayedResult.jitterMs,
        sparseCount: displayedResult.sparseCount,
        staleCount: displayedResult.staleCount,
        speedSource: displayedResult.speedSource,
        sampleCount: displayedResult.sampleCount,
        warningKeys: displayedResult.warningKeys || [],
      };
    }

    if (state.run && state.run.result) {
      return {
        averageIntervalMs: state.run.result.averageIntervalMs,
        jitterMs: state.run.result.jitterMs,
        sparseCount: state.run.result.sparseCount,
        staleCount: state.run.result.staleCount,
        speedSource: state.run.result.speedSource,
        sampleCount: state.run.result.sampleCount,
        warningKeys: state.run.result.warningKeys || [],
      };
    }

    if (isRunActive(state.run)) {
      var liveRunQuality = buildCurrentRunQuality(state.run);
      return {
        averageIntervalMs: liveRunQuality.averageIntervalMs,
        jitterMs: liveRunQuality.jitterMs,
        sparseCount: state.run.sparseCount,
        staleCount: state.run.staleCount,
        speedSource: state.run.derivedSpeedCount > (state.run.sampleCount / 2) ? "derived" : "reported",
        sampleCount: state.run.sampleCount,
        warningKeys: liveRunQuality.warningKeys,
      };
    }

    var sessionQuality = buildLiveQuality();
    return {
      averageIntervalMs: sessionQuality.averageIntervalMs,
      jitterMs: sessionQuality.jitterMs,
      sparseCount: isLatestSampleSparse() ? 1 : 0,
      staleCount: isLatestSampleStale() ? 1 : 0,
      speedSource: state.latestSample ? state.latestSample.speedSource : null,
      sampleCount: state.sessionSampleCount,
      warningKeys: sessionQuality.warningKeys || [],
    };
  }

  function buildCurrentRunQuality(run) {
    var stats = computeIntervalStats(run.intervalValues);
    var averageAccuracyM = averageArray(run.accuracyValues);
    var quality = evaluateQuality({
      sampleCount: run.sampleCount,
      durationMs: run.startPerfMs !== null ? performance.now() - run.startPerfMs : 0,
      averageAccuracyM: averageAccuracyM,
      averageHz: stats.hz,
      averageIntervalMs: stats.averageMs,
      jitterMs: stats.jitterMs,
      staleCount: run.staleCount,
      sparseCount: run.sparseCount,
      nullSpeedShare: run.sampleCount ? run.nullSpeedCount / run.sampleCount : 1,
      derivedShare: run.sampleCount ? run.derivedSpeedCount / run.sampleCount : 1,
      isLive: true,
    });

    quality.averageIntervalMs = stats.averageMs;
    quality.jitterMs = stats.jitterMs;
    return quality;
  }

  function renderWarningBadges(warningKeys) {
    var warnings = warningKeys && warningKeys.length ? warningKeys : ["accelWarningNoWarnings"];
    var html = "";

    for (var index = 0; index < warnings.length; index += 1) {
      var warningKey = warnings[index];
      var tone = warningKey === "accelWarningNoWarnings" ? "ok" : "warning";
      if (warningKey === "accelWarningStale") tone = "danger";
      html += '<span class="accel-warning-badge" data-tone="' + tone + '">' + escapeHtml(t(warningKey)) + "</span>";
    }

    elements.warningBadges.innerHTML = html;
  }

  function renderHistory() {
    if (!state.runs.length) {
      elements.historyEmptyState.hidden = false;
      elements.historyList.innerHTML = "";
      return;
    }

    elements.historyEmptyState.hidden = true;

    var html = "";
    var displayedResult = getDisplayedResult();
    for (var index = 0; index < state.runs.length; index += 1) {
      var run = state.runs[index];
      var isSelected = Boolean(displayedResult && displayedResult.id === run.id);
      html += '<article class="accel-history-item" data-selected="' + String(isSelected) + '">';
      html += '<div class="accel-history-copy">';
      html += '<div class="accel-history-main"><strong>' + escapeHtml(getPresetLabel(run)) + "</strong> <span>" + escapeHtml(formatRunSeconds(run.elapsedMs)) + " s</span></div>";
      html += '<div class="accel-history-meta">' + escapeHtml(getQualityLabel(run.qualityGrade)) + " · " + escapeHtml(formatTimestamp(run.savedAtMs)) + "</div>";
      if (run.notes) html += '<div class="accel-history-note">' + escapeHtml(run.notes) + "</div>";
      html += "</div>";
      html += '<div class="accel-history-actions">';
      html += '<button type="button" class="accel-action-btn accel-action-btn-compact accel-history-load-btn" data-history-action="load" data-run-id="' + escapeHtml(run.id) + '" aria-pressed="' + String(isSelected) + '">' + escapeHtml(isSelected ? t("accelViewingResult") : t("accelLoadResult")) + "</button>";
      html += '<button type="button" class="accel-delete-btn" data-history-action="delete" data-run-id="' + escapeHtml(run.id) + '">' + escapeHtml(t("delete")) + "</button>";
      html += "</div>";
      html += "</article>";
    }

    elements.historyList.innerHTML = html;
  }

  function getSetupSummary() {
    var preset = getSelectedPreset();
    var metaParts = [preset.standingStart ? t("accelStandingStart") : t("accelRollingStart")];

    if (preset.standingStart) {
      metaParts.push(state.settings.rolloutEnabled ? t("accelRolloutOn") : t("accelRolloutOff"));
    }

    metaParts.push(getSpeedUnitLabel(state.settings.speedUnit) + " / " + getDistanceUnitLabel(state.settings.distanceUnit));

    return {
      title: getPresetLabel(preset),
      meta: metaParts.join(" · "),
    };
  }

  function getResultsSummary() {
    var result = getDisplayedResult();
    if (!result) {
      return {
        title: t("accelNoSavedRunsShort"),
        meta: t("accelLocalOnly"),
      };
    }

    return {
      title: formatRunSeconds(result.elapsedMs) + " s",
      meta: getPresetLabel(result) + " · " + getQualityLabel(result.qualityGrade),
    };
  }

  function getResultsPanelStatusText() {
    var result = getDisplayedResult();
    if (!result) return t("accelStorageNote");
    return getPresetLabel(result) + " · " + formatTimestamp(result.savedAtMs);
  }

  function getRunStateLabel() {
    if (!state.geolocationSupported) return t("accelStateError");
    if (!isGpsReady() && (!state.run || state.run.stage !== "completed")) return t("accelStateGpsWaiting");
    if (!state.run) return t("accelStateIdle");

    switch (state.run.stage) {
      case "armed":
        return t("accelStateWaitingLaunch");
      case "waiting_rollout":
        return t("accelStateWaitingRollout");
      case "running":
        return t("accelStateRunning");
      case "completed":
        return t("accelStateCompleted");
      default:
        return t("accelStateIdle");
    }
  }

  function getPermissionLabel(permissionState) {
    switch (permissionState) {
      case "granted":
        return t("accelPermissionGranted");
      case "denied":
        return t("accelPermissionDenied");
      case "prompt":
        return t("accelPermissionPrompt");
      case "unsupported":
        return t("accelPermissionUnsupported");
      default:
        return t("accelPermissionUnknown");
    }
  }

  function getQualityLabel(grade) {
    switch (grade) {
      case "good":
        return t("accelQualityGood");
      case "fair":
        return t("accelQualityFair");
      case "poor":
        return t("accelQualityPoor");
      default:
        return t("accelQualityInvalid");
    }
  }

  function getSpeedSourceLabel(source) {
    if (source === "derived") return t("accelSpeedDerivedLabel");
    if (source === "reported") return t("accelSpeedReported");
    return t("accelUnavailable");
  }

  function getRolloutLabel(result) {
    if (!result.standingStart) return t("accelRolloutIgnored");
    return result.rolloutApplied ? t("accelRolloutOn") : t("accelRolloutOff");
  }

  function isGpsReady() {
    var latestSampleAgeMs = getLatestSampleAgeMs();
    return isFiniteNumber(latestSampleAgeMs) && latestSampleAgeMs <= READY_SAMPLE_AGE_MS;
  }

  function getLatestSampleAgeMs() {
    if (!state.latestSample || !isFiniteNumber(state.latestSample.receivedAtMs)) return null;
    return Math.max(0, Date.now() - state.latestSample.receivedAtMs);
  }

  function isLatestSampleStale() {
    return Boolean(state.latestSample && (state.latestSample.stale || getLatestSampleAgeMs() >= STALE_INTERVAL_MS));
  }

  function isLatestSampleSparse() {
    return Boolean(state.latestSample && (state.latestSample.sparse || getLatestSampleAgeMs() >= SPARSE_INTERVAL_MS));
  }

  function isCustomRangeValid() {
    return toFiniteNumber(state.settings.customEnd, 0) > toFiniteNumber(state.settings.customStart, 0);
  }

  function setActionNotice(key, params) {
    if (state.actionNoticeTimerId) window.clearTimeout(state.actionNoticeTimerId);
    elements.actionNotice.textContent = t(key, params || {});

    state.actionNoticeTimerId = window.setTimeout(function () {
      elements.actionNotice.textContent = "";
      state.actionNoticeTimerId = null;
    }, 2600);
  }

  function buildComparisonText(result) {
    var best = findBestComparableRun(result);
    if (!best) return t("accelNoComparison");
    if (best.id === result.id) return t("accelBestRun");

    var deltaMs = result.elapsedMs - best.elapsedMs;
    var deltaText = formatRunSeconds(Math.abs(deltaMs)) + " s";
    return deltaMs < 0 ? t("accelFasterBy", { value: deltaText }) : t("accelSlowerBy", { value: deltaText });
  }

  function getCompletedRunDistance(run) {
    if (!run) return null;
    if (isFiniteNumber(run.finishDistanceM) && isFiniteNumber(run.startDistanceM)) {
      return Math.max(0, run.finishDistanceM - run.startDistanceM);
    }
    if (run.preset && run.preset.type === "distance" && isFiniteNumber(run.preset.distanceTargetM)) {
      return run.preset.distanceTargetM;
    }
    if (isFiniteNumber(run.distanceSinceArmM) && isFiniteNumber(run.startDistanceM)) {
      return Math.max(0, run.distanceSinceArmM - run.startDistanceM);
    }
    return null;
  }

  function buildSlopeAnalysis(startAltitudeM, finishAltitudeM, runDistanceM) {
    if (!isFiniteNumber(startAltitudeM) || !isFiniteNumber(finishAltitudeM)) {
      return { elevationDeltaM: null, slopePercent: null };
    }
    if (!isFiniteNumber(runDistanceM) || runDistanceM <= 0) {
      return { elevationDeltaM: null, slopePercent: null };
    }

    var elevationDeltaM = finishAltitudeM - startAltitudeM;
    return {
      elevationDeltaM: elevationDeltaM,
      slopePercent: (elevationDeltaM / runDistanceM) * 100,
    };
  }

  function getLiveSlopePercent(run) {
    if (!run) return null;
    if (run.stage === "completed" && run.result) return run.result.slopePercent;
    if (run.startPerfMs === null) return null;

    var currentAltitudeM = state.latestSample ? state.latestSample.altitudeM : null;
    var currentDistanceM = isFiniteNumber(run.startDistanceM)
      ? Math.max(0, run.distanceSinceArmM - run.startDistanceM)
      : null;
    return buildSlopeAnalysis(run.startAltitudeM, currentAltitudeM, currentDistanceM).slopePercent;
  }

  function getPartialLabel(partial) {
    if (!partial) return t("accelUnavailable");
    return t(partial.labelKey);
  }

  function formatPartialValue(partial, speedUnit, runCompleted) {
    if (!partial) return t("accelUnavailable");
    var activeSpeedUnit = speedUnit || state.settings.speedUnit;
    if (!isFiniteNumber(partial.elapsedMs)) {
      return runCompleted ? t("accelPartialNotCaptured") : t("accelPartialWaiting");
    }

    var elapsedText = formatRunSeconds(partial.elapsedMs) + " s";
    if (!partial.showTrapSpeed || !isFiniteNumber(partial.trapSpeedMs)) return elapsedText;
    return elapsedText + " @ " + formatSpeedValue(partial.trapSpeedMs, activeSpeedUnit);
  }

  function findBestComparableRun(result) {
    var matches = [];
    var validMatches = [];
    var comparisonSignature = result && result.comparisonSignature
      ? result.comparisonSignature
      : buildComparisonSignature(result);

    for (var index = 0; index < state.runs.length; index += 1) {
      var run = state.runs[index];
      var runComparisonSignature = run.comparisonSignature || buildComparisonSignature(run);
      if (runComparisonSignature !== comparisonSignature) continue;
      matches.push(run);
      if (run.qualityGrade !== "invalid") validMatches.push(run);
    }

    var comparableRuns = validMatches.length ? validMatches : matches;
    if (!comparableRuns.length) return null;

    comparableRuns.sort(function (left, right) {
      return left.elapsedMs - right.elapsedMs;
    });

    return comparableRuns[0];
  }

  function getDistanceM(latA, lonA, latB, lonB) {
    if (!isFiniteNumber(latA) || !isFiniteNumber(lonA) || !isFiniteNumber(latB) || !isFiniteNumber(lonB)) return 0;

    var rad = Math.PI / 180;
    var phi1 = latA * rad;
    var phi2 = latB * rad;
    var deltaPhi = (latB - latA) * rad;
    var deltaLambda = (lonB - lonA) * rad;
    var sinPhi = Math.sin(deltaPhi / 2);
    var sinLambda = Math.sin(deltaLambda / 2);
    var a = (sinPhi * sinPhi) + (Math.cos(phi1) * Math.cos(phi2) * sinLambda * sinLambda);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371000 * c;
  }

  function msToSpeedUnit(speedMs, unit) {
    if (!isFiniteNumber(speedMs)) return null;
    return speedMs * SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].factor;
  }

  function speedUnitValueToMs(value, unit) {
    if (!isFiniteNumber(value)) return null;
    return value / SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].factor;
  }

  function convertSpeedInputValue(value, fromUnit, toUnit) {
    if (!isFiniteNumber(value)) return 0;
    if (fromUnit === toUnit) return normalizeCustomSpeedInput(value, 0);
    return normalizeCustomSpeedInput(msToSpeedUnit(speedUnitValueToMs(value, fromUnit), toUnit), 0);
  }

  function getSpeedUnitLabel(unit) {
    return t(SPEED_UNIT_CONFIG[normalizeSpeedUnit(unit)].labelKey);
  }

  function getDistanceUnitLabel(unit) {
    return DISTANCE_UNIT_CONFIG[normalizeDistanceUnit(unit)].label;
  }

  function convertDistanceMeasurement(valueM, unit) {
    if (!isFiniteNumber(valueM)) return null;
    return valueM * DISTANCE_UNIT_CONFIG[normalizeDistanceUnit(unit)].factor;
  }

  function formatLiveSpeedNumber(speedMs, unit) {
    if (!isFiniteNumber(speedMs)) return "0";
    return formatNumber(msToSpeedUnit(speedMs, unit), 0);
  }

  function formatSpeedValue(speedMs, unit) {
    if (!isFiniteNumber(speedMs)) return t("accelUnavailable");
    return formatNumber(msToSpeedUnit(speedMs, unit), 1) + " " + getSpeedUnitLabel(unit);
  }

  function formatRunDistance(distanceM, unit) {
    if (!isFiniteNumber(distanceM)) return t("accelUnavailable");
    var normalizedUnit = normalizeDistanceUnit(unit || state.settings.distanceUnit);
    var converted = convertDistanceMeasurement(distanceM, normalizedUnit);
    var decimals = normalizedUnit === "m" ? 1 : 0;
    return formatNumber(converted, decimals) + " " + getDistanceUnitLabel(normalizedUnit);
  }

  function getDistanceProgressLabel(currentDistanceM, targetDistanceM) {
    return formatRunDistance(currentDistanceM) + " / " + formatRunDistance(targetDistanceM);
  }

  function getSpeedProgressLabel(currentSpeedMs, targetSpeedMs, unit, baselineMs) {
    var baseline = isFiniteNumber(baselineMs) ? baselineMs : 0;
    var currentValue = Math.max(baseline, currentSpeedMs || 0);
    return formatNumber(msToSpeedUnit(currentValue, unit), 0) + " / " + formatNumber(msToSpeedUnit(targetSpeedMs, unit), 0) + " " + getSpeedUnitLabel(unit);
  }

  function getTargetProgressLabel(preset, value) {
    if (preset.type === "distance") return getDistanceProgressLabel(value, preset.distanceTargetM);
    return getSpeedProgressLabel(0, preset.targetSpeedMs, state.settings.speedUnit, preset.startSpeedMs);
  }

  function formatHeading(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return formatNumber(value, 0) + "°";
  }

  function formatDistanceMeasurement(valueM, unit) {
    if (!isFiniteNumber(valueM)) return t("accelUnavailable");
    var normalizedUnit = normalizeDistanceUnit(unit || state.settings.distanceUnit);
    var converted = convertDistanceMeasurement(valueM, normalizedUnit);
    var decimals = Math.abs(converted) >= 100 ? 0 : 1;
    return formatNumber(converted, decimals) + " " + getDistanceUnitLabel(normalizedUnit);
  }

  function formatSignedDistanceMeasurement(valueM, unit) {
    if (!isFiniteNumber(valueM)) return t("accelUnavailable");
    var normalizedUnit = normalizeDistanceUnit(unit || state.settings.distanceUnit);
    var converted = convertDistanceMeasurement(Math.abs(valueM), normalizedUnit);
    var decimals = Math.abs(converted) >= 100 ? 0 : 1;
    var sign = Math.abs(valueM) < 0.05 ? "" : (valueM > 0 ? "+" : "-");
    return sign + formatNumber(converted, decimals) + " " + getDistanceUnitLabel(normalizedUnit);
  }

  function formatSlopePercent(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    var sign = Math.abs(value) < 0.05 ? "" : (value > 0 ? "+" : "-");
    return sign + formatNumber(Math.abs(value), 1) + "%";
  }

  function formatHz(value) {
    if (!isFiniteNumber(value) || value <= 0) return t("accelUnavailable");
    var decimals = value >= 10 ? 1 : 2;
    return formatNumber(value, decimals) + " Hz";
  }

  function formatMs(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return formatNumber(value, value >= 100 ? 0 : 1) + " ms";
  }

  function formatInteger(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return new Intl.NumberFormat(state.lang, { maximumFractionDigits: 0 }).format(value);
  }

  function formatNumber(value, decimals) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    return new Intl.NumberFormat(state.lang, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  function formatAdaptiveNumber(value) {
    if (!isFiniteNumber(value)) return t("accelUnavailable");
    var rounded = Math.round(value);
    var decimals = Math.abs(value - rounded) < 0.05 ? 0 : 1;
    return formatNumber(value, decimals);
  }

  function normalizeCustomSpeedInput(value, fallback) {
    var normalized = Math.max(0, toFiniteNumber(value, fallback));
    return Math.round(normalized * 10) / 10;
  }

  function formatInputSpeedValue(value) {
    if (!isFiniteNumber(value)) return "";
    var normalized = normalizeCustomSpeedInput(value, 0);
    if (Math.abs(normalized - Math.round(normalized)) < 0.001) return String(Math.round(normalized));
    return normalized.toFixed(1);
  }

  function formatThresholdOptionLabel(speedMs) {
    return formatNumber(msToSpeedUnit(speedMs, state.settings.speedUnit), 1) + " " + getSpeedUnitLabel(state.settings.speedUnit);
  }

  function isSameNumber(left, right) {
    if (!isFiniteNumber(left) || !isFiniteNumber(right)) return false;
    return Math.abs(left - right) < 0.0001;
  }

  function formatRunSeconds(durationMs) {
    if (!isFiniteNumber(durationMs)) return "0.000";
    return formatNumber(Math.max(0, durationMs) / 1000, 3);
  }

  function formatTimestamp(timestampMs) {
    if (!isFiniteNumber(timestampMs)) return t("accelUnavailable");
    var date = new Date(timestampMs);
    return new Intl.DateTimeFormat(state.lang, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
