// Fetches a Pararius/Funda listing page server-side (avoids browser CORS
// restrictions) and returns a lightly cleaned text version for parsing.
// Restricted to a domain allowlist so this can't be used as an open proxy.

const ALLOWED_HOSTS = new Set([
  'www.pararius.nl', 'pararius.nl',
  'www.funda.nl', 'funda.nl'
]);

function isAuthed(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)brunssum_session=([^;]+)/);
  const token = match ? decodeURIComponent(match[1]) : null;
  return Boolean(token) && Boolean(process.env.SITE_PASSWORD) && token === process.env.SITE_PASSWORD;
}

function htmlToText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&euro;/gi, '€')
    .replace(/&quot;/gi, '"')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iuml;/gi, 'ï')
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)));
  return text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { url } = req.query;
  if (!url) {
    res.status(400).json({ error: 'url required' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    res.status(400).json({ error: 'Only pararius.nl and funda.nl links are supported' });
    return;
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      res.status(502).json({ error: `Site returned HTTP ${response.status}` });
      return;
    }

    const html = await response.text();
    const text = htmlToText(html);

    if (text.length < 200 || /just a moment|access denied|captcha|are you human/i.test(text.slice(0, 500))) {
      res.status(502).json({ error: 'The site appears to have blocked automated access' });
      return;
    }

    res.status(200).json({ text: text.slice(0, 20000) });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};
