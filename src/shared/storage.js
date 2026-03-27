export function loadText(key, fallback = "") {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function saveText(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

export function loadBoolean(key, fallback = false) {
  const value = loadText(key, null);
  return value === null ? fallback : value === "true";
}

export function saveBoolean(key, value) {
  saveText(key, String(Boolean(value)));
}

export function loadNumber(key, fallback = 0, options = {}) {
  const value = loadText(key, null);
  if (value === null || value === "") return fallback;

  const parse = typeof options.parse === "function" ? options.parse : Number.parseFloat;
  const validate = typeof options.validate === "function" ? options.validate : () => true;
  const parsed = parse(value);

  if (!Number.isFinite(parsed) || !validate(parsed)) {
    return fallback;
  }

  return parsed;
}

export function saveNumber(key, value) {
  saveText(key, String(value));
}

export function loadJson(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function removeStoredValue(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
