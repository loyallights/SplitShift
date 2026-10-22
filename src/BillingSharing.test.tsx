import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import BillingSharing from './BillingSharing';
import { SessionStore } from './session-store';
import type { Snapshot } from './persistence';

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('./billing-vault', () => ({ syncBilling: mocks.sync }));
vi.mock('./persistence', () => ({ hosted: true }));
const initial = (): Snapshot => ({ version: 1, entries: [], rates: {}, timer: null });
function Panel({ store }: { store: SessionStore }) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <BillingSharing store={store} />;
}
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.sync.mockResolvedValue({ vault: 'SplitShift-own-vault', syncedAt: 1000 }); });
it('does not write until opt-in, syncs later edits, and withdraws on disable', async () => {
  const store = new SessionStore(initial(), async () => {});
  render(<Panel store={store} />);
  expect(mocks.sync).not.toHaveBeenCalled();
  const checkbox = screen.getByRole('checkbox');
  fireEvent.click(checkbox);
  await waitFor(() => expect(store.getSnapshot().snapshot.billingSharing?.lastRevision).toBe(0));
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await act(async () => { await store.update(current => ({ ...current, entries: [{ id: 'one', client: 'Acme', project: 'Website', description: '', startedAt: 1000, endedAt: 2000 }] })); });
  await waitFor(() => expect(store.getSnapshot().snapshot.billingSharing?.lastRevision).toBe(1));
  fireEvent.click(checkbox);
  await waitFor(() => expect(store.getSnapshot().snapshot.billingSharing?.withdrawPending).toBe(false));
  expect(mocks.sync.mock.calls.at(-1)?.[1]).toBe(true);
});
it('shows sync failure and requires a retry instead of claiming records are current', async () => {
  mocks.sync.mockRejectedValueOnce(new Error('Permission denied'));
  const store = new SessionStore(initial(), async () => {});
  render(<Panel store={store} />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
  expect(store.getSnapshot().snapshot.billingSharing?.lastRevision).toBeUndefined();
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
  await waitFor(() => expect(store.getSnapshot().snapshot.billingSharing?.lastRevision).toBe(0));
});
