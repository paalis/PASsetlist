'use strict';
// Serverless-funksjon (Vercel): GET /api/playlist?url=<spotify-lenke>
const { fetchPlaylist } = require('../lib/spotify');

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost').searchParams.get('url');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const data = await fetchPlaylist(url);
    res.statusCode = 200;
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.message || 'Ukjent feil' }));
  }
};
