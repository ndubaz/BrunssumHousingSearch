# Housing Ops

A full-featured housing search tracker built for a PCS move from Vicenza to
JFC Brunssum, Netherlands. Redesigned around three jobs: maintaining a master
register of homes, tracking daily Homes.mil listings, and prioritizing homes
to visit.

## ⚠️ If you're recovering from a "413 FUNCTION_PAYLOAD_TOO_LARGE" error

The register used to be stored as one combined value. Once enough photos
piled up, that value grew past Vercel's response payload limit and
`GET /api/storage` started failing outright — the app couldn't load at all.
Your data is still in Redis; it just couldn't be fetched in one piece.

**After deploying this version:**
1. Log in as usual.
2. Go to **Settings → Storage Repair → Recover / Repair Storage**.
3. Click it once. It reads the old combined value directly from Redis
   server-side (not subject to the same limit), splits it into a lightweight
   index plus one small key per home and one key per photo, and retires the
   old key. Your data reappears in the Register immediately after.

This is safe to click more than once — if there's nothing to migrate, it
just says so and does nothing.

## Architecture

**Storage is split three ways**, specifically to avoid the failure above:
- `homeops-register-index` — a small list of home IDs.
- `homeops-home-<id>` — one small key per home, metadata only, no photo data.
- `homeops-photo-<id>` — one key per photo. This is the only place actual
  image data lives.

No single stored value ever embeds photo data alongside metadata, so no
amount of photos can make any one value large enough to hit a payload limit
again. Photos save and delete through their own keys at the specific points
they change (mass upload, docx import, screenshot capture, backup import,
gallery delete) — everything else (notes, ratings, status, rank, watch,
criteria) goes through the lightweight per-home metadata save.

**One data model, still.** Every home lives in a single record — this hasn't
changed from the original redesign, just how it's physically stored.

**Four views:**
- **Register** — the master list. Search, filter, sort, and a stats strip
  showing active/new/delisted/watched counts and average rent.
- **Shortlist** — ranked homes to visit, with notes, post-viewing ratings
  (Anne/Nick/Alma, averaged), a viewing scheduler (`.ics` export), and status
  tracking (shortlisted → requested → response received → scheduled → viewed).
- **Intake** — every ingestion method in one place: Homes.mil daily dispatch
  (paste either the compact summary format or full detail pages — it
  auto-detects which), Homes.mil photo `.docx` export, Funda/Pararius
  (paste text or fetch a link), Instagram/housing-office screenshots (OCR),
  and manual entry.
- **Settings** — household priorities (used for match scoring), OHA/BAH
  budget, activity log, data export/import, and storage repair.

Click any home for a detail view: photo gallery (supports mass upload from
a phone's photo picker, auto-compressed before storing), editable facts, a
nickname, a notes thread, a match-score checklist, and post-viewing ratings.

## Deployment structure
- `index.html` — the full app, wrapped with the auth overlay and storage
  shim for shared/persistent use.
- `api/storage.js` — generic key-value storage (Redis via Upstash),
  data-model-agnostic.
- `api/migrate-register.js` — one-time server-side repair tool; see the
  recovery section above. Safe to leave in place permanently.
- `api/login.js` — password → session cookie.
- `api/fetch-listing.js` — server-side fetch proxy for Pararius/Funda links
  (domain-allowlisted).
- `vercel.json` — gives the migration endpoint more execution time, since it
  may process many homes/photos in one run.

## Environment variables
Set in Vercel: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the
`KV_REST_API_*` equivalents), and `SITE_PASSWORD` for the login gate.
