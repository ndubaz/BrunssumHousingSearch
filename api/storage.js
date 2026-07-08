const { Redis } = require('@upstash/redis');

// Vercel's Upstash Marketplace integration has used a couple of different
// env var naming conventions over time. Accept whichever pair actually
// shows up in this project's environment variables.
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

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (!redis) {
    res.status(500).json({
      error: 'Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or the KV_REST_API_* equivalents) in Vercel Settings > Environment Variables, then redeploy.'
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const { key, list, prefix } = req.query;

      if (list) {
        const keys = await redis.keys(`${prefix || ''}*`);
        res.status(200).json({ keys });
        return;
      }

      if (!key) {
        res.status(400).json({ error: 'key required' });
        return;
      }
      const value = await redis.get(key);
      if (value === null || value === undefined) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.status(200).json({ key, value });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { key, value } = body;
      if (!key) {
        res.status(400).json({ error: 'key required' });
        return;
      }
      await redis.set(key, value);
      res.status(200).json({ key, value });
      return;
    }

    if (req.method === 'DELETE') {
      const { key } = req.query;
      if (!key) {
        res.status(400).json({ error: 'key required' });
        return;
      }
      await redis.del(key);
      res.status(200).json({ key, deleted: true });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};
