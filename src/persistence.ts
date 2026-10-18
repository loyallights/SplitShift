import { MnemoCartridgeSDK } from './sdk/mnemo-sdk';

export type Entry = {
  id: string; client: string; project: string; description: string;
  startedAt: number; endedAt: number; hourlyRate?: number;
};
export type RunningTimer = Omit<Entry, 'id' | 'endedAt'>;
export type Snapshot = {
  version: 1;
  entries: Entry[];
  rates: Record<string, string>;
  timer: RunningTimer | null;
};

export const hosted = window.parent !== window;
const KEY = 'splitshift.preview.state.v1';
const HOST_LIMIT = 256 * 1024;
let sdk: MnemoCartridgeSDK | undefined;
let loaded = false;
let loadPromise: Promise<Snapshot> | undefined;
let writes: Promise<void> = Promise.resolve();
let lastSaved = '';

export function getCartridgeSdk() {
  return sdk ??= new MnemoCartridgeSDK('@splitshift/app');
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function timer(value: unknown): value is RunningTimer & Record<string, unknown> {
  return object(value) && typeof value.client === 'string' && !!value.client.trim() &&
    typeof value.project === 'string' && !!value.project.trim() &&
    typeof value.description === 'string' && finite(value.startedAt) &&
    Math.abs(value.startedAt) <= 8640000000000000 &&
    (value.hourlyRate === undefined || (finite(value.hourlyRate) && value.hourlyRate >= 0));
}
export function validateSnapshot(value: unknown): Snapshot {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.entries) ||
      !object(value.rates) || !(value.timer === null || timer(value.timer))) {
    throw new Error('Saved data has an unsupported format. It has not been overwritten.');
  }
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (!timer(entry) || !object(entry) || typeof entry.id !== 'string' || !entry.id ||
        ids.has(entry.id) || !finite(entry.endedAt) ||
        Math.abs(entry.endedAt) > 8640000000000000 || entry.endedAt < entry.startedAt) {
      throw new Error('A saved entry could not be read. Saved data has not been overwritten.');
    }
    ids.add(entry.id);
  }
  for (const rate of Object.values(value.rates)) {
    if (typeof rate !== 'string' || (rate !== '' && (!Number.isFinite(Number(rate)) || Number(rate) < 0))) {
      throw new Error('A saved rate could not be read. Saved data has not been overwritten.');
    }
  }
  return value as Snapshot;
}
function empty(): Snapshot {
  return { version: 1, entries: [], rates: {}, timer: null };
}
function legacy(key: string, fallback: unknown): unknown {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : JSON.parse(raw);
}

export function loadSnapshot(): Promise<Snapshot> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let state: unknown;
    if (hosted) {
      const reply = await getCartridgeSdk().invoke<unknown>('state.get');
      if (reply === null) state = empty();
      else if (object(reply) && 'state' in reply && 'updatedAt' in reply) {
        state = reply.state === null ? empty() : reply.state;
      } else throw new Error('Mnemosyne returned an unexpected storage response. No data was changed.');
    } else {
      const raw = localStorage.getItem(KEY);
      state = raw === null ? {
        version: 1,
        entries: legacy('splitshift.preview.entries.v1', []),
        rates: legacy('splitshift.preview.rates.v1', {}),
        timer: legacy('splitshift.preview.timer.v1', null),
      } : JSON.parse(raw);
    }
    const result = validateSnapshot(state);
    // Legacy preview data is copied to the new atomic snapshot on first save.
    lastSaved = !hosted && localStorage.getItem(KEY) === null ? '' : JSON.stringify(result);
    loaded = true;
    return result;
  })().catch(error => {
    loadPromise = undefined;
    throw error;
  });
  return loadPromise;
}

export function saveSnapshot(state: Snapshot): Promise<void> {
  if (!loaded) return Promise.reject(new Error('Saved data must load before changes can be saved.'));
  let json: string;
  try {
    json = JSON.stringify(validateSnapshot(state));
    if (hosted && new TextEncoder().encode(json).length > HOST_LIMIT) {
      throw new Error('Mnemosyne storage is full. Export your entries before making further changes. Nothing was automatically deleted.');
    }
  } catch (error) { return Promise.reject(error); }
  // Capture each complete snapshot now; serialize writes so late replies cannot
  // replace newer data. A failed save does not poison subsequent retries.
  const job = writes.catch(() => undefined).then(async () => {
    if (json === lastSaved) return;
    if (hosted) await getCartridgeSdk().invoke('state.set', { state: JSON.parse(json) });
    else localStorage.setItem(KEY, json);
    lastSaved = json;
  });
  writes = job;
  return job;
}
