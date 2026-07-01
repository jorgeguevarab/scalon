const { kv } = require('@vercel/kv');
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const { subscription, reminders, timezone } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    res.status(400).json({ error: 'invalid subscription' });
    return;
  }

  const id = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
  const existing = await kv.get(`sub:${id}`);
  const record = {
    subscription,
    reminders: Array.isArray(reminders) ? reminders : [],
    timezone: timezone || 'UTC',
    lastSent: (existing && existing.lastSent) || {},
    updatedAt: Date.now(),
  };

  await kv.set(`sub:${id}`, record);
  await kv.sadd('subs:index', id);
  res.status(200).json({ ok: true });
};
