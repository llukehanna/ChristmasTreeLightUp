import { expect, it } from 'vitest';
import { hexRgb } from '../../../src/render/color';
import { AURORA, HOME_ALONE, SCENES, sceneFor } from '../../../src/render/scenes';

it('lifts unlit wires on Frost per path style, and leaves the night scenes plain', () => {
  expect(SCENES.frost.unlit.filament.look).toBe('twotone');
  expect(SCENES.frost.unlit.fairy.look).toBe('glint');
  expect(SCENES.frost.unlit.neon.look).toBe('glint');
  for (const id of ['midnight', 'fireside', 'sash'] as const)
    for (const u of Object.values(SCENES[id].unlit)) expect(u.look).toBe('plain');
});
it('gives every scene six bulb colours', () => {
  for (const s of Object.values(SCENES)) expect(s.bulbs).toHaveLength(6);
});

/** HSL hue in degrees. */
const hue = (hex: string): number => {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

it('the aurora: a night scene of its own, six cool bulbs in hue order, shown only in secret mode', () => {
  expect(AURORA).toMatchObject({
    id: 'aurora', light: 'aurora', sky: ['#050a1f', '#140f3d', '#2b1a5e'], ground: ['#1a2350', '#0a0d24'],
    needleA: [12, 40, 52], needleB: [36, 92, 104], trunk: '#0a0c14', bulbFrost: 0, core: '#f2f8ff', glow: '#7fd8ff',
    copperOn: 'rgba(170,215,255,.9)', neon: '#8a7bff', neonMid: '#b6a8ff', socket: '#3a4466',
    starOff: 'rgba(220,235,255,.05)', starEdge: 'rgba(220,235,255,.32)', hover: '170,220,255', snow: '235,245,255',
    snowAlpha: 0.6, bloom: 1, snowDust: false, reflect: false, embers: false,
  });
  for (const u of Object.values(AURORA.unlit)) expect(u.look).toBe('plain');
  expect(AURORA.bulbs).toEqual(['#6dffa8', '#4fe6d6', '#7fd0ff', '#8fa2ff', '#b48cff', '#e08cff']);
  const hues = AURORA.bulbs.map(hue);
  for (let k = 1; k < hues.length; k++) expect(hues[k]).toBeGreaterThan(hues[k - 1]);
  expect(sceneFor('frost', true)).toBe(AURORA);
  expect(sceneFor('frost', false)).toBe(SCENES.frost);
  expect(Object.keys(SCENES)).toEqual(['midnight', 'fireside', 'frost', 'sash']); // not a menu pick
});

it('Home Alone: a warm night room of its own, chosen over the hour, never over the head', () => {
  expect(HOME_ALONE).toMatchObject({ id: 'home-alone', light: 'fire', bulbFrost: 0, snowAlpha: 0, embers: false, reflect: true });
  expect(HOME_ALONE.bulbs).toHaveLength(6);
  for (const u of Object.values(HOME_ALONE.unlit)) expect(u.look).toBe('plain');
  // Deep Christmas-card reds on the wall, wood on the floor: red channel well above green and blue.
  for (const c of HOME_ALONE.sky) {
    const [r, g, b] = hexRgb(c);
    expect(r).toBeGreaterThan(2 * Math.max(g, b));
  }
  for (const id of ['midnight', 'fireside', 'frost'] as const) {
    expect(sceneFor(id, false, true)).toBe(HOME_ALONE);
    expect(sceneFor(id, true, true)).toBe(AURORA); // they never stack, but if asked, the head wins
    expect(sceneFor(id, false)).toBe(SCENES[id]);
  }
  expect(Object.keys(SCENES)).toEqual(['midnight', 'fireside', 'frost', 'sash']); // not a menu pick
});

it("the Sash: the lab's town-square palette in a dark room, its own snow behind the glass and none in the room", () => {
  expect(SCENES.sash).toMatchObject({
    id: 'sash', light: 'moon', sky: ['#04050a', '#0a0c14', '#0b0d14'], ground: ['#0c0d13', '#030305'],
    needleA: [15, 46, 40], needleB: [44, 102, 84], trunk: '#0c0d10', bulbFrost: 0, core: '#fff4dc', glow: '#ffb862',
    copperOn: 'rgba(236,178,108,.92)', neon: '#ff9548', neonMid: '#ffc07a', socket: '#6a5434',
    bulbs: ['#ff4f5e', '#ffc04e', '#58b0ff', '#5fdc90', '#ff96c8', '#fff0d0'],
    starOff: 'rgba(255,236,205,.05)', starEdge: 'rgba(255,236,205,.32)', hover: '255,212,150', snow: '235,240,255',
    snowAlpha: 0, bloom: 1, snowDust: false, reflect: true, embers: false,
  });
  for (const u of Object.values(SCENES.sash.unlit)) {
    expect(u).toEqual({
      look: 'plain', wire: 'rgba(195,208,236,.42)', wireW: 0.06, copper: 'rgba(210,155,100,.5)', led: 'rgba(255,232,200,.36)',
      glass: 'rgba(210,222,255,.12)', glassHi: 'rgba(255,255,255,.34)',
    });
  }
  expect(sceneFor('sash', false)).toBe(SCENES.sash);
  expect(sceneFor('sash', true)).toBe(AURORA);
});
