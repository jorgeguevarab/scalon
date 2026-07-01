const { getCookie, destroySession, clearSessionCookie, COOKIE_NAME } = require('../../lib/auth');

module.exports = async (req, res) => {
  if(req.method !== 'POST'){ res.status(405).json({ error: 'method not allowed' }); return; }
  const token = getCookie(req, COOKIE_NAME);
  await destroySession(token);
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
};
