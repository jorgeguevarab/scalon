const { kv } = require('@vercel/kv');
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const { endpoint } = req.body || {};
  if (!endpoint) { res.status(400).json({ error: 'missing endpoint' }); return; }

  const id = crypto.createHash('sha256').update(endpoint).digest('hex');
  await kv.del(`sub:${id}`);
  await kv.srem('subs:index', id);
  res.status(200).json({ ok: true });
};
