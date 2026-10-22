import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from './persistence';
import { BILLING_MARKER, billingIndex, syncBilling } from './billing-vault';
import { SessionStore } from './session-store';

vi.mock('./persistence', () => ({ hosted: true, getCartridgeSdk: vi.fn() }));
const state = (): Snapshot => ({ version: 1, rates: {}, timer: null, entries: [
  { id: 'session-a', client: 'Example client', project: 'Website', description: 'Design', startedAt: 1000, endedAt: 3601000, hourlyRate: 60 },
  { id: 'session-b', client: 'Example client', project: 'Admin', description: '', startedAt: 1000, endedAt: 3601000 },
], invoices: [{ id: 'invoice-one', number: 'INV-0001', client: 'Example client', status: 'draft', issueDate: '2026-10-22', dueDate: '',
  currency: 'USD', businessDetails: 'Private business address', clientDetails: 'Private client address', notes: 'Private payment notes',
  lines: [{ id: 'session-a', client: 'Example client', project: 'Website', description: 'Design', startedAt: 1000, endedAt: 3601000, hourlyRate: 60 }] }] });
function fixture() {
  let records = [{ id: 1, content: BILLING_MARKER + 'Old snapshot' }, { id: 2, content: '# SplitShift time report\nKeep this' }];
  const calls: string[] = [];
  let next = 3;
  const sdk = {
    ensureSandbox: vi.fn(async () => { calls.push('ensure'); return { vault: 'SplitShift-own-vault', created: false, unlocked: false }; }),
    socialQuery: vi.fn(async (vault: string) => { expect(vault).toBe('SplitShift-own-vault'); calls.push('query'); return { chronicles: records.map(row => ({ ...row })) }; }),
    socialIngest: vi.fn(async (vault: string, content: string) => { expect(vault).toBe('SplitShift-own-vault'); calls.push('ingest'); records.push({ id: next++, content }); return { success: true }; }),
    forgetSandbox: vi.fn(async (ids: number[]) => { calls.push('forget'); records = records.filter(row => !ids.includes(row.id)); return { success: true }; }),
  };
  return { sdk, calls, records: () => records };
}
beforeEach(() => vi.clearAllMocks());
describe('opt-in billing vault index', () => {
  it('includes invoice/session coverage and unbilled sessions but excludes billing addresses and payment notes', () => {
    const text = billingIndex(state(), 10000);
    expect(text).toContain('"billingStatus":"draft"');
    expect(text).toContain('"billingStatus":"unbilled"');
    expect(text).toContain('"sessionId":"session-a"');
    expect(text).toContain('"invoiceNumber":"INV-0001"');
    expect(text).toContain('"total":60');
    expect(text).not.toContain('Private business address');
    expect(text).not.toContain('Private client address');
    expect(text).not.toContain('Private payment notes');
    expect(text).not.toContain('"dueDate"');
    expect(text).toContain('Neither means paid');
  });
  it('claims only its own sandbox, verifies new content before cleanup, and preserves manual reports', async () => {
    const { sdk, calls, records } = fixture();
    await syncBilling(state(), false, sdk, 10000);
    expect(calls).toEqual(['ensure', 'query', 'ingest', 'query', 'forget', 'query']);
    expect(sdk.forgetSandbox).toHaveBeenCalledWith([1]);
    expect(records().find(row => row.id === 2)?.content).toContain('Keep this');
    expect(records().filter(row => row.content.startsWith(BILLING_MARKER))).toHaveLength(1);
  });
  it('keeps old records when writing fails', async () => {
    const { sdk } = fixture();
    sdk.socialIngest.mockRejectedValueOnce(new Error('Offline'));
    await expect(syncBilling(state(), false, sdk)).rejects.toThrow('Offline');
    expect(sdk.forgetSandbox).not.toHaveBeenCalled();
  });
  it('does not delete anything if the new record cannot be read back', async () => {
    const { sdk } = fixture();
    sdk.socialIngest.mockImplementationOnce(async () => ({ success: true }));
    await expect(syncBilling(state(), false, sdk)).rejects.toThrow(/could not be verified/);
    expect(sdk.forgetSandbox).not.toHaveBeenCalled();
  });
  it('reports cleanup failure and recovers on retry without leaving old snapshots', async () => {
    const { sdk, records } = fixture();
    sdk.forgetSandbox.mockResolvedValueOnce({ success: false });
    await expect(syncBilling(state(), false, sdk, 10000)).rejects.toThrow(/older billing records remain/);
    expect(records().filter(row => row.content.startsWith(BILLING_MARKER))).toHaveLength(2);
    await syncBilling(state(), false, sdk, 10001);
    expect(records().filter(row => row.content.startsWith(BILLING_MARKER))).toHaveLength(1);
  });
  it('withdraws only its managed indexes and does not ingest on disable', async () => {
    const { sdk, records } = fixture();
    await syncBilling(state(), true, sdk);
    expect(sdk.socialIngest).not.toHaveBeenCalled();
    expect(records()).toEqual([{ id: 2, content: '# SplitShift time report\nKeep this' }]);
  });
  it('fails closed on malformed query responses', async () => {
    const { sdk } = fixture();
    sdk.socialQuery.mockResolvedValueOnce({ chronicles: [{ id: 'bad' as unknown as number, content: BILLING_MARKER + 'test' }] });
    await expect(syncBilling(state(), false, sdk)).rejects.toThrow(/unsupported ID/);
    expect(sdk.socialIngest).not.toHaveBeenCalled();
    expect(sdk.forgetSandbox).not.toHaveBeenCalled();
  });
  it('increments billing revision for invoice/session changes, not timer starts or sync receipts', async () => {
    const store = new SessionStore(state(), async () => {});
    await store.start('Example client', 'Project');
    expect(store.getSnapshot().snapshot.billingRevision).toBeUndefined();
    await store.stop();
    expect(store.getSnapshot().snapshot.billingRevision).toBe(1);
    await store.update(current => ({ ...current, billingSharing: { enabled: true, lastRevision: 1 } }));
    expect(store.getSnapshot().snapshot.billingRevision).toBe(1);
    await store.update(current => ({ ...current, invoices: [] }));
    expect(store.getSnapshot().snapshot.billingRevision).toBe(2);
  });
});
