const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'csv-export.ts'), 'utf8').replace(
  "import { getCartridgeSdk, hosted } from './persistence';",
  'const hosted = true; const getCartridgeSdk = () => (globalThis as any).__sdk;'
);
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
(async () => {
  const { exportTextFile } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  let calls = [];
  global.__sdk = { invoke: async (...args) => { calls.push(args); return null; } };
  assert.equal(await exportTextFile('csv', 'report.csv'), null);
  assert.deepEqual(calls, [['dialog.selectFolder', {}]]);
  console.log('PASS cancelled folder selection writes nothing');
  calls = [];
  global.__sdk = { invoke: async (...args) => { calls.push(args); return args[0] === 'dialog.selectFolder' ? 'C:\\Users\\ExampleUser\\Documents' : { success: true }; } };
  const path = await exportTextFile('exact,csv\r\n', 'report.csv');
  assert.match(path, /^C:\\Users\\ExampleUser\\Documents\/report-[0-9a-f-]+\.csv$/);
  assert.equal(calls[1][0], 'dialog.writeFile');
  assert.deepEqual(calls[1][1], { filePath: path, content: 'exact,csv\r\n' });
  console.log('PASS export writes exact content to selected folder with a unique filename');
  calls = [];
  const htmlPath = await exportTextFile('<!doctype html><title>Invoice</title>', 'invoice-INV-0001.html', 'text/html;charset=utf-8');
  assert.match(htmlPath, /invoice-INV-0001-[0-9a-f-]+\.html$/);
  assert.equal(calls[1][1].content, '<!doctype html><title>Invoice</title>');
  console.log('PASS printable invoice export retains HTML extension and exact content');
  global.__sdk = { invoke: async action => action === 'dialog.selectFolder' ? 'C:\\Users\\ExampleUser' : { success: false, error: 'Disk unavailable' } };
  await assert.rejects(exportTextFile('csv', 'report.csv'), /Disk unavailable/);
  console.log('PASS host write failure is surfaced');
})().catch(error => { console.error(error); process.exitCode = 1; });
