interface NumberStorageOptions {
  parse?: (value: string) => number;
  validate?: (value: number) => boolean;
}

export function loadText<TFallback extends string | null = string>(
  key: string,
  fallback: TFallback = '' as TFallback,
): string | TFallback {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function saveText(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

export function hasStoredValue(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function loadBoolean(key: string, fallback = false): boolean {
  const value = loadText(key, null);
  return value === null ? fallback : value === 'true';
}

export function saveBoolean(key: string, value: unknown): void {
  saveText(key, String(Boolean(value)));
}

export function loadNumber(key: string, fallback = 0, options: NumberStorageOptions = {}): number {
  const value = loadText(key, null);
  if (value === null || value === '') return fallback;

  const parse = typeof options.parse === 'function' ? options.parse : Number.parseFloat;
  const validate = typeof options.validate === 'function' ? options.validate : () => true;
  const parsed = parse(value);

  if (!Number.isFinite(parsed) || !validate(parsed)) {
    return fallback;
  }

  return parsed;
}

export function saveNumber(key: string, value: number): void {
  saveText(key, String(value));
}

export function loadJson<T = unknown>(key: string, fallback: T | null = null): T | null {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function removeStoredValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
