// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { ProgressResponse } from '../../../src/api/types';
import { itemOf, type ItemId } from '../../../src/core/catalogue';
import { evaluate, pileOf } from '../../../src/core/goals';
import { effectiveLook, STARTER_LOOK, type Look } from '../../../src/store/look';
import { Results } from '../../../src/ui/results';
import { renderRibbon } from '../../../src/ui/ribbon';
import { picked, tryPatch, unlockLine, UnlockNews, type UnlockLine } from '../../../src/ui/unlock-ribbon';
import { UnlockState } from '../../../src/unlock-state';

const noop = (): void => undefined;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  document.body.innerHTML = `<section id="results" hidden><h2 id="r-time"></h2><div id="r-merry">Merry &amp; bright</div><div id="r-badge"></div>
    <div class="stats"><b id="r-solved"></b><b id="r-avg"></b><b id="r-streak"></b></div><div class="actions"><button id="r-new"></button><button id="r-share"></button></div><button id="r-keep"></button></section>`;
});

it('the best by prestige, and the rest as +N more', () => {
  expect(unlockLine(['decor:tinsel', 'topper:star', 'scene:midnight'])).toMatchObject({ best: { id: 'topper:star' }, more: 2 });
  expect(unlockLine(['decor:tinsel'])).toMatchObject({ best: { id: 'decor:tinsel', label: 'Tinsel' }, more: 0 });
});

it('nothing fresh, no line', () => expect(unlockLine([])).toBeNull());

it('a tie goes to the first in catalogue order, whatever order the ids come in', () => {
  // Candy canes and the Midnight scene are both prestige 2; the scene comes first in ITEMS.
  expect(unlockLine(['decor:canes', 'scene:midnight'])?.best.id).toBe('scene:midnight');
  expect(unlockLine(['scene:midnight', 'decor:canes'])?.best.id).toBe('scene:midnight');
});

it('Try it: a decoration is switched on, a slot the look has takes the value; one the look has no place for yet is null', () => {
  const look: Look = { ...STARTER_LOOK, decor: { ...STARTER_LOOK.decor, beads: true } };
  expect(tryPatch(look, itemOf('decor:tinsel')!)).toEqual({ decor: { tinsel: true, beads: true, canes: false, skirt: false } });
  expect(tryPatch(look, itemOf('scene:midnight')!)).toEqual({ scene: 'midnight' });
  expect(tryPatch(look, itemOf('path:neon')!)).toEqual({ path: 'neon' });
  expect(tryPatch(look, itemOf('topper:star')!)).toEqual({ topper: 'star' });
  expect(tryPatch(look, itemOf('presents:luxe')!)).toEqual({ presents: 'luxe' });
  expect(tryPatch(look, itemOf('palette:gilded')!)).toEqual({ palette: 'gilded' });
  // Not in the look yet (Milestone 2): a palette it can't hold, a tree, a sound.
  expect(tryPatch(look, itemOf('palette:candy')!)).toBeNull();
  expect(tryPatch(look, itemOf('tree:flocked')!)).toBeNull();
  expect(tryPatch(look, itemOf('sound:rain')!)).toBeNull();
});

it('the tag draws "Unlocked: Tinsel · Try it", and " · +N more", under the rank strip; its buttons call back; null takes it away', () => {
  const r = new Results({ onNew: noop, onShare: noop, onKeep: noop });
  const root = document.getElementById('results')!;
  renderRibbon(root, { kind: 'saving' }, { board: noop, save: noop, retry: noop });
  const onTry = vi.fn();
  const onMore = vi.fn();
  r.setUnlocks(unlockLine(['decor:tinsel']), { onTry, onMore });
  const line = (): HTMLElement | null => root.querySelector('.unlock');
  expect(line()?.textContent).toBe('Unlocked: Tinsel · Try it');
  expect(line()?.previousElementSibling?.classList.contains('rib-line')).toBe(true);
  expect(line()?.querySelector('button')?.textContent).toBe('Try it');
  r.setUnlocks(unlockLine(['decor:tinsel', 'topper:star', 'scene:midnight']), { onTry, onMore });
  expect(line()?.textContent).toBe('Unlocked: Star topper · Try it · +2 more');
  expect(root.querySelectorAll('.unlock')).toHaveLength(1);
  const [tryIt, more] = [...line()!.querySelectorAll('button')];
  tryIt.click();
  more.click();
  expect(onTry).toHaveBeenCalledOnce();
  expect(onMore).toHaveBeenCalledOnce();
  // A ribbon redraw (the server answers) keeps the line, under the new rank strip.
  renderRibbon(root, { kind: 'kept' }, { board: noop, save: noop, retry: noop });
  expect(line()?.previousElementSibling?.textContent).toBe('Saved to Your games');
  r.setUnlocks(null, { onTry, onMore });
  expect(line()).toBeNull();
});

