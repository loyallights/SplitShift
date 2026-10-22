# Changelog

## 1.1.0 — Invoices

- Select completed sessions for one client across multiple projects.
- Save and reopen drafts; mark invoices issued to preserve their details.
- Keep due dates optional and omit them when blank.
- Apply invoice-specific rates or explicitly include sessions at no charge.
- Reserve sessions on saved invoices and drafts to prevent duplicate billing.
- Export self-contained HTML invoices for browser printing or Save as PDF.
- Optionally share a billing index with SplitShift's dedicated Mnemosyne vault.
- Show pending syncs, failures, and retries; verify replacements before removing older managed records.

### Permissions and data

- Adds `vault:read` to verify the app's own managed billing records.
- Automatic billing sharing is off by default; broader vault access remains user-controlled.
- Existing entries, rates, and timers remain compatible. The cartridge identity is unchanged.
- Version 1.0 does not preserve invoices when saving; back up full app state before downgrading.
- Issued means finalized, not paid. No taxes, currency conversion, email sending, or payment collection are included.

### Validation

- Automated storage, invoice, export, and sharing tests; type checking; production build.
- Maintainer confirmed invoice reopening, Print/PDF export, vault syncing, session-deletion sync, and scoped invoice retrieval on Mnemosyne 1.9.1-infinity / Windows.
- Maintainer confirmed sharing withdrawal completed successfully while saved invoices remained accessible and exportable.

## Planned 1.2.0

Voice and agent controls are maintained separately and are not included in 1.1.0.
