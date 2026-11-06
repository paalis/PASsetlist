'use strict';
// Enkel lokal server uten avhengigheter: serverer public/ og /api/playlist
const http = require('http');
const fs = require('fs');
const path = require('path');
const playlistHandler = require('./api/playlist');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/playlist') return playlistHandler(req, res);

    const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC)) {
      res.statusCode = 403;
      return res.end();
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.statusCode = 404;
        return res.end('Ikke funnet');
      }
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.end(buf);
    });
  })
  .listen(PORT, () => console.log(`Setlist Live kjører på http://localhost:${PORT}`));
