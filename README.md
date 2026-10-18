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

## Run the browser preview

Install Node.js 18 or newer, then run these commands from the project folder:

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
CSV export calls, and report writes to the cartridge's own vault. They mock the
Mnemosyne bridge; a successful test run does not establish that installation,
permission dialogs, or vault ingestion work in a particular host version.

## Use inside Mnemosyne

This package includes a production build in `dist/`. Its manifest uses the
relative renderer entrypoint `index.html`. Select the project root containing
`mnemo-plugin.json` when adding it as a local cartridge.

Adding the cartridge uses a Mnemosyne cartridge slot. The working version was manually tested in Mnemosyne: canvas launch, session persistence after reopening, CSV export, and saving a report to the dedicated vault. Scrolling and the compact timer layout were also checked. Other host versions still require their own integration checks.

For development with hot reload, change `entrypoints.renderer` in the manifest
to `http://127.0.0.1:5185/index.html`, start the development server, and link the
project folder. Restore `index.html` and rebuild before distributing it.

Keep the identifier `@splitshift/app` stable. Mnemosyne uses it to associate the
cartridge with its saved state and sandbox vault.

## Data and permissions

The app loads and validates data before allowing edits. Entries, rates, and the
running timer are saved together as a single snapshot. Save failures are shown
with a retry action.

Inside Mnemosyne, live app data uses the cartridge's own `state.get` / `state.set`
storage. The host limits this state to 256 KiB. SplitShift reports a full store;
it does not automatically discard old entries. Export important records before
reaching that limit. CSV export is not currently an import or full-restore format.

Declared permissions:

| Permission | Use |
| --- | --- |
| `dialog:open` | Let the user choose a CSV export folder and write the report. |
| `vault:write` | Claim the dedicated SplitShift vault and save report snapshots. |

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

## Project layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Screens, timer, entries, rates, and reports. |
| `src/persistence.ts` | Validated browser and Mnemosyne state storage. |
| `src/csv-export.ts` | Browser downloads and native canvas exports. |
| `src/vault-report.ts` | User-triggered report snapshots to the app's vault. |
| `src/SplitShift.css` | SplitShift layout and styling. |
| `src/glass.css` | Starter glass styles and host theme tokens. |
| `src/sdk/mnemo-sdk.ts` | Plain re-export of the official cartridge SDK. |
| `tests/` | Portable storage and export checks. |
| `AGENTS.md` | Official Mnemosyne cartridge development reference. |

This project uses the official Mnemosyne cartridge starter and SDK, React, and
Vite. The development reference is retained for API and permission requirements.

Before publishing to a store or repository, supply the repository metadata and
complete the host integration checks described above.

## Sharing this package

Includes the source, build, purple clock artwork, development documentation, and portable checks. It excludes dependency installations, backups, reference downloads, browser storage, and personal session records. Repository metadata uses the public GitHub project URL; no personal email is configured in this package.

## License and attribution

MIT. See LICENSE and THIRD_PARTY_NOTICES.md. The original Mnemosyne starter copyright notice is retained. This license applies to SplitShift; it does not license the proprietary Mnemosyne desktop application.
