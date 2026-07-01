const { getSessionFromRequest } = require('../../lib/auth');

module.exports = async (req, res) => {
  const session = await getSessionFromRequest(req);
  if(!session){ res.status(200).json({ authenticated: false }); return; }
  res.status(200).json({ authenticated: true, email: session.email });
};
