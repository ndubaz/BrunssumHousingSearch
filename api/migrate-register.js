const { Redis } = require('@upstash/redis');

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.REDIS_REST_URL;

const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  process.env.REDIS_REST_TOKEN;

const redis = (REDIS_URL && REDIS_TOKEN)
  ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN, automaticDeserialization: false })
  : null;

function isAuthed(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)brunssum_session=([^;]+)/);
  const token = match ? decodeURIComponent(match[1]) : null;
  return Boolean(token) && Boolean(process.env.SITE_PASSWORD) && token === process.env.SITE_PASSWORD;
}

const OLD_KEY = 'homeops-register';
const INDEX_KEY = 'homeops-register-index';

// One-time repair: the old architecture stored every home (including every
// embedded photo, base64-encoded) as a single Redis value. Once that value
// grows past Vercel's response payload limit, GET /api/storage can no
// longer return it to the browser at all — but the value is still sitting
// in Redis intact. This endpoint reads it directly server-side (a
// function-to-Redis call, not subject to the browser-facing payload cap)
// and uses it only to fill in homes that are missing from the new per-home
// structure. It never overwrites a home that already exists there — the
// old blob is a point-in-time snapshot that can be stale relative to
// edits already made through the new structure, and overwriting
// unconditionally would silently revert that newer data. Safe to call
// more than once, and safe even if the old key is stale or absent.
module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!redis) {
    res.status(500).json({ error: 'Redis is not configured.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const raw = await redis.get(OLD_KEY);
    if (raw === null || raw === undefined) {
      res.status(200).json({
        migrated: false,
        reason: 'Nothing to migrate — the old combined register key is empty or already migrated.',
        migratedHomes: 0,
        migratedPhotos: 0
      });
      return;
    }

    let register;
    try {
      register = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      res.status(500).json({ error: 'The stored register value is not valid JSON: ' + e.message });
      return;
    }

    const homeIds = Object.keys(register);
    const writes = [];
    let photoCount = 0;
    let photosSkippedTooLarge = 0;
    let homesAlreadyCurrent = 0;
    const MAX_PHOTO_BYTES = 3500000; // same ceiling used client-side — a value stored above this can never be read back via GET /api/storage

    // Critical: only ever write a home from the old blob if it doesn't
    // already exist in the new per-home structure. The old blob is a
    // snapshot that can be arbitrarily stale relative to homes already
    // living in the new structure — overwriting unconditionally would
    // silently replace newer data (nicknames, ratings, added photos,
    // status changes) with an older version. This makes the migration
    // strictly additive: it only recovers homes that are missing, never
    // reverts ones that already exist.
    for (const id of homeIds) {
      const alreadyExists = await redis.get(`homeops-home-${id}`);
      if (alreadyExists !== null && alreadyExists !== undefined) {
        homesAlreadyCurrent++;
        continue;
      }
      const home = register[id] || {};
      const photos = Array.isArray(home.photos) ? home.photos : [];
      const photoRefs = [];
      photos.forEach(p => {
        if (p && p.dataUrl) {
          const commaIdx = p.dataUrl.indexOf(',');
          const b64 = commaIdx >= 0 ? p.dataUrl.slice(commaIdx + 1) : p.dataUrl;
          const approxBytes = Math.floor(b64.length * 0.75);
          if (approxBytes > MAX_PHOTO_BYTES) {
            photosSkippedTooLarge++;
            return; // don't relocate an oversized photo into a new key that would be just as unreadable
          }
          writes.push(redis.set(`homeops-photo-${p.id}`, JSON.stringify(p.dataUrl)));
          photoRefs.push({ id: p.id, addedAt: p.addedAt || null });
          photoCount++;
        }
      });
      const homeMeta = Object.assign({}, home, { id, photos: photoRefs });
      writes.push(redis.set(`homeops-home-${id}`, JSON.stringify(homeMeta)));
    }
    // Merge into whatever's already in the index rather than overwriting it
    // outright — the old combined-blob key can be stale relative to homes
    // already living in the new per-home structure, and replacing the index
    // instead of merging into it would silently orphan those homes even
    // though their data is untouched.
    let existingIndex = [];
    try {
      const existingRaw = await redis.get(INDEX_KEY);
      existingIndex = existingRaw ? JSON.parse(existingRaw) : [];
      if (!Array.isArray(existingIndex)) existingIndex = [];
    } catch (e) { existingIndex = []; }
    const mergedIndex = Array.from(new Set([...existingIndex, ...homeIds]));
    writes.push(redis.set(INDEX_KEY, JSON.stringify(mergedIndex)));

    await Promise.all(writes);

    // Keep a backup under a different key rather than deleting the data
    // outright, then retire the key the app will stop reading from.
    await redis.set('homeops-register-backup', raw);
    await redis.del(OLD_KEY);

    res.status(200).json({
      migrated: true,
      migratedHomes: homeIds.length - homesAlreadyCurrent,
      homesAlreadyCurrent,
      migratedPhotos: photoCount,
      photosSkippedTooLarge,
      note: photosSkippedTooLarge
        ? `${photosSkippedTooLarge} photo(s) were already too large to ever load and were left out — those homes kept their other photos.`
        : undefined
    });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};
