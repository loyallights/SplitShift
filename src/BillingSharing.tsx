import { useEffect, useRef, useState } from 'react';
import { hosted } from './persistence';
import type { SessionStore } from './session-store';
import { syncBilling } from './billing-vault';

export default function BillingSharing({ store }: { store: SessionStore }) {
  const view = store.getSnapshot();
  const { snapshot } = view;
  const sharing = snapshot.billingSharing;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const revision = snapshot.billingRevision ?? 0;
  const changed = sharing?.enabled && sharing.lastRevision !== revision;

  useEffect(() => {
    if (!hosted || running.current || error || view.busy || view.status !== 'Saved' ||
        (!changed && !sharing?.withdrawPending)) return;
    const captured = store.getSnapshot().snapshot;
    const withdraw = Boolean(captured.billingSharing?.withdrawPending && !captured.billingSharing.enabled);
    running.current = true;
    setWorking(true);
    void syncBilling(captured, withdraw).then(async result => {
      await store.update(current => {
        const settings = current.billingSharing;
        if (!settings || settings.enabled !== captured.billingSharing?.enabled) return current;
        return { ...current, billingSharing: { ...settings, withdrawPending: false,
          vault: result.vault, lastSyncedAt: result.syncedAt,
          ...(withdraw ? { lastRevision: undefined } : { lastRevision: captured.billingRevision ?? 0 }) } };
      });
    }).catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => { running.current = false; setWorking(false); setAttempt(value => value + 1); });
  }, [store, view.status, view.busy, sharing?.enabled, sharing?.withdrawPending, sharing?.lastRevision, changed, revision, attempt, error]);

  async function toggle(enabled: boolean) {
    setError('');
    try {
      await store.update(current => ({ ...current, billingSharing: {
        ...current.billingSharing, enabled, withdrawPending: !enabled,
        lastRevision: enabled ? undefined : current.billingSharing?.lastRevision,
      } }));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  const pending = changed || sharing?.withdrawPending;
  return <section className="glass ss-panel" style={{ marginBottom: 18 }} aria-label="Invoice memory sharing">
    <h3>Share billing records with Mnemosyne</h3>
    <label className="ss-check" style={{ marginTop: 12 }}>
      <input type="checkbox" checked={Boolean(sharing?.enabled)} disabled={!hosted || working || view.busy || view.status !== 'Saved'}
        onChange={event => void toggle(event.target.checked)} />
      Automatically sync saved invoice records and completed-session billing coverage to SplitShift’s vault
    </label>
    <p className="ss-help" style={{ marginTop: 12 }}>Off by default. When on, SplitShift replaces its shared billing index after changes while the app is open.
      This includes client/project names, descriptions, session dates, hours, rates, invoice numbers, status, totals, and currency.
      Billing addresses, payment instructions, and invoice notes are excluded.</p>
    <p className="ss-help" style={{ marginTop: 8 }}>You separately control whether Mnemosyne and other permitted tools can read this vault in Mnemosyne’s vault settings.
      This switch does not grant broader access or enable cloud use.</p>
    <p className="ss-help" style={{ marginTop: 8 }}>Turning sharing off removes this feature’s shared index, including older revisions.
      Your local sessions, invoices, and manually saved reports remain. Previously generated answers or exported copies are not removed.</p>
    <p role="status" className="ss-help" style={{ marginTop: 12 }}>
      {!hosted ? 'Available inside Mnemosyne.' : working ? (sharing?.enabled ? 'Updating vault records...' : 'Removing shared index...') :
        error ? 'Sharing needs attention. Vault records may be outdated.' : pending ? 'Changes waiting to sync.' :
          sharing?.enabled ? `Synced to ${sharing.vault ?? 'SplitShift vault'}${sharing.lastSyncedAt ? ' · ' + new Date(sharing.lastSyncedAt).toLocaleString() : ''}` :
            'Automatic sharing is off.'}
    </p>
    {error && <div className="ss-alert" role="alert"><p>{error}</p>
      <button disabled={working || view.busy || view.status !== 'Saved'} onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry {sharing?.withdrawPending ? 'removal' : 'sync'}</button></div>}
    {hosted && sharing?.enabled && !working && !pending && !error && <button style={{ marginTop: 10 }} disabled={view.busy || view.status !== 'Saved'}
      onClick={() => void toggle(true)}>Refresh shared records</button>}
  </section>;
}
