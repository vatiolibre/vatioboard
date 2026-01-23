/**
 * energy-core.js
 * Lógica de cálculo y formateo para el calculador de energía
 */

import {
  toDisplay,
  toRaw,
} from "../calculator/widget/number-format.js";
import { t } from "../i18n.js";

// Slider ranges based on unit (km = Colombia/Latam, mi = USA)
export const SLIDER_CONFIG = {
  km: {
    distance: { min: 0, max: 1000, step: 1 },
    consumption: { min: 5, max: 40, step: 0.1 },
    price: { min: 100, max: 2000, step: 10 },
  },
  mi: {
    distance: { min: 0, max: 600, step: 1 },
    consumption: { min: 5, max: 40, step: 0.1 },
    price: { min: 0.05, max: 2.00, step: 0.01 },
  },
};

/**
 * EnergyCore - Clase con lógica de cálculo y formateo
 */
export class EnergyCore {
  constructor(formatSettings) {
    this.formatSettings = formatSettings;
  }

  /**
   * Actualiza los settings de formateo
   */
  setFormatSettings(settings) {
    this.formatSettings = settings;
  }

  /**
   * Parsea un string a número de forma segura
   * @param {string} rawStr - String a parsear
   * @returns {number|null|NaN} - Número, null si vacío, NaN si inválido
   */
  parseNumber(rawStr) {
    if (!rawStr || rawStr.trim() === "") return null;
    const num = parseFloat(rawStr);
    if (!Number.isFinite(num)) return NaN;
    return num;
  }

  /**
   * Valida un valor de entrada
   * @param {string} rawValue - Valor crudo a validar
   * @returns {{ valid: boolean, value: number|null, error: string|null }}
   */
  validateInput(rawValue) {
    const val = this.parseNumber(rawValue);

    if (!rawValue || rawValue.trim() === "") {
      return { valid: true, value: null, error: null };
    }

    if (Number.isNaN(val)) {
      return { valid: false, value: NaN, error: t("invalidNumber") };
    }

    if (val < 0) {
      return { valid: false, value: val, error: t("mustBePositive") };
    }

    return { valid: true, value: val, error: null };
  }

  /**
   * Formatea un valor crudo para mostrar en input
   * @param {string|number} rawValue - Valor crudo
   * @returns {string} - Valor formateado para display
   */
  formatInputValue(rawValue) {
    if (!rawValue && rawValue !== "0" && rawValue !== 0) return "";
    return toDisplay(String(rawValue), this.formatSettings);
  }

  /**
   * Parsea un valor de display a crudo
   * @param {string} displayValue - Valor mostrado en input
   * @returns {string} - Valor crudo
   */
  parseInputValue(displayValue) {
    if (!displayValue || displayValue.trim() === "") return "";
    return toRaw(displayValue, this.formatSettings);
  }

  /**
   * Formatea un número de resultado
   * @param {number} value - Valor a formatear
   * @param {number} decimals - Decimales (default 2)
   * @returns {string} - Valor formateado
   */
  formatResultNumber(value, decimals = 2) {
    if (value === null || Number.isNaN(value)) return "—";
    const fixed = value.toFixed(decimals);
    return toDisplay(fixed, this.formatSettings);
  }

  /**
   * Formatea kWh para mostrar
   * @param {number} value - kWh
   * @returns {string} - "X.XX kWh" o "—"
   */
  formatKwh(value) {
    if (value === null || Number.isNaN(value)) return "—";
    return this.formatResultNumber(value, 2) + " kWh";
  }

  /**
   * Formatea costo para mostrar
   * @param {number} value - Costo
   * @returns {string} - "$ X.XX" o "—"
   */
  formatCost(value) {
    if (value === null || Number.isNaN(value)) return "—";
    return "$ " + this.formatResultNumber(value, 2);
  }

  /**
   * Calcula kWh y costo de un trip
   * @param {number} distance - Distancia
   * @param {number} consumption - Consumo (kWh/100 unidades)
   * @param {number} price - Precio por kWh
   * @returns {{ kwhUsed: number, cost: number }}
   */
  calculateTrip(distance, consumption, price) {
    const kwhUsed = distance * (consumption / 100);
    const cost = kwhUsed * price;
    return { kwhUsed, cost };
  }

  /**
   * Calcula el total de múltiples trips
   * @param {Array} trips - Array de trips con { id, distance, consumption, price }
   * @returns {{ total: number, tripCosts: Map<string, { kwhUsed: number, cost: number }> }}
   */
  calculateMultiTotal(trips) {
    let total = 0;
    const tripCosts = new Map();

    trips.forEach((trip) => {
      const distance = this.parseNumber(trip.distance);
      const consumption = this.parseNumber(trip.consumption);
      const price = this.parseNumber(trip.price);

      if (
        distance !== null && consumption !== null && price !== null &&
        !Number.isNaN(distance) && !Number.isNaN(consumption) && !Number.isNaN(price)
      ) {
        const { kwhUsed, cost } = this.calculateTrip(distance, consumption, price);
        tripCosts.set(trip.id, { kwhUsed, cost });
        total += cost;
      } else {
        tripCosts.set(trip.id, null);
      }
    });

    return { total, tripCosts };
  }
}
