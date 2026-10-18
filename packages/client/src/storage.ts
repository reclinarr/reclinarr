export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

export const DEVICE_ID_KEY = "streamerr_device_id";
export const SUBTITLE_PREF_KEY = "streamerr_subtitle_pref";
export const BW_PROBE_CACHE_KEY = "streamerr.bwProbe";

export async function readStorage(storage: KeyValueStorage | undefined, key: string): Promise<string | null> {
  if (!storage) return null;
  return storage.getItem(key);
}

export async function writeStorage(
  storage: KeyValueStorage | undefined,
  key: string,
  value: string,
): Promise<void> {
  if (!storage) return;
  await storage.setItem(key, value);
}

export function memoryStorage(initial?: Record<string, string>): KeyValueStorage {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
