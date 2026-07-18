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

const INDEX_KEY = 'homeops-register-index';
const HOME_PREFIX = 'homeops-home-';

// Rebuilds the register index directly from whichever homeops-home-* keys
// actually exist in Redis, merged (union) with whatever the index currently
// holds. This is purely additive — it only ever adds IDs that have real
// backing data, never removes anything from the index and never touches a
// home's own stored data. Safe to run any number of times. Exists because
// a prior version of the migration endpoint overwrote the index instead of
// merging into it, which could orphan homes that were never in the old
// combined-blob key that migration reads from.
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
    const keys = await redis.keys(`${HOME_PREFIX}*`);
    const idsFromKeys = keys.map(k => k.slice(HOME_PREFIX.length)).filter(Boolean);

    let existingIndex = [];
    try {
      const raw = await redis.get(INDEX_KEY);
      existingIndex = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(existingIndex)) existingIndex = [];
    } catch (e) { existingIndex = []; }

    const merged = Array.from(new Set([...existingIndex, ...idsFromKeys]));
    await redis.set(INDEX_KEY, JSON.stringify(merged));

    res.status(200).json({
      rebuilt: true,
      homeKeysFoundInRedis: idsFromKeys.length,
      previousIndexSize: existingIndex.length,
      newIndexSize: merged.length,
      recovered: Math.max(0, merged.length - existingIndex.length)
    });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};
