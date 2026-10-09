import { describe, expect, it } from 'vitest';
import { Board } from '../../../src/core/board';
import { degree } from '../../../src/core/dirs';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { faceBulbTile, faceGarlandIndex, faceGiftIndex, solutionHash } from '../../../src/render/faces';
import { garlandGeometry } from '../../../src/render/garland';
import { computeLayout } from '../../../src/render/layout';
import { placePresents } from '../../../src/render/presents';

const trees = Array.from({ length: 40 }, (_, k) => Board.random(GRID, mulberry32(k + 1)));

describe('faceBulbTile', () => {
  it("is one of the tree's bulbs, the same every time for the same tree", () => {
    for (const b of trees) {
      const t = faceBulbTile(b.solution, GRID.ids);
      expect(degree(b.solution[t])).toBe(1);
      expect(faceBulbTile([...b.solution], [...GRID.ids])).toBe(t);
    }
  });
  it('spreads over the bulbs from tree to tree', () => {
    expect(new Set(trees.map((b) => faceBulbTile(b.solution, GRID.ids))).size).toBeGreaterThanOrEqual(15);
  });
  it('hashes with FNV-1a over the low four bits of each tile', () => {
    expect(solutionHash([])).toBe(0x811c9dc5);
    expect(solutionHash([16 + 3])).toBe(solutionHash([3]));
    expect(faceBulbTile([], [])).toBe(-1);
  });
});

describe('faceGiftIndex', () => {
  it('picks the gift with the largest front face, on phones and desktop', () => {
    for (const [w, h] of [[390, 844], [1440, 900]] as const) {
      const gifts = placePresents(computeLayout(w, h, 2), GRID);
      const k = faceGiftIndex(gifts);
      expect(gifts[k].w * gifts[k].h).toBe(Math.max(...gifts.map((g) => g.w * g.h)));
    }
  });
  it('the first on a tie; -1 with no gifts', () => {
    expect(faceGiftIndex([{ w: 2, h: 1 }, { w: 1, h: 2 }])).toBe(0);
    expect(faceGiftIndex([])).toBe(-1);
  });
});

describe('faceGarlandIndex', () => {
  it("is the right swag's bulb nearest the swag's middle, hanging nearly straight down", () => {
    for (const [w, chrome] of [[390, 46], [1440, 58]] as const) {
      const geo = garlandGeometry(w, 40, chrome);
      const k = faceGarlandIndex(geo);
      const [a, b] = geo.swags[1];
      const mid = (a + b) / 2;
      expect(geo.bulbs[k].x).toBeGreaterThanOrEqual(a);
      expect(Math.abs(geo.bulbs[k].angle)).toBeLessThan(0.2);
      for (const bulb of geo.bulbs) if (bulb.x >= a) expect(Math.abs(bulb.x - mid)).toBeGreaterThanOrEqual(Math.abs(geo.bulbs[k].x - mid));
    }
  });
});
