const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const raw = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'vault-report.ts'), 'utf8').replace(
  "import { getCartridgeSdk, hosted, type Entry } from './persistence';",
  'type Entry = any; const hosted = true; const getCartridgeSdk = () => (globalThis as any).__sdk;'
);
const js = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
(async () => {
  const calls = [];
  global.__sdk = {
    ensureSandbox: async () => { calls.push(['ensure']); return { vault: 'SplitShift-owned-vault' }; },
    socialIngest: async (...args) => { calls.push(['ingest', ...args]); return { success: true }; },
  };
  const { saveReportToVault } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const entry = { id: 'id1', client: 'Example Client', project: 'Example Project', description: 'Example note', startedAt: 0, endedAt: 3600000, hourlyRate: 60 };
  await assert.rejects(saveReportToVault([], '', ''), /no entries/);
  assert.equal(calls.length, 0);
  const vault = await saveReportToVault([entry], '2026-10-01', '2026-10-31');
  assert.equal(vault, 'SplitShift-owned-vault');
  assert.equal(calls[0][0], 'ensure');
  assert.equal(calls[1][1], 'SplitShift-owned-vault');
  assert.equal(calls[1][3], 'SPLITSHIFT_REPORT');
  const content = calls[1][2];
  for (const expected of ['Example Client', 'Example Project', 'Example note', 'Total hours: 1.000000', 'rated sessions: 60.00', '2026-10-01', 'Entry ID: id1']) assert(content.includes(expected));
  await saveReportToVault([entry], '2026-10-01', '2026-10-31');
  assert.equal(calls.filter(call => call[0] === 'ensure').length, 1);
  assert.equal(calls[2][2], content);
  global.__sdk.socialIngest = async () => ({ success: false, error: 'Permission denied' });
  await assert.rejects(saveReportToVault([entry], '', ''), /Permission denied/);
  console.log('PASS empty report does not write');
  console.log('PASS vault is claimed before ingest and every write targets its returned name');
  console.log('PASS report includes entries, dates, rates and totals');
  console.log('PASS unchanged reports have stable content and claim vault once');
  console.log('PASS failed ingest is surfaced');
})().catch(error => { console.error(error); process.exitCode = 1; });
