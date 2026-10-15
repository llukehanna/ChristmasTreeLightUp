// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../../src/api/session';
import type { User } from '../../../src/api/types';
import { loadHomeAlone, saveHomeAlone } from '../../../src/store/home-alone';
import { HOME_ALONE_WORD, HomeAloneSwitch, homeAloneFor, type HomeAloneHooks } from '../../../src/ui/home-alone';
import { TypedWord } from '../../../src/ui/star-egg';

const user = (homeAlone: boolean, starHead = false): User => ({ name: 'Comet', isAdmin: false, starHead, homeAlone });
const key = (k: string) => ({ key: k, target: document.body, ctrlKey: false, metaKey: false, altKey: false, repeat: false });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('TypedWord("kevin")', () => {
  it('matches on the last letter in any case; a pause over 2 s starts the word over', () => {
    const w = new TypedWord(HOME_ALONE_WORD);
    expect([...'kevin'].map((c, i) => w.feed(key(c), i * 100))).toEqual([false, false, false, false, true]);
    expect([...'KeViN'].map((c, i) => w.feed(key(c), 1000 + i * 100)).at(-1)).toBe(true);
    expect([...'kev'].map((c, i) => w.feed(key(c), 2000 + i * 100)).some(Boolean)).toBe(false);
    expect([...'in'].map((c, i) => w.feed(key(c), 4201 + i * 100)).some(Boolean)).toBe(false);
  });
});

describe('the preference', () => {
  beforeEach(() => localStorage.clear());

  it('the browser keeps it as aglow.homeAlone = true, or nothing', () => {
    expect(loadHomeAlone()).toBe(false);
    saveHomeAlone(true);
    expect(localStorage.getItem('aglow.homeAlone')).toBe('true');
    expect(loadHomeAlone()).toBe(true);
    saveHomeAlone(false);
    expect(localStorage.getItem('aglow.homeAlone')).toBeNull();
    localStorage.setItem('aglow.homeAlone', '"yes"');
    expect(loadHomeAlone()).toBe(false);
  });

  it("signed in the account's value, else the browser's; never with the head, which wins", () => {
    expect(homeAloneFor(true, null, false)).toBe(true);
    expect(homeAloneFor(true, undefined, false)).toBe(true);
    expect(homeAloneFor(false, user(true), false)).toBe(true);
    expect(homeAloneFor(true, user(false), false)).toBe(false);
    expect(homeAloneFor(true, { name: 'Old', isAdmin: false, starHead: false }, false)).toBe(false); // absent: off
    expect(homeAloneFor(true, null, true)).toBe(false);
    expect(homeAloneFor(false, user(true, true), false)).toBe(false); // both on at the account: the head
  });
});