/** The server's answer for `treesLit` trees, plus `extra` earned items. */
const progress = (treesLit: number, extra: ItemId[] = []): ProgressResponse => {
  const e = evaluate({ treesLit, runs: [], topTenDays: 0 });
  return { earned: [...e.earned, ...extra], goals: e.goals, treesLit };
};

/**
 * The App's part, with fakes: a run, a tag, a session, and the stage as App.applyLook leaves it (the look's path and
 * topper as shown, and the pile), read from the news' ownership as the App's stage is.
 */
function world(saved: Look) {
  const f = { inRun: false, tagUp: false, known: true, look: saved, path: 'unset', topper: 'unset', pile: -1, lines: [] as (UnlockLine | null)[], applied: 0 };
  const news: { n: UnlockNews | null } = { n: null };
  const unlocks = new UnlockState({ onChange: () => news.n?.changed() });
  const paint = (): void => {
    const shown = effectiveLook(f.look, (id) => n.owns(id));
    f.path = shown.path;
    f.topper = shown.topper;
    f.pile = pileOf(n.treesLit(), Infinity);
  };
  const n = new UnlockNews(unlocks, {
    inRun: () => f.inRun,
    tagUp: () => f.tagUp,
    known: () => f.known,
    apply: () => {
      f.applied++;
      paint();
    },
    ribbon: (line) => f.lines.push(line),
  });
  news.n = n;
  /** A pick by the player (the drawer, a saved look, Try it): App.applyLook with persist. */
  const pick = (patch: Partial<Look>): void => {
    const next = { ...f.look, ...patch };
    n.reveal(picked(f.look, next));
    f.look = next;
    paint();
  };
  return { f, unlocks, news: n, pick };
}

it('progress landing mid-run waits for the next tag (no dot, no ribbon until then)', () => {
  // R9: a signed-in player whose saved look has the Neon path, not yet theirs.
  const { f, unlocks, news } = world({ ...STARTER_LOOK, path: 'neon' });
  unlocks.setPlayer(7, 0);
  unlocks.setServer(progress(24));
  expect(f.path).toBe('filament');
  // The first move: the run is in progress. Progress that earns the Neon path lands now.
  f.inRun = true;
  const applied = f.applied;
  unlocks.setServer(progress(25));
  expect(unlocks.owns('path:neon')).toBe(true);
  expect(f.path).toBe('filament');
  expect(f.applied).toBe(applied);
  expect(f.lines).toEqual([]);
  // Nothing the app does mid-run releases it.
  news.tell();
  news.settle();
  expect(f.path).toBe('filament');
  expect(f.lines).toEqual([]);
  // The win, then the tag: the look takes the path, and the ribbon announces it (then it is known).
  f.inRun = false;
  f.tagUp = true;
  news.tagShown();
  expect(f.path).toBe('neon');
  expect(f.lines.at(-1)).toMatchObject({ best: { id: 'path:neon' }, more: 1 });
  expect(unlocks.fresh()).toEqual([]);
  // Once told, the next tag says nothing.
  news.tagShown();
  expect(f.lines.at(-1)).toBeNull();
});

