/**
 * The Decorate drawer's swatch thumbnails, painted as small SVGs (lit, shaded, never flat). Ported from the lab
 * (src/lab/menus-art.ts): only the swatches for what the drawer offers. Built once, when the module loads.
 */
import type { PathStyle } from '../render/paths';
import { SET_PAPERS, type PaperSet } from '../render/present-sets';
import type { SceneId } from '../render/scenes';
import type { CursorKind, Decor, PresentSet, StrandKind, TagStyle, TopperKind, TreeKind } from '../store/look';

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
  // Drawn in their hand from the scene (src/render/square.ts): blue hour, a rose glow low in the west, snow-roofed
  // townhouses with lit shopfronts and a clock tower, gas lamps, carolers round a lantern, and the rink in front. The
  // spire's tip stays below y 9, inside the tile's cover crop.
  square: svg(
    '0 0 80 60',
    `<defs><linearGradient id="P-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04071a"/><stop offset=".4" stop-color="#0c1335"/><stop offset=".78" stop-color="#22285a"/><stop offset="1" stop-color="#3a3264"/></linearGradient>
    <radialGradient id="P-r" cx=".22" cy=".72" r=".6"><stop offset="0" stop-color="#ff8278" stop-opacity=".22"/><stop offset="1" stop-color="#c86e96" stop-opacity="0"/></radialGradient>
    <linearGradient id="P-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2c4a"/><stop offset="1" stop-color="#4c5078"/></linearGradient>
    <linearGradient id="P-i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2340"/><stop offset=".35" stop-color="#11152a"/><stop offset="1" stop-color="#080a14"/></linearGradient></defs>
    <rect width="80" height="60" fill="url(#P-s)"/><rect width="80" height="44" fill="url(#P-r)"/>${stars(10, 7, 14)}
    <path d="M0 42V27l6-6 6 6v15zM17 42V25h11v17zM27 42V31h26v11zM52 42V26l3-3v-2l3-2 3 2v2l3 3v16zM64 42V24l8-6 8 6v18z" fill="#16152b"/>
    <path d="M12 42V19h5v23z" fill="#15162a"/><path d="M11.4 19h6.2l-3.1-8z" fill="#121326"/>
    <path d="M-.5 27.5L6 21l6.5 6.5M16.6 25h11.8M51.6 26.4l3.4-3.4M61 23l3.4 3.4M63.4 24.4L72 18l8.6 6.4M11.4 19l3.1-8" fill="none" stroke="#d6e0f6" stroke-width="1" stroke-linecap="round" opacity=".55"/>
    <circle cx="14.5" cy="22.5" r="1.7" fill="#ffe2a8"/><path d="M14.5 22.5v-1.1M14.5 22.5h.8" stroke="#2a180a" stroke-width=".3"/>
    <g fill="#ffb868" opacity=".8"><rect x="2" y="30" width="1.6" height="2.4"/><rect x="8" y="30" width="1.6" height="2.4"/><rect x="19" y="28" width="1.6" height="2.4"/><rect x="24" y="28" width="1.6" height="2.4"/><rect x="55" y="29" width="1.6" height="2.4"/><rect x="67" y="27" width="1.6" height="2.4"/><rect x="75" y="27" width="1.6" height="2.4"/></g>
    <g filter="url(#P-b)" fill="#ffaa58" opacity=".85"><rect x="1" y="36" width="9" height="4.5"/><rect x="18.5" y="36" width="8" height="4.5"/><rect x="53.5" y="36" width="8" height="4.5"/><rect x="66" y="36" width="10" height="4.5"/></g>
    <g fill="#ffd696"><rect x="1.6" y="36.6" width="7.8" height="3.3"/><rect x="19.1" y="36.6" width="6.8" height="3.3"/><rect x="54.1" y="36.6" width="6.8" height="3.3"/><rect x="66.6" y="36.6" width="8.8" height="3.3"/></g>
    <g fill="#5a1418"><rect x=".6" y="34.6" width="9.8" height="1.2"/><rect x="53.1" y="34.6" width="8.8" height="1.2"/></g><g fill="#163a26"><rect x="18.1" y="34.6" width="8.8" height="1.2"/><rect x="65.6" y="34.6" width="10.8" height="1.2"/></g>
    <rect x="21.6" y="31" width=".6" height="11" fill="#0a0b14"/><rect x="59.6" y="31" width=".6" height="11" fill="#0a0b14"/>
    <g filter="url(#P-bb)" fill="#ffc878" opacity=".6"><circle cx="21.9" cy="31" r="2.6"/><circle cx="59.9" cy="31" r="2.6"/></g><circle cx="21.9" cy="31" r=".9" fill="#ffe2a8"/><circle cx="59.9" cy="31" r=".9" fill="#ffe2a8"/>
    <rect y="42" width="80" height="4" fill="url(#P-p)"/>
    <g filter="url(#P-bb)" fill="#ffb46e" opacity=".3"><ellipse cx="5.5" cy="43.4" rx="6" ry="1.2"/><ellipse cx="22.5" cy="43.4" rx="5" ry="1.2"/><ellipse cx="57.5" cy="43.4" rx="5" ry="1.2"/><ellipse cx="71" cy="43.4" rx="6" ry="1.2"/></g>
    <g fill="#080911"><path d="M3.2 45.4l.5-4h1.6l.5 4z"/><circle cx="4.5" cy="40.9" r=".8"/><path d="M6.4 45.6l.5-4.4h1.8l.5 4.4z"/><circle cx="7.8" cy="40.6" r=".85"/><path d="M9.5 45.4l.5-4h1.6l.5 4z"/><circle cx="10.8" cy="40.9" r=".8"/></g>
    <path d="M12.6 45.6l.7-6.4" stroke="#090a12" stroke-width=".4"/><g filter="url(#P-b)"><circle cx="13.4" cy="39.2" r="1.2" fill="#ffc878" opacity=".8"/></g><rect x="13" y="38.8" width=".9" height=".9" fill="#ffd08a"/>
    <rect y="46" width="80" height="14" fill="url(#P-i)"/>
    <g filter="url(#P-b)" fill="#ffb464" opacity=".28"><rect x="2" y="46" width="7" height="7"/><rect x="19.5" y="46" width="6" height="6"/><rect x="54.5" y="46" width="6" height="6"/><rect x="67" y="46" width="8" height="7"/><rect x="21.4" y="46" width="1" height="6"/><rect x="59.4" y="46" width="1" height="6"/></g>
    <rect y="45.4" width="80" height="1.2" fill="#dce4fa" opacity=".22"/>
    <g fill="none" stroke="#d2dcff" stroke-width=".3" opacity=".12"><path d="M8 52q14 3 28 0M46 55q12 2 24-1"/></g>
    <ellipse cx="40" cy="49" rx="12" ry="2.4" fill="#ffc070" opacity=".22" filter="url(#P-bb)"/>
    ${fir({ cx: 40, top: 12, h: 34 })}`,
  ),
  // Drawn in their hand from the scene (src/render/parlour.ts): oxblood damask over walnut wainscoting, the hearth on the
  // left under a gilt mirror with the clock and candles on its mantel, a sconce, and a snowy window between velvet drapes.
  parlour: svg(
    '0 0 80 60',
    `<defs><linearGradient id="P-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120708"/><stop offset=".4" stop-color="#1d0a0b"/><stop offset="1" stop-color="#2a0f10"/></linearGradient>
    <pattern id="P-dm" width="7" height="9" patternUnits="userSpaceOnUse"><path d="M3.5 1.2c1.7 1.8 1.7 4.2 0 6.2-1.7-2-1.7-4.4 0-6.2z" fill="#c04a42" opacity=".13"/></pattern>
    <linearGradient id="P-ws" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24130b"/><stop offset="1" stop-color="#170c07"/></linearGradient>
    <linearGradient id="P-fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22120a"/><stop offset="1" stop-color="#0d0705"/></linearGradient>
    <linearGradient id="P-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1312"/><stop offset="1" stop-color="#0e0909"/></linearGradient>
    <linearGradient id="P-n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060b1e"/><stop offset=".6" stop-color="#0f1a3a"/><stop offset="1" stop-color="#26345e"/></linearGradient>
    <linearGradient id="P-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34241a"/><stop offset=".25" stop-color="#6a5438"/><stop offset=".5" stop-color="#3c2c1c"/><stop offset=".75" stop-color="#5e4a30"/><stop offset="1" stop-color="#2e2014"/></linearGradient>
    <linearGradient id="P-d" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1e0306"/><stop offset=".45" stop-color="#5a0c14"/><stop offset=".6" stop-color="#7a1a22"/><stop offset="1" stop-color="#2a0408"/></linearGradient>
    <radialGradient id="P-fire" cx=".5" cy=".85" r=".7"><stop offset="0" stop-color="#ffb060"/><stop offset=".4" stop-color="#e0501a"/><stop offset="1" stop-color="#501405" stop-opacity="0"/></radialGradient>
    <radialGradient id="P-room" cx="0" cy=".8" r=".75"><stop offset="0" stop-color="#ff7832" stop-opacity=".22"/><stop offset="1" stop-color="#ff6428" stop-opacity="0"/></radialGradient>
    <linearGradient id="P-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".34"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
    <rect width="80" height="60" fill="url(#P-w)"/><rect width="80" height="38" fill="url(#P-dm)"/>
    <rect width="80" height="3.4" fill="#0e0506"/><rect y="3.4" width="80" height=".4" fill="#ffc896" opacity=".07"/>
    <rect y="38" width="80" height="9" fill="url(#P-ws)"/><rect y="37.2" width="80" height="1.6" fill="#3c2214"/><rect y="37.2" width="80" height=".3" fill="#ffc88c" opacity=".09"/>
    <g fill="none" stroke="#000" stroke-opacity=".28" stroke-width=".5"><rect x="23" y="39.6" width="7" height="5.6"/><rect x="32" y="39.6" width="7" height="5.6"/><rect x="41" y="39.6" width="7" height="5.6"/><rect x="50" y="39.6" width="7" height="5.6"/></g>
    <rect y="46" width="80" height="1.2" fill="#140a06"/><rect y="47.2" width="80" height="12.8" fill="url(#P-fl)"/>
    <path d="M23 49h30l5 11H18z" fill="#3a1214"/><path d="M24 49.8h28" stroke="#c8964a" stroke-opacity=".3" stroke-width=".6" stroke-dasharray="1 1"/>
    <rect x="-1" y="27" width="22" height="19" fill="url(#P-m)"/>
    <path d="M3 46V36q6.5-5.4 13 0v10z" fill="#050202"/>
    <ellipse cx="9.5" cy="44.5" rx="6" ry="4" fill="url(#P-fire)" filter="url(#P-b)"/>
    <g fill="#ff8a3a" opacity=".7"><circle cx="6.5" cy="44.6" r=".6"/><circle cx="9" cy="44.2" r=".7"/><circle cx="11.6" cy="44.7" r=".6"/><circle cx="13.5" cy="44.3" r=".5"/></g>
    <path d="M5 40.5v5.5M7.5 40.5v5.5M10 40.5v5.5M12.5 40.5v5.5M15 40.5v5.5" stroke="#0a0606" stroke-width=".55"/>
    <path d="M2.4 46V36q7.1-6 14.2 0v10" fill="none" stroke="#c8965a" stroke-opacity=".12" stroke-width=".6"/>
    <rect x="-1" y="25.6" width="23" height="1.8" fill="#4a2c18"/><rect x="-1" y="25.6" width="23" height=".4" fill="#ffc88c" opacity=".12"/>
    <rect x="2.5" y="7" width="15" height="14" fill="#0e0809"/>
    <g filter="url(#P-b)" opacity=".55"><circle cx="12" cy="11" r="1" fill="#ffaa5a"/><circle cx="14.6" cy="15" r="1.1" fill="#ff5a50"/><circle cx="10" cy="17" r=".9" fill="#ffd28c"/><circle cx="15.4" cy="10" r=".8" fill="#6ed282"/><circle cx="6" cy="18.6" r="1.6" fill="#ffaa5a" opacity=".5"/></g>
    <rect x="2.5" y="7" width="15" height="14" fill="none" stroke="url(#P-g)" stroke-width="1.5"/><path d="M6.6 6.3q3.4-3 6.8 0z" fill="url(#P-g)"/>
    <path d="M8 25.6v-3.4q0-1.1.9-1.3q1.1-1.6 2.2 0q.9.2.9 1.3v3.4z" fill="#3e200f"/><circle cx="10" cy="22.7" r="1.05" fill="#857a68"/><path d="M10 22.7v-.75M10 22.7h.55" stroke="#2a180a" stroke-width=".25"/>
    <g fill="#6e5a3c"><rect x="4.25" y="22.6" width=".5" height="3"/><rect x="15.25" y="22.6" width=".5" height="3"/><rect x="52.75" y="19.8" width=".9" height="1.1"/></g>
    <g fill="#8c8270"><rect x="4.1" y="19.8" width=".8" height="2.8"/><rect x="15.1" y="19.8" width=".8" height="2.8"/><rect x="52.8" y="17.4" width=".8" height="2.4"/></g>
    <path d="M53.2 23.2q-1.4-1.2 0-2.3" fill="none" stroke="#5e4a2e" stroke-width=".45"/>
    <g filter="url(#P-bb)" fill="#ffb464" opacity=".5"><circle cx="4.5" cy="18.6" r="2.4"/><circle cx="15.5" cy="18.6" r="2.4"/><circle cx="53.2" cy="16.2" r="2.4"/></g>
    <g fill="#ffe6b4"><path d="M4.5 17.6q.65 1 0 2q-.65-1 0-2z"/><path d="M15.5 17.6q.65 1 0 2q-.65-1 0-2z"/><path d="M53.2 15.2q.65 1 0 2q-.65-1 0-2z"/></g>
    <rect x="62" y="9" width="12" height="27" fill="url(#P-n)"/>
    <path d="M62 36v-6l4.6-3.4 4 2.6 3.4-1.4V36z" fill="#96a5cd" opacity=".35"/><g fill="#ffbe6e" opacity=".5"><rect x="64.4" y="31.2" width=".9" height="1.2"/><rect x="69.2" y="32" width=".9" height="1.2"/></g>
    <g fill="#ebf0ff" opacity=".7"><circle cx="64" cy="12" r=".35"/><circle cx="70.6" cy="14.4" r=".3"/><circle cx="66.4" cy="19" r=".4"/><circle cx="72.2" cy="22" r=".3"/><circle cx="63.4" cy="25" r=".3"/><circle cx="69" cy="27.4" r=".35"/></g>
    <path d="M68 9v27M62 15.75h12M62 22.5h12M62 29.25h12" stroke="#1a0d08" stroke-width=".7"/><rect x="62" y="9" width="12" height="27" fill="none" stroke="#140a06" stroke-width="1"/>
    <rect x="60.8" y="36" width="14.4" height="1.3" fill="#3a2214"/>
    <path d="M56.6 6h6.2v2.6q-.6 10-3.4 15.4q2.4 5 3.8 22H56.6z" fill="url(#P-d)"/><path d="M73.2 6H81v40h-7.6q1.4-17 3.8-22q-2.8-5.4-4-15.4z" fill="url(#P-d)"/>
    <path d="M59.4 24c1.4-.2 2.6.2 3.6 1M76.6 24c-1.4-.2-2.6.2-3.6 1" fill="none" stroke="#8a6c3c" stroke-width=".55"/>
    <path d="M55.6 3.4H81v3.4q-4.2 2.6-8.4 0q-4.2 2.6-8.4 0q-4.2 2.6-8.6 0z" fill="#4a0b12" stroke="#dcaa5a" stroke-opacity=".2" stroke-width=".4"/>
    <rect width="80" height="60" fill="url(#P-room)"/><rect width="80" height="20" fill="url(#P-top)"/>
    <ellipse cx="37" cy="50" rx="15" ry="2.6" fill="#ffc070" opacity=".2" filter="url(#P-bb)"/>
    ${fir({ cx: 37, top: 13, h: 35 })}`,
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

/* ---------------- trees (60×72), from the lab ---------------- */

const tierPaths = (cx: number, top: number, h: number, fill: string, extra = ''): string =>
  [
    [top, top + h * 0.4, h * 0.21],
    [top + h * 0.2, top + h * 0.67, h * 0.32],
    [top + h * 0.42, top + h * 0.94, h * 0.43],
  ]
    .map(
      ([t, b, w]) =>
        `<path d="M${cx} ${t}L${cx + w} ${b}Q${cx + w * 0.5} ${b + 2.4} ${cx} ${b - 0.6}Q${cx - w * 0.5} ${b + 2.4} ${cx - w} ${b}Z" fill="${fill}" ${extra}/>`,
    )
    .join('');

const needles = (cx: number, top: number, h: number, color: string, op: number): string => {
  let out = '';
  let s = 17;
  const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 70; i++) {
    const f = 0.12 + r() * 0.85;
    const y = top + h * f;
    const half = h * 0.43 * f;
    const x = cx + (r() * 2 - 1) * half * 0.9;
    const dx = (x < cx ? -1 : 1) * (1 + r() * 1.4);
    out += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${dx.toFixed(1)} 1.6" />`;
  }
  return `<g stroke="${color}" stroke-width=".55" stroke-linecap="round" opacity="${op}">${out}</g>`;
};

