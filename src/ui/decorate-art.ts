/**
 * The Decorate drawer's swatch thumbnails, painted as small SVGs (lit, shaded, never flat). Ported from the lab
 * (src/lab/menus-art.ts): only the swatches for what the drawer offers. Built once, when the module loads.
 */
import type { PathStyle } from '../render/paths';
import type { SceneId } from '../render/scenes';
import type { Decor, PresentSet, TopperKind } from '../store/look';

let n = 0;
/** Gives every `P-` id and `#P-` reference in an SVG string its own prefix, so swatches never share gradients. */
function uniq(svg: string): string {
  const id = `dk${++n}`;
  return svg.replace(/P-/g, `${id}-`);
}

/** Point on a quadratic Bézier. */
function quad(t: number, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): [number, number] {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}

const WARM = ['#ffcf7a', '#ff6a5c', '#7fd0ff', '#8cf0a8', '#ffb0e0', '#fff1d6'];

/** A soft blur filter and a wider one, shared inside one SVG. */
const FX = `<filter id="P-b" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.1"/></filter>
<filter id="P-bb" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.4"/></filter>`;

function bulbs(pts: readonly [number, number][], colors: readonly string[], r = 1.5): string {
  const glow = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${r * 1.9}" fill="${colors[i % colors.length]}" opacity=".75"/>`).join('');
  const core = pts
    .map(
      ([x, y], i) =>
        `<circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="#fff" opacity=".9"/><circle cx="${x}" cy="${y}" r="${r}" fill="${colors[i % colors.length]}" opacity=".55"/>`,
    )
    .join('');
  return `<g filter="url(#P-b)">${glow}</g>${core}`;
}

interface TreeOpts {
  cx: number;
  top: number;
  h: number;
  light?: string;
  dark?: string;
  colors?: readonly string[];
}

/** A tiered fir: three overlapping, slightly scalloped tiers with a lit edge, a trunk, bulbs and a little star. */
function fir(o: TreeOpts): string {
  const { cx, top, h } = o;
  const tiers = [
    [top, top + h * 0.42, h * 0.2],
    [top + h * 0.2, top + h * 0.68, h * 0.3],
    [top + h * 0.42, top + h * 0.94, h * 0.4],
  ];
  const paths = tiers
    .map(
      ([t, b, w]) =>
        `<path d="M${cx} ${t}L${cx + w} ${b}Q${cx + w * 0.5} ${b + h * 0.035} ${cx} ${b - h * 0.01}Q${cx - w * 0.5} ${b + h * 0.035} ${cx - w} ${b}Z" fill="url(#P-tr)"/>`,
    )
    .join('');
  const pts: [number, number][] = [];
  [0.3, 0.5, 0.66, 0.8, 0.9].forEach((f, ri) => {
    const y = top + h * f;
    const half = h * 0.42 * f * 0.86;
    const k = ri + 1;
    for (let j = 0; j < k; j++) pts.push([cx - half * 0.8 + (k === 1 ? half * 0.8 : (j / (k - 1)) * half * 1.6), y]);
  });
  const r = Math.max(0.9, h * 0.035);
  return `<defs><linearGradient id="P-tr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${o.light ?? '#2f7a4c'}"/><stop offset=".55" stop-color="${o.dark ?? '#14482b'}"/><stop offset="1" stop-color="#082416"/></linearGradient></defs>
  <rect x="${cx - h * 0.04}" y="${top + h * 0.9}" width="${h * 0.08}" height="${h * 0.12}" fill="#3a2010"/>
  ${paths}
  ${bulbs(pts, o.colors ?? WARM, r)}
  <g filter="url(#P-b)"><circle cx="${cx}" cy="${top - h * 0.02}" r="${h * 0.07}" fill="#ffd27a"/></g><path d="M${cx} ${top - h * 0.1}l${h * 0.022} ${h * 0.07} ${h * 0.07} 0 -${h * 0.056} ${h * 0.043} ${h * 0.022} ${h * 0.07} -${h * 0.058} -${h * 0.043} -${h * 0.058} ${h * 0.043} ${h * 0.022} -${h * 0.07} -${h * 0.056} -${h * 0.043} ${h * 0.07} 0z" fill="#ffe7a8"/>`;
}

