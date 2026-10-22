import { MnemoCartridgeSDK } from './sdk/mnemo-sdk';

export type Entry = {
  id: string; client: string; project: string; description: string;
  startedAt: number; endedAt: number; hourlyRate?: number;
};
export type RunningTimer = Omit<Entry, 'id' | 'endedAt'>;
export type Invoice = {
  id: string; number: string; status: 'draft' | 'issued';
  client: string; businessDetails: string; clientDetails: string;
  issueDate: string; dueDate: string; currency: string; notes: string;
  lines: (Entry & { hourlyRate: number })[];
};
export type Snapshot = {
  version: 1;
  entries: Entry[];
  rates: Record<string, string>;
  timer: RunningTimer | null;
  invoices?: Invoice[];
  billingRevision?: number;
  billingSharing?: {
    enabled: boolean; withdrawPending?: boolean; lastRevision?: number;
    lastSyncedAt?: number; vault?: string;
  };
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
  const revision = (item: unknown) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  if (value.billingRevision !== undefined && !revision(value.billingRevision)) throw new Error('Saved billing revision is invalid.');
  if (value.billingSharing !== undefined) {
    const sharing = value.billingSharing;
    if (!object(sharing) || typeof sharing.enabled !== 'boolean' ||
        (sharing.withdrawPending !== undefined && typeof sharing.withdrawPending !== 'boolean') ||
        (sharing.lastRevision !== undefined && !revision(sharing.lastRevision)) ||
        (sharing.lastSyncedAt !== undefined && !finite(sharing.lastSyncedAt)) ||
        (sharing.vault !== undefined && typeof sharing.vault !== 'string')) {
      throw new Error('Saved billing sharing settings are invalid. No data was overwritten.');
    }
  }
  if (value.invoices !== undefined) {
    if (!Array.isArray(value.invoices)) throw new Error('Saved invoices could not be read. No data was overwritten.');
    const invoiceIds = new Set<string>();
    const numbers = new Set<string>();
    const assigned = new Set<string>();
    const date = (text: unknown) => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) &&
      Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text;
    for (const invoice of value.invoices) {
      if (!object(invoice) || typeof invoice.id !== 'string' || !invoice.id || invoiceIds.has(invoice.id) ||
          typeof invoice.number !== 'string' || !invoice.number.trim() || invoice.number.length > 80 || numbers.has(invoice.number.trim().toLowerCase()) ||
          !['draft', 'issued'].includes(String(invoice.status)) || typeof invoice.client !== 'string' || !invoice.client.trim() ||
          !['businessDetails', 'clientDetails', 'notes'].every(key => typeof invoice[key] === 'string' && (invoice[key] as string).length <= 10000) ||
          typeof invoice.currency !== 'string' || !/^[A-Z]{3}$/.test(invoice.currency) ||
          !date(invoice.issueDate) || !(invoice.dueDate === '' || (date(invoice.dueDate) && String(invoice.dueDate) >= String(invoice.issueDate))) ||
          !Array.isArray(invoice.lines) || invoice.lines.length === 0) {
        throw new Error('A saved invoice could not be read. No data was overwritten.');
      }
      invoiceIds.add(invoice.id);
      numbers.add(invoice.number.trim().toLowerCase());
      const digits = new Intl.NumberFormat('en', { style: 'currency', currency: invoice.currency }).resolvedOptions().maximumFractionDigits ?? 2;
      let total = 0;
      for (const line of invoice.lines) {
        if (!timer(line) || typeof line.id !== 'string' || !line.id || assigned.has(line.id) ||
            line.client.trim() !== invoice.client.trim() || !finite(line.endedAt) || line.endedAt < line.startedAt ||
            Math.abs(line.endedAt) > 8640000000000000 || !finite(line.hourlyRate) || line.hourlyRate < 0) {
          throw new Error('A saved invoice session could not be read. No data was overwritten.');
        }
        const amount = Math.round((line.endedAt - line.startedAt) / 3600000 * line.hourlyRate * 10 ** digits);
        total += amount;
        if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total)) {
          throw new Error('A saved invoice amount could not be read. No data was overwritten.');
        }
        assigned.add(line.id);
      }
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