const treeBulbs = (cx: number, top: number, h: number, colors: readonly string[]): string => {
  const pts: [number, number][] = [];
  [0.3, 0.48, 0.64, 0.8, 0.92].forEach((f, ri) => {
    const half = h * 0.43 * f * 0.8;
    const k = ri + 1;
    for (let j = 0; j < k; j++) pts.push([k === 1 ? cx + 2 : cx - half + (j / (k - 1)) * half * 2, top + h * f]);
  });
  return bulbs(pts, colors, 1.7);
};

const STAR = (cx: number, y: number): string =>
  `<g filter="url(#P-bb)"><circle cx="${cx}" cy="${y}" r="4.5" fill="#ffcc70" opacity=".8"/></g><path d="M${cx} ${y - 4.4}L${cx + 1.2} ${y - 1.2}L${cx + 4.4} ${y}L${cx + 1.2} ${y + 1.2}L${cx} ${y + 4.4}L${cx - 1.2} ${y + 1.2}L${cx - 4.4} ${y}L${cx - 1.2} ${y - 1.2}Z" fill="#fff0c4"/>`;

export const TREE_ART: Record<TreeKind, string> = {
  fir: svg(
    '0 0 60 72',
    `<defs><linearGradient id="P-t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a8a58"/><stop offset=".5" stop-color="#17502f"/><stop offset="1" stop-color="#072112"/></linearGradient></defs>
    <rect x="27.6" y="60" width="4.8" height="8" fill="#4a2814"/>
    ${tierPaths(30, 8, 56, 'url(#P-t)')}${needles(30, 8, 56, '#6fc08a', 0.45)}${treeBulbs(30, 8, 56, WARM)}${STAR(30, 8)}`,
  ),
  tinsel: svg(
    '0 0 60 72',
    `<defs><linearGradient id="P-t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7d8794"/><stop offset=".35" stop-color="#f4f7fa"/><stop offset=".55" stop-color="#c3ccd6"/><stop offset="1" stop-color="#5b6470"/></linearGradient>
    <clipPath id="P-c">${tierPaths(30, 8, 56, '#000')}</clipPath></defs>
    <rect x="29" y="60" width="2" height="8" fill="#b9c2cc"/><path d="M22 68h16" stroke="#8d96a2" stroke-width="2" stroke-linecap="round"/>
    ${tierPaths(30, 8, 56, 'url(#P-t)')}
    <g clip-path="url(#P-c)">
    <g stroke="#fff" stroke-width=".5" opacity=".75">${Array.from({ length: 26 }, (_, i) => `<path d="M${30 - 26 + ((i * 7) % 52)} ${12 + i * 2}l${i % 2 ? 4 : -4} 2"/>`).join('')}</g></g>
    <g fill="#fff">${[
      [24, 30],
      [36, 40],
      [27, 52],
      [40, 56],
      [33, 22],
    ]
      .map(([x, y]) => `<path d="M${x} ${y - 2.6}l.5 2.1 2.1.5-2.1.5-.5 2.1-.5-2.1-2.1-.5 2.1-.5z"/>`)
      .join('')}</g>${STAR(30, 8)}`,
  ),
  flocked: svg(
    '0 0 60 72',
    `<defs><linearGradient id="P-t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a8a68"/><stop offset=".5" stop-color="#245a40"/><stop offset="1" stop-color="#0d2a1c"/></linearGradient>
    <linearGradient id="P-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6e4ec"/></linearGradient></defs>
    <rect x="27.6" y="60" width="4.8" height="8" fill="#4a2814"/>
    ${tierPaths(30, 8, 56, 'url(#P-t)')}
    ${[
      [8, 30.4, 11.8],
      [19.2, 45.5, 17.9],
      [31.5, 60.6, 24],
    ]
      .map(
        ([t, b, w]) =>
          `<path d="M30 ${t}L${30 + w * 0.42} ${t + (b - t) * 0.42}Q30 ${t + (b - t) * 0.5} ${30 - w * 0.42} ${t + (b - t) * 0.42}Z" fill="url(#P-snow)" opacity=".92"/><path d="M${30 - w} ${b}Q${30 - w * 0.5} ${b - 3.6} 30 ${b - 1.6}Q${30 + w * 0.5} ${b - 3.6} ${30 + w} ${b}Q${30 + w * 0.5} ${b + 1.6} 30 ${b - 0.2}Q${30 - w * 0.5} ${b + 1.6} ${30 - w} ${b}Z" fill="url(#P-snow)"/>`,
      )
      .join('')}
    <g fill="#fff">${Array.from({ length: 30 }, (_, i) => `<circle cx="${(30 + Math.sin(i * 2.3) * (4 + (i % 9) * 2.4)).toFixed(1)}" cy="${(16 + ((i * 13) % 44)).toFixed(1)}" r="${(0.35 + (i % 3) * 0.2).toFixed(2)}" opacity=".8"/>`).join('')}</g>
    ${treeBulbs(30, 8, 56, ['#ffd27a', '#ff6a5c', '#ffd27a', '#fff1d6'])}${STAR(30, 8)}`,
  ),
  feather: svg(
    '0 0 60 72',
    `<defs><linearGradient id="P-base" x1="0" x2="1"><stop offset="0" stop-color="#bfb3a0"/><stop offset=".4" stop-color="#fffaf0"/><stop offset="1" stop-color="#9c8f7c"/></linearGradient></defs>
    <path d="M30 9V63" stroke="#5a3a1c" stroke-width="1.6"/>
    ${[
      [17, 7],
      [26, 11],
      [35, 15],
      [44, 19],
      [53, 23],
    ]
      .map(([y, w]) => {
        let n = '';
        for (const side of [-1, 1]) {
          const x2 = 30 + side * w;
          n += `<path d="M30 ${y}Q${30 + side * w * 0.5} ${y - 2} ${x2} ${y + 1}" fill="none" stroke="#2a6a3e" stroke-width="1.1"/>`;
          for (let k = 1; k <= Math.floor(w / 1.6); k++) {
            const px = 30 + side * k * 1.6;
            const py = y - 1.2 * Math.sin((k / (w / 1.6)) * Math.PI) + (k / (w / 1.6)) * 1;
            n += `<path d="M${px.toFixed(1)} ${py.toFixed(1)}l${side * 0.8} -1.8M${px.toFixed(1)} ${py.toFixed(1)}l${side * 0.8} 1.6" stroke="#3f8a54" stroke-width=".55"/>`;
          }
          n += `<circle cx="${x2}" cy="${y + 1}" r="1.5" fill="#d42a2e"/><circle cx="${x2 - 0.5}" cy="${y + 0.5}" r=".5" fill="#ffb0a0"/>`;
        }
        return n;
      })
      .join('')}
    <g filter="url(#P-b)">${[
      [30 - 7, 13],
      [30 + 11, 22],
      [30 - 15, 31],
      [30 + 19, 40],
      [30 - 19, 49],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#ffc46a"/>`)
      .join('')}</g>
    ${[
      [30 - 7, 13],
      [30 + 11, 22],
      [30 - 15, 31],
      [30 + 19, 40],
      [30 - 19, 49],
    ]
      .map(
        ([x, y]) =>
          `<rect x="${x - 0.8}" y="${y + 1}" width="1.6" height="3.6" fill="#fff6e6"/><path d="M${x} ${y - 1.6}q1 1.6 0 2.6q-1-1 0-2.6z" fill="#fff3c0"/>`,
      )
      .join('')}
    <path d="M22 70h16l-2.5-7h-11z" fill="url(#P-base)"/>${STAR(30, 8)}`,
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
  // Neon at full strength: a wider, brighter bloom (twice over) and a wider tube.
  neonbright: svg(
    '0 0 84 44',
    `<g filter="url(#P-bb)"><path d="M4 12Q42 40 80 12" fill="none" stroke="#ff3fa8" stroke-width="10"/><path d="M4 12Q42 40 80 12" fill="none" stroke="#ff5cb8" stroke-width="5"/></g>
    <path d="M4 12Q42 40 80 12" fill="none" stroke="#ff8ad0" stroke-width="3.6"/><path d="M4 12Q42 40 80 12" fill="none" stroke="#fff4fa" stroke-width="1.6"/>`,
  ),
};

/* ---------------- strands (84×44), from the lab ---------------- */

/** What the end tiles' bulbs become: the game's glass bulbs on their wire, or a strand with its own. */
export const STRAND_ART: Record<StrandKind, string> = {
  bulbs: svg(
    '0 0 84 44',
    `${WIRE('#163a24', 1)}${along(5, 0.1, 0.9)
      .map(([x, y], i) => {
        const c = ['#ffcf7a', '#ff6a5c', '#7fd0ff', '#8cf0a8', '#ffb0e0'][i];
        return `<g filter="url(#P-b)"><circle cx="${x.toFixed(1)}" cy="${(y + 6).toFixed(1)}" r="5" fill="${c}" opacity=".75"/></g>
        <rect x="${(x - 1.4).toFixed(1)}" y="${(y - 0.5).toFixed(1)}" width="2.8" height="2.8" rx=".5" fill="#2a3a2a"/>
        <circle cx="${x.toFixed(1)}" cy="${(y + 6).toFixed(1)}" r="3.4" fill="${c}"/><circle cx="${(x - 0.9).toFixed(1)}" cy="${(y + 5).toFixed(1)}" r="1.3" fill="#fff" opacity=".85"/>`;
      })
      .join('')}`,
  ),
  bubble: svg(
    '0 0 84 44',
    `${WIRE('#163a24', 1)}${along(4, 0.14, 0.86)
      .map(([x, y], i) => {
        const c = ['#ff5a5a', '#4ab8ff', '#ffc24a', '#5ad87a'][i];
        return `<g filter="url(#P-b)"><rect x="${x - 2.2}" y="${y - 15}" width="4.4" height="13" rx="2.2" fill="${c}" opacity=".7"/></g>
        <rect x="${x - 1.5}" y="${y - 14.5}" width="3" height="12" rx="1.5" fill="${c}" opacity=".85"/><rect x="${x - 0.8}" y="${y - 13.6}" width=".7" height="10" rx=".35" fill="#fff" opacity=".7"/>
        <circle cx="${x}" cy="${y - 5}" r=".55" fill="#fff"/><circle cx="${x + 0.3}" cy="${y - 8}" r=".45" fill="#fff"/><circle cx="${x - 0.2}" cy="${y - 11}" r=".4" fill="#fff"/>
        <path d="M${x - 2.6} ${y + 2.5}L${x + 2.6} ${y + 2.5}L${x + 1.7} ${y - 2.5}L${x - 1.7} ${y - 2.5}Z" fill="${['#c2303a', '#2a6ad0', '#d09030', '#2a9a50'][i]}"/>`;
      })
      .join('')}`,
  ),
  candle: svg(
    '0 0 84 44',
    `${WIRE('#2a5a3a', 1.6)}${along(4, 0.12, 0.88)
      .map(
        ([x, y]) => `<path d="M${x - 2.2} ${y}h4.4" stroke="#c9a45a" stroke-width="1.6"/>
        <rect x="${x - 1.6}" y="${y - 12}" width="3.2" height="12" rx=".6" fill="#fbf3e2"/><rect x="${x - 1.6}" y="${y - 12}" width="1" height="12" fill="#fff" opacity=".8"/><rect x="${x + 0.6}" y="${y - 12}" width="1" height="12" fill="#d9ccb3"/>
        <g filter="url(#P-bb)"><circle cx="${x}" cy="${y - 15}" r="3.6" fill="#ffb84a" opacity=".85"/></g>
        <path d="M${x} ${y - 19.5}q2 3.2 0 5q-2-1.8 0-5z" fill="#ffd27a"/><path d="M${x} ${y - 17}q.8 1.4 0 2.2q-.8-.8 0-2.2z" fill="#fffbe8"/>`,
      )
      .join('')}`,
  ),
  c9: svg(
    '0 0 84 44',
    `${WIRE('#163a24', 1.3)}${along(5, 0.1, 0.9)
      .map(([x, y], i) => {
        const c = ['#ff4a4a', '#ffb43a', '#3aa0ff', '#3ad07a', '#ff7ac8'][i];
        return `<g filter="url(#P-bb)"><ellipse cx="${x}" cy="${y + 6}" rx="4.4" ry="5.6" fill="${c}" opacity=".85"/></g>
        <rect x="${x - 1.5}" y="${y - 0.5}" width="3" height="2.6" fill="#2a4a2a"/>
        <path d="M${x - 1.8} ${y + 2}C${x - 3.8} ${y + 5} ${x - 3} ${y + 10.5} ${x} ${y + 11}C${x + 3} ${y + 10.5} ${x + 3.8} ${y + 5} ${x + 1.8} ${y + 2}Z" fill="${c}"/>
        <path d="M${x - 1} ${y + 3}C${x - 2.2} ${y + 5} ${x - 1.8} ${y + 8} ${x - 0.6} ${y + 9}" fill="none" stroke="#fff" stroke-width=".8" opacity=".75"/>`;
      })
      .join('')}`,
  ),
};

/* ---------------- toppers (56×56) ---------------- */

/** The star in a halo of `glow`, its points shaded from `hi` through `mid` to `lo`, with a `core` at the heart. */
const star = (glow: string, hi: string, mid: string, lo: string, core: string): string =>
  svg(
    '0 0 56 56',
    `<defs><radialGradient id="P-g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${glow}" stop-opacity=".75"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="P-s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>
    <circle cx="28" cy="28" r="22" fill="url(#P-g)"/>
    <path d="M28 4L30.2 25.8 52 28 30.2 30.2 28 52 25.8 30.2 4 28 25.8 25.8Z" fill="url(#P-s)"/>
    <path d="M28 14L29.4 26.6 42 28 29.4 29.4 28 42 26.6 29.4 14 28 26.6 26.6Z" transform="rotate(45 28 28)" fill="url(#P-s)" opacity=".9"/>
    <circle cx="28" cy="28" r="2.4" fill="${core}"/>`,
  );

export const TOPPER_ART: Record<TopperKind, string> = {
  star: star('#ffd27a', '#fff4cf', '#f0c060', '#a8701e', '#fffbe8'),
  // The star recoloured (src/render/topper-art.ts STAR_TINTS): cool silver, and a deeper, richer gold.
  silverstar: star('#b4cbe8', '#ffffff', '#c9d4e2', '#6f7c8c', '#f6f9ff'),
  goldstar: star('#ffb92e', '#fff0b0', '#ffbf2e', '#9a5a0c', '#fff4c8'),
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

/** A set that wraps the game's boxes in its own papers: the three boxes in the papers that stand for the game's (0, 1, 3). */
const papered = (set: PaperSet): string => {
  const p = SET_PAPERS[set];
  return gifts([
    { x: 6, w: 20, h: 16, paper: p[0].base, ribbon: p[0].ribbon },
    { x: 24, w: 15, h: 22, paper: p[1].base, ribbon: p[1].ribbon },
    { x: 38, w: 20, h: 13, paper: p[3].base, ribbon: p[3].ribbon },
  ]);
};

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
  silver: papered('silver'),
  tartan: papered('tartan'),
  starry: papered('starry'),
  candystripe: papered('candystripe'),
  goldfoil: papered('goldfoil'),
};

/* ---------------- garland (84×44) ---------------- */

/**
 * A swag of six C9 bulbs. Each bulb's colour is its group's `--c` (decorate.css paints `.deco-garl-b` in it): the drawer
 * sets them from the set, or, for the game's, from the bulbs on the tree. One per swatch, each with its own filter id.
 */
export function garlandArt(): string {
  const bulbs = Array.from({ length: 6 }, (_, i) => {
    const [x, y] = quad(0.08 + (0.84 * i) / 5, 4, 8, 42, 30, 80, 8);
    // Lit like the stage's garland: a halo, the glass, a hot white core and a specular.
    return `<g class="deco-garl-g"><g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(1.25)">
      <circle cy="7" r="6" class="deco-garl-b" opacity=".7" filter="url(#P-b)"/>
      <rect x="-1.6" y="-.5" width="3.2" height="3" rx=".6" fill="#163a25"/>
      <path d="M-1.8 2.4C-3.6 3.6-3.2 7.6-.8 10.6Q0 11.4.8 10.6C3.2 7.6 3.6 3.6 1.8 2.4Z" class="deco-garl-b"/>
      <ellipse cy="6" rx="1.2" ry="2" fill="#fff" opacity=".55" filter="url(#P-b)"/>
      <ellipse cx="-.9" cy="5" rx=".45" ry="1.6" fill="#fff" opacity=".75"/></g></g>`;
  });
  return svg('0 0 84 44', `<path d="M4 8Q42 30 80 8" fill="none" stroke="#0e2416" stroke-width="1.2"/>${bulbs.join('')}`);
}

/* ---------------- results tag (56×44) ---------------- */

/** Each tag style's paper (top to foot) and ribbon, as tag-styles.css sets them (tests/unit/ui/tag-styles.test.ts). */
const TAGS: Record<TagStyle, readonly [string, string, string]> = {
  plain: ['#f9efdc', '#efdcbc', '#c49440'],
  silver: ['#f7f8fa', '#e1e6ec', '#8d99a8'],
  goldfoil: ['#fcf3d6', '#f0dfae', '#b8862e'],
  velvet: ['#fbf0f0', '#f0dcdd', '#7a0f1e'],
  tartan: ['#f7f1e4', '#ede2cc', '#9e1b26'],
  holly: ['#f9f5e9', '#ece4cc', '#1f5a34'],
  plaid: ['#f8f2e9', '#eee3d4', '#b3202c'],
  ember: ['#fdf3e8', '#f3e0ca', '#c4501c'],
  frost: ['#f5f9fc', '#e1eaf2', '#6f9cc2'],
  gingerbread: ['#faefdf', '#f0dcbf', '#8a5a2e'],
  snowflake: ['#f7fafc', '#e5edf3', '#3f6f9a'],
  kraft: ['#f3e8d2', '#e8d6b6', '#8a6a42'],
  candystripe: ['#fcf9f6', '#f2e9e2', '#c8202e'],
  starry: ['#f4f5fa', '#e2e5f1', '#1f2a5a'],
};

/** A small tag: its paper, the ribbon through the eyelet (the plain tag has a gold string), and two lines of ink. */
const tag = ([hi, lo, ribbon]: readonly [string, string, string]): string =>
  svg(
    '0 0 56 44',
    `<defs><linearGradient id="P-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>
    <path d="M17 6h22l6 5v28H11V11z" fill="#000" opacity=".35" transform="translate(0 1.5)" filter="url(#P-b)"/>
    <path d="M17 6h22l6 5v28H11V11z" fill="url(#P-p)"/>
    <path d="M28 0v12" stroke="${ribbon}" stroke-width="3"/>
    <circle cx="28" cy="12" r="1.9" fill="#3a1a0c" stroke="#e2b560" stroke-width=".8"/>
    <path d="M20 22h16M23 28h10" stroke="#7d1420" stroke-width="1.6" stroke-linecap="round" opacity=".75"/>`,
  );

export const TAG_ART = Object.fromEntries(Object.entries(TAGS).map(([k, v]) => [k, tag(v)])) as Record<TagStyle, string>;

/** The drawer's gold bow, over its ribbon band, with its own gradient ids. */

/* ---------------- the cursor (56×44) ---------------- */

/** The pointer: the system's arrow, or the spark's ember with a few sparkles. */
export const CURSOR_ART: Record<CursorKind, string> = {
  plain: svg(
    '0 0 56 44',
    `<path d="M22 8v24l6-6 4.4 9.4 3.6-1.7-4.4-9.3H40z" fill="#000" opacity=".35" transform="translate(1 1.5)" filter="url(#P-b)"/>
    <path d="M22 8v24l6-6 4.4 9.4 3.6-1.7-4.4-9.3H40z" fill="#f6efe2" stroke="#2a1c10" stroke-width="1.2" stroke-linejoin="round"/>`,
  ),
  spark: svg(
    '0 0 56 44',
    `<defs><radialGradient id="P-e" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffecbe" stop-opacity=".9"/><stop offset=".3" stop-color="#ffb050" stop-opacity=".55"/><stop offset="1" stop-color="#ff7828" stop-opacity="0"/></radialGradient></defs>
    <circle cx="28" cy="22" r="16" fill="url(#P-e)"/>
    <g fill="#ffd27a">${[
      [14, 30, 1.1],
      [40, 12, 0.9],
      [43, 30, 1.3],
      [18, 13, 0.8],
    ]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" opacity=".85"/>`)
      .join('')}</g>
    <path d="M38 33l.7 2.4 2.4.7-2.4.7-.7 2.4-.7-2.4-2.4-.7 2.4-.7z" fill="#fff3c8"/>
    <path d="M12 21l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6z" fill="#fff3c8"/>
    <circle cx="28" cy="22" r="3.6" fill="#fff"/><circle cx="28" cy="22" r="5.2" fill="#fff2c8" opacity=".5" filter="url(#P-b)"/>`,
  ),
};
