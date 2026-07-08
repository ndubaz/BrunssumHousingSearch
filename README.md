# Brunssum Housing Tracker

A live, shared version of the housing SITREP tracker. Same tool you've been using
in Claude, now running as a real website you and Anne can both open on a phone
or a computer, with data stored in a small cloud database instead of
Claude-only storage.

## What's in this package

```
index.html        The entire tracker (UI, parsers, charts) — unchanged from Claude,
                   just pointed at a real backend instead of Claude's storage.
api/storage.js     Serverless function: get/set/delete/list, backed by Redis.
api/login.js       Serverless function: checks the shared password, sets a cookie.
package.json       One dependency (@upstash/redis).
.env.example       Template for the environment variables you'll set in Vercel.
```

Nothing else needs to change. Every feature you already have — SITREP diffing,
watchlist, dossiers, photos, trends, To View list, priorities — works exactly
the same. The only difference under the hood: `window.storage` now talks to
a Redis database over the network instead of Claude's built-in storage.

## One-time setup (about 15 minutes)

### 1. Push this to GitHub

```bash
cd brunssum-tracker
git init
git add .
git commit -m "Initial tracker deploy"
```

Create a new **private** repo on GitHub (Settings can stay private — Vercel
reads private repos fine), then:

```bash
git remote add origin https://github.com/<your-username>/brunssum-tracker.git
git push -u origin main
```

### 2. Create a free Redis database (Upstash)

You need somewhere for the data to live. Upstash's free tier is plenty for
this (10,000 commands/day, 256MB storage).

**Easiest path — do it from inside Vercel:**
1. Go to vercel.com and import the GitHub repo (see step 3 below) first.
2. In your new Vercel project, go to **Storage** → **Create Database** →
   **Upstash** → **Redis**.
3. Vercel automatically adds `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` to your project's environment variables. Skip
   to step 4.

**Manual path:**
1. Go to upstash.com, sign up free, create a Redis database (any region close
   to you — Frankfurt is closest to the Netherlands).
2. On the database page, find the **REST API** section and copy the
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` values.
3. You'll paste these into Vercel in step 4.

### 3. Import the project into Vercel

1. Go to vercel.com → **Add New** → **Project** → import your GitHub repo.
2. Framework preset: leave as **Other**. No build command needed.
3. Don't deploy yet if you still need to add environment variables — click
   **Environment Variables** on the same screen (or add them after the first
   deploy, in **Settings → Environment Variables**).

### 4. Set environment variables

In the Vercel project (Settings → Environment Variables), set:

| Name | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | from step 2 (auto-filled if you used the Vercel integration) |
| `UPSTASH_REDIS_REST_TOKEN` | from step 2 (auto-filled if you used the Vercel integration) |
| `SITE_PASSWORD` | a password you and Anne will both use to unlock the site |

Apply all three to **Production**, **Preview**, and **Development**.

### 5. Deploy

Click **Deploy**. Vercel builds nothing (there's no build step) — it just
publishes `index.html` as-is and turns the two files in `api/` into
serverless functions. First deploy takes under a minute.

You'll get a URL like `brunssum-tracker.vercel.app`. Open it, enter the
`SITE_PASSWORD` you set, and the tracker loads exactly as it does in Claude.

## Using it day to day

- Share the URL and password with Anne. Either of you can open it on any
  phone or laptop browser — no app install.
- Data is shared: whatever one of you saves (dispatch pastes, watchlist
  stars, dossiers, photos, priorities) the other sees immediately on refresh.
- To ship an update later (say, if you ask Claude for another feature and
  want it live), just replace `index.html` with the new version, commit, and
  push. Vercel redeploys automatically within a minute — no other steps.

## Security notes, honestly stated

- The password gate is a shared cookie, not individual logins. It's enough
  to keep random internet traffic out, not bank-grade security. Don't put
  anything in here you wouldn't want a determined snoop to eventually see.
- The password is stored in the cookie itself (not hashed). Fine for this
  use case since it's only compared server-side and the cookie is
  `HttpOnly` + `Secure`, but worth knowing.
- If you ever want stronger protection, Vercel's paid plans include built-in
  password/SSO protection at the platform level — this DIY version exists
  because that feature isn't on the free tier.

## Storage limits worth knowing

Upstash's free tier caps each database at 256MB and each command at a few
MB. Text data (listings, watchlist, dossiers, priorities) won't come close.
Photos are the one thing to watch — they're stored as base64 text, so a lot
of accumulated listing photos over many months could eventually approach
the per-command size ceiling. If you ever hit a storage error specifically
on photo import, the fix is switching photo storage to Vercel Blob (object
storage built for exactly this) instead of Redis — ask Claude to make that
change if it comes up; it's a contained edit to `api/storage.js` and the
photo-saving code in `index.html`, nothing else changes.

## If something breaks

- **"SITE_PASSWORD is not configured"** — you deployed without setting the
  env var. Add it in Vercel Settings, then redeploy (Deployments → ⋯ →
  Redeploy).
- **Blank page / fetch errors** — open browser dev tools (F12) → Console/
  Network tab and check what `/api/storage` or `/api/login` returned. A 401
  means the password cookie isn't set; a 500 usually means the Upstash env
  vars are missing or wrong.
- **Photos not saving** — see the storage limits note above.
