export type SceneId = 'midnight' | 'fireside' | 'frost';
export type Rgb = readonly [number, number, number];

/**
 * How unlit wires, LEDs, tubes and bulbs are lifted off a dark fir in daylight (spec §4.3, Frost):
 * - `plain`: no treatment (night scenes).
 * - `outline`: a thin dark casing around the pale wire and LEDs.
 * - `glint` (A): a paler, heavier frosted-silver wire with a soft snow-glint halo and no dark edge.
 * - `shadow` (B): a bright pale wire resting on a soft, offset shadow (a shadow, not an outline).
 * - `twotone` (C): a light core inside a wider, translucent silver body that blends into the tree.
 */
export type UnlitLook = 'plain' | 'outline' | 'glint' | 'shadow' | 'twotone';

/** Frost's unlit treatment. Options A, B and C are kept side by side until one is chosen. */
export const FROST_UNLIT: Exclude<UnlitLook, 'plain'> = 'shadow';

type UnlitPalette = Pick<Scene, 'unlitLook' | 'wireOff' | 'wireOffW' | 'copperOff' | 'ledOff' | 'glass' | 'glassHi'>;

/** Frost's unlit palette for each treatment. */
const FROST_LOOKS: Readonly<Record<Exclude<UnlitLook, 'plain'>, UnlitPalette>> = {
  outline: {
    unlitLook: 'outline', wireOff: 'rgba(200,216,224,.8)', wireOffW: 0.07, copperOff: 'rgba(222,184,140,.85)',
    ledOff: 'rgba(238,236,228,.68)', glass: 'rgba(225,238,246,.26)', glassHi: 'rgba(255,255,255,.62)',
  },
  glint: {
    unlitLook: 'glint', wireOff: 'rgba(222,233,240,.9)', wireOffW: 0.08, copperOff: 'rgba(230,200,162,.9)',
    ledOff: 'rgba(244,243,236,.72)', glass: 'rgba(228,240,248,.3)', glassHi: 'rgba(255,255,255,.7)',
  },
  shadow: {
    unlitLook: 'shadow', wireOff: 'rgba(228,237,242,.92)', wireOffW: 0.07, copperOff: 'rgba(234,204,164,.92)',
    ledOff: 'rgba(246,244,236,.78)', glass: 'rgba(228,240,248,.3)', glassHi: 'rgba(255,255,255,.7)',
  },
  twotone: {
    unlitLook: 'twotone', wireOff: 'rgba(240,246,248,.95)', wireOffW: 0.04, copperOff: 'rgba(240,212,176,.95)',
    ledOff: 'rgba(248,246,240,.8)', glass: 'rgba(200,220,228,.34)', glassHi: 'rgba(255,255,255,.75)',
  },
};

export interface Scene {
  id: SceneId;
  light: 'moon' | 'fire' | 'day';
  sky: readonly [string, string, string];
  ground: readonly [string, string];
  needleA: Rgb;
  needleB: Rgb;
  trunk: string;
  wireOff: string;
  /** Unlit filament width, in tiles. */
  wireOffW: number;
  /** Treatment that lifts unlit wires and bulbs off the tree (see UnlitLook). */
  unlitLook: UnlitLook;
  /** 0 = dark coloured glass for unlit bulbs; above 0, lifts it toward pale frosted glass with a rim (daylight). */
  bulbFrost: number;
  core: string;
  glow: string;
  copperOff: string;
  copperOn: string;
  ledOff: string;
  glass: string;
  glassHi: string;
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
    wireOff: 'rgba(185,205,235,.40)', wireOffW: 0.06, unlitLook: 'plain', bulbFrost: 0, core: '#fff5de', glow: '#ffbe6a',
    copperOff: 'rgba(205,150,95,.5)', copperOn: 'rgba(230,175,110,.9)', ledOff: 'rgba(255,235,205,.36)',
    glass: 'rgba(210,225,255,.12)', glassHi: 'rgba(255,255,255,.34)', neon: '#ff9d4a', neonMid: '#ffc27a',
    socket: '#6f5a36', bulbs: ['#ff5a6a', '#ffc65a', '#5cb6ff', '#6ae59a', '#ff9cd0', '#fff0d2'],
    starOff: 'rgba(255,238,205,.05)', starEdge: 'rgba(255,238,205,.32)', hover: '255,215,150',
    snow: '255,255,255', snowAlpha: 0.55, bloom: 1, snowDust: false, reflect: false, embers: false,
  },
  fireside: {
    id: 'fireside', light: 'fire',
    sky: ['#0b0604', '#160d07', '#1f130a'], ground: ['#1a0f08', '#080403'],
    needleA: [16, 34, 18], needleB: [50, 80, 40], trunk: '#120a06',
    wireOff: 'rgba(235,195,145,.38)', wireOffW: 0.06, unlitLook: 'plain', bulbFrost: 0, core: '#fff2de', glow: '#ff9240',
    copperOff: 'rgba(210,140,80,.5)', copperOn: 'rgba(240,170,100,.95)', ledOff: 'rgba(255,220,180,.34)',
    glass: 'rgba(255,220,190,.12)', glassHi: 'rgba(255,240,220,.34)', neon: '#ff7a2e', neonMid: '#ffae6a',
    socket: '#3b2a17', bulbs: ['#ff4b3a', '#5fd47a', '#ffb53a', '#4a8cff', '#ff8a3a', '#fff0d6'],
    starOff: 'rgba(255,225,190,.05)', starEdge: 'rgba(255,225,190,.30)', hover: '255,190,130',
    snow: '255,236,210', snowAlpha: 0, bloom: 1, snowDust: false, reflect: true, embers: true,
  },
  frost: {
    id: 'frost', light: 'day',
    sky: ['#dfe7ed', '#eef2f5', '#f7f9fa'], ground: ['#ffffff', '#e9eff3'],
    needleA: [14, 46, 36], needleB: [42, 100, 76], trunk: '#2a2019',
    bulbFrost: 1, core: '#fff3da', glow: '#ffb65e', copperOn: 'rgba(245,200,140,.95)', neon: '#ffa24a', neonMid: '#ffcf8a',
    ...FROST_LOOKS[FROST_UNLIT],
    socket: '#1b2a24', bulbs: ['#ff6b6b', '#ffcb5c', '#6fc2ff', '#7fe0a0', '#ffa6d4', '#fff3dc'],
    starOff: 'rgba(255,255,255,.35)', starEdge: 'rgba(21,38,31,.35)', hover: '255,225,170',
    snow: '150,172,188', snowAlpha: 0.7, bloom: 0.7, snowDust: true, reflect: false, embers: false,
  },
};

/** Auto scene by local time: Frost 07–16, Fireside 16–20, Midnight 20–07. */
export function sceneForHour(hour: number): SceneId {
  if (hour >= 7 && hour < 16) return 'frost';
  if (hour >= 16 && hour < 20) return 'fireside';
  return 'midnight';
}
