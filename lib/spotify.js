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
    return { name: album.name, tracks, cover: largestImage(album.images), source: 'api' };
  }

  const pl = await apiGet(
    `https://api.spotify.com/v1/playlists/${id}?fields=name,images,tracks.next,tracks.items(track(name,duration_ms,artists(name),show(name)))`,
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
  return { name: pl.name, tracks, cover: largestImage(pl.images), source: 'api' };
}

/* ---------- Cover ---------- */

/** Største bilde fra en liste i Spotifys ulike formater ({url,width} / {url,maxWidth}). */
function largestImage(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const size = (i) => Number(i.width || i.maxWidth || i.height || i.maxHeight || 0);
  const best = [...list].filter((i) => i && typeof i.url === 'string').sort((a, b) => size(b) - size(a))[0];
  return best ? best.url : '';
}

/** Finner cover i embed-dataene (feltene varierer mellom spillelister og album). */
function findCover(entity) {
  if (!entity) return '';
  return (
    largestImage(entity.coverArt && entity.coverArt.sources) ||
    largestImage(entity.visualIdentity && entity.visualIdentity.image) ||
    largestImage(entity.images) ||
    ''
  );
}

/** Spotifys offisielle oEmbed-tjeneste – gir et coverbilde (thumbnail_url) for en lenke. */
async function fetchOEmbedCover(type, id) {
  const target = `https://open.spotify.com/${type}/${id}`;
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(target)}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) return '';
  const json = await res.json();
  return typeof json.thumbnail_url === 'string' ? json.thumbnail_url : '';
}

/** Bare coveret for en lenke (rask – brukes for eldre setlister uten cover). */
async function fetchCover(url) {
  const ref = parseSpotifyUrl(url);
  if (!ref) {
    const err = new Error('Ugyldig lenke.');
    err.status = 400;
    throw err;
  }
  let cover = '';
  try {
    cover = await fetchOEmbedCover(ref.type, ref.id);
  } catch (_) {}
  if (!cover) {
    try {
      cover = (await fetchViaEmbed(ref.type, ref.id)).cover || '';
    } catch (_) {}
  }
  return { cover, ...ref };
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

  return { name: cleanText(entity.name || entity.title), tracks, cover: findCover(entity), source: 'embed' };
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

/** Fyller inn cover via oEmbed hvis kilden ikke hadde et. */
async function withCover(result) {
  if (!result.cover) {
    try {
      result.cover = await fetchOEmbedCover(result.type, result.id);
    } catch (_) {
      result.cover = '';
    }
  }
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
    if (viaApi && viaApi.tracks.length) return withCover({ ...viaApi, ...ref });
  } catch (e) {
    apiError = e;
  }

  try {
    const viaEmbed = await fetchViaEmbed(ref.type, ref.id);
    return withCover({ ...viaEmbed, ...ref });
  } catch (e) {
    if (apiError) e.message += ` (API: ${apiError.message})`;
    e.status = e.status || 502;
    throw e;
  }
}

module.exports = { parseSpotifyUrl, extractFromEmbedHtml, fetchPlaylist, fetchCover, findCover, largestImage };
