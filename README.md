# SplitShift

A community cartridge for [Mnemosyne OS](https://mnemosyne-os.io), for tracking time across clients and projects. Built from the official cartridge starter; independently maintained.

## Features

- Start and stop a timer, with recovery after a refresh.
- Keep the timer at the top, with a compact layout for smaller canvas windows.
- Scroll within the canvas window and use a matching purple clock icon.
- Add manual sessions with a local start and end date/time.
- Save an optional description for each session.
- Set a client hourly rate and an optional project override.
- Keep the applied rate with each completed session.
- Search entries and confirm before deleting them.
- Filter reports by date and group totals by client and project.
- Export report entries as CSV.
- Save a report snapshot to a dedicated SplitShift vault when running inside Mnemosyne.
- Create invoices by checking completed sessions for one client across multiple projects.
- Save drafts, finalize invoices, and reopen saved invoices later. Due dates are optional.
- Export printable HTML invoices and use the browser's Print / Save as PDF.
- Optionally sync invoice records and session billing coverage to SplitShift's vault.

## Run the browser preview

Use Node.js 24 (the version used for release testing), then run these commands from the project folder:

```powershell
npm ci
npm run dev
```

Open the local address printed by the development server. The default is
`http://127.0.0.1:5185/`.

Browser-preview data stays in that browser and origin. It is separate from data
saved inside Mnemosyne. No sample client records or personal time entries are
included in this package.

## Build and check

```powershell
npm test
npm run typecheck
npm run build
```

The tests check storage migration, validation, failed saves, ordered writes,
invoice selection, amounts, snapshots, exports, and opt-in vault syncing. They mock the
Mnemosyne bridge; a successful test run does not establish that installation,
permission dialogs, or vault ingestion work in a particular host version.

## Use inside Mnemosyne

This package includes a production build in `dist/`. Its manifest uses the
relative renderer entrypoint `index.html`. Select the project root containing
`mnemo-plugin.json` when adding it as a local cartridge.

Adding the cartridge uses a Mnemosyne cartridge slot. The maintainer tested the
invoice release in Mnemosyne 1.9.1-infinity on Windows: existing entries remained
available, saved invoices reopened, Print/PDF export worked, billing records
synced to the app vault, and deleting test sessions triggered another sync.
The assistant retrieved the issued invoice when explicitly scoped to that vault.
Earlier live checks covered canvas launch, timer recovery, CSV export, vault
report saves, scrolling, and the compact timer layout. Other host versions still
require their own integration checks.

For development with hot reload, change `entrypoints.renderer` in the manifest
to `http://127.0.0.1:5185/index.html`, start the development server, and link the
project folder. Restore `index.html` and rebuild before distributing it.

Keep the identifier `@splitshift/app` stable. Mnemosyne uses it to associate the
cartridge with its saved state and sandbox vault.

## Data and permissions

The app loads and validates data before allowing edits. Entries, rates, the
running timer, invoices, and sharing settings are saved together as a single snapshot. Save failures are shown
with a retry action.

Inside Mnemosyne, live app data uses the cartridge's own `state.get` / `state.set`
storage. The host limits this state to 256 KiB. SplitShift reports a full store;
it does not automatically discard old entries. Export important records before
reaching that limit. CSV export is not currently an import or full-restore format.

Declared permissions:

| Permission | Use |
| --- | --- |
| `dialog:open` | Choose an export folder and save CSV reports or printable HTML invoices. |
| `vault:write` | Claim the dedicated SplitShift vault, save report snapshots, and maintain the optional billing index. |
| `vault:read` | Read back SplitShift's own managed billing index to verify replacement and cleanup after opt-in. |

Vault reports are written only after the user presses **Save to vault**. They
contain the selected report's clients, projects, descriptions, timestamps,
durations, and rates. They are snapshots, not a synchronized copy of the live
database. Choosing an arbitrary existing vault is not implemented.

The sandbox vault initially follows Mnemosyne's isolation rules. The user
controls whether its contents become available to broader memory features.

## Report conventions

- Date filters include sessions whose local start date is in the selected range.
- Sessions crossing midnight are attributed to their start date.
- CSV timestamps are explicitly labeled UTC.
- Amounts assume a single shared currency; no currency conversion is performed.
- Entries without rates count toward time and remain unpriced.
- Report amounts are summed before rounding; summing rounded CSV rows may differ
  slightly from the report total.
- A running timer continues to count elapsed time while the page is closed.

## Invoices (1.1.0)

Open **Invoices**, choose a client, and check the completed sessions to bill.
One invoice can contain several projects for that client. Enter an invoice
number, issue date, currency, business details, billing details, and any payment
instructions. **Due date is optional**; leaving it blank omits it from the preview
and printable file. A supplied due date must be on or after the issue date.

Use **Save draft** to preserve your selection. Sessions on saved drafts are
reserved and labelled; they cannot be selected for another invoice. A missing
rate requires either a non-negative invoice rate or an explicit **No charge**
choice. Invoice rates do not change tracked sessions or their saved rates.
Currency labels amounts; it does not perform a conversion. No tax is calculated.
Each session amount is rounded to the currency's minor unit before the invoice
total is summed, so displayed line amounts agree with the total.

Drafts can be reopened, edited, or deleted with confirmation. Deleting a draft
releases its sessions and keeps all tracked entries. **Mark issued** asks for
confirmation, requires business and billing details, and makes the saved invoice
read only. Issued invoices have no edit or delete operation in this release.
Issuing does not email an invoice or collect payment.

**Export for Print / PDF** saves a self-contained `.html` invoice using the
existing folder picker in Mnemosyne or a download in browser preview. Open the
file in a browser and choose **Print → Save as PDF** or a printer. Draft exports
are labelled DRAFT. The saved file has no scripts, remote fonts, or external
assets; user content is escaped. A fresh filename avoids overwriting an export.
Direct printing from the sandboxed cartridge is not used. The maintainer
confirmed the export and browser Print/PDF workflow inside Mnemosyne.

Invoices retain copies of session details and rates. Later changes or deletion
of original time entries do not change an invoice. Existing version-1 storage
loads without invoices; the new optional invoice collection is validated before
any stored data is replaced. Invoices share the host's 256 KiB state allowance.
An exported HTML or PDF invoice is not encrypted by the app's vault encryption.

Do not downgrade to the 1.0 build after saving invoices: it does not understand
invoice records and can discard them on its next state save. Back up the full
cartridge state before testing or downgrading; CSV exports are not a complete
invoice backup.

## Optional invoice memory sharing

In **Invoices**, turn on **Share billing records with Mnemosyne** to automatically
publish a managed billing index to the dedicated SplitShift vault. Sharing is off
by default. Enabling it is consent to publish the listed fields and replace older managed
indexes. Turning it off removes those indexes, keeping local data and manual
report snapshots. The app needs to remain open until sync/removal finishes.

The index includes saved draft/issued invoice numbers, clients, currency, totals,
issue date, optional due date, invoice session snapshots, and completed-session
billing coverage. It lists unbilled sessions explicitly. It excludes running
timers, business and billing addresses, invoice notes, and payment instructions.
Session descriptions and applied rates are included. Indexes record their UTC
sync time, local time zone, and source revision. Draft/issued never means paid.

The app saves locally before syncing. It verifies a new index by reading it
back before deleting older managed indexes. Unexpected replies or failed reads,
writes, and cleanup leave a visible retry state. Cleanup targets only this
feature's exact marker in the app's own sandbox, never manual time reports.
A full 100-record query window is refused conservatively rather than assuming
the result is complete. There is no background sync while SplitShift is closed;
pending edits retry on reopening. A failed sync means vault results may be stale.

This does not change vault governance. Separately permit access to SplitShift's
vault in Mnemosyne for the assistant or other authorized tools. Agent/auto vault
selection may still exclude app sandbox vaults; explicitly scope a question to
this vault when needed. Queries such as "Have I made an invoice for last week's
sessions?" can then use the index, subject to retrieval/model behavior. Interpret
"last week" from local session start dates and distinguish drafts from issued
invoices. Always check the sync timestamp; this is a snapshot, not a live tool.

Removing shared indexes cannot erase prior chats, derived memories, exported
copies, or information already shared elsewhere. Billing sync and invoice
retrieval have been exercised live. The maintainer also confirmed that turning
sharing off completed successfully while saved invoices remained accessible and exportable.

Retrieval is not a guaranteed accounting answer: a model can omit sessions or
invent examples even when a source was retrieved. Select only the SplitShift
vault and turn web search off for private billing questions. Use SplitShift's
own invoice/session lists to verify financial records. An issued invoice is
finalized; it does not establish that it was sent or paid.

## Release plan

Version 1.1.0 adds invoices. Voice and agent controls are planned separately for 1.2.0 and are not registered or shown in this invoice build.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Screens, timer, entries, rates, and reports. |
| `src/persistence.ts` | Validated browser and Mnemosyne state storage. |
| `src/csv-export.ts` | Browser downloads and native canvas exports. |
| `src/vault-report.ts` | User-triggered report snapshots to the app's vault. |
| `src/InvoicePanel.tsx` | Invoice selection, drafts, finalized previews, and exports. |
| `src/invoices.ts` | Invoice snapshots, amounts, and printable HTML. |
| `src/BillingSharing.tsx` | Opt-in sharing controls, sync status, and retry flow. |
| `src/billing-vault.ts` | Managed billing index, verification, and cleanup. |
| `src/session-store.ts` | Shared local session state and save handling. |
| `src/SplitShift.css` | SplitShift layout and styling. |
| `src/glass.css` | Starter glass styles and host theme tokens. |
| `src/sdk/mnemo-sdk.ts` | Plain re-export of the official cartridge SDK. |
| `tests/` | Portable storage and export checks. |
| `AGENTS.md` | Official Mnemosyne cartridge development reference. |

This project uses the official Mnemosyne cartridge starter and SDK, React, and
Vite. The development reference is retained for API and permission requirements.

The release package includes source, the production build, purple clock artwork,
documentation, and tests. It excludes dependencies, backups, reference downloads,
browser storage, personal session records, and invoices. Repository metadata uses
the public GitHub project URL; no personal email is configured in this package.

## License and attribution

MIT. See LICENSE and THIRD_PARTY_NOTICES.md. The original Mnemosyne starter copyright notice is retained. This license applies to SplitShift; it does not license the proprietary Mnemosyne desktop application.

## Development acknowledgment

SplitShift was built with assistance from OpenAI Codex for implementation, interface design, debugging, and documentation. Its features and behavior were reviewed and tested by the project maintainer.
## Release checks

- Automated checks, type checking, and production build must pass.
- Confirm the package contains no personal records or backup files.
- Live sharing withdrawal completed successfully; saved invoice access and export were retained.
