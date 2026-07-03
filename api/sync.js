const { kv } = require('@vercel/kv');
const { getSessionFromRequest } = require('../lib/auth');

// Cross-device sync with optimistic concurrency.
//  - `data:{userId}` keeps the same JSON blob the client stores in localStorage
//    ({ habits: [...], deleted: {...} }) — unchanged key/shape from v1 so old
//    clients keep working.
//  - `syncmeta:{userId}` adds a monotonic revision counter plus a per-device
//    registry ({ deviceId: { name, lastSyncAt, lastRev } }) so clients can
//    detect stale writes (409 + server copy for merging) and the UI can show
//    which device holds the most recent data.
const MAX_DEVICES = 8;
const DEVICE_NAME_MAX = 40;

function touchDevice(devices, deviceId, deviceName, rev){
  if(!deviceId) return devices;
  const out = Object.assign({}, devices);
  out[String(deviceId).slice(0, 64)] = {
    name: String(deviceName || 'Dispositivo').slice(0, DEVICE_NAME_MAX),
    lastSyncAt: Date.now(),
    lastRev: rev,
  };
  // keep only the most recently seen devices
  const ids = Object.keys(out).sort((a, b) => (out[b].lastSyncAt || 0) - (out[a].lastSyncAt || 0));
  ids.slice(MAX_DEVICES).forEach(id => { delete out[id]; });
  return out;
}

module.exports = async (req, res) => {
  const session = await getSessionFromRequest(req);
  if(!session){ res.status(401).json({ error: 'no autenticado' }); return; }
  const dataKey = `data:${session.userId}`;
  const metaKey = `syncmeta:${session.userId}`;

  if(req.method === 'GET'){
    const [savedState, meta] = await Promise.all([kv.get(dataKey), kv.get(metaKey)]);
    // accounts created before versioning existed: treat their blob as rev 1
    const rev = meta ? meta.rev : (savedState ? 1 : 0);
    const updatedAt = meta ? meta.updatedAt : null;
    let devices = (meta && meta.devices) || {};
    const deviceId = req.query && req.query.deviceId;
    if(deviceId){
      devices = touchDevice(devices, deviceId, req.query.deviceName, rev);
      await kv.set(metaKey, { rev, updatedAt, devices });
    }
    res.status(200).json({ ok: true, state: savedState || null, rev, updatedAt, devices });
    return;
  }

  if(req.method === 'POST'){
    const body = req.body || {};
    const payload = body.state;
    if(!payload || !Array.isArray(payload.habits)){ res.status(400).json({ error: 'payload inválido' }); return; }

    const meta = await kv.get(metaKey);
    let currentRev;
    if(meta){ currentRev = meta.rev; }
    else { currentRev = (await kv.get(dataKey)) ? 1 : 0; }

    // Stale write: the client last saw an older revision than what's stored, so
    // another device pushed in between. Hand back the server copy so the client
    // can merge locally and retry with the right baseRev.
    if(typeof body.baseRev === 'number' && body.baseRev !== currentRev){
      const serverState = await kv.get(dataKey);
      res.status(409).json({
        error: 'conflict', rev: currentRev,
        updatedAt: meta ? meta.updatedAt : null,
        state: serverState || null,
        devices: (meta && meta.devices) || {},
      });
      return;
    }

    const newRev = currentRev + 1;
    const now = Date.now();
    const devices = touchDevice((meta && meta.devices) || {}, body.deviceId, body.deviceName, newRev);
    await Promise.all([
      kv.set(dataKey, payload),
      kv.set(metaKey, { rev: newRev, updatedAt: now, devices }),
    ]);
    res.status(200).json({ ok: true, rev: newRev, updatedAt: now, devices });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
