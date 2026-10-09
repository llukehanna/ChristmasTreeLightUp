import type { PathStyle } from './paths';

/** The menu's scenes. Secret mode's aurora (spec 2026-10-08 secret mode §2) is not one of them. */
export type SceneId = 'midnight' | 'fireside' | 'frost';
export type Rgb = readonly [number, number, number];

/**
 * How unlit wires, LEDs, tubes and bulbs are lifted off the tree (spec §4.3, §4.4):
 * - `plain`: no treatment (night scenes, where the pale line reads on its own).
 * - `glint`: a paler, heavier frosted-silver wire or tube with a soft snow-glint halo and no dark edge (Frost fairy, neon).
 * - `twotone`: a light core inside a wider, translucent silver body that blends into the tree (Frost filament).
 */
export type UnlitLook = 'plain' | 'glint' | 'twotone';

/** The unlit palette for one path style. Each style reads only its own fields. */
export interface Unlit {
  look: UnlitLook;
  /** Filament wire colour and width (tiles). */
  wire: string;
  wireW: number;
  /** Fairy lights: copper wire and LEDs. */
  copper: string;
  led: string;
  /** Neon: outer glass and specular line. */
  glass: string;
  glassHi: string;
}

/** The same unlit palette for every path style. */
const everyStyle = (u: Unlit): Readonly<Record<PathStyle, Unlit>> => ({ filament: u, fairy: u, neon: u });

export interface Scene {
  id: SceneId | 'aurora';
  light: 'moon' | 'fire' | 'day' | 'aurora';
  sky: readonly [string, string, string];
  ground: readonly [string, string];
  needleA: Rgb;
  needleB: Rgb;
  trunk: string;
  /** Unlit palette and treatment per path style (Frost picks a different one per style). */
  unlit: Readonly<Record<PathStyle, Unlit>>;
  /** 0 = dark coloured glass for unlit bulbs; above 0, lifts it toward pale frosted glass with a rim (daylight). */
  bulbFrost: number;
  core: string;
  glow: string;
  copperOn: string;
  neon: string;
  neonMid: string;
  socket: string;
  bulbs: readonly string[];
  starOff: string;
  starEdge: string;
  /** "r,g,b" for the hover light. */
  hover: string;
  /** "r,g,b" for snowflakes. */
  snow: string;
  snowAlpha: number;
  bloom: number;
  snowDust: boolean;
  reflect: boolean;
  embers: boolean;
}

