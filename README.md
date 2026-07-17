# Housing Ops

A full-featured housing search tracker built for a PCS move from Vicenza to
JFC Brunssum, Netherlands. Redesigned around three jobs: maintaining a master
register of homes, tracking daily Homes.mil listings, and prioritizing homes
to visit.

## Architecture

**One data model.** Every home — however it was found — lives in a single
`register` object keyed by ID. There's no separate "library," "watchlist,"
or "to-view" store to keep in sync; a home's photos, notes, score, and
viewing status are all fields on the same record. This replaces the earlier
version's five separate storage keys and the manual reconciliation that
required.

**Four views:**
- **Register** — the master list. Search, filter, sort, and a stats strip
  showing active/new/delisted/watched counts and average rent.
- **Intake** — every ingestion method in one place: Homes.mil daily dispatch
  (paste either the compact summary format or full detail pages — it
  auto-detects which), Homes.mil photo `.docx` export, Funda/Pararius
  (paste text or fetch a link), Instagram/housing-office screenshots (OCR),
  and manual entry.
- **Shortlist** — ranked homes to visit, with notes, a viewing scheduler
  (`.ics` export), and status tracking (shortlisted → scheduled → viewed).
- **Settings** — household priorities (used for match scoring), OHA/BAH
  budget, activity log, and data export.

Click any home for a detail view: photo gallery, editable facts, a notes
thread, and a scoring checklist against household priorities.

## Deployment structure
- `index.html` — the full app, wrapped with the auth overlay and storage
  shim for shared/persistent use.
- `api/storage.js` — generic key-value storage (Redis via Upstash),
  data-model-agnostic.
- `api/login.js` — password → session cookie.
- `api/fetch-listing.js` — server-side fetch proxy for Pararius/Funda links
  (domain-allowlisted).

## Environment variables
Set in Vercel: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the
`KV_REST_API_*` equivalents), and `SITE_PASSWORD` for the login gate.
