import { loadJson, saveJson } from "../shared/storage.js";

const KEY = "embeddable_calc_state_v1";
const HISTORY_KEY = "embeddable_calc_history_v1";
const SETTINGS_KEY = "embeddable_calc_settings_v1";
const MAX_HISTORY = 7;
const DEFAULT_SETTINGS = {
  decimals: 8,
  thousandSeparator: "",
};

export function loadState() {
  return loadJson(KEY, null);
}

export function saveState(state) {
  saveJson(KEY, state);
}

export function loadHistory() {
  return loadJson(HISTORY_KEY, []);
}

export function saveHistory(history) {
  saveJson(HISTORY_KEY, history);
}

export function addToHistory(expr, result) {
  const history = loadHistory();
  if (history.length > 0 && history[0].expr === expr && history[0].result === result) {
    return history;
  }
  history.unshift({ expr, result });
  if (history.length > MAX_HISTORY) {
    history.pop();
  }
  saveHistory(history);
  return history;
}

export function clearHistory() {
  saveHistory([]);
  return [];
}

export function loadSettings() {
  const stored = loadJson(SETTINGS_KEY, null);
  const decimals = Number.isFinite(Number(stored?.decimals))
    ? Number(stored.decimals)
    : DEFAULT_SETTINGS.decimals;
  const thousandSeparator =
    typeof stored?.thousandSeparator === "string"
      ? stored.thousandSeparator
      : DEFAULT_SETTINGS.thousandSeparator;
  return { ...DEFAULT_SETTINGS, decimals, thousandSeparator };
}

export function saveSettings(settings) {
  saveJson(SETTINGS_KEY, settings);
}

export { DEFAULT_SETTINGS };
