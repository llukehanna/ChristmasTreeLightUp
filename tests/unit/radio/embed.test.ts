import { expect, it } from 'vitest';
import { EMBED_PRESETS, parseEmbed } from '../../../src/radio/embed';

it("parses Luke's Spotify playlists (with share params)", () => {
  const e = parseEmbed('https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4?si=jOmM1zzYRIOxCA9VhUmgAQ');
  expect(e).toEqual({ provider: 'spotify', src: 'https://open.spotify.com/embed/playlist/3rKFTakI4TxtuNLJ1Ruog4?utm_source=generator&theme=0', height: 152, label: 'Spotify playlist' });
  expect(parseEmbed('https://open.spotify.com/intl-de/playlist/0N1jXhN0GD3mUEs6prVPVQ')?.provider).toBe('spotify');
});
it('parses Apple Music playlists', () => {
  const e = parseEmbed('https://music.apple.com/us/playlist/christmas-jazz/pl.u-abc123XYZ');
  expect(e?.src).toBe('https://embed.music.apple.com/us/playlist/christmas-jazz/pl.u-abc123XYZ');
});
it('rejects anything that is not a playlist link', () => {
  for (const bad of ['', 'hello', 'https://open.spotify.com/track/123', 'https://evil.com/playlist/abc', 'javascript:alert(1)']) expect(parseEmbed(bad)).toBeNull();
});
it("offers Luke's two playlists as presets", () => {
  expect(EMBED_PRESETS.map((p) => parseEmbed(p.url)?.provider)).toEqual(['spotify', 'spotify']);
});
