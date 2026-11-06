'use strict';
// Serverless-funksjon (Vercel):
//   GET /api/playlist?url=<spotify-lenke>           -> { name, tracks, cover, ... }
//   GET /api/playlist?url=<spotify-lenke>&cover=1   -> { cover } (bare coverbildet)
const { fetchPlaylist, fetchCover } = require('../lib/spotify');

module.exports = async function handler(req, res) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const url = params.get('url');
  const coverOnly = params.get('cover') === '1';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', coverOnly ? 'public, max-age=86400' : 'no-store');
  try {
    const data = coverOnly ? await fetchCover(url) : await fetchPlaylist(url);
    res.statusCode = 200;
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.message || 'Ukjent feil' }));
  }
};
