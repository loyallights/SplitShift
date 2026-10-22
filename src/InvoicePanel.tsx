import { useEffect, useState } from 'react';
import type { Entry, Invoice, Snapshot } from './persistence';
import { currencyDigits, invoiceTotal, lineAmount, localDate, money, printableInvoice } from './invoices';
import { exportTextFile } from './csv-export';

type Details = Omit<Invoice, 'lines'>;
export default function InvoicePanel({ snapshot, busy, onSave, onDelete }: {
  snapshot: Snapshot; busy: boolean; onSave: (invoice: Invoice) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  const invoices = snapshot.invoices ?? [];
  function blank(): Details {
    let index = invoices.length + 1;
    while (invoices.some(item => item.number === `INV-${String(index).padStart(4, '0')}`)) index++;
    return { id: crypto.randomUUID(), number: `INV-${String(index).padStart(4, '0')}`, status: 'draft',
      client: '', businessDetails: invoices[0]?.businessDetails ?? '', clientDetails: '',
      issueDate: localDate(), dueDate: '', currency: invoices[0]?.currency ?? 'USD', notes: '' };
  }
  const [details, setDetails] = useState<Details>(blank);
  const [selected, setSelected] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [snapshots, setSnapshots] = useState<Entry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saved = invoices.find(item => item.id === details.id);
  const issued = saved?.status === 'issued';
  const disabled = busy || saving || issued;
  const reserved = new Map(invoices.filter(item => item.id !== details.id).flatMap(item =>
    item.lines.map(line => [line.id, `${item.status === 'issued' ? 'Invoiced' : 'On draft'} ${item.number}`] as const)));
  // Existing invoices keep their original lines even if a tracked session was deleted.
  const candidates = [...snapshots, ...snapshot.entries.filter(entry => !snapshots.some(line => line.id === entry.id))]
    .filter(entry => entry.client.trim() === details.client.trim()).sort((a, b) => a.startedAt - b.startedAt);
  const clients = [...new Set([...snapshot.entries.map(entry => entry.client.trim()), ...invoices.map(item => item.client)])].sort();
  const chosen = candidates.filter(entry => selected.includes(entry.id));
  const rateText = (entry: Entry) => prices[entry.id] ?? (entry.hourlyRate === undefined ? '' : String(entry.hourlyRate));
  const missingRate = chosen.some(entry => rateText(entry).trim() === '' || !Number.isFinite(Number(rateText(entry))) || Number(rateText(entry)) < 0);
  const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function change(key: keyof Details, value: string) {
    setDetails(previous => ({ ...previous, [key]: value }));
    setDirty(true); setPreview(null); setMessage(''); setError('');
  }
  function navigate(action: () => void) {
    if (dirty) setPending(() => action);
    else action();
  }
  function open(invoice?: Invoice) {
    setDetails(invoice ? { ...invoice } : blank());
    setSnapshots(invoice?.lines.map(line => ({ ...line })) ?? []);
    setSelected(invoice?.lines.map(line => line.id) ?? []);
    setPrices(Object.fromEntries(invoice?.lines.map(line => [line.id, String(line.hourlyRate)]) ?? []));
    setDirty(false); setError(''); setMessage(''); setPreview(invoice ?? null); setConfirmDelete(false); setConfirmIssue(false);
  }
  function makeInvoice(status: Invoice['status'] = details.status): Invoice {
    if (!details.number.trim()) throw new Error('Enter an invoice number.');
    if (!details.client || !chosen.length) throw new Error('Choose a client and at least one session.');
    if (!dateValid(details.issueDate)) throw new Error('Choose a valid issue date.');
    if (details.dueDate && (!dateValid(details.dueDate) || details.dueDate < details.issueDate)) throw new Error('The optional due date must be on or after the issue date.');
    if (!/^[A-Z]{3}$/.test(details.currency)) throw new Error('Enter a three-letter currency code, such as USD.');
    if (missingRate) throw new Error('Enter a non-negative rate for every selected session, or explicitly choose No charge.');
    if (chosen.some(entry => reserved.has(entry.id))) throw new Error('A session is already assigned to another invoice.');
    const invoice = { ...details, number: details.number.trim(), status, lines: chosen.map(entry => ({ ...entry, hourlyRate: Number(rateText(entry)) })) };
    invoiceTotal(invoice);
    return invoice;
  }
  async function save(status: Invoice['status']) {
    setError(''); setMessage('');
    try {
      const invoice = makeInvoice(status);
      setSaving(true);
      await onSave(invoice);
      open(invoice);
      setMessage(status === 'issued' ? 'Invoice marked issued. Its session details are now fixed.' : 'Invoice draft saved.');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  }
  async function exportInvoice() {
    setError(''); setMessage('');
    try {
      if (dirty || !saved) throw new Error('Save the draft before exporting so the file matches the saved invoice.');
      setSaving(true);
      const filename = `invoice-${saved.number.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'splitshift'}.html`;
      const result = await exportTextFile(printableInvoice(saved), filename, 'text/html;charset=utf-8');
      setMessage(result === null ? 'Export cancelled.' : 'Printable invoice saved. Open the HTML file in your browser, then use Print → Save as PDF.');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  }
  let total: string | null = null;
  try { if (chosen.length && !missingRate && /^[A-Z]{3}$/.test(details.currency)) total = money(invoiceTotal({ ...details, lines: chosen.map(entry => ({ ...entry, hourlyRate: Number(rateText(entry)) })) }), details.currency); }
  catch { total = null; }

  return <section className="glass ss-panel ss-invoices">
    <div className="ss-panel-heading"><div><span className="ss-eyebrow">FROM WORK TO INVOICE</span><h2>Invoices</h2></div>
      <button disabled={saving} onClick={() => navigate(() => open())}>New invoice</button></div>
    {invoices.length > 0 && <div className="ss-invoice-saved" aria-label="Saved invoices">{invoices.map(invoice => <button key={invoice.id}
      aria-pressed={details.id === invoice.id} disabled={saving} onClick={() => navigate(() => open(invoice))}>
      {invoice.number} · {invoice.client} · {invoice.status}</button>)}</div>}
    {pending && <div role="alert" className="ss-alert"><p>Discard your unsaved invoice edits?</p><div className="ss-actions">
      <button onClick={() => setPending(null)}>Keep editing</button><button onClick={() => { pending(); setPending(null); }}>Discard edits</button>
    </div></div>}
    <p className="ss-help">{issued ? 'Issued invoice · read only. Its details are preserved independently of your time entries.' :
      dirty ? 'Unsaved invoice edits · save your draft before leaving.' : 'Select completed sessions for one client. Multiple projects are welcome.'}</p>
    <fieldset disabled={disabled} className="ss-invoice-fields">
      <legend>{issued ? 'Invoice details' : 'Build your invoice'}</legend>
      <div className="ss-form-grid">
        <label>Invoice number<input maxLength={80} value={details.number} onChange={event => change('number', event.target.value)} /></label>
        <label>Invoice client<select value={details.client} onChange={event => {
          change('client', event.target.value); setSelected([]); setSnapshots([]); setPrices({}); change('clientDetails', '');
        }}><option value="">Choose a client</option>{clients.map(client => <option key={client}>{client}</option>)}</select></label>
        <label>Issue date<input type="date" value={details.issueDate} onChange={event => change('issueDate', event.target.value)} /></label>
        <label>Due date (optional)<input type="date" value={details.dueDate} onChange={event => change('dueDate', event.target.value)} /></label>
        <label>Your business details<textarea maxLength={10000} rows={3} placeholder="Business name, address, contact details" value={details.businessDetails} onChange={event => change('businessDetails', event.target.value)} /></label>
        <label>Client billing details<textarea maxLength={10000} rows={3} placeholder="Billing name, address, contact details" value={details.clientDetails} onChange={event => change('clientDetails', event.target.value)} /></label>
        <label>Invoice currency<input maxLength={3} value={details.currency} onChange={event => change('currency', event.target.value.toUpperCase())} placeholder="USD" /></label>
        <label>Payment instructions or notes<textarea maxLength={10000} rows={3} value={details.notes} onChange={event => change('notes', event.target.value)} /></label>
      </div>
      <p className="ss-help">Currency labels the invoice amounts; no conversion or tax is applied. Changing a rate here affects this invoice only.</p>
      <h3>Choose sessions</h3>
      {!details.client ? <p className="ss-help">Choose a client to see their completed sessions.</p> : <>
        <div className="ss-actions"><button onClick={() => { setSelected(candidates.filter(entry => !reserved.has(entry.id)).map(entry => entry.id)); setDirty(true); setPreview(null); }}>Select available</button>
          <button onClick={() => { setSelected([]); setDirty(true); setPreview(null); }}>Clear selection</button></div>
        {!candidates.length && <p>No completed sessions for this client.</p>}
        {candidates.map(entry => {
          let amount = 'Rate needed';
          try { if (rateText(entry).trim() && Number(rateText(entry)) >= 0 && /^[A-Z]{3}$/.test(details.currency)) amount = money(lineAmount({ ...entry, hourlyRate: Number(rateText(entry)) }, details.currency) / 10 ** currencyDigits(details.currency), details.currency); } catch { amount = 'Check rate'; }
          return <article className="ss-invoice-session" key={entry.id}>
            <label className="ss-check"><input type="checkbox" checked={selected.includes(entry.id)} disabled={reserved.has(entry.id)}
              onChange={event => { setSelected(previous => event.target.checked ? [...previous, entry.id] : previous.filter(id => id !== entry.id)); setDirty(true); setPreview(null); }} />
              <span><strong>{entry.project}</strong><br />{localDate(entry.startedAt)} · {((entry.endedAt - entry.startedAt) / 3600000).toFixed(4)} hours
                {entry.description && <span className="ss-invoice-description">{entry.description}</span>}
                {reserved.has(entry.id) && <span className="ss-invoice-description">{reserved.get(entry.id)}</span>}</span></label>
            <div className="ss-invoice-price"><label>Invoice rate per hour<input type="number" min="0" step="any" disabled={reserved.has(entry.id)} value={rateText(entry)} onChange={event => { setPrices(previous => ({ ...previous, [entry.id]: event.target.value })); setDirty(true); setPreview(null); }} /></label>
              <label className="ss-check"><input type="checkbox" disabled={reserved.has(entry.id)} checked={rateText(entry) === '0'} onChange={event => { setPrices(previous => ({ ...previous, [entry.id]: event.target.checked ? '0' : '' })); setDirty(true); setPreview(null); }} />No charge</label>
              <strong>{amount}</strong></div>
          </article>;
        })}
      </>}
    </fieldset>
    <div className="ss-invoice-total"><span>{selected.length} sessions selected</span><strong>{total ?? (missingRate ? 'Rate needed' : 'Choose sessions')}</strong></div>
    {error && <p role="alert" className="ss-alert">{error}</p>}
    {message && <p role="status" className="ss-help">{message}</p>}
    <div className="ss-actions">
      {!issued && <button className="primary" disabled={disabled || !selected.length} onClick={() => void save('draft')}>{saving ? 'Saving...' : 'Save draft'}</button>}
      <button disabled={saving || !selected.length} onClick={() => { try { setPreview(makeInvoice()); setError(''); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }}>Preview invoice</button>
      {!issued && <button disabled={disabled || !saved || dirty} onClick={() => setConfirmIssue(true)}>Mark issued</button>}
      <button disabled={saving || busy || !saved || dirty} onClick={() => void exportInvoice()}>Export for Print / PDF</button>
      {!issued && saved && onDelete && <button className="ss-danger" disabled={saving || busy} onClick={() => setConfirmDelete(true)}>Delete draft</button>}
    </div>
    {confirmIssue && <div role="alert" className="ss-alert"><p>Mark this invoice issued? Its details will become read only.</p><div className="ss-actions">
      <button onClick={() => setConfirmIssue(false)}>Keep draft</button><button disabled={disabled} onClick={() => { setConfirmIssue(false); void save('issued'); }}>Confirm issue</button>
    </div></div>}
    {confirmDelete && <div role="alert" className="ss-alert"><p>Delete this draft and release its sessions for another invoice? Your tracked entries will remain.</p><div className="ss-actions">
      <button onClick={() => setConfirmDelete(false)}>Keep draft</button><button disabled={saving || busy} onClick={() => {
        setSaving(true);
        void onDelete?.(details.id).then(() => { open(); setMessage('Draft deleted. Its sessions are available again.'); })
          .catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setSaving(false));
      }}>Confirm delete draft</button>
    </div></div>}
    <p className="ss-help">Saved drafts reserve their selected sessions. Mark issued after review to lock the invoice. Export does not send it to anyone.</p>
    {preview && <div className="ss-invoice-preview" aria-label="Invoice preview">
      <h2>{preview.status === 'draft' ? 'Draft invoice' : 'Invoice'} {preview.number}</h2>
      <p>Issued: {preview.issueDate}{preview.dueDate && <> · Due: {preview.dueDate}</>} · {preview.currency}</p>
      <div className="ss-form-grid"><div><h3>From</h3><p className="ss-invoice-description">{preview.businessDetails}</p></div>
        <div><h3>Bill to: {preview.client}</h3><p className="ss-invoice-description">{preview.clientDetails}</p></div></div>
      {preview.lines.map(line => <div className="ss-invoice-session" key={line.id}><div>{localDate(line.startedAt)} · {line.project}<p className="ss-invoice-description">{line.description}</p>
        <small>{((line.endedAt - line.startedAt) / 3600000).toFixed(4)} hours × {money(line.hourlyRate, preview.currency)}</small></div>
        <strong>{money(lineAmount(line, preview.currency) / 10 ** currencyDigits(preview.currency), preview.currency)}</strong></div>)}
      <div className="ss-invoice-total"><span>Total</span><strong>{money(invoiceTotal(preview), preview.currency)}</strong></div>
      <p className="ss-invoice-description">{preview.notes}</p>
    </div>}
  </section>;
}