it("a pick mid-run shows what it names, but never brings a held unlock along (the path, the pile); those wait for the tag", () => {
  // Saved: the Neon path. Owned: the Star topper, 20 trees (a pile of 4).
  const { f, unlocks, news, pick } = world({ ...STARTER_LOOK, path: 'neon' });
  unlocks.setPlayer(7, 0);
  unlocks.setServer(progress(20, ['topper:star']));
  expect([f.path, f.pile]).toEqual(['filament', 4]);
  // Mid-run, progress earns m25 (Neon, beads) and five more trees.
  f.inRun = true;
  unlocks.setServer(progress(25, ['topper:star']));
  // A drawer pick of another slot: the topper changes, the path and the pile don't.
  pick({ topper: 'star' });
  expect([f.topper, f.path, f.pile]).toEqual(['star', 'filament', 4]);
  // A decoration switched on that is held too (the beads): picked by the player, it shows; the path still waits.
  pick({ decor: { ...f.look.decor, beads: true } });
  expect(news.owns('decor:beads')).toBe(true);
  expect([f.path, f.pile]).toEqual(['filament', 4]);
  expect(f.lines).toEqual([]);
  // The tag: the held path and pile appear, and the news is told.
  f.inRun = false;
  f.tagUp = true;
  news.tagShown();
  expect([f.topper, f.path, f.pile]).toEqual(['star', 'neon', 5]);
  expect(f.lines.at(-1)).toMatchObject({ best: { id: 'path:neon' }, more: 1 });
});

it('a pick names the slots it changed and the decorations it switched on', () => {
  const before: Look = { ...STARTER_LOOK, decor: { ...STARTER_LOOK.decor, skirt: true } };
  expect(picked(before, { ...before, topper: 'star', decor: { ...before.decor, tinsel: true } })).toEqual(['topper:star', 'decor:tinsel']);
  expect(picked(before, { ...before, decor: { ...before.decor, skirt: false } })).toEqual([]);
  expect(picked(before, before)).toEqual([]);
});

it('a new tree ends the run: the held look applies, and the ribbon waits for a tag', () => {
  const { f, unlocks, news } = world({ ...STARTER_LOOK, path: 'neon' });
  unlocks.setPlayer(7, 0);
  unlocks.setServer(progress(24));
  f.inRun = true;
  unlocks.setServer(progress(25));
  expect(f.path).toBe('filament');
  f.inRun = false;
  news.settle();
  expect(f.path).toBe('neon');
  expect(f.lines).toEqual([]);
  expect(unlocks.fresh()).toEqual(['path:neon', 'decor:beads']);
});

it("a guest's milestone arrives at the win and goes on the tag; progress landing while the tag is up joins the line", () => {
  const { f, unlocks, news } = world(STARTER_LOOK);
  unlocks.setPlayer(null, 0);
  // The last turn: still in the run when the App records the win.
  f.inRun = true;
  unlocks.setPlayer(null, 1);
  expect(f.lines).toEqual([]);
  f.inRun = false;
  f.tagUp = true;
  news.tagShown();
  expect(f.lines.at(-1)).toMatchObject({ best: { id: 'decor:tinsel' }, more: 0 });
  // Signed in meanwhile (another tab): the account's progress lands with the tag up.
  unlocks.setPlayer(3, 1);
  unlocks.setServer(progress(1));
  unlocks.setServer(progress(5));
  expect(f.lines.at(-1)).toMatchObject({ best: { id: 'scene:midnight' }, more: 3 });
});

it('while the session is still loading, nothing is announced (the key is provisional); once it is known, the tag tells', () => {
  const { f, unlocks, news } = world(STARTER_LOOK);
  f.known = false;
  unlocks.setPlayer(null, 0);
  unlocks.setPlayer(null, 1);
  f.tagUp = true;
  news.tagShown();
  expect(f.lines).toEqual([null]);
  expect(unlocks.fresh()).toEqual(['decor:tinsel']);
  f.known = true;
  news.tell();
  expect(f.lines.at(-1)).toMatchObject({ best: { id: 'decor:tinsel' } });
  expect(unlocks.fresh()).toEqual([]);
});

it('with no tag up and no run, an unlock applies at once and waits, fresh, for a tag', () => {
  const { f, unlocks } = world({ ...STARTER_LOOK, path: 'neon' });
  unlocks.setPlayer(7, 0);
  unlocks.setServer(progress(24));
  unlocks.setServer(progress(25));
  expect(f.path).toBe('neon');
  expect(f.lines).toEqual([]);
  expect(unlocks.fresh()).toEqual(['path:neon', 'decor:beads']);
});
