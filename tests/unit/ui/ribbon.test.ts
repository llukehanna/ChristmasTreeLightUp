// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FinishResult } from '../../../src/api/types';
import { renderRibbon, ribbonModel } from '../../../src/ui/ribbon';

const result = (over: Partial<FinishResult> = {}): FinishResult => ({ id: 'g', ranked: true, reason: null, ms: 81_000, rank: 12, total: 340, best: 81_000, newBest: true, ...over });
const me = { name: 'Comet', isAdmin: false, starHead: false };

describe('ribbonModel', () => {
  it('ranked: the place, and a new best or your best', () => {
    expect(ribbonModel({ kind: 'done', result: result() }, me)).toEqual({ kind: 'rank', rank: 12, of: 340, best: 81_000, newBest: true });
    expect(ribbonModel({ kind: 'done', result: result({ newBest: false, best: 79_500 }) }, me)).toMatchObject({ newBest: false, best: 79_500 });
  });

  it('signed out: Save to leaderboard with the place it would take; signed in, the claim is on its way', () => {
    const anon = result({ ranked: false, reason: 'anonymous', rank: 5, best: null, newBest: false });
    expect(ribbonModel({ kind: 'done', result: anon }, null)).toEqual({ kind: 'save', rank: 5, of: 341, signedIn: false });
    expect(ribbonModel({ kind: 'done', result: anon }, undefined)).toEqual({ kind: 'save', rank: 5, of: 341, signedIn: false });
    expect(ribbonModel({ kind: 'done', result: anon }, me)).toEqual({ kind: 'saving' });
    // Signed in but the name card was put off: nothing is being claimed yet, so the ribbon still offers to save (no Google).
    expect(ribbonModel({ kind: 'done', result: anon }, { name: null, isAdmin: false, starHead: false })).toEqual({ kind: 'save', rank: 5, of: 341, signedIn: true });
  });

  it('back from Google while /api/me is in flight: saving, not a flash of Save to leaderboard', () => {
    const anon = result({ ranked: false, reason: 'anonymous', rank: 5, best: null, newBest: false });
    expect(ribbonModel({ kind: 'done', result: anon }, undefined, { returning: true })).toEqual({ kind: 'saving' });
    // Once the session is known to be signed out (sign-in didn't finish), the ribbon is back.
    expect(ribbonModel({ kind: 'done', result: anon }, null, { returning: true })).toMatchObject({ kind: 'save' });
  });

  it('a claim that failed offers a retry; one the server no longer has is kept in Your games', () => {
    const anon = result({ ranked: false, reason: 'anonymous', rank: 5, best: null, newBest: false });
    expect(ribbonModel({ kind: 'done', result: anon }, me, { claim: 'stuck' })).toEqual({ kind: 'retry', what: 'claim' });
    expect(ribbonModel({ kind: 'done', result: anon }, me, { claim: 'gone' })).toEqual({ kind: 'kept' });
    // Signed out again: the claim state no longer applies.
    expect(ribbonModel({ kind: 'done', result: anon }, null, { claim: 'stuck' })).toMatchObject({ kind: 'save' });
  });

  it('a finish that reached the server too late: saved, unranked, and says so', () => {
    const clock = result({ ranked: false, reason: 'clock', rank: null });
    expect(ribbonModel({ kind: 'done', result: clock }, me, { late: true })).toEqual({ kind: 'unranked', why: 'reached the server too late', saved: true });
    expect(ribbonModel({ kind: 'done', result: clock }, null, { late: true })).toEqual({ kind: 'unranked', why: 'reached the server too late', saved: true });
    // Only the clock reason: a late run that paused too long still says so.
    expect(ribbonModel({ kind: 'done', result: result({ ranked: false, reason: 'paused', rank: null }) }, me, { late: true })).toEqual({ kind: 'unranked', why: 'paused too long' });
  });

  it('unranked, offline, unverified, saving and failed', () => {
    expect(ribbonModel({ kind: 'done', result: result({ ranked: false, reason: 'paused', rank: null }) }, me)).toEqual({ kind: 'unranked', why: 'paused too long' });
    expect(ribbonModel({ kind: 'done', result: result({ ranked: false, reason: 'too_fast', rank: null }) }, me)).toEqual({ kind: 'unranked', why: 'too fast' });
    expect(ribbonModel({ kind: 'done', result: result({ ranked: false, reason: 'clock', rank: null }) }, me)).toEqual({ kind: 'unranked', why: "couldn't verify the clock" });
    expect(ribbonModel({ kind: 'offline' }, me)).toEqual({ kind: 'unranked', why: 'offline' });
    expect(ribbonModel({ kind: 'unverified' }, null)).toEqual({ kind: 'unranked', why: "couldn't verify this run" });
    expect(ribbonModel({ kind: 'saving' }, null)).toEqual({ kind: 'saving' });
    expect(ribbonModel({ kind: 'failed' }, null)).toEqual({ kind: 'retry', what: 'finish' });
  });
});

