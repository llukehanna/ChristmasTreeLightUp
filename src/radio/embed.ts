export interface Embed {
  provider: 'spotify' | 'apple';
  src: string;
  height: number;
  label: string;
}

/** Official embeds only (spec §5.2). Returns null for anything that isn't a playlist link. */
export function parseEmbed(input: string): Embed | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{10,40})\/?$/);
    return m ? { provider: 'spotify', src: `https://open.spotify.com/embed/playlist/${m[1]}?utm_source=generator&theme=0`, height: 152, label: 'Spotify playlist' } : null;
  }
  if (u.hostname === 'music.apple.com' || u.hostname === 'embed.music.apple.com') {
    const m = u.pathname.match(/^\/([a-z]{2})\/playlist\/([^/]+)\/(pl\.[A-Za-z0-9.-]+)\/?$/);
    return m ? { provider: 'apple', src: `https://embed.music.apple.com/${m[1]}/playlist/${m[2]}/${m[3]}`, height: 175, label: 'Apple Music playlist' } : null;
  }
  return null;
}

export const EMBED_PRESETS: readonly { name: string; url: string }[] = [
  { name: 'Christmas Jazz on Spotify', url: 'https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4' },
  { name: 'Christmas Classics on Spotify', url: 'https://open.spotify.com/playlist/0N1jXhN0GD3mUEs6prVPVQ' },
];
