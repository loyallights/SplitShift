import { saveReportToVault } from './vault-report';
import { exportTextFile } from './csv-export';
import { useEffect, useRef, useState } from 'react';
import { hosted, loadSnapshot, saveSnapshot, type Entry, type Snapshot } from './persistence';
import './SplitShift.css';

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ].map(value => String(value).padStart(2, '0')).join(':');
}

export default function App() {
  const [initial, setInitial] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadError('');
    loadSnapshot().then(data => { if (active) setInitial(data); })
      .catch(error => { if (active) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [attempt]);
  if (!initial) return <main className="ss-app"><section className="glass ss-panel">
    <h1>SplitShift</h1>
    {loadError ? <><p className="ss-alert" role="alert">{loadError}</p>
      <button onClick={() => setAttempt(value => value + 1)}>Retry loading</button>
      <p className="ss-help">Editing is paused until your saved data loads.</p></> :
      <p role="status">Loading your sessions...</p>}
  </section></main>;
  return <SplitShiftScreen initial={initial} />;
}

function SplitShiftScreen({ initial }: { initial: Snapshot }) {
  const recoveredTimer = initial.timer;
  const [client, setClient] = useState(recoveredTimer?.client ?? '');
  const [project, setProject] = useState(recoveredTimer?.project ?? '');
  const [description, setDescription] = useState(recoveredTimer?.description ?? '');
  const [startedAt, setStartedAt] = useState<number | null>(recoveredTimer?.startedAt ?? null);
  const [now, setNow] = useState(Date.now());
  const [entries, setEntries] = useState<Entry[]>(initial.entries);
  const [storageError, setStorageError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function deleteEntry(id: string) {
    setEntries(previous => previous.filter(entry => entry.id !== id));
    setDeleteId(null);
  }

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  function start() {
    if (!validRate) return;
    setRunningRate(effectiveRate);
    const timestamp = Date.now();
    setNow(timestamp);
    setStartedAt(timestamp);
  }

  function stop() {
    if (startedAt === null) return;
    setEntries(previous => [{
      id: crypto.randomUUID(),
      client: client.trim(),
      project: project.trim(),
      description: description.trim(),
      hourlyRate: runningRate,
      startedAt,
      endedAt: Date.now(),
    }, ...previous]);
    setStartedAt(null);
    setDescription('');
  }

  const [rates, setRates] = useState<Record<string, string>>(initial.rates);

  const [runningRate, setRunningRate] = useState<number | undefined>(
    recoveredTimer?.hourlyRate
  );
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [saveAttempt, setSaveAttempt] = useState(0);
  const latestSave = useRef(0);

  useEffect(() => {
    const generation = ++latestSave.current;
    setSaveStatus('Saving...');
    const snapshot: Snapshot = {
      version: 1, entries, rates,
      timer: startedAt === null ? null : {
        client, project, description, startedAt, hourlyRate: runningRate,
      },
    };
    saveSnapshot(snapshot).then(() => {
      if (latestSave.current !== generation) return;
      setStorageError('');
      setSaveStatus('Saved');
    }).catch(error => {
      if (latestSave.current !== generation) return;
      setSaveStatus('Not saved');
      setStorageError(error instanceof Error ? error.message : String(error));
    });
    return () => { latestSave.current += 1; };
  }, [entries, rates, startedAt, client, project, description, runningRate, saveAttempt]);

  useEffect(() => {
    function warnUnsaved(event: BeforeUnloadEvent) {
      if (saveStatus === 'Saved') return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [saveStatus]);

  const clientKey = JSON.stringify(['client', client.trim()]);
  const projectKey = JSON.stringify(['project', client.trim(), project.trim()]);
  const clientRate = rates[clientKey] ?? '';
  const projectRate = rates[projectKey] ?? '';
  const rateText = projectRate !== '' ? projectRate : clientRate;
  const effectiveRate = rateText === '' ? undefined : Number(rateText);
  const validRate = effectiveRate === undefined ||
    (Number.isFinite(effectiveRate) && effectiveRate >= 0);

  function updateRate(key: string, value: string) {
    setRates(previous => ({ ...previous, [key]: value }));
  }

  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [manualError, setManualError] = useState('');

  function saveManual() {
    const start = new Date(manualStart).getTime();
    const end = new Date(manualEnd).getTime();

    if (startedAt !== null) return;
    if (!validRate) {
      setManualError('Enter a valid, non-negative rate.');
      return;
    }
    if (!client.trim() || !project.trim()) {
      setManualError('Enter a client and project above.');
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setManualError('Choose valid dates, with the end after the start.');
      return;
    }

    setEntries(previous => [{
      id: crypto.randomUUID(),
      client: client.trim(),
      project: project.trim(),
      description: description.trim(),
      hourlyRate: effectiveRate,
      startedAt: start,
      endedAt: end,
    }, ...previous]);
    setManualStart('');
    setManualEnd('');
    setDescription('');
    setManualError('');
  }

  const running = startedAt !== null;
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');

  function localDay(timestamp: number) {
    const date = new Date(timestamp);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  const invalidRange = Boolean(reportFrom && reportTo && reportFrom > reportTo);
  const reportEntries = invalidRange ? [] : entries.filter(entry => {
    const day = localDay(entry.startedAt);
    return (!reportFrom || day >= reportFrom) &&
      (!reportTo || day <= reportTo);
  });

  const reportGroups = new Map<string, {
    client: string;
    project: string;
    milliseconds: number;
    amount: number;
    unpriced: number;
  }>();

  for (const entry of reportEntries) {
    const key = JSON.stringify([entry.client, entry.project]);
    const group = reportGroups.get(key) ?? {
      client: entry.client,
      project: entry.project,
      milliseconds: 0,
      amount: 0,
      unpriced: 0,
    };
    const milliseconds = entry.endedAt - entry.startedAt;
    group.milliseconds += milliseconds;
    if (entry.hourlyRate === undefined) {
      group.unpriced += 1;
    } else {
      group.amount += milliseconds / 3600000 * entry.hourlyRate;
    }
    reportGroups.set(key, group);
  }

  const reportRows = [...reportGroups.values()].sort((a, b) =>
    a.client.localeCompare(b.client) || a.project.localeCompare(b.project)
  );
  const [savingVault, setSavingVault] = useState(false);
  const [vaultMessage, setVaultMessage] = useState('');
  const [vaultError, setVaultError] = useState('');

  async function saveVaultReport() {
    if (savingVault || invalidRange || reportEntries.length === 0) return;
    setSavingVault(true);
    setVaultMessage('');
    setVaultError('');
    try {
      const vault = await saveReportToVault(reportEntries, reportFrom, reportTo);
      setVaultMessage(`Report snapshot saved to vault: ${vault}`);
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingVault(false);
    }
  }

  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');

  async function exportCsv() {
    if (exporting) return;
    if (invalidRange || reportEntries.length === 0) return;

    function cell(value: string | number) {
      let text = String(value);
      // Keep user-entered text from becoming a spreadsheet formula.
      if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) {
        text = "'" + text;
      }
      return '"' + text.replace(/"/g, '""') + '"';
    }

    const rows: (string | number)[][] = [
      [
        'Client', 'Project', 'Description',
        'Start (UTC)', 'End (UTC)', 'Duration (seconds)',
        'Duration (hours)', 'Hourly rate', 'Amount',
      ],
      ...reportEntries.map(entry => {
        const seconds = (entry.endedAt - entry.startedAt) / 1000;
        const hours = seconds / 3600;
        return [
          entry.client,
          entry.project,
          entry.description,
          new Date(entry.startedAt).toISOString(),
          new Date(entry.endedAt).toISOString(),
          seconds.toFixed(3),
          hours.toFixed(6),
          entry.hourlyRate === undefined ? '' : entry.hourlyRate.toFixed(2),
          entry.hourlyRate === undefined
            ? '' : (hours * entry.hourlyRate).toFixed(2),
        ];
      }),
    ];

    const csv = '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
    setExporting(true);
    setExportMessage('');
    setExportError('');
    try {
      const result = await exportTextFile(csv,
        `splitshift-${reportFrom || 'all'}-to-${reportTo || 'all'}.csv`);
      setExportMessage(result === null ? 'Export cancelled.' :
        result === 'download' ? 'CSV download started.' : `CSV saved to ${result}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  const reportTime = reportRows.reduce((sum, row) => sum + row.milliseconds, 0);
  const reportAmount = reportRows.reduce((sum, row) => sum + row.amount, 0);
  const unpricedCount = reportRows.reduce((sum, row) => sum + row.unpriced, 0);

  const [view, setView] = useState<'track' | 'entries' | 'reports'>('track');
  const [entryMode, setEntryMode] = useState<'timer' | 'manual'>('timer');
  const [search, setSearch] = useState('');
  const todayEntries = entries.filter(entry => localDay(entry.startedAt) === localDay(now));
  const todayTime = todayEntries.reduce((sum, entry) => sum + entry.endedAt - entry.startedAt, 0);
  const todayAmount = todayEntries.reduce((sum, entry) => sum +
    (entry.endedAt - entry.startedAt) / 3600000 * (entry.hourlyRate ?? 0), 0);
  const clients = [...new Set(entries.map(entry => entry.client))].sort();
  const projects = [...new Set(entries.filter(entry => entry.client === client.trim()).map(entry => entry.project))].sort();
  const sortedEntries = [...entries].sort((a, b) => b.startedAt - a.startedAt);
  const visibleEntries = sortedEntries.filter(entry =>
    `${entry.client} ${entry.project} ${entry.description}`.toLowerCase().includes(search.toLowerCase()));

  function entryCard(entry: Entry) {
    return <article className="ss-entry" key={entry.id}>
      <div className="ss-entry-top">
        <div className="ss-entry-copy"><span className="ss-eyebrow">{entry.client}</span>
          <h3>{entry.project}</h3>
          {entry.description && <p className="ss-description">{entry.description}</p>}
          <p className="ss-meta">{new Date(entry.startedAt).toLocaleString([], {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
          })}</p>
        </div>
        <div className="ss-entry-numbers"><strong>{duration(entry.endedAt - entry.startedAt)}</strong>
          <span>{entry.hourlyRate === undefined ? 'No rate' :
            `${((entry.endedAt - entry.startedAt) / 3600000 * entry.hourlyRate).toFixed(2)}`}</span>
          {entry.hourlyRate !== undefined && <small>{entry.hourlyRate.toFixed(2)} / hr</small>}
        </div>
      </div>
      {deleteId === entry.id ? <div className="ss-delete-confirm" role="group" aria-label="Confirm entry deletion">
        <p>Delete this entry? This cannot be undone.</p>
        <div className="ss-actions"><button onClick={() => setDeleteId(null)}>Keep entry</button>
          <button className="ss-danger" onClick={() => deleteEntry(entry.id)}>Confirm delete</button></div>
      </div> : <button className="ss-delete" onClick={() => setDeleteId(entry.id)}
        aria-label={`Delete ${entry.client} / ${entry.project} entry`} title="Delete entry">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
        </svg>
      </button>}
    </article>;
  }

  return (
    <main className="ss-app">
      <header className="ss-header">
        <div className="ss-brand"><span className="ss-logo" aria-hidden="true"><img src="./splitshift-icon.svg" width="48" height="48" alt="" /></span>
          <div><h1>SplitShift</h1><p>A little clarity for every working hour.</p></div></div>
        <span className="ss-status" role="status"><span aria-hidden="true" />{hosted ? 'Mnemosyne' : 'Browser preview'} · {saveStatus}</span>
      </header>

      <div className="ss-summary">
        <section className="glass ss-stat"><span>Tracked today</span><strong>{duration(todayTime)}</strong><small>Completed sessions</small></section>
        <section className="glass ss-stat"><span>Amount today</span><strong>{todayAmount.toFixed(2)}</strong><small>From entries with rates</small></section>
        <section className="glass ss-stat"><span>Sessions today</span><strong>{todayEntries.length.toString().padStart(2, '0')}</strong><small>{running ? 'Plus one timer running' : 'Ready for your next task'}</small></section>
      </div>

      <nav className="ss-nav" aria-label="SplitShift sections">
        <button aria-pressed={view === 'track'} onClick={() => setView('track')}>Track time</button>
        <button aria-pressed={view === 'entries'} onClick={() => setView('entries')}>Entries <span className="ss-count">{entries.length}</span></button>
        <button aria-pressed={view === 'reports'} onClick={() => setView('reports')}>Reports</button>
      </nav>

      {running && view !== 'track' && <div className="ss-running-banner">
        <span><span className="ss-live-dot" />{client} / {project} · {duration(now - (startedAt ?? now))}</span>
        <button onClick={() => setView('track')}>Back to timer</button>
      </div>}
      {storageError && <div className="ss-alert" role="alert">
        <p>{storageError}</p><p>Keep this page open until your changes are saved.</p>
        <button onClick={() => setSaveAttempt(value => value + 1)}>Retry saving</button>
      </div>}

      {view === 'track' && <div className="ss-workspace">
        <section className="glass ss-panel">
          <div className="ss-panel-heading"><div><span className="ss-eyebrow">YOUR NEXT SESSION</span><h2>Make time count.</h2></div>
            <span className="ss-pill">{running ? 'In progress' : 'Ready when you are'}</span></div>
          <div className="ss-mode" role="group" aria-label="Entry method">
            <button aria-pressed={entryMode === 'timer'} onClick={() => setEntryMode('timer')}>Timer</button>
            <button aria-pressed={entryMode === 'manual'} disabled={running} onClick={() => setEntryMode('manual')}>Manual entry</button>
          </div>
          <div className="ss-form-grid">
            <label>Client<input list="ss-clients" placeholder="e.g. Studio" value={client} disabled={running}
              onChange={event => setClient(event.target.value)} autoComplete="off" /></label>
            <label>Project<input list="ss-projects" placeholder="e.g. Billing audit" value={project} disabled={running}
              onChange={event => setProject(event.target.value)} autoComplete="off" /></label>
          </div>
          <datalist id="ss-clients">{clients.map(value => <option key={value} value={value} />)}</datalist>
          <datalist id="ss-projects">{projects.map(value => <option key={value} value={value} />)}</datalist>
          <label className="ss-description-field">What are you working on? <span className="ss-optional">Optional</span>
            <textarea value={description} rows={2} placeholder="A short note for your future self..."
              onChange={event => setDescription(event.target.value)} /></label>

          <details className="ss-rates"><summary>Hourly rates <span>{effectiveRate === undefined ? 'Not set' : `${effectiveRate.toFixed(2)} / hr`}</span></summary>
            <div className="ss-form-grid">
              <label>Client default<input type="number" min="0" step="0.01" value={clientRate} placeholder="Optional"
                disabled={running || !client.trim()} onChange={event => updateRate(clientKey, event.target.value)} /></label>
              <label>Project override<input type="number" min="0" step="0.01" value={projectRate} placeholder="Use client rate"
                disabled={running || !client.trim() || !project.trim()} onChange={event => updateRate(projectKey, event.target.value)} /></label>
            </div><p className="ss-help">Leave the project rate blank to use the client default. New sessions keep their applied rate.</p>
          </details>
          {!validRate && <p className="ss-alert" role="alert">Enter a valid, non-negative rate.</p>}

          {entryMode === 'timer' ? <div className={`ss-timer ${running ? 'is-running' : ''}`}>
            <span className="ss-eyebrow">{running ? 'FOCUS TIME' : 'START SOMETHING GOOD'}</span>
            <output aria-label="Elapsed time">{duration(startedAt === null ? 0 : Math.max(0, now - startedAt))}</output>
            <button className="primary ss-start" disabled={!running && (!client.trim() || !project.trim() || !validRate)}
              onClick={running ? stop : start}><span aria-hidden="true">{running ? '■' : '▶'}</span>{running ? 'Stop & save session' : 'Start timer'}</button>
            <p className="ss-help">{running ? 'Your timer will continue if you refresh this page.' : 'Choose a client and project to get started.'}</p>
          </div> : <div className="ss-manual">
            <div className="ss-form-grid"><label>Start date & time<input type="datetime-local" value={manualStart}
              onChange={event => setManualStart(event.target.value)} /></label>
              <label>End date & time<input type="datetime-local" value={manualEnd}
                onChange={event => setManualEnd(event.target.value)} /></label></div>
            {manualError && <p className="ss-alert" role="alert">{manualError}</p>}
            <button className="primary" disabled={running || !client.trim() || !project.trim() || !validRate} onClick={saveManual}>Save manual entry</button>
            <p className="ss-help">Dates and times use your local time zone.</p>
          </div>}
        </section>

        <aside className="glass ss-panel ss-recent"><div className="ss-panel-heading"><div><span className="ss-eyebrow">A LITTLE PROGRESS</span><h2>Recent sessions</h2></div></div>
          {entries.length ? <>{sortedEntries.slice(0, 4).map(entryCard)}<button className="ss-all" onClick={() => setView('entries')}>View all entries →</button></> :
            <div className="ss-empty"><span aria-hidden="true">◷</span><h3>Your day starts here.</h3><p>Save a session and it will appear here.</p></div>}
        </aside>
      </div>}

      {view === 'entries' && <section className="glass ss-panel"><div className="ss-panel-heading"><div><span className="ss-eyebrow">YOUR WORK, RECORDED</span><h2>Time entries</h2></div></div>
        <label className="ss-search">Find a session<input type="search" value={search} placeholder="Search client, project, or description"
          onChange={event => setSearch(event.target.value)} /></label>
        <p className="ss-help">{visibleEntries.length} of {entries.length} sessions</p>
        {visibleEntries.length ? visibleEntries.map(entryCard) : <div className="ss-empty"><h3>No sessions found</h3><p>Try a different search or track your first session.</p></div>}
      </section>}

      {view === 'reports' && <section className="glass ss-panel"><div className="ss-panel-heading"><div><span className="ss-eyebrow">SEE WHERE THE TIME GOES</span><h2>Your report</h2></div>
        <button className="primary" disabled={exporting || invalidRange || reportEntries.length === 0}
          onClick={exportCsv}>{exporting ? 'Exporting...' : 'Export CSV ↓'}</button></div>
        <div className="ss-vault-export" style={{ marginBottom: 20 }}>
          <button disabled={!hosted || savingVault || invalidRange || reportEntries.length === 0}
            onClick={saveVaultReport}>{savingVault ? 'Saving to vault...' : 'Save to vault'}</button>
          <p className="ss-help" style={{ marginTop: 8 }}>
            {hosted ? 'Saves this report and its included entries to the dedicated SplitShift vault. The app keeps your editable sessions separately.' :
              'Save to vault becomes available when SplitShift runs inside Mnemosyne.'}
          </p>
          {vaultMessage && <p role="status" className="ss-help" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>{vaultMessage}</p>}
          {vaultError && <div role="alert" className="ss-alert"><p>{vaultError}</p>
            <button disabled={savingVault} onClick={saveVaultReport}>Retry saving to vault</button></div>}
        </div>
        {exportMessage && <p className="ss-help" role="status" style={{ overflowWrap: 'anywhere', marginBottom: 16 }}>{exportMessage}</p>}
        {exportError && <p className="ss-alert" role="alert">{exportError} Try Export CSV again.</p>}
        <div className="ss-report-filters"><label>From<input type="date" value={reportFrom} onChange={event => setReportFrom(event.target.value)} /></label>
          <label>Through<input type="date" value={reportTo} onChange={event => setReportTo(event.target.value)} /></label>
          <button onClick={() => { setReportFrom(''); setReportTo(''); }}>All dates</button></div>
        <p className="ss-help">Includes sessions starting within these local dates. Blank dates include all sessions.</p>
        {invalidRange && <p className="ss-alert" role="alert">The end date must be on or after the start date.</p>}
        <div className="ss-report-totals"><div><span>Total time</span><strong>{duration(reportTime)}</strong></div>
          <div><span>Rated amount</span><strong>{reportAmount.toFixed(2)}</strong></div><div><span>Sessions</span><strong>{reportEntries.length}</strong></div></div>
        <div className="ss-report-list">{reportRows.map(row => <article className="ss-report-row" key={JSON.stringify([row.client, row.project])}>
          <div><span className="ss-eyebrow">{row.client}</span><h3>{row.project}</h3>{row.unpriced > 0 && <small>{row.unpriced} without a rate</small>}</div>
          <div className="ss-entry-numbers"><strong>{duration(row.milliseconds)}</strong><span>{row.amount.toFixed(2)}</span></div>
        </article>)}</div>
        {!invalidRange && !reportEntries.length && <div className="ss-empty"><h3>No sessions in this period</h3><p>Choose different dates or save a session.</p></div>}
        <p className="ss-help">{unpricedCount} sessions without rates. Amounts use one shared currency and are summed before rounding.</p>
      </section>}
      <footer className="ss-footer">{hosted ? 'Stored in dedicated SplitShift state in Mnemosyne' : 'Browser preview · Saved in this browser'} · Amounts use your chosen shared currency</footer>
    </main>
  );
}
