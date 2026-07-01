const { kv } = require('@vercel/kv');
const crypto = require('crypto');

// Reuses the same lastSent map that send-reminders.js writes to, so a habit
// checked off from the app suppresses the reminder push for that day too.
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const { endpoint, habitId, date } = req.body || {};
  if (!endpoint || !habitId || !date) { res.status(400).json({ error: 'missing fields' }); return; }

  const id = crypto.createHash('sha256').update(endpoint).digest('hex');
  const record = await kv.get(`sub:${id}`);
  if (!record) { res.status(200).json({ ok: true }); return; }

  record.lastSent = record.lastSent || {};
  record.lastSent[habitId] = date;
  await kv.set(`sub:${id}`, record);
  res.status(200).json({ ok: true });
};
