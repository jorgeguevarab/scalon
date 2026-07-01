const crypto = require('crypto');
const { kv } = require('@vercel/kv');

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const COOKIE_NAME = 'escalon_session';

function normalizeEmail(email){
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored){
  const [salt, hash] = (stored || '').split(':');
  if(!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function createSession(userId, email){
  const token = crypto.randomBytes(32).toString('hex');
  await kv.set(`session:${token}`, { userId, email }, { ex: SESSION_TTL_SECONDS });
  return token;
}
async function destroySession(token){
  if(token) await kv.del(`session:${token}`);
}
function getCookie(req, name){
  const header = req.headers.cookie;
  if(!header) return null;
  for(const part of header.split(';')){
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if(idx === -1) continue;
    if(trimmed.slice(0, idx) === name) return decodeURIComponent(trimmed.slice(idx + 1));
  }
  return null;
}
async function getSessionFromRequest(req){
  const token = getCookie(req, COOKIE_NAME);
  if(!token) return null;
  return kv.get(`session:${token}`);
}
function setSessionCookie(res, token){
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`);
}
function clearSessionCookie(res){
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

// Simple fixed-window counter to slow down credential guessing. Not a substitute
// for a real rate limiter, but cheap and enough for a personal-scale app.
async function rateLimited(key, max, windowSeconds){
  const count = await kv.incr(`ratelimit:${key}`);
  if(count === 1) await kv.expire(`ratelimit:${key}`, windowSeconds);
  return count > max;
}

module.exports = {
  COOKIE_NAME,
  normalizeEmail,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getCookie,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  rateLimited,
};
