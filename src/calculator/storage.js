const KEY = "embeddable_calc_state_v1";
const HISTORY_KEY = "embeddable_calc_history_v1";
const SETTINGS_KEY = "embeddable_calc_settings_v1";
const MAX_HISTORY = 7;
const DEFAULT_SETTINGS = {
  decimals: 8,
  thousandSeparator: "",
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
  }
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
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const stored = raw ? JSON.parse(raw) : null;
    const decimals = Number.isFinite(Number(stored?.decimals))
      ? Number(stored.decimals)
      : DEFAULT_SETTINGS.decimals;
    const thousandSeparator =
      typeof stored?.thousandSeparator === "string"
        ? stored.thousandSeparator
        : DEFAULT_SETTINGS.thousandSeparator;
    return { ...DEFAULT_SETTINGS, decimals, thousandSeparator };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export { DEFAULT_SETTINGS };
