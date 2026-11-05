'use strict';

/**
 * Henter tittel og artist fra en Spotify-spilleliste (eller et album).
 *
 * Strategi:
 *  1. Hvis SPOTIFY_CLIENT_ID og SPOTIFY_CLIENT_SECRET er satt, brukes Spotify Web API
 *     (støtter lange lister med paginering).
 *  2. Ellers (eller hvis API-et feiler) leses den offentlige embed-siden til Spotify,
 *     som ikke krever innlogging eller nøkler.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function parseSpotifyUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();

  // spotify:playlist:ID
  let m = s.match(/^spotify:(playlist|album):([A-Za-z0-9]+)$/);
  if (m) return { type: m[1], id: m[2] };

  // https://open.spotify.com/(intl-xx/)?(embed/)?playlist/ID?si=...
  m = s.match(
    /^(?:https?:\/\/)?(?:open|play)\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]+)/i
  );
  if (m) return { type: m[1].toLowerCase(), id: m[2] };

  return null;
}

/* ---------- Spotify Web API ---------- */

let cachedToken = null;

async function getApiToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.expires > Date.now() + 30000) return cachedToken.value;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify-token feilet (${res.status})`);
  const json = await res.json();
  cachedToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

async function apiGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Spotify API svarte ${res.status}`);
  return res.json();
}

async function fetchViaApi(type, id) {
  const token = await getApiToken();
  if (!token) return null;

  if (type === 'album') {
    const album = await apiGet(`https://api.spotify.com/v1/albums/${id}`, token);
    const tracks = [];
    let page = album.tracks;
    while (page) {
      for (const t of page.items || []) {
        tracks.push({
          title: t.name,
          artist: (t.artists || []).map((a) => a.name).join(', '),
          durationMs: t.duration_ms || 0,
        });
      }
      page = page.next ? await apiGet(page.next, token) : null;
    }
    return { name: album.name, tracks, source: 'api' };
  }

  const pl = await apiGet(
    `https://api.spotify.com/v1/playlists/${id}?fields=name,tracks.next,tracks.items(track(name,duration_ms,artists(name),show(name)))`,
    token
  );
  const tracks = [];
  let page = pl.tracks;
  while (page) {
    for (const item of page.items || []) {
      const t = item && item.track;
      if (!t || !t.name) continue;
      tracks.push({
        title: t.name,
        artist: t.artists ? t.artists.map((a) => a.name).join(', ') : (t.show && t.show.name) || '',
        durationMs: t.duration_ms || 0,
      });
    }
    page = page.next ? await apiGet(page.next, token) : null;
  }
  return { name: pl.name, tracks, source: 'api' };
}

/* ---------- Offentlig embed-side ---------- */

function findEntity(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return null;
  if (Array.isArray(node.trackList) && node.trackList.length) return node;
  for (const key of Object.keys(node)) {
    const found = findEntity(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function cleanText(s) {
  return String(s || '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFromEmbedHtml(html) {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  let data = null;
  if (m) {
    try {
      data = JSON.parse(m[1]);
    } catch (_) {
      data = null;
    }
  }
  // Noen versjoner av embed-siden legger data base64-kodet i et eget script.
  if (!data) {
    const b = html.match(/<script[^>]*id="(?:resource|initial-state)"[^>]*>([\s\S]*?)<\/script>/);
    if (b) {
      try {
        data = JSON.parse(Buffer.from(b[1].trim(), 'base64').toString('utf8'));
      } catch (_) {
        data = null;
      }
    }
  }
  if (!data) return null;

  const entity = findEntity(data);
  if (!entity) return null;

  const tracks = entity.trackList
    .map((t) => ({
      title: cleanText(t.title || t.name),
      artist: cleanText(
        t.subtitle ||
          (Array.isArray(t.artists) ? t.artists.map((a) => a.name).join(', ') : '')
      ),
      durationMs: Number(t.duration) || Number(t.duration_ms) || 0,
    }))
    .filter((t) => t.title);

  return { name: cleanText(entity.name || entity.title), tracks, source: 'embed' };
}

async function fetchViaEmbed(type, id) {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.8' },
  });
  if (res.status === 404) throw new Error('Fant ikke spillelisten. Er den offentlig?');
  if (!res.ok) throw new Error(`Spotify svarte ${res.status}`);
  const html = await res.text();
  const result = extractFromEmbedHtml(html);
  if (!result) throw new Error('Klarte ikke å lese sporene fra Spotify-siden.');
  return result;
}

async function fetchPlaylist(url) {
  const ref = parseSpotifyUrl(url);
  if (!ref) {
    const err = new Error('Ugyldig lenke. Lim inn en lenke til en Spotify-spilleliste eller et album.');
    err.status = 400;
    throw err;
  }

  let apiError = null;
  try {
    const viaApi = await fetchViaApi(ref.type, ref.id);
    if (viaApi && viaApi.tracks.length) return { ...viaApi, ...ref };
  } catch (e) {
    apiError = e;
  }

  try {
    const viaEmbed = await fetchViaEmbed(ref.type, ref.id);
    return { ...viaEmbed, ...ref };
  } catch (e) {
    if (apiError) e.message += ` (API: ${apiError.message})`;
    e.status = e.status || 502;
    throw e;
  }
}

module.exports = { parseSpotifyUrl, extractFromEmbedHtml, fetchPlaylist };
