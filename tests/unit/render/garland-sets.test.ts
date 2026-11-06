import { expect, it } from 'vitest';
import { ITEMS } from '../../../src/core/catalogue';
import { Garland } from '../../../src/render/garland';
import { GARLAND_COLOURS, GARLAND_SETS } from '../../../src/render/garland-sets';
import { SCENES } from '../../../src/render/scenes';

it("every garland set the catalogue names has the garland's colour count, in #rrggbb", () => {
  const named = ITEMS.filter((i) => i.slot === 'garland').map((i) => i.value);
  expect(named).toHaveLength(10);
  expect(GARLAND_COLOURS).toBe(SCENES.fireside.bulbs.length);
  for (const id of named) {
    const set = GARLAND_SETS[id as keyof typeof GARLAND_SETS];
    expect(set, id).toHaveLength(GARLAND_COLOURS);
    for (const c of set) expect(c, id).toMatch(/^#[0-9a-f]{6}$/);
  }
});

/** The colours a frame's lit glass is painted in: each gradient stop, as given. */
function litColours(g: Garland): string[] {
  const out: string[] = [];
  const gradient = { addColorStop: (_: number, c: string) => out.push(c) };
  const c = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => gradient : () => undefined),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  g.drawLit(c, SCENES.midnight, 1000, null, true);
  return out;
}

it("the garland's bulbs take the set's colours, and the game's keeps the scene's", () => {
  const g = new Garland();
  g.layout(1440, 40, 58);
  g.update(1, 0);
  const game = litColours(g);
  for (const c of SCENES.midnight.bulbs) expect(game).toContain(c);
  g.setSet('gold');
  const gold = litColours(g);
  for (const c of GARLAND_SETS.gold) expect(gold).toContain(c);
  for (const c of SCENES.midnight.bulbs) expect(gold).not.toContain(c);
  g.setSet('game');
  expect(litColours(g)).toEqual(game);
});
