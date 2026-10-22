import type { Entry, Invoice, Snapshot } from './persistence';

export function localDate(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function currencyDigits(currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export function lineAmount(line: Entry & { hourlyRate: number }, currency: string) {
  const minor = Math.round((line.endedAt - line.startedAt) / 3600000 * line.hourlyRate * 10 ** currencyDigits(currency));
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('An invoice amount is too large. Check the session duration and rate.');
  return minor;
}
export function invoiceTotal(invoice: Invoice) {
  const total = invoice.lines.reduce((sum, line) => sum + lineAmount(line, invoice.currency), 0);
  if (!Number.isSafeInteger(total)) throw new Error('The invoice total is too large.');
  return total / 10 ** currencyDigits(invoice.currency);
}
export function money(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}
export function putInvoice(state: Snapshot, invoice: Invoice): Snapshot {
  const invoices = state.invoices ?? [];
  const previous = invoices.find(item => item.id === invoice.id);
  if (previous?.status === 'issued') throw new Error('An issued invoice cannot be edited.');
  if (invoices.some(item => item.id !== invoice.id && item.number.trim().toLowerCase() === invoice.number.trim().toLowerCase())) {
    throw new Error('That invoice number is already in use.');
  }
  const reserved = new Set(invoices.filter(item => item.id !== invoice.id).flatMap(item => item.lines.map(line => line.id)));
  if (invoice.lines.some(line => reserved.has(line.id))) throw new Error('A selected session is already on another invoice or draft.');
  if (invoice.status === 'issued' && (!invoice.businessDetails.trim() || !invoice.clientDetails.trim())) {
    throw new Error('Add your business details and the client billing details before marking issued.');
  }
  invoiceTotal(invoice);
  // Clone line items so later edits or deletion of tracked sessions cannot change invoices.
  const copy: Invoice = { ...invoice, lines: invoice.lines.map(line => ({ ...line })) };
  return { ...state, invoices: previous ? invoices.map(item => item.id === copy.id ? copy : item) : [copy, ...invoices] };
}
export function removeDraft(state: Snapshot, id: string): Snapshot {
  const invoice = state.invoices?.find(item => item.id === id);
  if (!invoice || invoice.status !== 'draft') throw new Error('Only a saved draft can be deleted.');
  return { ...state, invoices: state.invoices?.filter(item => item.id !== id) };
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function printableInvoice(invoice: Invoice) {
  const esc = escapeHtml;
  const digits = currencyDigits(invoice.currency);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Invoice ${esc(invoice.number)}</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#202124;background:#fff;margin:40px}main{max-width:1000px;margin:auto}h1{margin-bottom:0}header,.parties{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}.text{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:28px 0}td,th{padding:10px 8px;border-bottom:1px solid #ddd;text-align:left;overflow-wrap:anywhere}td:last-child,th:last-child{text-align:right}.total{text-align:right;font-size:22px;font-weight:600}small{color:#555}.instructions{background:#f1f0fa;padding:12px}@media print{body{margin:12mm;font-size:11px}.instructions{display:none}tr{break-inside:avoid}thead{display:table-header-group}@page{margin:12mm}
</style></head><body><main><p class="instructions">Open this file in your browser. Use Print (Ctrl+P), then choose Save as PDF or a printer. Review the invoice before sending it.</p>
<header><div><h1>${invoice.status === 'draft' ? 'DRAFT INVOICE' : 'INVOICE'}</h1><p>${esc(invoice.number)}</p></div><div><p>Issued: ${esc(invoice.issueDate)}</p>${invoice.dueDate ? `<p>Due: ${esc(invoice.dueDate)}</p>` : ''}<p>Currency: ${esc(invoice.currency)}</p></div></header>
<div class="parties"><section><h2>From</h2><p class="text">${esc(invoice.businessDetails)}</p></section><section><h2>Bill to: ${esc(invoice.client)}</h2><p class="text">${esc(invoice.clientDetails)}</p></section></div>
<table><thead><tr><th>Date</th><th>Project / description</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${invoice.lines.map(line => `<tr><td>${esc(localDate(line.startedAt))}</td><td class="text">${esc(line.project)}${line.description ? '<br>' + esc(line.description) : ''}</td><td>${((line.endedAt - line.startedAt) / 3600000).toFixed(4)}</td><td>${esc(money(line.hourlyRate, invoice.currency))}</td><td>${esc(money(lineAmount(line, invoice.currency) / 10 ** digits, invoice.currency))}</td></tr>`).join('')}</tbody></table>
<p class="total">Total: ${esc(money(invoiceTotal(invoice), invoice.currency))}</p><p class="text">${esc(invoice.notes)}</p><small>Session dates use the local time zone. Line amounts are rounded individually; totals sum those rounded amounts. No taxes or currency conversion are applied.</small></main></body></html>`;
}