const svg = (vb: string, body: string): string => uniq(`<svg viewBox="${vb}" aria-hidden="true" focusable="false"><defs>${FX}</defs>${body}</svg>`);

/* ---------------- scenes (80×60) ---------------- */

const stars = (count: number, seed: number, maxY: number): string => {
  let s = seed;
  const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  let out = '';
  for (let i = 0; i < count; i++)
    out += `<circle cx="${(r() * 80).toFixed(1)}" cy="${(r() * maxY).toFixed(1)}" r="${(0.25 + r() * 0.45).toFixed(2)}" fill="#fff" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`;
  return out;
};

/** Flakes for the Sash's night outside, kept inside the window (x 22–58, y 6–44). */
const flakes = (count: number, seed: number): string => {
  let s = seed;
  const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  let out = '';
  for (let i = 0; i < count; i++)
    out += `<circle cx="${(23 + r() * 34).toFixed(1)}" cy="${(7 + r() * 36).toFixed(1)}" r="${(0.3 + r() * 0.4).toFixed(2)}" fill="#eef3ff" opacity="${(0.45 + r() * 0.45).toFixed(2)}"/>`;
  return out;
};

export const SCENE_ART: Record<SceneId, string> = {
  fireside: svg(
    '0 0 80 60',
    `<defs><linearGradient id="P-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e140b"/><stop offset="1" stop-color="#170805"/></linearGradient>
    <linearGradient id="P-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a2412"/><stop offset="1" stop-color="#1c0b05"/></linearGradient>
    <radialGradient id="P-fire" cx=".5" cy=".9" r=".7"><stop offset="0" stop-color="#ffd27a"/><stop offset=".35" stop-color="#ff7a2a"/><stop offset="1" stop-color="#ff5a1a" stop-opacity="0"/></radialGradient></defs>
    <rect width="80" height="60" fill="url(#P-s)"/>
    <rect y="46" width="80" height="14" fill="url(#P-f)"/>
    <rect x="3" y="22" width="30" height="3" rx=".6" fill="#5a2e16"/><rect x="5" y="25" width="26" height="21" fill="#3a1a0c"/>
    <path d="M9 46V33a9 7 0 0 1 18 0v13z" fill="#0b0402"/>
    <ellipse cx="18" cy="43" rx="11" ry="9" fill="url(#P-fire)" filter="url(#P-b)"/>
    <path d="M14 46c0-4 2-5 2-8 1 2 2 2 2 4 1-2 1-4 3-6 0 4 2 5 1 10z" fill="#ffb347"/><path d="M16.5 46c0-2 1-3 1.5-4.5.6 1.5 1.5 2 1.5 4.5z" fill="#fff0c0"/>
    <ellipse cx="18" cy="51" rx="16" ry="3" fill="#ff8a3a" opacity=".3" filter="url(#P-bb)"/>
    <ellipse cx="56" cy="49" rx="16" ry="3.4" fill="#ffc070" opacity=".25" filter="url(#P-bb)"/>
    ${fir({ cx: 56, top: 13, h: 35 })}`,
  ),
  midnight: svg(
    '0 0 80 60',
    `<defs><linearGradient id="P-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060b20"/><stop offset="1" stop-color="#1c2850"/></linearGradient>
    <linearGradient id="P-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4a72"/><stop offset="1" stop-color="#141c38"/></linearGradient></defs>
    <rect width="80" height="60" fill="url(#P-s)"/>${stars(22, 3, 40)}
    <g filter="url(#P-bb)"><circle cx="66" cy="11" r="7" fill="#f6ecd0" opacity=".35"/></g><circle cx="66" cy="11" r="3.6" fill="#f8f0da"/>
    <path d="M0 49Q24 44 44 48T80 46V60H0Z" fill="url(#P-g)"/>
    <ellipse cx="40" cy="50" rx="20" ry="3" fill="#ffc070" opacity=".18" filter="url(#P-bb)"/>
    ${fir({ cx: 40, top: 14, h: 35 })}`,
  ),
  // Not in the lab's swatches: drawn in their hand. A slate room, a tall arched sash window behind the tree with a
  // snowy blue night through it, a far street lamp, and drapes either side.
  sash: svg(
    '0 0 80 60',
    `<defs><linearGradient id="P-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0f18"/><stop offset=".6" stop-color="#151a27"/><stop offset="1" stop-color="#171c29"/></linearGradient>
    <linearGradient id="P-n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1a3a"/><stop offset=".7" stop-color="#22385f"/><stop offset="1" stop-color="#3c5578"/></linearGradient>
    <linearGradient id="P-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16171f"/><stop offset="1" stop-color="#08080c"/></linearGradient>
    <linearGradient id="P-d" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1c2232"/><stop offset=".5" stop-color="#2c3448"/><stop offset="1" stop-color="#161b28"/></linearGradient>
    <clipPath id="P-c"><path d="M23 45V17a17 11 0 0 1 34 0v28z"/></clipPath></defs>
    <rect width="80" height="60" fill="url(#P-w)"/>
    <rect y="47" width="80" height="13" fill="url(#P-f)"/>
    <path d="M21 46V17a19 13 0 0 1 38 0v29z" fill="#121620"/>
    <g clip-path="url(#P-c)"><rect x="20" y="0" width="40" height="46" fill="url(#P-n)"/>
    <path d="M20 40Q32 35 44 38T60 36V46H20z" fill="#5d7090" opacity=".7"/><path d="M20 43Q34 40 60 42V46H20z" fill="#a9b8cc" opacity=".55"/>
    <g filter="url(#P-bb)"><circle cx="50" cy="33" r="4" fill="#ffc46a" opacity=".55"/></g><circle cx="50" cy="33" r="1" fill="#fff0c8"/><rect x="49.6" y="34" width=".8" height="8" fill="#0a0d16"/>
    ${flakes(26, 9)}</g>
    <path d="M23 31h34M40 6v39M23 17h34" stroke="#121620" stroke-width="1.1"/>
    <path d="M23 45V17a17 11 0 0 1 34 0v28" fill="none" stroke="rgba(150,170,220,.18)" stroke-width=".5"/>
    <path d="M2 4c5 8 4 30 1 44h8c3-12 3-32-2-44zM78 4c-5 8-4 30-1 44h-8c-3-12-3-32 2-44z" fill="url(#P-d)"/>
    <rect x="17" y="45" width="46" height="2" rx=".5" fill="#1d2230"/>
    <ellipse cx="40" cy="51" rx="18" ry="2.6" fill="#ffc070" opacity=".2" filter="url(#P-bb)"/>
    ${fir({ cx: 40, top: 16, h: 34 })}`,
  ),
  frost: svg(
    '0 0 80 60',
    `<defs><linearGradient id="P-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9c8da"/><stop offset="1" stop-color="#eef5f8"/></linearGradient>
    <linearGradient id="P-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d4e3ec"/></linearGradient></defs>
    <rect width="80" height="60" fill="url(#P-s)"/>
    <path d="M0 40l6-9 5 9 4-6 5 6 6-11 6 11 30 0 4-7 5 7 5-10 4 10V48H0z" fill="#8fb0c2" opacity=".55"/>
    <path d="M0 48Q24 43 44 47T80 45V60H0Z" fill="url(#P-g)"/>
    <ellipse cx="44" cy="51" rx="16" ry="2" fill="#7f9fb3" opacity=".35"/>
    ${fir({ cx: 40, top: 13, h: 36, light: '#3d7a5a', dark: '#1e4a36', colors: ['#ff5a4a', '#ffc24a', '#4aa8ff', '#ff5a4a'] })}
    ${stars(14, 11, 46)}`,
  ),
};

