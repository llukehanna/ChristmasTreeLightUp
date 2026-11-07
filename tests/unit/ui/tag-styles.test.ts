import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ITEMS } from '../../../src/core/catalogue';
import { TAG_ART } from '../../../src/ui/decorate-art';

/*
 * The results tag's styles (src/ui/tag-styles.css) change its paper and ribbon only: every word on the tag keeps its
 * own ink. jsdom has no CSS, so the stylesheets are read as text.
 */
const css = readFileSync(new URL('../../../src/ui/tag-styles.css', import.meta.url), 'utf8');
const base = readFileSync(new URL('../../../src/styles.css', import.meta.url), 'utf8');

/** The custom properties a rule block sets, by name. */
function vars(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--(tag-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const blockOf = (src: string, selector: string): string => {
  const at = src.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return src.slice(at, src.indexOf('}', at));
};
const plain = vars(blockOf(base, '.results'));
const styles = ITEMS.filter((i) => i.slot === 'tag').map((i) => i.value);
const style = (t: string): Record<string, string> => vars(blockOf(css, `.results[data-tag='${t}']`));

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]): number => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]): number => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** An ink at `alpha` over the paper. */
const over = (ink: string, alpha: number, paper: number[]): number[] => rgb(ink).map((v, i) => v * alpha + paper[i] * (1 - alpha));

/**
 * Every ink the tag's words use (styles.css, account.css), with the opacity it is set at: the time and Unlocked's name,
 * the body, the gold line ("Merry & bright", "Daily Tree"), the unlock and ranking lines, their buttons, the quiet best
 * pill, and the faded stat labels and Keep watching.
 */
const INKS: readonly [string, string, number][] = [
  ['time', '#7d1420', 1],
  ['body', '#3a1a0e', 1],
  ['gold line', '#7c521c', 1],
  ['unlock line', '#7a4a22', 1],
  ['unlock button', '#8e1622', 1],
  ['quiet pill', '#6b3a1c', 1],
  ['stat labels', '#3a1a0e', 0.7],
  ['keep watching', '#3a1a0e', 0.7],
];

it('every tag style the catalogue names has a block, and only paper and ribbon in it', () => {
  expect(styles).toHaveLength(13);
  for (const t of styles) {
    expect(Object.keys(style(t)).sort(), t).toEqual(['tag-paper-hi', 'tag-paper-lo', 'tag-print', 'tag-ribbon', 'tag-ribbon-hi']);
    // A block sets custom properties alone: no colour, font or layout of its own.
    expect(blockOf(css, `.results[data-tag='${t}']`).replace(/--tag-[\w-]+:[^;]+;/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), t).toMatch(/^[^:;]*$/);
  }
  expect(Object.keys(plain)).toEqual(expect.arrayContaining(['tag-paper-hi', 'tag-paper-lo', 'tag-print', 'tag-ribbon', 'tag-ribbon-hi']));
});

it('the words keep 4.5:1 on every paper, plain included, down to its darkest stop', () => {
  for (const [t, v] of [['plain', plain] as const, ...styles.map((t) => [t, style(t)] as const)]) {
    for (const stop of [v['tag-paper-hi'], v['tag-paper-lo']]) {
      expect(stop, t).toMatch(/^#[0-9a-f]{6}$/);
      const paper = rgb(stop);
      for (const [name, ink, alpha] of INKS) expect(contrast(over(ink, alpha, paper), paper), `${name} on ${t} ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("the tag's inks in the stylesheets are the ones checked", () => {
  const account = readFileSync(new URL('../../../src/ui/account.css', import.meta.url), 'utf8');
  expect(blockOf(base, '.results .merry')).toContain('#7c521c');
  expect(blockOf(base, '.results .daily')).toContain('#7c521c');
  expect(blockOf(base, '.results .ghost')).toContain('#7c521c');
  expect(blockOf(base, '.results .stats span')).toContain('opacity: 0.7');
  expect(blockOf(base, '.results .keep')).toContain('opacity: 0.7');
  expect(blockOf(account, '.results .rib-line')).toContain('#7a4a22');
});

it("each Tag swatch is painted in its style's paper and ribbon", () => {
  for (const t of styles) {
    const v = style(t);
    expect(TAG_ART[t as keyof typeof TAG_ART], t).toContain(v['tag-paper-lo']);
    expect(TAG_ART[t as keyof typeof TAG_ART], t).toContain(v['tag-ribbon']);
  }
  expect(TAG_ART.plain).toContain(plain['tag-paper-lo']);
});
