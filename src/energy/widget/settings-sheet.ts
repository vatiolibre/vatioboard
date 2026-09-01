/**
 * settings-sheet.js
 * Manejo del sheet de configuración (unit toggle + thousands separator)
 */

import { saveTripCostSettings } from '../trip-cost-storage.js';
import { saveSettings as saveCalcSettings } from '../../calculator/storage.js';
import { markUnitBootstrapManualSelection } from '../../shared/unit-bootstrap.js';

/**
 * initSettingsSheet - Inicializa el sheet de configuración
 * @param {Object} options
 * @param {HTMLElement} options.panel - Panel contenedor
 * @param {Object} options.tripSettings - Settings de trip (unit, mode)
 * @param {Object} options.formatSettings - Settings de formateo
 * @param {HTMLElement} options.settingsBtn - Botón para abrir settings
 * @param {HTMLElement} options.settingsSheet - Sheet de settings
 * @param {HTMLElement} options.settingsCloseBtn - Botón para cerrar
 * @param {NodeList} options.unitBtns - Botones de unidad (km/mi)
 * @param {HTMLInputElement} options.thousandsToggle - Toggle de separador de miles
 * @param {Function} options.onUnitChange - Callback cuando cambia unidad (newUnit)
 * @param {Function} options.onThousandsChange - Callback cuando cambia separador (newSettings)
 * @param {Function} [options.onOpen] - Callback cuando se abre el sheet
 * @returns {{ setSettingsSheetOpen: Function, syncForm: Function }}
 */
export function initSettingsSheet({
  panel,
  tripSettings,
  formatSettings,
  settingsBtn,
  settingsSheet,
  settingsCloseBtn,
  unitBtns,
  thousandsToggle,
  distanceUnitControl,
  thousandsControl,
  onUnitChange,
  onThousandsChange,
  onOpen,
  saveTripCostSettings: persistTripCostSettings = saveTripCostSettings,
  saveFormatSettings = saveCalcSettings,
}) {
  function setSettingsSheetOpen(isOpen) {
    settingsBtn.classList.toggle('active', isOpen);
    settingsBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    if (isOpen) {
      settingsSheet.hidden = false;
      settingsSheet.setAttribute('aria-hidden', 'false');
      syncForm();
      requestAnimationFrame(() => settingsSheet.classList.add('is-open'));
      onOpen?.();
      return;
    }
    settingsSheet.classList.remove('is-open');
    settingsSheet.setAttribute('aria-hidden', 'true');
  }

  settingsBtn.setAttribute('aria-expanded', 'false');

  // Hide after transition ends
  settingsSheet.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'transform') return;
    if (!settingsSheet.classList.contains('is-open')) {
      settingsSheet.hidden = true;
    }
  });

  function syncForm() {
    // Unit buttons
    distanceUnitControl?.setValue?.(tripSettings.unit);
    unitBtns.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.unit === tripSettings.unit);
    });
    // Thousands toggle
    thousandsControl?.setChecked?.((formatSettings.thousandSeparator ?? '') !== '');
    if (!thousandsControl) thousandsToggle.checked = (formatSettings.thousandSeparator ?? '') !== '';
  }

  // Prevent drag from capturing settings button clicks
  settingsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  settingsBtn.addEventListener('click', () => {
    const isOpen = settingsSheet.classList.contains('is-open');
    setSettingsSheetOpen(!isOpen);
  });

  settingsCloseBtn.addEventListener('click', () => {
    setSettingsSheetOpen(false);
  });

  // Close settings when clicking outside
  panel.addEventListener('click', (e) => {
    if (!settingsSheet.classList.contains('is-open')) return;
    if (!settingsSheet.contains(e.target) && !settingsBtn.contains(e.target)) {
      setSettingsSheetOpen(false);
    }
  });

  // Unit toggle
  unitBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const newUnit = btn.dataset.unit;
      tripSettings.unit = newUnit;
      persistTripCostSettings(tripSettings);
      markUnitBootstrapManualSelection({ tripDistanceUnit: newUnit });
      syncForm();
      onUnitChange(newUnit);
    });
  });

  // Thousands separator toggle
  thousandsToggle.addEventListener('change', () => {
    formatSettings.thousandSeparator = thousandsToggle.checked ? '.' : '';
    saveFormatSettings(formatSettings);
    onThousandsChange(formatSettings);
  });

  return { setSettingsSheetOpen, syncForm };
}
