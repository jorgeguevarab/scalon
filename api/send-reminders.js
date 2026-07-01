const { kv } = require('@vercel/kv');
const webpush = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Minutes-since-midnight for `date` in IANA timezone `timeZone`.
function minutesInTz(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}
function dateKeyInTz(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date); // YYYY-MM-DD
}

// Called every ~5 min by an external cron (cron-job.org — see README). GitHub Actions'
// `schedule` trigger was tried first but is best-effort and skipped windows >10 min.
// Reminder delivery is therefore accurate to a ~5-10 minute window, not to the exact minute.
module.exports = async (req, res) => {
  const authHeader = (req.headers['authorization'] || '').trim();
  const expected = `Bearer ${(process.env.CRON_SECRET || '').trim()}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    res.status(500).json({ error: 'VAPID keys not configured' });
    return;
  }

  const ids = await kv.smembers('subs:index');
  const now = new Date();
  let sent = 0, pruned = 0;
  const debug = [];

  for (const id of ids) {
    const record = await kv.get(`sub:${id}`);
    if (!record) { await kv.srem('subs:index', id); pruned++; continue; }

    const tz = record.timezone || 'UTC';
    let nowMin, today;
    try { nowMin = minutesInTz(now, tz); today = dateKeyInTz(now, tz); }
    catch (e) { nowMin = minutesInTz(now, 'UTC'); today = dateKeyInTz(now, 'UTC'); }

    const lastSent = record.lastSent || {};
    let changed = false;
    let dropSub = false;

    for (const r of (record.reminders || [])) {
      if (!r.time || !r.habitId) { debug.push({ sub: id.slice(0, 8), skip: 'no time/habitId', r }); continue; }
      const [hh, mm] = r.time.split(':').map(Number);
      const remMin = hh * 60 + mm;
      const withinWindow = remMin <= nowMin && nowMin - remMin < 6;
      const alreadySentToday = lastSent[r.habitId] === today;
      debug.push({
        sub: id.slice(0, 8), habit: r.name, time: r.time, tz,
        nowMin, remMin, withinWindow, alreadySentToday, today,
      });
      if (!withinWindow) continue;
      if (alreadySentToday) continue;

      try {
        await webpush.sendNotification(record.subscription, JSON.stringify({
          title: 'Escalón',
          body: `${r.icon || '🎯'} Toca para registrar: ${r.name} (${r.target ?? ''} ${r.unit || ''})`.trim(),
          tag: `escalon-${r.habitId}`,
          data: { habitId: r.habitId },
        }));
        lastSent[r.habitId] = today;
        changed = true;
        sent++;
      } catch (err) {
        debug.push({ sub: id.slice(0, 8), sendError: err.message, statusCode: err.statusCode });
        if (err.statusCode === 404 || err.statusCode === 410) { dropSub = true; break; }
      }
    }

    if (dropSub) {
      await kv.del(`sub:${id}`);
      await kv.srem('subs:index', id);
      pruned++;
    } else if (changed) {
      record.lastSent = lastSent;
      await kv.set(`sub:${id}`, record);
    }
  }

  console.log('send-reminders debug', JSON.stringify(debug));
  res.status(200).json({ ok: true, checked: ids.length, sent, pruned });
};
