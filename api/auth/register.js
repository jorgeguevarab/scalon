const { kv } = require('@vercel/kv');
const crypto = require('crypto');
const { normalizeEmail, hashPassword, createSession, setSessionCookie, rateLimited } = require('../../lib/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if(req.method !== 'POST'){ res.status(405).json({ error: 'method not allowed' }); return; }

  const email = normalizeEmail(req.body && req.body.email);
  const password = (req.body && req.body.password) || '';

  if(await rateLimited(`register:${email || 'unknown'}`, 6, 600)){
    res.status(429).json({ error: 'demasiados intentos, espera unos minutos' });
    return;
  }
  if(!EMAIL_RE.test(email)){ res.status(400).json({ error: 'correo inválido' }); return; }
  if(password.length < 8){ res.status(400).json({ error: 'la contraseña debe tener al menos 8 caracteres' }); return; }

  const existing = await kv.get(`user:${email}`);
  if(existing){ res.status(409).json({ error: 'ya existe una cuenta con ese correo' }); return; }

  const userId = crypto.randomUUID();
  await kv.set(`user:${email}`, { id: userId, email, passwordHash: hashPassword(password), createdAt: Date.now() });

  const token = await createSession(userId, email);
  setSessionCookie(res, token);
  res.status(200).json({ ok: true, email });
};
