import { expect, it } from 'vitest';
import { hexRgb } from '../../../src/render/color';
import { AURORA, SCENES, sceneFor, sceneForHour } from '../../../src/render/scenes';

it('picks the scene by local hour', () => {
  expect(sceneForHour(7)).toBe('frost');
  expect(sceneForHour(15)).toBe('frost');
  expect(sceneForHour(16)).toBe('fireside');
  expect(sceneForHour(19)).toBe('fireside');
  expect(sceneForHour(20)).toBe('midnight');
  expect(sceneForHour(3)).toBe('midnight');
});
it('lifts unlit wires on Frost per path style, and leaves the night scenes plain', () => {
  expect(SCENES.frost.unlit.filament.look).toBe('twotone');
  expect(SCENES.frost.unlit.fairy.look).toBe('glint');
  expect(SCENES.frost.unlit.neon.look).toBe('glint');
  for (const id of ['midnight', 'fireside'] as const)
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
  expect(Object.keys(SCENES)).toEqual(['midnight', 'fireside', 'frost']); // not a menu pick
});
