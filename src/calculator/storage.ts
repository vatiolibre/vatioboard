import { loadJson, saveJson } from "../shared/storage.js";

const KEY = "embeddable_calc_state_v1";
const HISTORY_KEY = "embeddable_calc_history_v1";
const SETTINGS_KEY = "embeddable_calc_settings_v1";
const MAX_HISTORY = 7;

export interface CalculatorState {
  expr?: string;
  lastResult?: string;
  lastExpr?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CalculatorHistoryRecord {
  expr: string;
  result: string;
  [key: string]: unknown;
}

export interface CalculatorSettings {
  decimals: number;
  thousandSeparator: string;
}

const DEFAULT_SETTINGS: CalculatorSettings = {
  decimals: 8,
  thousandSeparator: "",
};

export function loadState(): CalculatorState | null {
  return loadJson<CalculatorState>(KEY, null);
}

export function saveState(state: CalculatorState | null): void {
  saveJson(KEY, state);
}

export function loadHistory(): CalculatorHistoryRecord[] {
  return loadJson<CalculatorHistoryRecord[]>(HISTORY_KEY, []) as CalculatorHistoryRecord[];
}

export function saveHistory(history: CalculatorHistoryRecord[]): void {
  saveJson(HISTORY_KEY, history);
}

export function addToHistory(expr: string, result: string): CalculatorHistoryRecord[] {
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

export function clearHistory(): CalculatorHistoryRecord[] {
  saveHistory([]);
  return [];
}

export function loadSettings(): CalculatorSettings {
  const stored = loadJson<Partial<CalculatorSettings>>(SETTINGS_KEY, null);
  return normalizeSettings(stored);
}

export function normalizeSettings(stored: Partial<CalculatorSettings> | null | undefined): CalculatorSettings {
  const decimals = Number.isFinite(Number(stored?.decimals))
    ? Number(stored.decimals)
    : DEFAULT_SETTINGS.decimals;
  const thousandSeparator =
    typeof stored?.thousandSeparator === "string"
      ? stored.thousandSeparator
      : DEFAULT_SETTINGS.thousandSeparator;
  return { ...DEFAULT_SETTINGS, decimals, thousandSeparator };
}

export function saveSettings(settings: CalculatorSettings | Partial<CalculatorSettings>): void {
  saveJson(SETTINGS_KEY, settings);
}

export { DEFAULT_SETTINGS };