function tag(): HTMLElement {
  document.body.innerHTML = `<section class="results" id="results"><h2 id="r-time">Lit in 1:21</h2><div class="merry" id="r-merry">Merry &amp; bright</div>
    <div class="score" id="r-score">Score 41,900</div><div class="stats"></div><div class="actions"><button id="r-new">New tree</button></div></section>`;
  const root = document.getElementById('results');
  if (!root) throw new Error('no tag');
  return root;
}
const handlers = () => ({ board: vi.fn(), save: vi.fn(), retry: vi.fn() });

describe('renderRibbon', () => {
  it('ranked: a rosette that opens the leaderboard, and a line under Merry & bright', () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'rank', rank: 12, of: 340, best: 81_000, newBest: true }, h);
    expect(root.querySelector('#r-merry + .rib-line')?.textContent).toBe('#12 of 340 runs · New personal best!');
    const ros = root.querySelector<HTMLButtonElement>('.rib-ros');
    expect(ros?.getAttribute('aria-label')).toBe('Rank 12 of 340: open the leaderboard');
    expect(ros?.querySelector('.rib-ros-face')?.textContent).toBe('#12of 340');
    expect(ros?.querySelector('.rib-ros-banner')?.textContent).toBe('New best');
    ros?.click();
    expect(h.board).toHaveBeenCalledTimes(1);
    renderRibbon(root, { kind: 'rank', rank: 12, of: 340, best: 79_500, newBest: false }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe('#12 of 340 runs · Your best 1:19.5');
    expect(root.querySelectorAll('.rib-ros')).toHaveLength(1);
    expect(root.querySelector('#r-time')?.textContent).toBe('Lit in 1:21');
    // The rosette and the line tell the best now: the device's best pill steps aside (CSS), until the tag is redrawn.
    expect(root.classList.contains('rib-ros-on')).toBe(true);
    renderRibbon(root, { kind: 'saving' }, h);
    expect(root.classList.contains('rib-ros-on')).toBe(false);
  });

  it('signed out: the Save to leaderboard ribbon above the buttons', () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'save', rank: 5, of: 341, signedIn: false }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe('Would place #5 of 341 runs');
    const ribbon = root.querySelector<HTMLButtonElement>('.rib-ribbon');
    expect(ribbon?.nextElementSibling?.classList.contains('actions')).toBe(true);
    expect(ribbon?.textContent).toBe('Save to leaderboard');
    expect(ribbon?.querySelector('.acct-g')).not.toBeNull();
    ribbon?.click();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.rib-ros')).toBeNull();
    // Signed in already (no name yet): saving is a name away, not Google, so no Google mark.
    renderRibbon(root, { kind: 'save', rank: 5, of: 341, signedIn: true }, h);
    expect(root.querySelector('.rib-ribbon')?.textContent).toBe('Save to leaderboard');
    expect(root.querySelector('.rib-ribbon .acct-g')).toBeNull();
  });

  it('unranked: a grey rosette that is a picture, not a control, and the reason', () => {
    const root = tag();
    renderRibbon(root, { kind: 'unranked', why: 'paused too long' }, handlers());
    expect(root.querySelector('.rib-line')?.textContent).toBe('Unranked: paused too long');
    const ros = root.querySelector('.rib-ros.un');
    expect(ros?.tagName).toBe('SPAN');
    expect(ros?.getAttribute('role')).toBe('img');
    expect(ros?.getAttribute('aria-label')).toBe('Unranked');
    expect(ros?.querySelector('.rib-ros-face b')?.textContent).toBe('—');
    expect(root.querySelector('button')?.id).toBe('r-new');
    // The device's best pill steps aside for an unranked run too (it would contradict the rosette).
    expect(root.classList.contains('rib-ros-on')).toBe(true);
    renderRibbon(root, { kind: 'unranked', why: 'reached the server too late', saved: true }, handlers());
    expect(root.querySelector('.rib-line')?.textContent).toBe('Saved, unranked: reached the server too late');
    expect(root.querySelector('.rib-ros.un')).not.toBeNull();
  });

  it('a run the server already has elsewhere: Saved to Your games, no rosette', () => {
    const root = tag();
    renderRibbon(root, { kind: 'kept' }, handlers());
    expect(root.querySelector('.rib-line')?.textContent).toBe('Saved to Your games');
    expect(root.querySelector('.rib-ros, .rib-ribbon, .rib-retry')).toBeNull();
  });

  it("saving, then couldn't save with a Retry; null clears it all", () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'saving' }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe('Saving your time…');
    renderRibbon(root, { kind: 'retry', what: 'finish' }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe("Couldn't save this run. Retry");
    root.querySelector<HTMLButtonElement>('.rib-retry')?.click();
    expect(h.retry).toHaveBeenCalledTimes(1);
    renderRibbon(root, { kind: 'retry', what: 'claim' }, h);
    expect(root.querySelector('.rib-line')?.textContent).toBe("Couldn't save this run. Retry");
    renderRibbon(root, null, h);
    expect(root.querySelectorAll('.rib, .rib-line')).toHaveLength(0);
    expect(root.querySelector('#r-time')?.textContent).toBe('Lit in 1:21');
    expect(root.querySelector('#r-score')?.textContent).toBe('Score 41,900');
  });

  it('big boards: the count shortens on the rosette (its label has it in full), and a long rank gets a smaller numeral', () => {
    const root = tag();
    renderRibbon(root, { kind: 'rank', rank: 12_345, of: 23_456, best: 81_000, newBest: false }, handlers());
    const ros = root.querySelector('.rib-ros');
    expect(ros?.getAttribute('aria-label')).toBe('Rank 12345 of 23456: open the leaderboard');
    expect(ros?.querySelector('.rib-ros-face small')?.textContent).toBe('of 23.5K');
    expect(ros?.querySelector('.rib-ros-face')?.classList.contains('long')).toBe(true);
    expect(ros?.querySelector('.rib-ros-face')?.classList.contains('longer')).toBe(true);
    expect(ros?.querySelector('.rib-ros-banner')).toBeNull();
    expect(root.querySelector('.rib-line')?.textContent).toBe('#12,345 of 23,456 runs · Your best 1:21.0');
  });

  it('text goes in as text, and server numbers paint only as numbers', () => {
    const root = tag();
    renderRibbon(root, { kind: 'unranked', why: '<img src=x onerror=alert(1)>' }, handlers());
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.rib-line')?.textContent).toBe('Unranked: <img src=x onerror=alert(1)>');
    const sneaky = '<b>9</b>' as unknown as number;
    renderRibbon(root, { kind: 'save', rank: sneaky, of: 10, signedIn: false }, handlers());
    expect(root.querySelector('.rib-line')?.textContent).toBe('Would place #NaN of 10 runs');
  });

  it('a redraw keeps keyboard focus on the same control', () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'retry', what: 'finish' }, h);
    root.querySelector<HTMLButtonElement>('.rib-retry')?.focus();
    renderRibbon(root, { kind: 'retry', what: 'finish' }, h);
    expect(document.activeElement?.classList.contains('rib-retry')).toBe(true);
    renderRibbon(root, { kind: 'save', rank: 3, of: 9, signedIn: false }, h);
    root.querySelector<HTMLButtonElement>('.rib-ribbon')?.focus();
    renderRibbon(root, { kind: 'save', rank: 3, of: 9, signedIn: false }, h);
    expect(document.activeElement?.classList.contains('rib-ribbon')).toBe(true);
  });

  it('a control that goes away hands focus on: through "Saving…" to the rosette the claim brings', () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'save', rank: 3, of: 9, signedIn: true }, h);
    root.querySelector<HTMLButtonElement>('.rib-ribbon')?.focus();
    renderRibbon(root, { kind: 'saving' }, h);
    // Nothing to press while saving: the line holds focus, so it isn't dropped to the page.
    expect(document.activeElement?.classList.contains('rib-line')).toBe(true);
    renderRibbon(root, { kind: 'rank', rank: 3, of: 10, best: 81_000, newBest: true }, h);
    expect(document.activeElement?.classList.contains('rib-ros')).toBe(true);
    // Straight from the ribbon to the rosette too.
    renderRibbon(root, { kind: 'save', rank: 3, of: 9, signedIn: false }, h);
    expect(document.activeElement?.classList.contains('rib-ribbon')).toBe(true);
    renderRibbon(root, { kind: 'rank', rank: 3, of: 10, best: 81_000, newBest: true }, h);
    expect(document.activeElement?.classList.contains('rib-ros')).toBe(true);
  });

  it('focus elsewhere is never taken', () => {
    const root = tag();
    const h = handlers();
    renderRibbon(root, { kind: 'saving' }, h);
    root.querySelector<HTMLButtonElement>('#r-new')?.focus();
    renderRibbon(root, { kind: 'rank', rank: 3, of: 10, best: 81_000, newBest: true }, h);
    expect(document.activeElement?.id).toBe('r-new');
  });

  it('signed out with no place to show: a plainer line, and still the ribbon', () => {
    const root = tag();
    renderRibbon(root, { kind: 'save', rank: null, of: 1, signedIn: false }, handlers());
    expect(root.querySelector('.rib-line')?.textContent).toBe('Sign in to put this time on the leaderboard');
    expect(root.querySelector('.rib-ribbon')).not.toBeNull();
  });
});