/* ---------------- light paths (84×44) ---------------- */

const along = (count: number, a = 0.06, b = 0.94): [number, number][] =>
  Array.from({ length: count }, (_, i) => quad(a + ((b - a) * i) / (count - 1), 4, 12, 42, 40, 80, 12));
const WIRE = (c: string, w: number): string => `<path d="M4 12Q42 40 80 12" fill="none" stroke="${c}" stroke-width="${w}"/>`;

export const PATH_ART: Record<PathStyle, string> = {
  filament: svg(
    '0 0 84 44',
    `<g filter="url(#P-bb)"><path d="M4 12Q42 40 80 12" fill="none" stroke="#ffb860" stroke-width="4" opacity=".7"/></g>
    <path d="M4 12Q42 40 80 12" fill="none" stroke="#ffe9c0" stroke-width="1.4"/><path d="M4 12Q42 40 80 12" fill="none" stroke="#fff" stroke-width=".5"/>`,
  ),
  fairy: svg(
    '0 0 84 44',
    `${WIRE('#3a2a18', 0.6)}<g filter="url(#P-b)">${along(15)
      .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="#ffc870"/>`)
      .join('')}</g>${along(15)
      .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r=".9" fill="#fff6e0"/>`)
      .join('')}`,
  ),
  neon: svg(
    '0 0 84 44',
    `<g filter="url(#P-bb)"><path d="M4 12Q42 40 80 12" fill="none" stroke="#ff3fa8" stroke-width="7" opacity=".8"/></g>
    <path d="M4 12Q42 40 80 12" fill="none" stroke="#ff7cc8" stroke-width="3"/><path d="M4 12Q42 40 80 12" fill="none" stroke="#ffe6f6" stroke-width="1.1"/>`,
  ),
};

