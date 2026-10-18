import { DEVICE_ID_KEY, readStorage, writeStorage, type KeyValueStorage } from "./storage.js";

function randomId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `dev-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export async function getOrCreateDeviceId(storage?: KeyValueStorage): Promise<string> {
  const existing = await readStorage(storage, DEVICE_ID_KEY);
  if (existing && existing.length >= 8) return existing;
  const id = randomId();
  await writeStorage(storage, DEVICE_ID_KEY, id);
  return id;
}
