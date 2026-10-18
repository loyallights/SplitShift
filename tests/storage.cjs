const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'persistence.ts'), 'utf8').replace(
  "import { MnemoCartridgeSDK } from './sdk/mnemo-sdk';",
  'class MnemoCartridgeSDK { invoke(...args: unknown[]) { return (globalThis as any).__invoke(...args); } }'
);
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
let seq = 0;
async function fresh(hosted = false, handler = async () => { throw new Error('Unexpected host call'); }) {
  const browser = new Map();
  const surface = {};
  surface.parent = hosted ? {} : surface;
  global.window = surface;
  global.localStorage = { getItem: k => browser.get(k) ?? null, setItem: (k,v) => browser.set(k,v) };
  const calls = [];
  global.__invoke = (...args) => { calls.push(args); return handler(...args); };
  const storage = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64') + '#' + seq++);
  return { storage, browser, calls };
}
const entry = { id: 'one', client: 'Example Client', project: 'Example Project', description: 'Example note', startedAt: 1000, endedAt: 3601000, hourlyRate: 60 };
const snapshot = () => ({ version: 1, entries: [entry], rates: {}, timer: null });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
  await check('migrate browser entries, rates and timer without deleting old data', async () => {
    const { storage, browser, calls } = await fresh();
    const timer = { client: 'Example Client', project: 'Example Project', description: 'Active', startedAt: 1234, hourlyRate: 60 };
    browser.set('splitshift.preview.entries.v1', JSON.stringify([entry]));
    browser.set('splitshift.preview.rates.v1', JSON.stringify({ client: '60' }));
    browser.set('splitshift.preview.timer.v1', JSON.stringify(timer));
    const data = await storage.loadSnapshot();
    assert.deepEqual(data, { ...snapshot(), rates: { client: '60' }, timer });
    await storage.saveSnapshot(data);
    assert.deepEqual(JSON.parse(browser.get('splitshift.preview.state.v1')), data);
    assert(browser.has('splitshift.preview.entries.v1'));
    assert.equal(calls.length, 0);
  });
  await check('read host envelope and write exact state payload without browser access', async () => {
    const { storage, calls, browser } = await fresh(true, async action => action === 'state.get' ? { state: snapshot(), updatedAt: 'now' } : { ok: true });
    const data = await storage.loadSnapshot();
    await storage.saveSnapshot({ ...data, entries: [] });
    assert.deepEqual(calls, [['state.get'], ['state.set', { state: { ...snapshot(), entries: [] } }]]);
    assert.equal(browser.size, 0);
  });
  await check('failed host load prevents writes and can be retried', async () => {
    let fail = true;
    const { storage, calls } = await fresh(true, async () => { if (fail) throw new Error('Offline'); return { state: null, updatedAt: null }; });
    await assert.rejects(storage.loadSnapshot(), /Offline/);
    await assert.rejects(storage.saveSnapshot(snapshot()), /must load/);
    assert.equal(calls.length, 1);
    fail = false;
    assert.deepEqual((await storage.loadSnapshot()).entries, []);
  });
  await check('malformed browser data is preserved and cannot be overwritten', async () => {
    const { storage, browser } = await fresh();
    browser.set('splitshift.preview.state.v1', '{broken');
    await assert.rejects(storage.loadSnapshot());
    await assert.rejects(storage.saveSnapshot(snapshot()), /must load/);
    assert.equal(browser.get('splitshift.preview.state.v1'), '{broken');
  });
  await check('reject invalid dates, duplicate entries and invalid rates', async () => {
    const { storage } = await fresh();
    assert.throws(() => storage.validateSnapshot({ ...snapshot(), entries: [{ ...entry, endedAt: -1 }] }));
    assert.throws(() => storage.validateSnapshot({ ...snapshot(), entries: [entry, entry] }));
    assert.throws(() => storage.validateSnapshot({ ...snapshot(), rates: { client: '-5' } }));
  });
  await check('serialize writes and recover after a save failure', async () => {
    let rejectFirst;
    let writeCount = 0;
    const { storage, calls } = await fresh(true, async action => {
      if (action === 'state.get') return { state: null, updatedAt: null };
      if (++writeCount === 1) return new Promise((_resolve, reject) => { rejectFirst = reject; });
      return { ok: true };
    });
    await storage.loadSnapshot();
    const first = storage.saveSnapshot(snapshot());
    const failed = assert.rejects(first, /Disk unavailable/);
    const second = storage.saveSnapshot({ ...snapshot(), rates: { client: '75' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
    rejectFirst(new Error('Disk unavailable'));
    await failed;
    await second;
    assert.deepEqual(calls[2][1].state.rates, { client: '75' });
  });
  await check('oversized host data is rejected without deleting entries', async () => {
    const { storage, calls } = await fresh(true, async () => ({ state: null, updatedAt: null }));
    await storage.loadSnapshot();
    const data = { ...snapshot(), entries: [{ ...entry, description: 'x'.repeat(270000) }] };
    await assert.rejects(storage.saveSnapshot(data), /storage is full/);
    assert.equal(data.entries.length, 1);
    assert.equal(calls.length, 1);
  });
  console.log(`${passed} storage checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
