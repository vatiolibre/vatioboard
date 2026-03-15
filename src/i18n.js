/**
 * VatioBoard i18n - Minimal internationalization
 * Supports: English (en), Spanish (es)
 */

const translations = {
  en: {
    // UI Controls
    pen: 'Pen',
    eraser: 'Eraser',
    size: 'Size',
    color: 'Color',
    hex: 'Hex',
    close: 'Close',
    clear: 'Clear',
    savePng: 'Save PNG',
    calculator: 'Calculator',
    speedometer: 'Speedometer',
    energy: 'Trip Cost',
    tools: 'Tools',
    alerts: 'Alerts',
    resetTrip: 'Reset trip',
    done: 'Done',
    manualSpeed: 'Manual speed',
    turnOn: 'Turn on',
    turnOff: 'Turn off',
    useCurrentSpeed: 'Use current speed',
    overspeedSound: 'Overspeed sound',
    trapAlerts: 'Trap alerts',
    alertDistance: 'Alert distance',
    trapSound: 'Trap sound',
    audio: 'Audio',
    backgroundCompact: 'BG',
    backgroundAudio: 'Background audio',
    backgroundAudioHelp: 'Keeps alerts ready when the browser is hidden.',
    audioQuickControls: 'Audio quick controls',
    toggleAlertAudio: 'Toggle alert audio',
    toggleBackgroundAudio: 'Toggle background audio',
    muteAlertAudio: 'Mute alert audio',
    unmuteAlertAudio: 'Unmute alert audio',
    enableBackgroundAudio: 'Enable background audio',
    disableBackgroundAudio: 'Disable background audio',
    speed: 'Speed',
    distance: 'Distance',
    max: 'Max',
    average: 'Average',
    nearestTrap: 'Nearest Trap',
    duration: 'Duration',
    trip: 'trip',
    altitude: 'Altitude',
    maxAlt: 'Max Alt',
    minAlt: 'Min Alt',
    on: 'On',
    off: 'Off',
    away: 'away',
    liveSpeed: 'Live speed',
    liveGlobe: 'Live globe',
    wazeMap: 'Waze map',
    recenterMap: 'Recenter map',
    changeLanguage: 'Change language',

    // Aria labels
    presetColors: 'Preset colors',
    moreColors: 'More colors',
    openCalculator: 'Open calculator',
    openSpeedometer: 'Open speedometer',
    openEnergy: 'Open trip cost calculator',
    openBoard: 'Open board',
    speedometerControls: 'Speedometer controls',
    connectionStatus: 'Connection status',
    liveAnalogSpeedometer: 'Live analog speedometer',
    analogSpeedometer: 'Analog speedometer',
    viewMode: 'View mode',
    showSpeedometer: 'Show speedometer',
    showWazeMap: 'Show Waze map',
    configureAlerts: 'Configure alerts',
    speedAlertSettings: 'Speed alert settings',
    setAlertSpeedLimit: 'Set alert speed limit',
    decreaseSpeedAlert: 'Decrease speed alert',
    increaseSpeedAlert: 'Increase speed alert',
    quickSpeedAlertPresets: 'Quick speed alert presets',
    trapAlertSettings: 'Trap alert settings',
    trapAlertDistancePresets: 'Trap alert distance presets',
    tripStats: 'Trip stats',
    currentLocationGlobe: 'Current location globe',

    // Energy Calculator
    energyTitle: 'EV Trip Cost',
    distanceKm: 'Distance (km)',
    distanceMi: 'Distance (mi)',
    consumptionKm: 'Avg consumption (kWh/100km)',
    consumptionMi: 'Avg consumption (kWh/100mi)',
    electricityPrice: 'Electricity price ($/kWh)',
    energyUsed: 'Energy used',
    estimatedCost: 'Estimated cost',
    units: 'Units',
    speedUnit: 'Speed unit',
    distanceUnit: 'Distance unit',
    invalidNumber: 'Invalid number',
    mustBePositive: 'Must be positive',
    simple: 'Simple',
    multiTrip: 'Multi-trip',
    addTrip: 'Add Trip',
    resetAll: 'Reset all',
    total: 'Total',
    tripEditor: 'Trip Editor',
    tripName: 'Trip name',
    cancel: 'Cancel',
    delete: 'Delete',
    deleteAll: 'Delete all',
    deleteTripConfirm: 'Delete "{name}"?',
    deleteAllTripsConfirm: 'Delete all trips?',
    updateTrip: 'Update trip',
    maxTrips: 'Maximum 5 trips allowed',
    tripPlaceholder: 'e.g. Bogota -> Medellin',
    tripDefaultName: 'Trip {n}',

    // Status messages
    ready: 'Ready',
    cleared: 'Cleared',
    colorUpdated: 'Color updated',
    themeUpdated: 'Theme updated',
    downloadedPng: 'Downloaded PNG',
    savedLocally: 'Saved locally (not persisted)',
    requestingGps: 'Requesting GPS...',
    gpsNotSupported: 'GPS not supported',
    gpsBlocked: 'GPS blocked',
    gpsUnavailable: 'GPS unavailable',
    waitingForGps: 'Waiting for GPS...',
    gpsError: 'GPS error',
    globeUnavailable: 'Globe unavailable',
    gpsLive: 'GPS live',
    gpsLockedAccuracy: 'GPS locked · +/-{value} {unit}',
    gpsLiveAccuracy: 'GPS live · +/-{value} {unit}',
    weakGpsAccuracy: 'Weak GPS · +/-{value} {unit}',
    loadingTraps: 'Loading traps',
    trapUnavailable: 'Trap unavailable',
    loadingTrapData: 'Loading trap data',
    loadingSpeedTrapData: 'Loading speed trap data',
    trapDataUnavailable: 'Trap data unavailable',
    trapAlertsEnabledUnavailable: 'Trap alerts are enabled, but trap data is unavailable',
    lookingFirstGpsFix: 'Looking for your first GPS fix',
    liveMapWaitingGps: 'Waiting for GPS to center the live map.',
    loadingWazeMap: 'Loading Waze live map...',
    mapCenteredOnLatestFix: 'Centered on the latest GPS fix.',
    recenterToLatestFix: 'Tap recenter to update the map.',
    alertsHint: 'Tap Alerts to set speed and trap warnings',
    tapToConfigure: 'Tap to configure',
    tapToConfigureAlerts: 'Tap to configure speed and trap alerts',
    nearbyTrapOverrides: 'Nearby trap speed overrides the manual limit.',
    allowLocationAccess: 'Allow location access to measure speed.',
    retryGps: 'Retry GPS',
    noticeNoGeolocation: 'This browser does not expose geolocation, so live speed cannot start here.',
    noticeLocationRequired: 'Location access is required. Allow GPS for this site and press Retry GPS.',
    noticeSignalUnavailable: 'GPS signal is unavailable right now. Move to a clearer area and retry.',
    noticeStillWaiting: 'Still waiting for a GPS lock. Make sure location access is enabled and try again.',
    noticeStillLookingFirstFix: 'Still looking for the first GPS fix. Keep location enabled and give the browser a moment.',

    // Color names
    graphite: 'Graphite',
    slate: 'Slate',
    blue: 'Blue',
    green: 'Green',
    amber: 'Amber',
    rose: 'Rose',

    // Calculator
    calcTitle: 'Calculator',
    history: 'History',
    noHistory: 'No history yet',
    settings: 'Settings',
    decimalPlaces: 'Decimal places',
    thousandSeparator: 'Thousands separator',
    separatorDot: 'Dot (.)',
    separatorNone: 'None',

    // Errors
    error: 'Error',
    blockedChars: 'Blocked: unsupported characters',

    // File
    drawingFilename: 'drawing.png',

    // Header/Brand
    brand: 'Vatio Board',
    tagline: 'Simple full-page drawing board by Vatio Libre',
    poweredBy: 'Powered by',
    speedTagline: 'Minimal live speedometer by Vatio Libre',
    speedRoute: 'SPEED',
    speedPageTitle: 'Vatio Speed - Free Live GPS Speedometer for Tesla and Mobile',
    speedPageDescription: 'Vatio Speed is a free live GPS speedometer with an analog dial, trip stats, unit switching, altitude tracking, and speed trap alerts. Works in Tesla browsers and modern mobile browsers.',
    speedPageH1: 'Vatio Speed live GPS speedometer',
    speedPageLead: 'Live GPS speedometer with analog dial, trip stats, unit switching, altitude tracking, and speed trap alerts for Tesla and mobile browsers.',

    // Speed alert templates
    trapLabel: 'Trap {distance}',
    alertOverShort: '+{delta} over',
    overTrapSpeedLimitBy: 'Over the trap speed limit by {delta}',
    overManualSpeedAlertBy: 'Over the manual speed alert by {delta}',
    trapAlertActiveWithLimit: 'Trap alert active {distance} ahead, limit {limit}',
    trapAlertActive: 'Trap alert active {distance} ahead',
    manualSpeedAlertSetTo: 'Manual speed alert set to {limit}',
    configureTrapAlertsAt: 'Configure trap alerts at {distance}',
    trapAlertsSummary: 'Trap alerts · {distance}',
    overTrapSummary: 'Over trap by {delta}',
    overSummary: 'Over by {delta}',
    trapAheadWithLimit: 'Trap ahead {distance} · Limit {limit}',
    trapAhead: 'Trap ahead {distance}',
    manualAlertAt: 'Manual alert at {limit}',
    overTrapLimitBy: 'Over trap limit by {delta}',
  },

  es: {
    // UI Controls
    pen: 'Lápiz',
    eraser: 'Borrador',
    size: 'Tamaño',
    color: 'Color',
    hex: 'Hex',
    close: 'Cerrar',
    clear: 'Limpiar',
    savePng: 'Guardar PNG',
    calculator: 'Calculadora',
    speedometer: 'Velocímetro',
    energy: 'Costo de viaje',
    tools: 'Herramientas',
    alerts: 'Alertas',
    resetTrip: 'Reiniciar viaje',
    done: 'Listo',
    manualSpeed: 'Velocidad manual',
    turnOn: 'Activar',
    turnOff: 'Desactivar',
    useCurrentSpeed: 'Usar velocidad actual',
    overspeedSound: 'Sonido de exceso',
    trapAlerts: 'Alertas de radar',
    alertDistance: 'Distancia de alerta',
    trapSound: 'Sonido de radar',
    audio: 'Audio',
    backgroundCompact: 'Fondo',
    backgroundAudio: 'Audio en segundo plano',
    backgroundAudioHelp: 'Mantiene las alertas listas cuando el navegador queda oculto.',
    audioQuickControls: 'Controles rápidos de audio',
    toggleAlertAudio: 'Alternar audio de alertas',
    toggleBackgroundAudio: 'Alternar audio en segundo plano',
    muteAlertAudio: 'Silenciar audio de alertas',
    unmuteAlertAudio: 'Activar audio de alertas',
    enableBackgroundAudio: 'Activar audio en segundo plano',
    disableBackgroundAudio: 'Desactivar audio en segundo plano',
    speed: 'Velocidad',
    distance: 'Distancia',
    max: 'Máx',
    average: 'Promedio',
    nearestTrap: 'Radar cercano',
    duration: 'Duración',
    trip: 'viaje',
    altitude: 'Altitud',
    maxAlt: 'Altitud máx',
    minAlt: 'Altitud mín',
    on: 'Sí',
    off: 'No',
    away: 'distancia',
    liveSpeed: 'Velocidad en vivo',
    liveGlobe: 'Globo en vivo',
    wazeMap: 'Mapa Waze',
    recenterMap: 'Recentrar mapa',
    changeLanguage: 'Cambiar idioma',

    // Aria labels
    presetColors: 'Colores predefinidos',
    moreColors: 'Más colores',
    openCalculator: 'Abrir calculadora',
    openSpeedometer: 'Abrir velocímetro',
    openEnergy: 'Abrir calculadora de costo de viaje',
    openBoard: 'Abrir pizarra',
    speedometerControls: 'Controles del velocímetro',
    connectionStatus: 'Estado de conexión',
    liveAnalogSpeedometer: 'Velocímetro analógico en vivo',
    analogSpeedometer: 'Velocímetro analógico',
    viewMode: 'Modo de vista',
    showSpeedometer: 'Mostrar velocímetro',
    showWazeMap: 'Mostrar mapa Waze',
    configureAlerts: 'Configurar alertas',
    speedAlertSettings: 'Configuración de alerta de velocidad',
    setAlertSpeedLimit: 'Definir límite de alerta de velocidad',
    decreaseSpeedAlert: 'Disminuir alerta de velocidad',
    increaseSpeedAlert: 'Aumentar alerta de velocidad',
    quickSpeedAlertPresets: 'Preajustes rápidos de alerta de velocidad',
    trapAlertSettings: 'Configuración de alertas de radar',
    trapAlertDistancePresets: 'Preajustes de distancia para alerta de radar',
    tripStats: 'Estadísticas del viaje',
    currentLocationGlobe: 'Globo de ubicación actual',

    // Energy Calculator
    energyTitle: 'Costo de Viaje EV',
    distanceKm: 'Distancia (km)',
    distanceMi: 'Distancia (mi)',
    consumptionKm: 'Consumo promedio (kWh/100km)',
    consumptionMi: 'Consumo promedio (kWh/100mi)',
    electricityPrice: 'Precio electricidad ($/kWh)',
    energyUsed: 'Energía usada',
    estimatedCost: 'Costo estimado',
    units: 'Unidades',
    speedUnit: 'Unidad de velocidad',
    distanceUnit: 'Unidad de distancia',
    invalidNumber: 'Número inválido',
    mustBePositive: 'Debe ser positivo',
    simple: 'Simple',
    multiTrip: 'Multi-trip',
    addTrip: 'Agregar Trip',
    resetAll: 'Reiniciar todo',
    total: 'Total',
    tripEditor: 'Editor de Trip',
    tripName: 'Nombre del trip',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    deleteAll: 'Eliminar todo',
    deleteTripConfirm: '¿Eliminar "{name}"?',
    deleteAllTripsConfirm: '¿Eliminar todos los trips?',
    updateTrip: 'Actualizar trip',
    maxTrips: 'Máximo 5 trips permitidos',
    tripPlaceholder: 'ej: Bogotá -> Medellín',
    tripDefaultName: 'Trip {n}',

    // Status messages
    ready: 'Listo',
    cleared: 'Limpiado',
    colorUpdated: 'Color actualizado',
    themeUpdated: 'Tema actualizado',
    downloadedPng: 'PNG descargado',
    savedLocally: 'Guardado no persistente',
    requestingGps: 'Solicitando GPS...',
    gpsNotSupported: 'GPS no compatible',
    gpsBlocked: 'GPS bloqueado',
    gpsUnavailable: 'GPS no disponible',
    waitingForGps: 'Esperando GPS...',
    gpsError: 'Error de GPS',
    globeUnavailable: 'Globo no disponible',
    gpsLive: 'GPS activo',
    gpsLockedAccuracy: 'GPS preciso · +/-{value} {unit}',
    gpsLiveAccuracy: 'GPS activo · +/-{value} {unit}',
    weakGpsAccuracy: 'GPS débil · +/-{value} {unit}',
    loadingTraps: 'Cargando radares',
    trapUnavailable: 'Radar no disponible',
    loadingTrapData: 'Cargando datos de radares',
    loadingSpeedTrapData: 'Cargando datos de radares de velocidad',
    trapDataUnavailable: 'Datos de radares no disponibles',
    trapAlertsEnabledUnavailable: 'Las alertas de radar están activadas, pero los datos no están disponibles',
    lookingFirstGpsFix: 'Buscando la primera señal GPS',
    liveMapWaitingGps: 'Esperando GPS para centrar el mapa en vivo.',
    loadingWazeMap: 'Cargando el mapa en vivo de Waze...',
    mapCenteredOnLatestFix: 'Centrado en la señal GPS más reciente.',
    recenterToLatestFix: 'Toca recentrar para actualizar el mapa.',
    alertsHint: 'Toca Alertas para configurar velocidad y radares',
    tapToConfigure: 'Toca para configurar',
    tapToConfigureAlerts: 'Toca para configurar alertas de velocidad y radares',
    nearbyTrapOverrides: 'La velocidad del radar cercano reemplaza el límite manual.',
    allowLocationAccess: 'Permite el acceso a la ubicación para medir la velocidad.',
    retryGps: 'Reintentar GPS',
    noticeNoGeolocation: 'Este navegador no ofrece geolocalización, por lo que la medición no puede iniciar aquí.',
    noticeLocationRequired: 'Se requiere acceso a la ubicación. Permite el GPS para este sitio y pulsa Reintentar GPS.',
    noticeSignalUnavailable: 'La señal GPS no está disponible en este momento. Muévete a un área más despejada y vuelve a intentar.',
    noticeStillWaiting: 'Aún esperando señal GPS. Verifica que la ubicación esté activada y vuelve a intentar.',
    noticeStillLookingFirstFix: 'Aún buscando la primera señal GPS. Mantén la ubicación activa y dale un momento al navegador.',

    // Color names
    graphite: 'Grafito',
    slate: 'Pizarra',
    blue: 'Azul',
    green: 'Verde',
    amber: 'Ámbar',
    rose: 'Rosa',

    // Calculator
    calcTitle: 'Calculadora',
    history: 'Historial',
    noHistory: 'Sin historial',
    settings: 'Configuración',
    decimalPlaces: 'Decimales',
    thousandSeparator: 'Separador de miles',
    separatorDot: 'Punto (.)',
    separatorNone: 'Ninguno',

    // Errors
    error: 'Error',
    blockedChars: 'Bloqueado: caracteres no soportados',

    // File
    drawingFilename: 'dibujo.png',

    // Header/Brand
    brand: 'Vatio Board',
    tagline: 'Pizarra de dibujo simple por Vatio Libre',
    poweredBy: 'Creado por',
    speedTagline: 'Velocímetro en vivo minimalista por Vatio Libre',
    speedRoute: 'VELOCIDAD',
    speedPageTitle: 'Vatio Speed - Velocímetro GPS en vivo gratis para Tesla y móvil',
    speedPageDescription: 'Vatio Speed es un velocímetro GPS en vivo gratis con dial analógico, estadísticas de viaje, cambio de unidades, seguimiento de altitud y alertas de radares. Funciona bien en navegadores Tesla y móviles modernos.',
    speedPageH1: 'Vatio Speed velocímetro GPS en vivo',
    speedPageLead: 'Velocímetro GPS en vivo con dial analógico, estadísticas de viaje, cambio de unidades, seguimiento de altitud y alertas de radares para navegadores Tesla y móviles.',

    // Speed alert templates
    trapLabel: 'Radar {distance}',
    alertOverShort: '+{delta} arriba',
    overTrapSpeedLimitBy: 'Por encima del límite del radar en {delta}',
    overManualSpeedAlertBy: 'Por encima de la alerta manual en {delta}',
    trapAlertActiveWithLimit: 'Radar activo a {distance}, límite {limit}',
    trapAlertActive: 'Radar activo a {distance}',
    manualSpeedAlertSetTo: 'Alerta manual fijada en {limit}',
    configureTrapAlertsAt: 'Configura alertas de radar a {distance}',
    trapAlertsSummary: 'Alertas de radar · {distance}',
    overTrapSummary: 'Radar +{delta}',
    overSummary: '+{delta}',
    trapAheadWithLimit: 'Radar a {distance} · Límite {limit}',
    trapAhead: 'Radar a {distance}',
    manualAlertAt: 'Alerta manual en {limit}',
    overTrapLimitBy: 'Sobre el límite del radar en {delta}',
  }
};