export const SCENES: Readonly<Record<SceneId, Scene>> = {
  midnight: {
    id: 'midnight', light: 'moon',
    sky: ['#02040a', '#070c1f', '#101a38'], ground: ['#141e3a', '#070a14'],
    needleA: [16, 48, 42], needleB: [44, 104, 86], trunk: '#0b0d10',
    unlit: everyStyle({
      look: 'plain', wire: 'rgba(185,205,235,.40)', wireW: 0.06, copper: 'rgba(205,150,95,.5)', led: 'rgba(255,235,205,.36)',
      glass: 'rgba(210,225,255,.12)', glassHi: 'rgba(255,255,255,.34)',
    }),
    bulbFrost: 0, core: '#fff5de', glow: '#ffbe6a', copperOn: 'rgba(230,175,110,.9)', neon: '#ff9d4a', neonMid: '#ffc27a',
    socket: '#6f5a36', bulbs: ['#ff5a6a', '#ffc65a', '#5cb6ff', '#6ae59a', '#ff9cd0', '#fff0d2'],
    starOff: 'rgba(255,238,205,.05)', starEdge: 'rgba(255,238,205,.32)', hover: '255,215,150',
    snow: '255,255,255', snowAlpha: 0.55, bloom: 1, snowDust: false, reflect: false, embers: false,
  },
  fireside: {
    id: 'fireside', light: 'fire',
    sky: ['#0b0604', '#160d07', '#1f130a'], ground: ['#1a0f08', '#080403'],
    needleA: [16, 34, 18], needleB: [50, 80, 40], trunk: '#120a06',
    unlit: everyStyle({
      look: 'plain', wire: 'rgba(235,195,145,.38)', wireW: 0.06, copper: 'rgba(210,140,80,.5)', led: 'rgba(255,220,180,.34)',
      glass: 'rgba(255,220,190,.12)', glassHi: 'rgba(255,240,220,.34)',
    }),
    bulbFrost: 0, core: '#fff2de', glow: '#ff9240', copperOn: 'rgba(240,170,100,.95)', neon: '#ff7a2e', neonMid: '#ffae6a',
    socket: '#3b2a17', bulbs: ['#ff4b3a', '#5fd47a', '#ffb53a', '#4a8cff', '#ff8a3a', '#fff0d6'],
    starOff: 'rgba(255,225,190,.05)', starEdge: 'rgba(255,225,190,.30)', hover: '255,190,130',
    snow: '255,236,210', snowAlpha: 0, bloom: 1, snowDust: false, reflect: true, embers: true,
  },
  frost: {
    id: 'frost', light: 'day',
    sky: ['#dfe7ed', '#eef2f5', '#f7f9fa'], ground: ['#ffffff', '#e9eff3'],
    needleA: [14, 46, 36], needleB: [42, 100, 76], trunk: '#2a2019',
    bulbFrost: 1, core: '#fff3da', glow: '#ffb65e', copperOn: 'rgba(245,200,140,.95)', neon: '#ffa24a', neonMid: '#ffcf8a',
    // Daylight on a dark fir: filament is a two-tone wire; fairy lights and neon get a soft snow glint (Luke's picks).
    unlit: {
      filament: {
        look: 'twotone', wire: 'rgba(240,246,248,.95)', wireW: 0.04, copper: '', led: '', glass: '', glassHi: '',
      },
      fairy: {
        look: 'glint', wire: '', wireW: 0, copper: 'rgba(222,196,164,.78)', led: 'rgba(228,234,238,.6)', glass: '', glassHi: '',
      },
      neon: {
        look: 'glint', wire: '', wireW: 0, copper: '', led: '', glass: 'rgba(228,240,248,.26)', glassHi: 'rgba(255,255,255,.62)',
      },
    },
    socket: '#1b2a24', bulbs: ['#ff6b6b', '#ffcb5c', '#6fc2ff', '#7fe0a0', '#ffa6d4', '#fff3dc'],
    starOff: 'rgba(255,255,255,.35)', starEdge: 'rgba(21,38,31,.35)', hover: '255,225,170',
    snow: '150,172,188', snowAlpha: 0.7, bloom: 0.7, snowDust: true, reflect: false, embers: false,
  },
};

/** Secret mode's world (spec 2026-10-08 secret mode §2.1): deep navy to violet, ice-blue light, a cool fir. */
export const AURORA: Scene = {
  id: 'aurora', light: 'aurora',
  sky: ['#050a1f', '#140f3d', '#2b1a5e'], ground: ['#1a2350', '#0a0d24'],
  needleA: [12, 40, 52], needleB: [36, 92, 104], trunk: '#0a0c14',
  unlit: everyStyle({
    look: 'plain', wire: 'rgba(190,210,255,.40)', wireW: 0.06, copper: 'rgba(170,190,235,.5)', led: 'rgba(220,235,255,.36)',
    glass: 'rgba(200,215,255,.12)', glassHi: 'rgba(255,255,255,.34)',
  }),
  bulbFrost: 0, core: '#f2f8ff', glow: '#7fd8ff', copperOn: 'rgba(170,215,255,.9)', neon: '#8a7bff', neonMid: '#b6a8ff',
  // In hue order (green → orchid): a strong beat steps every lit bulb to its neighbour (§5.3).
  socket: '#3a4466', bulbs: ['#6dffa8', '#4fe6d6', '#7fd0ff', '#8fa2ff', '#b48cff', '#e08cff'],
  starOff: 'rgba(220,235,255,.05)', starEdge: 'rgba(220,235,255,.32)', hover: '170,220,255',
  snow: '235,245,255', snowAlpha: 0.6, bloom: 1, snowDust: false, reflect: false, embers: false,
};

/** The scene on screen: the aurora while secret mode is on, whatever the hour or the menu says. */
export const sceneFor = (id: SceneId, secret: boolean): Scene => (secret ? AURORA : SCENES[id]);

/** Auto scene by local time: Frost 07–16, Fireside 16–20, Midnight 20–07. */
export function sceneForHour(hour: number): SceneId {
  if (hour >= 7 && hour < 16) return 'frost';
  if (hour >= 16 && hour < 20) return 'fireside';
  return 'midnight';
}
