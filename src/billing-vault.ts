import { getCartridgeSdk, hosted, type Snapshot } from './persistence';
import { invoiceTotal, localDate } from './invoices';

// This marker belongs only to the automatic index, never manual time reports.
export const BILLING_MARKER = '# SplitShift managed billing index v1\n';
type VaultSdk = Pick<ReturnType<typeof getCartridgeSdk>, 'ensureSandbox' | 'socialQuery' | 'socialIngest' | 'forgetSandbox'>;
// Stay within the SDK's documented default query window; refuse a full window
// rather than assume a truncated result contains every previous index.
const LIMIT = 100;
type Row = { id: number; content: string };
function rows(reply: unknown): Row[] {
  const value = reply as { success?: boolean; error?: unknown; chronicles?: unknown } | null;
  if (value?.success === false || value?.error) throw new Error('Mnemosyne could not read the billing index.');
  // Exact two response forms shown in the official cartridge starter.
  const list = Array.isArray(reply) ? reply : value?.chronicles;
  if (!Array.isArray(list) || list.length >= LIMIT) throw new Error('The vault response is incomplete or unsupported. No records were removed.');
  const managed: Row[] = [];
  for (const item of list) {
    if (typeof item?.content !== 'string' || !item.content.startsWith(BILLING_MARKER)) continue;
    if (!Number.isSafeInteger(item.id) || item.id < 0) throw new Error('The billing record has an unsupported ID. No records were removed.');
    managed.push({ id: item.id, content: item.content });
  }
  return managed;
}
function checked(reply: unknown, message: string) {
  const result = reply as { success?: boolean; error?: unknown } | null;
  if (!result || result.success === false || result.error) throw new Error(message);
}
export function billingIndex(state: Snapshot, now = Date.now()) {
  const invoices = [...(state.invoices ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const membership = new Map(invoices.flatMap(invoice => invoice.lines.map(line => [line.id, invoice] as const)));
  const entries = [...state.entries].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  return BILLING_MARKER + [
    `As of (UTC): ${new Date(now).toISOString()}`,
    `Local time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `Billing revision: ${state.billingRevision ?? 0}`,
    'This is the current shared snapshot of SplitShift billing records, not a live query. State changes while SplitShift is closed may not be reflected.',
    'Draft means prepared, issued means finalized. Neither means paid. A draft does not mean an invoice was sent.',
    'Answer questions about last week using session local start dates, not invoice issue dates. Sessions crossing midnight belong to their start date. Invoice numbers alone do not establish coverage.',
    'The coverage list includes every completed session currently in SplitShift. Running timers are excluded. Unbilled means the session is on neither a saved draft nor an issued invoice.',
    'Amounts use each invoice currency; never add amounts across currencies. No currency conversion or tax is applied.',
    '', '## Saved invoices',
    ...invoices.flatMap(invoice => [
      JSON.stringify({ invoiceId: invoice.id, number: invoice.number, client: invoice.client, status: invoice.status,
        issueDate: invoice.issueDate, ...(invoice.dueDate ? { dueDate: invoice.dueDate } : {}), currency: invoice.currency,
        total: invoiceTotal(invoice), sessionCount: invoice.lines.length }),
      ...invoice.lines.map(line => JSON.stringify({ invoiceId: invoice.id, sessionId: line.id, client: line.client,
        project: line.project, description: line.description, localStartDate: localDate(line.startedAt),
        startUtc: new Date(line.startedAt).toISOString(), endUtc: new Date(line.endedAt).toISOString(),
        hours: (line.endedAt - line.startedAt) / 3600000, hourlyRate: line.hourlyRate })), '',
    ]),
    '## Completed-session billing coverage',
    ...entries.map(entry => {
      const invoice = membership.get(entry.id);
      return JSON.stringify({ sessionId: entry.id, client: entry.client, project: entry.project, description: entry.description,
        localStartDate: localDate(entry.startedAt), startUtc: new Date(entry.startedAt).toISOString(),
        endUtc: new Date(entry.endedAt).toISOString(), hours: (entry.endedAt - entry.startedAt) / 3600000,
        appliedHourlyRate: entry.hourlyRate ?? null, billingStatus: invoice?.status ?? 'unbilled',
        invoiceId: invoice?.id ?? null, invoiceNumber: invoice?.number ?? null });
    }),
    '', 'Business addresses, client billing addresses, payment instructions, and invoice notes are intentionally excluded.',
  ].join('\n');
}

// Only called after explicit opt-in. No broad vault scan or governance change.
export async function syncBilling(state: Snapshot, withdraw = false, sdk: VaultSdk = getCartridgeSdk(), now = Date.now()) {
  if (!hosted) throw new Error('Open SplitShift inside Mnemosyne to share billing records.');
  const { vault } = await sdk.ensureSandbox();
  if (!vault) throw new Error('Mnemosyne did not return a SplitShift vault.');
  const before = rows(await sdk.socialQuery(vault, LIMIT));
  if (withdraw) {
    if (before.length) {
      checked(await sdk.forgetSandbox(before.map(row => row.id)), 'The shared index could not be removed. Retry removal.');
      if (rows(await sdk.socialQuery(vault, LIMIT)).length) throw new Error('Shared billing records remain. Retry removal.');
    }
    return { vault, syncedAt: now };
  }
  const content = billingIndex(state, now);
  checked(await sdk.socialIngest(vault, content, 'SPLITSHIFT_BILLING_INDEX'), 'The new billing index could not be saved. Previous records were kept.');
  const after = rows(await sdk.socialQuery(vault, LIMIT));
  const current = after.find(row => row.content === content);
  if (!current) throw new Error('The new index could not be verified. Previous records were kept. Retry sync.');
  const obsolete = after.filter(row => row.id !== current.id).map(row => row.id);
  if (obsolete.length) {
    checked(await sdk.forgetSandbox(obsolete), 'The new index was saved, but older billing records remain. Retry sync.');
    const remaining = rows(await sdk.socialQuery(vault, LIMIT));
    if (remaining.length !== 1 || remaining[0].id !== current.id) throw new Error('Billing cleanup could not be verified. Retry sync.');
  }
  return { vault, syncedAt: now };
}
