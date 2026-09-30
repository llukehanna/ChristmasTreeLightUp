export type SceneId = 'midnight' | 'fireside' | 'frost';
export type Rgb = readonly [number, number, number];

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
  /**
   * A dark casing drawn just outside every unlit wire, LED run and tube, so the pale line reads as a wire and not
   * as snow or needle highlights ('' = none).
   */
  unlitEdge: string;
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
    wireOff: 'rgba(185,205,235,.40)', wireOffW: 0.06, unlitEdge: '', bulbFrost: 0, core: '#fff5de', glow: '#ffbe6a',
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
    wireOff: 'rgba(235,195,145,.38)', wireOffW: 0.06, unlitEdge: '', bulbFrost: 0, core: '#fff2de', glow: '#ff9240',
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
    wireOff: 'rgba(200,216,224,.8)', wireOffW: 0.07, unlitEdge: 'rgba(4,16,12,.6)', bulbFrost: 1, core: '#fffaf0', glow: '#ffb65e',
    copperOff: 'rgba(222,184,140,.85)', copperOn: 'rgba(245,200,140,.95)', ledOff: 'rgba(238,236,228,.68)',
    glass: 'rgba(225,238,246,.26)', glassHi: 'rgba(255,255,255,.62)', neon: '#ffa24a', neonMid: '#ffcf8a',
    socket: '#1b2a24', bulbs: ['#ff6b6b', '#ffcb5c', '#6fc2ff', '#7fe0a0', '#ffa6d4', '#fff3dc'],
    starOff: 'rgba(255,255,255,.35)', starEdge: 'rgba(21,38,31,.35)', hover: '255,225,170',
    snow: '150,172,188', snowAlpha: 0.7, bloom: 0.55, snowDust: true, reflect: false, embers: false,
  },
};

/** Auto scene by local time: Frost 07–16, Fireside 16–20, Midnight 20–07. */
export function sceneForHour(hour: number): SceneId {
  if (hour >= 7 && hour < 16) return 'frost';
  if (hour >= 16 && hour < 20) return 'fireside';
  return 'midnight';
}