/* ---------------- toppers (56×56) ---------------- */

export const TOPPER_ART: Record<TopperKind, string> = {
  star: svg(
    '0 0 56 56',
    `<defs><radialGradient id="P-g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd27a" stop-opacity=".75"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <linearGradient id="P-s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4cf"/><stop offset=".5" stop-color="#f0c060"/><stop offset="1" stop-color="#a8701e"/></linearGradient></defs>
    <circle cx="28" cy="28" r="22" fill="url(#P-g)"/>
    <path d="M28 4L30.2 25.8 52 28 30.2 30.2 28 52 25.8 30.2 4 28 25.8 25.8Z" fill="url(#P-s)"/>
    <path d="M28 14L29.4 26.6 42 28 29.4 29.4 28 42 26.6 29.4 14 28 26.6 26.6Z" transform="rotate(45 28 28)" fill="url(#P-s)" opacity=".9"/>
    <circle cx="28" cy="28" r="2.4" fill="#fffbe8"/>`,
  ),
  angel: svg(
    '0 0 56 56',
    `<defs><radialGradient id="P-g" cx=".5" cy=".45" r=".5"><stop offset="0" stop-color="#fff0c8" stop-opacity=".7"/><stop offset="1" stop-color="#fff0c8" stop-opacity="0"/></radialGradient>
    <linearGradient id="P-gown" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c9b89a"/><stop offset=".4" stop-color="#fffaf0"/><stop offset="1" stop-color="#b8a684"/></linearGradient>
    <linearGradient id="P-wing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#d8c8a6"/></linearGradient></defs>
    <circle cx="28" cy="26" r="24" fill="url(#P-g)"/>
    <path d="M24 22C14 14 6 16 6 24c3-2 6-1 8 1-3 0-5 2-5 4 3-2 7-2 10 0 2-2 4-4 5-7zM32 22c10-8 18-6 18 2-3-2-6-1-8 1 3 0 5 2 5 4-3-2-7-2-10 0-2-2-4-4-5-7z" fill="url(#P-wing)"/>
    <path d="M10 22c4-3 8-2 12 1M46 22c-4-3-8-2-12 1" fill="none" stroke="#b8a070" stroke-width=".6" opacity=".7"/>
    <path d="M28 18L38 50Q28 53 18 50Z" fill="url(#P-gown)"/><path d="M18 50Q28 53 38 50" fill="none" stroke="#d6a24a" stroke-width="1.1"/><path d="M24 26l8 0" stroke="#d6a24a" stroke-width=".9"/>
    <circle cx="28" cy="15.5" r="4" fill="#f4dcc0"/><path d="M24 15c0-4 8-4 8 0-1-2-7-2-8 0z" fill="#e2b25a"/>
    <ellipse cx="28" cy="9.6" rx="5.6" ry="1.7" fill="none" stroke="#ffe08a" stroke-width="1.3"/><ellipse cx="28" cy="9.6" rx="5.6" ry="1.7" fill="none" stroke="#fff" stroke-width=".4" opacity=".8"/>`,
  ),
  bow: svg(
    '0 0 56 56',
    `<defs><linearGradient id="P-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a78"/><stop offset=".45" stop-color="#c8202e"/><stop offset="1" stop-color="#5e0612"/></linearGradient>
    <linearGradient id="P-t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d8303a"/><stop offset="1" stop-color="#5e0612"/></linearGradient>
    <radialGradient id="P-k" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#ffb0a8"/><stop offset=".5" stop-color="#c8202e"/><stop offset="1" stop-color="#5e0612"/></radialGradient></defs>
    <g transform="translate(-4 6) scale(1)">
    <path d="M29 26l-10 20 6-2.4 3.4 4 3.2-20zM35 26l10 20-6-2.4-3.4 4-3.2-20z" fill="url(#P-t)"/>
    <path d="M32 24C22 6 4 6 7 19c2 9 14 10 25 5z" fill="url(#P-l)"/><path d="M32 24C42 6 60 6 57 19c-2 9-14 10-25 5z" fill="url(#P-l)"/>
    <path d="M12 12c4-3 10-1 15 6M52 12c-4-3-10-1-15 6" fill="none" stroke="#ffd0c8" stroke-width=".9" stroke-linecap="round" opacity=".8"/>
    <path d="M7 19c4 3 12 4 22 2M57 19c-4 3-12 4-22 2" fill="none" stroke="#e2b560" stroke-width=".8" opacity=".9"/>
    <ellipse cx="32" cy="24" rx="5.4" ry="4.8" fill="url(#P-k)"/></g>`,
  ),
  snowflake: svg(
    '0 0 56 56',
    `<defs><radialGradient id="P-g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#bfe8ff" stop-opacity=".7"/><stop offset="1" stop-color="#bfe8ff" stop-opacity="0"/></radialGradient></defs>
    <circle cx="28" cy="28" r="24" fill="url(#P-g)"/>
    <g stroke="#eaf8ff" stroke-width="1.6" stroke-linecap="round" fill="none">${[0, 60, 120, 180, 240, 300]
      .map((a) => `<g transform="rotate(${a} 28 28)"><path d="M28 28V7M28 14l-4-4M28 14l4-4M28 20l-5-3.5M28 20l5-3.5"/></g>`)
      .join('')}</g>
    <g stroke="#7fd0ff" stroke-width=".5" stroke-linecap="round" fill="none" opacity=".9">${[0, 60, 120, 180, 240, 300].map((a) => `<path transform="rotate(${a} 28 28)" d="M28 28V7"/>`).join('')}</g>
    <circle cx="28" cy="28" r="3" fill="#fff"/>`,
  ),
};

