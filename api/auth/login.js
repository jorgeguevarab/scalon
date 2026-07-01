const { kv } = require('@vercel/kv');
const { normalizeEmail, verifyPassword, createSession, setSessionCookie, rateLimited } = require('../../lib/auth');

module.exports = async (req, res) => {
  if(req.method !== 'POST'){ res.status(405).json({ error: 'method not allowed' }); return; }

  const email = normalizeEmail(req.body && req.body.email);
  const password = (req.body && req.body.password) || '';

  if(await rateLimited(`login:${email || 'unknown'}`, 10, 300)){
    res.status(429).json({ error: 'demasiados intentos, espera unos minutos' });
    return;
  }

  const user = await kv.get(`user:${email}`);
  if(!user || !verifyPassword(password, user.passwordHash)){
    res.status(401).json({ error: 'correo o contraseña incorrectos' });
    return;
  }

  const token = await createSession(user.id, user.email);
  setSessionCookie(res, token);
  res.status(200).json({ ok: true, email: user.email });
};
