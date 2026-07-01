const { kv } = require('@vercel/kv');
const { getSessionFromRequest } = require('../lib/auth');

// Stores/retrieves the same JSON shape the client keeps in localStorage
// ({ habits: [...] }), one blob per account, for cross-device sync.
module.exports = async (req, res) => {
  const session = await getSessionFromRequest(req);
  if(!session){ res.status(401).json({ error: 'no autenticado' }); return; }

  if(req.method === 'GET'){
    const savedState = await kv.get(`data:${session.userId}`);
    res.status(200).json({ ok: true, state: savedState || null });
    return;
  }

  if(req.method === 'POST'){
    const payload = req.body && req.body.state;
    if(!payload || !Array.isArray(payload.habits)){ res.status(400).json({ error: 'payload inválido' }); return; }
    await kv.set(`data:${session.userId}`, payload);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
