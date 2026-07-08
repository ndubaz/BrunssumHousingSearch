module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!process.env.SITE_PASSWORD) {
    res.status(500).json({ error: 'SITE_PASSWORD is not configured on the server' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { password } = body;

  if (!password || password !== process.env.SITE_PASSWORD) {
    res.status(401).json({ error: 'incorrect password' });
    return;
  }

  const token = encodeURIComponent(process.env.SITE_PASSWORD);
  res.setHeader(
    'Set-Cookie',
    `brunssum_session=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`
  );
  res.status(200).json({ ok: true });
};
