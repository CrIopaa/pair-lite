# Pair Lite

A separate, browser-based workspace for public pair research and manual trade records. Hosted as a static GitHub Pages app.

## Open

Use the shared access password to unlock the encrypted application. Each browser starts with an empty portfolio. No exchange keys, accounts or orders are connected.

## Main functions

- Clean bases & highs, Daily rebound, and Opposing coin bias searches with public, dated market data.
- Manual entry and partial/full exit records with fixed-quantity price P&L.
- Signed range progress: entry 0%, confirmed average peaks or a manual endpoint 100%, default review goal 78%. Results sort from highest to lowest.
- Optional click-only review levels and historical price P&L charts.
- Encrypted backup export/import and previous local-save recovery.

The app locks after 15 minutes idle or 2 minutes in the background. Supported browser content rules restrict page scripts, network connections, forms and embedded content.

Records are stored encrypted in this browser, not uploaded. Export after edits and import the latest backup when changing devices. Imports replace this device's Pair Lite copy after a preview; the prior local copy remains recoverable. Clearing browser data removes local records, so keep exported backups.

The password protects an AES-256-GCM application payload and local backups using PBKDF2-SHA256 (600,000 iterations). It is browser-side encryption, not individual accounts or server authentication. The public numerical runtime and public candle assets are downloadable without a password. Passwords and private portfolios are not part of this repository.

## Research limits

Searches preserve existing research screens. A match is a dated research observation, not an execution instruction or probability of profit. Daily rebound funding eligibility is unverified. Results depend on complete public data and network availability. Portfolio chart totals are price P&L before costs; a closed trade's net result is available only when all its entry fees, exit fees and funding are recorded. Missing prices and costs remain unavailable.

Historical comparisons, including Original 20, are hypothetical and assume both legs survive without liquidation. No future performance is established.

## Hosting

The `docs/` directory is the GitHub Pages root. The app shell is small; the public numerical runtime and candle data load only when needed. Python/NumPy runtime licenses are retained under `docs/engine/runtime/`.