const LANG_KEY = 'vatio_board_lang';

const storedLang = localStorage.getItem(LANG_KEY);
const detectedLang = storedLang || window.__lang || (navigator.language?.startsWith('es') ? 'es' : 'en');

// Current language (can be changed later for manual switching)
let currentLang = detectedLang;

/**
 * Get translation by key
 * @param {string} key - Translation key
 * @returns {string} - Translated string or key if not found
 */
export function t(key) {
  return translations[currentLang]?.[key] ?? translations.en[key] ?? key;
}

/**
 * Get current language
 * @returns {string} - Current language code ('en' or 'es')
 */
export function getLang() {
  return currentLang;
}

/**
 * Set language manually and persist to localStorage
 * @param {string} lang - Language code ('en' or 'es')
 */
export function setLang(lang) {
  if (translations[lang]) {
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
  }
}

/**
 * Toggle between 'en' and 'es', persist, and re-apply translations
 * @returns {string} - New language code
 */
export function toggleLang() {
  const newLang = currentLang === 'en' ? 'es' : 'en';
  setLang(newLang);
  applyTranslations();
  document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: newLang } }));
  return newLang;
}

/**
 * Apply translations to DOM elements with data-i18n attribute
 */
export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria');
    el.setAttribute('aria-label', t(key));
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.setAttribute('title', t(key));
  });
}

export { translations, detectedLang };