describe('HomeAloneSwitch', () => {
  let saved: boolean[];
  let puts: boolean[];
  let put: (on: boolean) => Promise<unknown>;
  let head: boolean;
  const hooks = () => {
    const mode = vi.fn();
    const gesture = vi.fn();
    const h: HomeAloneHooks = {
      save: (on) => saved.push(on),
      put: (on) => {
        puts.push(on);
        return put(on);
      },
      mode,
      head: () => head,
      gesture,
    };
    return { h, mode, gesture };
  };
  const type = (s: HomeAloneSwitch, t0 = 0) => [...'kevin'].map((c, i) => s.key(key(c), t0 + i * 100)).at(-1);
  const held = () => {
    const pending: (() => void)[] = [];
    put = () => new Promise<unknown>((resolve) => pending.push(() => resolve({})));
    return { answer: async () => (pending.shift()?.(), await flush()), get open() { return pending.length; } };
  };

  beforeEach(() => {
    saved = [];
    puts = [];
    head = false;
    put = async () => ({});
  });

  it('starts from the browser value and reports it as start, saving and sending nothing', () => {
    const { h, mode } = hooks();
    const s = new HomeAloneSwitch(new Session(), h, true);
    expect(s.isOn).toBe(true);
    expect(mode).toHaveBeenCalledWith(true, 'start');
    expect(saved).toEqual([]);
    expect(puts).toEqual([]);
  });

  it('typing kevin turns it on, loud, with the gesture first; typing it again turns it off', () => {
    const { h, mode, gesture } = hooks();
    const s = new HomeAloneSwitch(new Session(), h, false);
    expect(type(s)).toBe(true);
    expect(s.isOn).toBe(true);
    expect(gesture).toHaveBeenCalledWith(true);
    expect(gesture.mock.invocationCallOrder[0]).toBeLessThan(mode.mock.invocationCallOrder.at(-1) ?? 0);
    expect(mode).toHaveBeenLastCalledWith(true, 'loud');
    expect(saved).toEqual([true]);
    type(s, 5000);
    expect(s.isOn).toBe(false);
    expect(mode).toHaveBeenLastCalledWith(false, 'loud');
    expect(saved).toEqual([true, false]);
  });

  it('signed out nothing is sent; signed in the account follows in the background, latest-wins', async () => {
    const out = hooks();
    type(new HomeAloneSwitch(new Session(), out.h, false));
    expect(puts).toEqual([]);
    const { h } = hooks();
    const session = new Session();
    session.set(user(false));
    const s = new HomeAloneSwitch(session, h, false);
    const net = held();
    type(s, 0); // on
    type(s, 3000); // off
    type(s, 6000); // on: the last word
    expect(net.open).toBe(1);
    await net.answer();
    expect(puts).toEqual([true, true]);
    await net.answer();
    expect(puts.at(-1)).toBe(s.isOn);
    expect((session.current as User).homeAlone).toBe(true);
  });

  it('off() is quiet but kept: this browser and the account forget it; off again does nothing', async () => {
    const { h, mode } = hooks();
    const session = new Session();
    session.set(user(false));
    const s = new HomeAloneSwitch(session, h, false);
    type(s);
    await flush();
    s.off();
    await flush();
    expect(s.isOn).toBe(false);
    expect(mode).toHaveBeenLastCalledWith(false, 'quiet');
    expect(saved).toEqual([true, false]);
    expect(puts).toEqual([true, false]);
    s.off();
    expect(saved).toEqual([true, false]);
  });

  it("the account's value wins on load and sign-in, quietly, and is never sent back; signing out keeps it", async () => {
    const { h, mode } = hooks();
    const session = new Session();
    const s = new HomeAloneSwitch(session, h, false);
    session.set(user(true));
    expect(s.isOn).toBe(true);
    expect(mode).toHaveBeenLastCalledWith(true, 'quiet');
    expect(saved).toEqual([true]);
    expect(puts).toEqual([]);
    session.set(user(true));
    expect(saved).toEqual([true]);
    session.set(null);
    expect(s.isOn).toBe(true);
  });

  it('an account with both on keeps the head: Home Alone goes off here and the account is told', async () => {
    const { h } = hooks();
    const session = new Session();
    const s = new HomeAloneSwitch(session, h, true);
    session.set(user(true, true));
    await flush();
    expect(s.isOn).toBe(false);
    expect(saved).toEqual([false]);
    expect(puts).toEqual([false]);
  });

  it('a load that finds the head on keeps the head: off from the start, and this browser forgets it', () => {
    head = true;
    const { h, mode } = hooks();
    const s = new HomeAloneSwitch(new Session(), h, true);
    expect(s.isOn).toBe(false);
    expect(mode).toHaveBeenCalledWith(false, 'start');
    expect(saved).toEqual([false]);
  });

  it('typed before the first /api/me answers: the toggle stands, and the account is told once it arrives', async () => {
    const { h, mode } = hooks();
    const session = new Session(); // undefined: the first /api/me is still out
    const s = new HomeAloneSwitch(session, h, false);
    type(s);
    expect(puts).toEqual([]);
    const late = user(false);
    session.set(late);
    await flush();
    expect(s.isOn).toBe(true);
    expect(mode).toHaveBeenLastCalledWith(true, 'quiet');
    expect(mode).not.toHaveBeenCalledWith(false, 'quiet');
    expect(puts).toEqual([true]);
    expect(late.homeAlone).toBe(true);
    // Only that first answer: a later sign-in's account wins again.
    session.set(user(false));
    await flush();
    expect(s.isOn).toBe(false);
    expect(puts).toEqual([true]);
  });

  it('typed off before the first /api/me answers: the account that had it on is told off', async () => {
    const { h } = hooks();
    const session = new Session();
    const s = new HomeAloneSwitch(session, h, true);
    type(s);
    session.set(user(true));
    await flush();
    expect(s.isOn).toBe(false);
    expect(puts).toEqual([false]);
  });

  it('typed on before the first /api/me answers, with the head on the account: the house stays and the head is turned off', async () => {
    const { h, mode } = hooks();
    const session = new Session();
    const s = new HomeAloneSwitch(session, h, false);
    type(s);
    session.set(user(false, true));
    await flush();
    expect(s.isOn).toBe(true);
    // The app turns the head off on every switch-on report (StarEgg.off()), so the house is reported again.
    expect(mode).toHaveBeenLastCalledWith(true, 'quiet');
    expect(puts).toEqual([true]);
  });

  it('typed before the first /api/me finds no one signed in: kept here, nothing sent', async () => {
    const { h } = hooks();
    const session = new Session();
    const s = new HomeAloneSwitch(session, h, false);
    type(s);
    session.set(null);
    await flush();
    expect(s.isOn).toBe(true);
    expect(puts).toEqual([]);
    session.set(user(false)); // a sign-in later: the account wins as ever
    expect(s.isOn).toBe(false);
  });

  it('an account answer that predates our PUT never overwrites the view', async () => {
    const { h } = hooks();
    const session = new Session();
    session.set(user(false));
    const s = new HomeAloneSwitch(session, h, false);
    const net = held();
    type(s);
    const stale = user(false);
    session.set(stale);
    expect(s.isOn).toBe(true);
    expect(stale.homeAlone).toBe(true);
    await net.answer();
    session.set(stale);
    expect(s.isOn).toBe(true);
  });
});
