module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
};