/* ---------------- decorations (64×44) ---------------- */

const SWAG = 'M4 10Q32 40 60 10';
export const DECOR_ART: Record<keyof Decor, string> = {
  tinsel: svg(
    '0 0 64 44',
    `<defs><linearGradient id="P-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#b7c1cc"/><stop offset="1" stop-color="#6f7a86"/></linearGradient></defs>
    <path d="${SWAG}" fill="none" stroke="url(#P-t)" stroke-width="7" stroke-dasharray=".7 .9" stroke-linecap="butt"/>
    <path d="${SWAG}" fill="none" stroke="#e8eef4" stroke-width="3.2" stroke-dasharray=".5 1.4" opacity=".9"/>
    <g fill="#fff">${[
      [14, 22],
      [30, 27],
      [46, 21],
      [22, 26],
    ]
      .map(([x, y]) => `<path d="M${x} ${y - 3}l.6 2.4 2.4.6-2.4.6-.6 2.4-.6-2.4-2.4-.6 2.4-.6z"/>`)
      .join('')}</g>`,
  ),
  beads: svg(
    '0 0 64 44',
    `<defs><radialGradient id="P-gd" cx=".35" cy=".3" r=".7"><stop offset="0" stop-color="#fff4c8"/><stop offset=".5" stop-color="#d6a24a"/><stop offset="1" stop-color="#7a4c10"/></radialGradient>
    <radialGradient id="P-rd" cx=".35" cy=".3" r=".7"><stop offset="0" stop-color="#ffb0a0"/><stop offset=".5" stop-color="#c8202e"/><stop offset="1" stop-color="#4e0410"/></radialGradient></defs>
    <path d="${SWAG}" fill="none" stroke="#5a3a1c" stroke-width=".5"/>
    ${Array.from({ length: 17 }, (_, i) => {
      const [x, y] = quad(0.03 + (0.94 * i) / 16, 4, 10, 32, 40, 60, 10);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 4 === 2 ? 2.6 : 1.9}" fill="url(#P-${i % 4 === 2 ? 'rd' : 'gd'})"/>`;
    }).join('')}`,
  ),
  canes: svg(
    '0 0 64 44',
    `<g transform="translate(14 4)"><path d="M8 38V12a6 6 0 0 1 12 0v2" fill="none" stroke="#fffaf2" stroke-width="5" stroke-linecap="round"/>
    <path d="M8 38V12a6 6 0 0 1 12 0v2" fill="none" stroke="#d0202e" stroke-width="5" stroke-dasharray="2.4 2.6" stroke-linecap="butt"/>
    <path d="M6.6 36V12.4a7 7 0 0 1 2-5" fill="none" stroke="#fff" stroke-width="1" opacity=".7"/></g>
    <g transform="translate(34 10) rotate(10)"><path d="M6 32V10a5 5 0 0 1 10 0v2" fill="none" stroke="#fffaf2" stroke-width="4.2" stroke-linecap="round"/>
    <path d="M6 32V10a5 5 0 0 1 10 0v2" fill="none" stroke="#2a9a50" stroke-width="4.2" stroke-dasharray="2 2.4"/></g>`,
  ),
  skirt: svg(
    '0 0 64 44',
    `<defs><radialGradient id="P-v" cx=".5" cy="0" r="1"><stop offset="0" stop-color="#e0303c"/><stop offset=".6" stop-color="#9a1424"/><stop offset="1" stop-color="#4e0610"/></radialGradient></defs>
    <path d="M4 30Q32 10 60 30Q32 44 4 30Z" fill="url(#P-v)"/>
    <path d="M27 23h10l-2-12h-6z" fill="#3a2010"/>
    <path d="M4 30Q32 44 60 30" fill="none" stroke="#fffaf4" stroke-width="4.4" stroke-linecap="round" stroke-dasharray=".1 2.6"/>
    <path d="M4 30Q32 44 60 30" fill="none" stroke="#ede4da" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M14 24Q32 16 50 24" fill="none" stroke="#e2b560" stroke-width=".7" stroke-dasharray="1.4 1.4" opacity=".8"/>`,
  ),
};

