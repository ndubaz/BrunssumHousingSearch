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

// Uses STRLEN to get each key's size without ever fetching its value —
// safe to run even on a key too large for GET /api/storage to return.
module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!redis) {
    res.status(500).json({ error: 'Redis is not configured.' });
    return;
  }

  try {
    const keys = await redis.keys('homeops-*');
    const VERCEL_LIMIT = 4500000;
    const sizes = await Promise.all(keys.map(async (key) => {
      let bytes = null;
      try { bytes = await redis.strlen(key); } catch (e) { bytes = null; }
      return { key, bytes, mb: bytes !== null ? +(bytes / 1000000).toFixed(2) : null, overLimit: bytes !== null && bytes > VERCEL_LIMIT };
    }));
    sizes.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));

    res.status(200).json({
      totalKeys: keys.length,
      overLimitCount: sizes.filter(s => s.overLimit).length,
      sizes
    });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};
