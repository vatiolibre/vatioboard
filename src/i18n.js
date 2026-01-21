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

    // Aria labels
    presetColors: 'Preset colors',
    moreColors: 'More colors',
    openCalculator: 'Open calculator',

    // Status messages
    ready: 'Ready',
    cleared: 'Cleared',
    colorUpdated: 'Color updated',
    themeUpdated: 'Theme updated',
    downloadedPng: 'Downloaded PNG',
    savedLocally: 'Saved locally (not persisted)',

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

    // Aria labels
    presetColors: 'Colores predefinidos',
    moreColors: 'Más colores',
    openCalculator: 'Abrir calculadora',

    // Status messages
    ready: 'Listo',
    cleared: 'Limpiado',
    colorUpdated: 'Color actualizado',
    themeUpdated: 'Tema actualizado',
    downloadedPng: 'PNG descargado',
    savedLocally: 'Guardado no persistente',

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