/* ---------------- presents (64×44) ---------------- */

// Not in the lab's swatches: drawn in their hand, three boxes on the floor in each set's papers (src/render/presents.ts
// and present-sets.ts), lit from the tree's side.

interface Box {
  x: number;
  w: number;
  h: number;
  paper: string;
  ribbon: string;
  /** Twine instead of satin: a thin line and a small bow. */
  twine?: boolean;
}

const FLOOR = 38;
function box(b: Box, i: number): string {
  const y = FLOOR - b.h;
  const rx = b.x + b.w / 2;
  const rw = b.twine ? 0.7 : Math.max(1.6, b.w * 0.16);
  const bow = b.twine
    ? `<path d="M${rx} ${y}c-2.4-2.6-4-.6-2.6.6M${rx} ${y}c2.4-2.6 4-.6 2.6.6" fill="none" stroke="${b.ribbon}" stroke-width=".7"/>`
    : `<path d="M${rx} ${y}c-5-5-8-1-5 1zM${rx} ${y}c5-5 8-1 5 1z" fill="${b.ribbon}"/><ellipse cx="${rx}" cy="${y}" rx="1.4" ry="1.1" fill="${b.ribbon}"/>`;
  return `<defs><linearGradient id="P-p${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b.paper}"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient></defs>
    <rect x="${b.x}" y="${y}" width="${b.w}" height="${b.h}" rx=".8" fill="${b.paper}"/><rect x="${b.x}" y="${y}" width="${b.w}" height="${b.h}" rx=".8" fill="url(#P-p${i})" opacity=".6"/>
    <rect x="${b.x}" y="${y}" width="${b.w}" height="${Math.min(3, b.h * 0.22)}" rx=".8" fill="#fff" opacity=".1"/>
    <rect x="${rx - rw / 2}" y="${y}" width="${rw}" height="${b.h}" fill="${b.ribbon}"/>${b.twine ? '' : `<rect x="${b.x}" y="${y + b.h * 0.45}" width="${b.w}" height="${rw}" fill="${b.ribbon}" opacity=".9"/>`}
    ${bow}`;
}

