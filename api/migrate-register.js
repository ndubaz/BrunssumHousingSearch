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
// function-to-Redis call, not subject to the browser-facing payload cap),
// splits it into a lightweight index + one small key per home + one key
// per photo, and retires the old oversized key. Safe to call more than
// once: if the old key is already gone, it reports nothing to do.
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
    const MAX_PHOTO_BYTES = 3500000; // same ceiling used client-side — a value stored above this can never be read back via GET /api/storage

    for (const id of homeIds) {
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
    writes.push(redis.set(INDEX_KEY, JSON.stringify(homeIds)));

    await Promise.all(writes);

    // Keep a backup under a different key rather than deleting the data
    // outright, then retire the key the app will stop reading from.
    await redis.set('homeops-register-backup', raw);
    await redis.del(OLD_KEY);

    res.status(200).json({
      migrated: true,
      migratedHomes: homeIds.length,
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
