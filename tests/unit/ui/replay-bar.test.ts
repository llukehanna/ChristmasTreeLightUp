// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ReplayBar, replayCaption } from '../../../src/ui/replay-bar';

let host: HTMLElement;
const hook = () => vi.fn<() => void>();
let hooks: Record<'onToggle' | 'onSpeed' | 'onRestart' | 'onDone', ReturnType<typeof hook>>;
let bar: ReplayBar;
beforeEach(() => {
  document.body.innerHTML = '<div id="replay-bar" hidden></div>';
  host = document.getElementById('replay-bar')!;
  hooks = { onToggle: hook(), onSpeed: hook(), onRestart: hook(), onDone: hook() };
  bar = new ReplayBar(host, hooks);
});
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name);

it('shows its caption and the three buttons: Pause, 2× (not pressed), Done', () => {
  bar.show('Your run · 1:02.4');
  expect(host.hidden).toBe(false);
  expect(host.querySelector('.rb-cap')?.textContent).toBe('Your run · 1:02.4');
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Pause', '2×', 'Done']);
  expect(button('2×')?.getAttribute('aria-pressed')).toBe('false');
  expect(host.getAttribute('aria-label')).toBe('Replay');
});

it('the toggle reads Pause while playing, Play while paused, and Watch again once ended', () => {
  bar.show('x');
  bar.set({ playing: false, speed: 1, ended: false });
  expect(button('Play')).toBeDefined();
  bar.set({ playing: true, speed: 2, ended: false });
  expect(button('Pause')).toBeDefined();
  expect(button('2×')?.getAttribute('aria-pressed')).toBe('true');
  bar.set({ playing: false, speed: 2, ended: true });
  expect(button('Watch again')).toBeDefined();
});

it('the buttons call their hooks; the toggle restarts once ended', () => {
  bar.show('x');
  button('Pause')!.click();
  expect(hooks.onToggle).toHaveBeenCalledTimes(1);
  button('2×')!.click();
  expect(hooks.onSpeed).toHaveBeenCalledTimes(1);
  button('Done')!.click();
  expect(hooks.onDone).toHaveBeenCalledTimes(1);
  bar.set({ playing: false, speed: 1, ended: true });
  button('Watch again')!.click();
  expect(hooks.onRestart).toHaveBeenCalledTimes(1);
  expect(hooks.onToggle).toHaveBeenCalledTimes(1);
});

it('show() starts afresh (playing, 1×) with a new caption, and hide() hides it', () => {
  bar.show('first');
  bar.set({ playing: false, speed: 2, ended: true });
  bar.show('second');
  expect(host.querySelector('.rb-cap')?.textContent).toBe('second');
  expect(button('Pause')).toBeDefined();
  expect(button('2×')?.getAttribute('aria-pressed')).toBe('false');
  bar.hide();
  expect(host.hidden).toBe(true);
});

it('the caption: your run or the player, the time, and a Daily run’s day in front (C4 decision 9)', () => {
  expect(replayCaption({ name: 'Meridian', mine: true, ms: 62_400, daily: null })).toBe('Your run · 1:02.4');
  expect(replayCaption({ name: null, mine: true, ms: 62_400, daily: null })).toBe('Your run · 1:02.4');
  expect(replayCaption({ name: 'Comet', mine: false, ms: 48_200, daily: null })).toBe('Comet · 0:48.2');
  expect(replayCaption({ name: 'Comet', mine: false, ms: 48_200, daily: '2026-11-06' })).toBe('Daily Tree · Nov 6 · Comet · 0:48.2');
  expect(replayCaption({ name: 'Meridian', mine: true, ms: 48_200, daily: '2026-11-06' })).toBe('Daily Tree · Nov 6 · Your run · 0:48.2');
});

it('the caption goes in as text', () => {
  bar.show('<b>x</b>');
  expect(host.querySelector('.rb-cap b')).toBeNull();
});
