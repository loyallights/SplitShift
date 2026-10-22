import { describe, expect, it } from 'vitest';
import { validateSnapshot, type Entry, type Invoice, type Snapshot } from './persistence';
import { invoiceTotal, printableInvoice, putInvoice, removeDraft } from './invoices';

const entry = (id = 'one'): Entry & { hourlyRate: number } => ({ id, client: 'Acme', project: 'Website', description: 'Design work', startedAt: 1000, endedAt: 3601000, hourlyRate: 60 });
const invoice = (): Invoice => ({ id: 'invoice-one', number: 'INV-0001', client: 'Acme', businessDetails: 'Example business', clientDetails: 'Example billing address', issueDate: '2026-10-21', dueDate: '', currency: 'USD', notes: '', status: 'draft', lines: [entry()] });
const state = (): Snapshot => ({ version: 1, entries: [entry()], rates: {}, timer: null });

describe('invoice snapshots and amounts', () => {
  it('loads existing version-1 data without requiring invoice fields', () => {
    expect(validateSnapshot(state())).toEqual(state());
  });
  it('validates optional sharing metadata without altering old data', () => {
    expect(validateSnapshot({ ...state(), billingRevision: 2, billingSharing: { enabled: true, lastRevision: 1, lastSyncedAt: 1000 } }).billingRevision).toBe(2);
    expect(() => validateSnapshot({ ...state(), billingSharing: { enabled: 'yes' } })).toThrow();
    expect(() => validateSnapshot({ ...state(), billingRevision: -1 })).toThrow();
  });
  it('saves and validates an invoice without a due date', () => {
    const saved = putInvoice(state(), invoice());
    expect(validateSnapshot(JSON.parse(JSON.stringify(saved))).invoices?.[0].dueDate).toBe('');
    expect(printableInvoice(invoice())).not.toContain('Due:');
  });
  it('includes an optional due date but refuses an invalid or earlier date', () => {
    expect(printableInvoice({ ...invoice(), dueDate: '2026-11-01' })).toContain('Due: 2026-11-01');
    for (const dueDate of ['2026-10-20', '2026-02-30', 'bad']) {
      expect(() => validateSnapshot({ ...state(), invoices: [{ ...invoice(), dueDate }] })).toThrow(/invoice/);
    }
  });
  it('retains details after source entries are modified or deleted', () => {
    const original = invoice();
    const saved = putInvoice(state(), original);
    original.lines[0].description = 'Changed';
    saved.entries[0].hourlyRate = 100;
    saved.entries = [];
    expect(saved.invoices?.[0].lines[0].description).toBe('Design work');
    expect(invoiceTotal(saved.invoices![0])).toBe(60);
  });
  it('rounds each line before summing, including zero-decimal currencies', () => {
    const sample = invoice();
    sample.lines = [entry('a'), entry('b')].map(line => ({ ...line, endedAt: line.startedAt + 60000, hourlyRate: 1 }));
    expect(invoiceTotal(sample)).toBe(0.04);
    expect(invoiceTotal({ ...sample, currency: 'JPY' })).toBe(0);
  });
  it('requires an explicit rate and accepts no-charge lines', () => {
    expect(() => validateSnapshot({ ...state(), invoices: [{ ...invoice(), lines: [{ ...entry(), hourlyRate: undefined }] }] })).toThrow(/session/);
    expect(invoiceTotal({ ...invoice(), lines: [{ ...entry(), hourlyRate: 0 }] })).toBe(0);
  });
  it('prevents mixed-client, duplicate-session, and malformed invoice data from loading', () => {
    for (const lines of [[{ ...entry(), client: 'Other' }], [entry(), entry()], [{ ...entry(), hourlyRate: -1 }]]) {
      expect(() => validateSnapshot({ ...state(), invoices: [{ ...invoice(), lines }] })).toThrow();
    }
    expect(() => validateSnapshot({ ...state(), invoices: {} })).toThrow();
  });
  it('reserves sessions on drafts and blocks duplicate invoice numbers', () => {
    const saved = putInvoice(state(), invoice());
    expect(() => putInvoice(saved, { ...invoice(), id: 'other', number: 'INV-0002' })).toThrow(/another invoice/);
    expect(() => putInvoice(saved, { ...invoice(), id: 'other', number: 'inv-0001', lines: [entry('other')] })).toThrow(/number/);
    expect(() => validateSnapshot({ ...saved, invoices: [invoice(), { ...invoice(), id: 'other', number: 'INV-0002' }] })).toThrow();
  });
  it('updates the same draft but locks issued invoices', () => {
    let saved = putInvoice(state(), invoice());
    saved = putInvoice(saved, { ...invoice(), notes: 'Payment by transfer' });
    expect(saved.invoices).toHaveLength(1);
    saved = putInvoice(saved, { ...invoice(), status: 'issued' });
    expect(() => putInvoice(saved, invoice())).toThrow(/cannot be edited/);
    expect(() => putInvoice(state(), { ...invoice(), status: 'issued', clientDetails: '' })).toThrow(/billing details/);
  });
  it('deletes drafts and releases sessions without deleting tracked entries', () => {
    const saved = putInvoice(state(), invoice());
    const removed = removeDraft(saved, invoice().id);
    expect(removed.invoices).toHaveLength(0);
    expect(removed.entries).toHaveLength(1);
    expect(() => putInvoice(removed, { ...invoice(), id: 'new' })).not.toThrow();
    expect(() => removeDraft(putInvoice(state(), { ...invoice(), status: 'issued' }), invoice().id)).toThrow(/Only a saved draft/);
  });
  it('exports escaped user text with no scripts or network assets', () => {
    const doc = printableInvoice({ ...invoice(), businessDetails: '<script>alert(1)</script>', notes: '<img src="https://example.com/track">' });
    expect(doc).not.toContain('<script>');
    expect(doc).not.toContain('<img');
    expect(doc).toContain('&lt;script&gt;');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('DRAFT INVOICE');
  });
});