const gifts = (boxes: readonly Box[]): string =>
  svg(
    '0 0 64 44',
    `<ellipse cx="32" cy="${FLOOR + 1}" rx="27" ry="3" fill="#000" opacity=".4" filter="url(#P-b)"/>
    <g filter="url(#P-bb)"><ellipse cx="16" cy="${FLOOR - 8}" rx="9" ry="9" fill="#ffc070" opacity=".12"/></g>
    ${boxes.map(box).join('')}`,
  );

export const PRESENT_ART: Record<PresentSet, string> = {
  // An empty floor under the tree: the tree's warm pool of light and a faint hem where the boxes would stand.
  none: svg(
    '0 0 64 44',
    `<g filter="url(#P-bb)"><ellipse cx="32" cy="${FLOOR - 1}" rx="22" ry="5" fill="#ffc070" opacity=".18"/></g>
    <path d="M10 ${FLOOR}Q32 ${FLOOR + 4} 54 ${FLOOR}" fill="none" stroke="rgba(236,196,116,.35)" stroke-width=".8" stroke-dasharray="1.6 1.8"/>`,
  ),
  game: gifts([
    { x: 6, w: 20, h: 16, paper: '#8e1622', ribbon: '#e2b25a' },
    { x: 24, w: 15, h: 22, paper: '#1d5534', ribbon: '#efe0bd' },
    { x: 38, w: 20, h: 13, paper: '#1f3f66', ribbon: '#e2b25a' },
  ]),
  luxe: gifts([
    { x: 6, w: 20, h: 16, paper: '#4f1520', ribbon: '#c6ab72' },
    { x: 24, w: 15, h: 22, paper: '#cbbd9f', ribbon: '#234536' },
    { x: 38, w: 20, h: 13, paper: '#1a2340', ribbon: '#c6ab72' },
  ]),
  kraft: gifts([
    { x: 6, w: 20, h: 16, paper: '#8a6741', ribbon: '#efe2c4', twine: true },
    { x: 24, w: 15, h: 22, paper: '#7a5a39', ribbon: '#c8343c', twine: true },
    { x: 38, w: 20, h: 13, paper: '#9a7650', ribbon: '#efe2c4', twine: true },
  ]),
};

/** The drawer's gold bow, over its ribbon band, with its own gradient ids. */
export const BOW_ART = uniq(`<svg class="deco-bow" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="P-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe3a4"/><stop offset=".45" stop-color="#d9a74e"/><stop offset="1" stop-color="#8f5f1e"/></linearGradient>
    <linearGradient id="P-t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9c16c"/><stop offset="1" stop-color="#90601f"/></linearGradient>
    <radialGradient id="P-k" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fff2c8"/><stop offset=".5" stop-color="#e2b25a"/><stop offset="1" stop-color="#8a5a1c"/></radialGradient>
  </defs>
  <path d="M29 22l-10 16 6-2.2 3.4 3.6 3.2-16.4zM35 22l10 16-6-2.2-3.4 3.6-3.2-16.4z" fill="url(#P-t)"/>
  <path d="M32 20C22 4 5 3 7 15c1 8 14 9 25 5z" fill="url(#P-l)"/>
  <path d="M32 20C42 4 59 3 57 15c-1 8-14 9-25 5z" fill="url(#P-l)"/>
  <path d="M30 19C22 9 12 7 11 13c0 3 4 5 10 5M34 19C42 9 52 7 53 13c0 3-4 5-10 5" fill="none" stroke="rgba(90,52,10,.45)" stroke-width="1.2"/>
  <path d="M12 9.5c4-3 10-1 15 5M52 9.5c-4-3-10-1-15 5" fill="none" stroke="rgba(255,248,220,.7)" stroke-width=".9" stroke-linecap="round"/>
  <ellipse cx="32" cy="20" rx="5.2" ry="4.6" fill="url(#P-k)"/>
</svg>`);
