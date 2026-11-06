'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseSpotifyUrl, extractFromEmbedHtml } = require('../lib/spotify');

test('parseSpotifyUrl godtar vanlige lenkeformater', () => {
  const id = '37i9dQZF1DXcBWIGoYBM5M';
  for (const url of [
    `https://open.spotify.com/playlist/${id}`,
    `https://open.spotify.com/playlist/${id}?si=abc123`,
    `https://open.spotify.com/intl-no/playlist/${id}?si=x`,
    `open.spotify.com/embed/playlist/${id}`,
    `spotify:playlist:${id}`,
  ]) {
    assert.deepStrictEqual(parseSpotifyUrl(url), { type: 'playlist', id }, url);
  }
  assert.deepStrictEqual(parseSpotifyUrl('https://open.spotify.com/album/abc'), { type: 'album', id: 'abc' });
  assert.strictEqual(parseSpotifyUrl('https://example.com/playlist/abc'), null);
  assert.strictEqual(parseSpotifyUrl(''), null);
});

test('extractFromEmbedHtml leser tittel og artist fra embed-siden', () => {
  const next = {
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              type: 'playlist',
              name: 'Julebord',
              trackList: [
                { uri: 'spotify:track:1', title: 'Take On Me', subtitle: 'a-ha', duration: 225280 },
                { uri: 'spotify:track:2', title: 'Firestone', subtitle: 'Kygo, Conrad Sewell', duration: 271000 },
              ],
            },
          },
        },
      },
    },
  };
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></body></html>`;
  const res = extractFromEmbedHtml(html);
  assert.strictEqual(res.name, 'Julebord');
  assert.deepStrictEqual(res.tracks, [
    { title: 'Take On Me', artist: 'a-ha', durationMs: 225280 },
    { title: 'Firestone', artist: 'Kygo, Conrad Sewell', durationMs: 271000 },
  ]);
});

test('extractFromEmbedHtml returnerer null for ukjent side', () => {
  assert.strictEqual(extractFromEmbedHtml('<html></html>'), null);
});

test('cover hentes fra embed-dataene (største bilde)', () => {
  const { findCover, largestImage } = require('../lib/spotify');
  assert.strictEqual(
    findCover({ coverArt: { sources: [{ url: 'https://i.scdn.co/a64', width: 64 }, { url: 'https://i.scdn.co/a640', width: 640 }] } }),
    'https://i.scdn.co/a640'
  );
  assert.strictEqual(
    findCover({ visualIdentity: { image: [{ url: 'https://x/300', maxWidth: 300 }, { url: 'https://x/60', maxWidth: 60 }] } }),
    'https://x/300'
  );
  assert.strictEqual(findCover({ trackList: [] }), '');
  assert.strictEqual(largestImage(null), '');
});

test('extractFromEmbedHtml tar med cover', () => {
  const entity = { name: 'Liste', coverArt: { sources: [{ url: 'https://i.scdn.co/c', width: 300 }] }, trackList: [{ title: 'A', subtitle: 'B', duration: 1000 }] };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
  assert.strictEqual(extractFromEmbedHtml(html).cover, 'https://i.scdn.co/c');
});
