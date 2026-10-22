import type { Entry, Snapshot } from './persistence';

export function appliedRate(rates: Snapshot['rates'], client: string, project: string) {
  const override = rates[JSON.stringify(['project', client, project])] ?? '';
  const text = override || rates[JSON.stringify(['client', client])] || '';
  const rate = text === '' ? undefined : Number(text);
  if (rate !== undefined && (!Number.isFinite(rate) || rate < 0)) {
    throw new Error('Enter a valid, non-negative rate.');
  }
  return rate;
}

// Keep one current session state, including during async saves.
export class SessionStore {
  private listeners = new Set<() => void>();
  private generation = 0;
  private view: { snapshot: Snapshot; status: string; error: string; busy: boolean };

  constructor(initial: Snapshot, private save: (state: Snapshot) => Promise<void>,
    private clock = Date.now, private uuid = () => crypto.randomUUID()) {
    this.view = { snapshot: initial, status: 'Saved', error: '', busy: false };
  }

  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(change: Partial<typeof this.view>) {
    this.view = { ...this.view, ...change };
    this.listeners.forEach(listener => listener());
  }
  private available() {
    if (this.view.busy) throw new Error('A timer change is still saving. Check timer status before trying again.');
    if (this.view.error) throw new Error('Changes are not saved. Open SplitShift and use Retry saving before another change.');
  }
  private async persist(snapshot: Snapshot) {
    const previous = this.view.snapshot;
    if (JSON.stringify(previous.entries) !== JSON.stringify(snapshot.entries) ||
        JSON.stringify(previous.invoices ?? []) !== JSON.stringify(snapshot.invoices ?? [])) {
      snapshot = { ...snapshot, billingRevision: (previous.billingRevision ?? 0) + 1 };
    }
    const generation = ++this.generation;
    this.publish({ snapshot, status: 'Saving...', error: '' });
    try {
      await this.save(snapshot);
      if (generation === this.generation) this.publish({ status: 'Saved', error: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (generation === this.generation) this.publish({ status: 'Not saved', error: message });
      throw new Error('Could not confirm saving. Keep SplitShift open and use Retry saving. ' + message);
    }
  }
  update(change: (state: Snapshot) => Snapshot) {
    if (this.view.busy) throw new Error('A timer change is still saving.');
    return this.persist(change(this.view.snapshot));
  }
  retry = async () => {
    if (this.view.busy) throw new Error('A timer change is still saving.');
    this.publish({ busy: true });
    try { await this.persist(this.view.snapshot); }
    finally { this.publish({ busy: false }); }
  };

  async start(client: string, project: string, description = '') {
    this.available();
    const state = this.view.snapshot;
    if (state.timer) throw new Error('A timer is already running. Stop it before starting another.');
    client = client.trim();
    project = project.trim();
    if (!client || !project) throw new Error('Provide a client and project.');
    const timer = { client, project, description: description.trim(), startedAt: this.clock(),
      hourlyRate: appliedRate(state.rates, client, project) };
    this.publish({ busy: true });
    try {
      await this.persist({ ...state, timer });
      return timer;
    } finally { this.publish({ busy: false }); }
  }

  async stop() {
    this.available();
    const state = this.view.snapshot;
    if (!state.timer) throw new Error('No timer is running.');
    const endedAt = this.clock();
    if (endedAt < state.timer.startedAt) throw new Error('Your clock is before the timer start. Correct the clock before stopping.');
    const entry: Entry = { ...state.timer, id: this.uuid(), endedAt };
    this.publish({ busy: true });
    try {
      await this.persist({ ...state, timer: null, entries: [entry, ...state.entries] });
      return entry;
    } finally { this.publish({ busy: false }); }
  }
}
