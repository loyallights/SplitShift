import { getCartridgeSdk, hosted, type Entry } from './persistence';

let sandbox: ReturnType<ReturnType<typeof getCartridgeSdk>['ensureSandbox']> | undefined;

export async function saveReportToVault(entries: Entry[], from: string, through: string): Promise<string> {
  if (!hosted) throw new Error('Open SplitShift inside Mnemosyne to save a report to its vault.');
  if (!entries.length) throw new Error('There are no entries in this report.');
  const sdk = getCartridgeSdk();
  if (!sandbox) {
    sandbox = sdk.ensureSandbox().catch(error => { sandbox = undefined; throw error; });
  }
  const { vault } = await sandbox;
  if (!vault) { sandbox = undefined; throw new Error('Mnemosyne did not return a SplitShift vault. Please retry.'); }
  const ordered = [...entries].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const seconds = ordered.reduce((sum, entry) => sum + (entry.endedAt - entry.startedAt) / 1000, 0);
  const amount = ordered.reduce((sum, entry) => sum +
    (entry.endedAt - entry.startedAt) / 3600000 * (entry.hourlyRate ?? 0), 0);
  const unpriced = ordered.filter(entry => entry.hourlyRate === undefined).length;
  const content = [
    '# SplitShift time report',
    `Period: ${from || 'Beginning of records'} through ${through || 'Latest records'}.`,
    'Date filters use session start dates in the local time zone at export.',
    `Sessions: ${ordered.length}. Total hours: ${(seconds / 3600).toFixed(6)}.`,
    `Amount from rated sessions: ${amount.toFixed(2)}. Sessions without a rate: ${unpriced}.`,
    'Amounts use one shared currency. Rates are the historical rates stored with each session.',
    'This is a report snapshot, not the editable live time-tracking database.',
    '',
    ...ordered.flatMap(entry => [
      `Client: ${entry.client}`,
      `Project: ${entry.project}`,
      `Description: ${entry.description || '(none)'}`,
      `Start (UTC): ${new Date(entry.startedAt).toISOString()}`,
      `End (UTC): ${new Date(entry.endedAt).toISOString()}`,
      `Duration hours: ${((entry.endedAt - entry.startedAt) / 3600000).toFixed(6)}`,
      `Hourly rate: ${entry.hourlyRate === undefined ? 'Not set' : entry.hourlyRate.toFixed(2)}`,
      `Amount: ${entry.hourlyRate === undefined ? 'Unpriced' :
        ((entry.endedAt - entry.startedAt) / 3600000 * entry.hourlyRate).toFixed(2)}`,
      `Entry ID: ${entry.id}`, '',
    ]),
  ].join('\n');
  // Exact SDK method and named-vault payload from the installed reference.
  const result = await sdk.socialIngest(vault, content, 'SPLITSHIFT_REPORT');
  if (result?.success === false || result?.error) {
    throw new Error(typeof result.error === 'string' ? result.error : 'Mnemosyne could not save this report.');
  }
  return vault;
}
