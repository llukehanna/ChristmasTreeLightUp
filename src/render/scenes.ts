import type { WireStyle } from './paths';

/** The menu's scenes. Secret mode's aurora (spec 2026-10-08 secret mode §2) is not one of them. */
export type SceneId = 'midnight' | 'fireside' | 'frost' | 'sash' | 'square' | 'parlour';
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
const everyStyle = (u: Unlit): Readonly<Record<WireStyle, Unlit>> => ({ filament: u, fairy: u, neon: u });

export interface Scene {
  id: SceneId | 'aurora' | 'home-alone';
  light: 'moon' | 'fire' | 'day' | 'aurora';
  sky: readonly [string, string, string];
  ground: readonly [string, string];
  needleA: Rgb;
  needleB: Rgb;
  trunk: string;
  /** Unlit palette and treatment per wire (Frost picks a different one per wire); read through paths.ts's unlitOf. */
  unlit: Readonly<Record<WireStyle, Unlit>>;
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
  /**
   * A dark room behind the tree, a tall arched window and snow falling outside it (src/render/sash.ts paints the room;
   * the snow is its own, so none falls in the room). The lab's town-square palette: cool, pale unlit wire that reads
   * on the dark wall.
   */
  sash: {
    id: 'sash', light: 'moon',
    sky: ['#04050a', '#0a0c14', '#0b0d14'], ground: ['#0c0d13', '#030305'],
    needleA: [15, 46, 40], needleB: [44, 102, 84], trunk: '#0c0d10',
    unlit: everyStyle({
      look: 'plain', wire: 'rgba(195,208,236,.42)', wireW: 0.06, copper: 'rgba(210,155,100,.5)', led: 'rgba(255,232,200,.36)',
      glass: 'rgba(210,222,255,.12)', glassHi: 'rgba(255,255,255,.34)',
    }),
    bulbFrost: 0, core: '#fff4dc', glow: '#ffb862', copperOn: 'rgba(236,178,108,.92)', neon: '#ff9548', neonMid: '#ffc07a',
    socket: '#6a5434', bulbs: ['#ff4f5e', '#ffc04e', '#58b0ff', '#5fdc90', '#ff96c8', '#fff0d0'],
    starOff: 'rgba(255,236,205,.05)', starEdge: 'rgba(255,236,205,.32)', hover: '255,212,150',
    snow: '235,240,255', snowAlpha: 0, bloom: 1, snowDust: false, reflect: true, embers: false,
  },
  /**
   * Blue hour on the town square (src/render/square.ts paints it): lit shopfronts, a skating rink that mirrors the
   * tree, light snow. The lab's palette as it is.
   */
  square: {
    id: 'square', light: 'moon',
    sky: ['#060a1c', '#141a3e', '#2c2a52'], ground: ['#2a3150', '#0b0e1c'],
    needleA: [15, 46, 40], needleB: [44, 102, 84], trunk: '#0c0d10',
    unlit: everyStyle({
      look: 'plain', wire: 'rgba(195,208,236,.42)', wireW: 0.06, copper: 'rgba(210,155,100,.5)', led: 'rgba(255,232,200,.36)',
      glass: 'rgba(210,222,255,.12)', glassHi: 'rgba(255,255,255,.34)',
    }),
    bulbFrost: 0, core: '#fff4dc', glow: '#ffb862', copperOn: 'rgba(236,178,108,.92)', neon: '#ff9548', neonMid: '#ffc07a',
    socket: '#6a5434', bulbs: ['#ff4f5e', '#ffc04e', '#58b0ff', '#5fdc90', '#ff96c8', '#fff0d0'],
    starOff: 'rgba(255,236,205,.05)', starEdge: 'rgba(255,236,205,.32)', hover: '255,212,150',
    snow: '235,240,255', snowAlpha: 0.42, bloom: 1, snowDust: false, reflect: true, embers: false,
  },
  /**
   * A Victorian parlour on Christmas Eve (src/render/parlour.ts paints it): candlelight and a coal fire low on the left,
   * so the game's firelight and embers belong to its hearth; deep wallpaper, velvet. The lab's palette as it is.
   */
  parlour: {
    id: 'parlour', light: 'fire',
    sky: ['#0a0405', '#150709', '#1d0b0b'], ground: ['#1c0e08', '#070302'],
    needleA: [15, 34, 20], needleB: [48, 80, 44], trunk: '#120a06',
    unlit: everyStyle({
      look: 'plain', wire: 'rgba(238,200,150,.38)', wireW: 0.06, copper: 'rgba(212,145,82,.5)', led: 'rgba(255,222,182,.34)',
      glass: 'rgba(255,220,190,.12)', glassHi: 'rgba(255,240,220,.34)',
    }),
    bulbFrost: 0, core: '#fff2da', glow: '#ff9a44', copperOn: 'rgba(242,172,100,.95)', neon: '#ff7a2e', neonMid: '#ffae6a',
    socket: '#3b2a17', bulbs: ['#ff4434', '#ffbf3e', '#4fcf78', '#fff0d2', '#ff8636', '#e2607a'],
    starOff: 'rgba(255,225,190,.05)', starEdge: 'rgba(255,225,190,.30)', hover: '255,190,130',
    snow: '255,236,210', snowAlpha: 0, bloom: 1, snowDust: false, reflect: true, embers: true,
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

/**
 * Home Alone mode's world (spec 2026-10-14 §2): the McCallister living room on Christmas Eve, 1990. Deep
 * Christmas-card reds, forest greens, warm gold light, a warm-wood tree tint ('fire' light: firelight, warm presents).
 * Its backdrop (wallpaper, the paned window with night snow outside, the floor toys) is home-alone-room.ts's; no
 * snow falls in the room.
 */
export const HOME_ALONE: Scene = {
  id: 'home-alone', light: 'fire',
  sky: ['#1a0507', '#2a0a0d', '#3a1014'], ground: ['#2b160b', '#0e0704'],
  needleA: [18, 40, 22], needleB: [54, 92, 46], trunk: '#1c0f07',
  unlit: everyStyle({
    look: 'plain', wire: 'rgba(240,205,160,.38)', wireW: 0.06, copper: 'rgba(214,150,84,.5)', led: 'rgba(255,226,186,.34)',
    glass: 'rgba(255,222,190,.12)', glassHi: 'rgba(255,242,222,.34)',
  }),
  bulbFrost: 0, core: '#fff4dc', glow: '#ffb347', copperOn: 'rgba(242,182,96,.95)', neon: '#ff4a3a', neonMid: '#ffa070',
  // Big old C9 bulbs: red, green, gold, blue, orange, warm white.
  socket: '#4a2c12', bulbs: ['#e3242b', '#2e9e4f', '#ffc43d', '#3a6fd8', '#ff7a2f', '#fff1d0'],
  starOff: 'rgba(255,226,180,.05)', starEdge: 'rgba(255,226,180,.32)', hover: '255,200,120',
  snow: '255,250,240', snowAlpha: 0, bloom: 1, snowDust: false, reflect: true, embers: false,
};

/** The scene on screen: the aurora while secret mode is on, the house in Home Alone mode, else the look's. */
export const sceneFor = (id: SceneId, secret: boolean, homeAlone = false): Scene => (secret ? AURORA : homeAlone ? HOME_ALONE : SCENES[id]);
