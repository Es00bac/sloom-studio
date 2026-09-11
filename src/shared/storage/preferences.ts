export interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => unknown;
  removeItem: (key: string) => unknown;
}

export interface StringPreferenceOptions {
  key: string;
  fallback: string;
  normalize?: (value: string) => string;
  storage?: PreferenceStorage;
}

export interface WriteStringPreferenceOptions extends StringPreferenceOptions {
  value: string;
}

export function readStringPreference({
  fallback,
  key,
  normalize = identity,
  storage = getBrowserLocalStorage(),
}: StringPreferenceOptions): string {
  if (!storage) return fallback;

  try {
    return normalize(storage.getItem(key) ?? fallback);
  } catch {
    return fallback;
  }
}

export function writeStringPreference({
  fallback,
  key,
  normalize = identity,
  storage = getBrowserLocalStorage(),
  value,
}: WriteStringPreferenceOptions): void {
  if (!storage) return;

  try {
    storage.setItem(key, normalize(value || fallback));
  } catch {
    // Storage can be unavailable in private windows or blocked contexts.
  }
}

export function removePreference(key: string, storage = getBrowserLocalStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore blocked storage cleanup; callers should keep runtime fallbacks.
  }
}

function getBrowserLocalStorage(): PreferenceStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function identity(value: string): string {
  return value;
}
