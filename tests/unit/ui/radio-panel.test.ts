// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Radio, RadioView } from '../../../src/radio/radio';
import type { Station } from '../../../src/radio/schema';
import { DEFAULT_RADIO } from '../../../src/store/radio-settings';
import { RadioPanel } from '../../../src/ui/radio-panel';

const station = (id: string, description = ''): Station => ({
  id,
  name: id === 'secret' ? 'Luke FM' : id,
  description,
  tracks: [{ id: `${id}-1`, url: `/a/${id}.m4a`, title: `${id} song`, artist: 'Someone', credit: 'CC0', duration: 10 }],
});

/** A radio that only answers view(), from a view the test edits. */
function fakeRadio(view: Partial<RadioView>) {
  const down = new Set<string>();
  const v: RadioView = {
    kind: null,
    playing: false,
    station: null,
    track: null,
    position: 0,
    duration: 0,
    stations: [station('christmas-jazz')],
    unavailable: (id) => down.has(id),
    embed: null,
    remoteOk: true,
    settings: { ...DEFAULT_RADIO },
    secretMode: false,
    secretStation: null,
    ...view,
  };
  const radio = { onChange: null as (() => void) | null, view: () => v, select: () => undefined };
  return { radio, v, down, change: () => radio.onChange?.() };
}

const rows = () => [...document.querySelectorAll<HTMLButtonElement>('#radio-panel .stations .st')];
const row = (id: string) => rows().find((b) => b.dataset.id === id);
const desc = (id: string) => row(id)?.querySelector('.d')?.textContent;

beforeEach(() => {
  document.body.innerHTML = '<div id="radio-slot"></div>';
  // jsdom has no matchMedia: the panel asks it for the phone layout.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
let opened: RadioPanel[] = [];
afterEach(() => {
  for (const p of opened) p.close();
  opened = [];
  vi.unstubAllGlobals();
});

/** An open panel: the rows render only while it is open. */
const panel = (radio: ReturnType<typeof fakeRadio>['radio']) => {
  const p = new RadioPanel(radio as unknown as Radio, { get: () => 1, set: () => undefined });
  p.open();
  opened.push(p);
  return p;
};

it('lists no Secret row outside secret mode', () => {
  const f = fakeRadio({ secretStation: station('secret') });
  panel(f.radio);
  expect(rows().map((b) => b.dataset.id)).toEqual(['christmas-jazz', 'music-box', 'fireplace']);
});

it('in secret mode, the Secret row sits on top with the station name and description', () => {
  const f = fakeRadio({ secretMode: true, secretStation: station('secret', 'Songs for the egg') });
  panel(f.radio);
  expect(rows()[0].dataset.id).toBe('secret');
  expect(rows()[0].querySelector('.n')?.textContent).toBe('Luke FM');
  expect(desc('secret')).toBe('Songs for the egg');
});

it('with no Secret station, the row is "Secret" and plays dreamy celesta carols', () => {
  const f = fakeRadio({ secretMode: true, kind: 'celesta', playing: true });
  panel(f.radio);
  expect(rows()[0].querySelector('.n')?.textContent).toBe('Secret');
  expect(desc('secret')).toBe('Dreamy celesta carols');
  expect(row('secret')?.getAttribute('aria-current')).toBe('true');
  expect(document.querySelector('.radio-pill .rp-name')?.textContent).toBe('Secret');
});

it('a Secret station that starts failing says celesta, in place: the row keeps its node, so focus survives', () => {
  const f = fakeRadio({ secretMode: true, secretStation: station('secret', 'Songs for the egg') });
  panel(f.radio);
  const before = row('secret');
  before?.focus();
  f.down.add('secret');
  f.v.kind = 'celesta';
  f.v.playing = true;
  f.change();
  expect(row('secret')).toBe(before);
  expect(document.activeElement).toBe(before);
  expect(desc('secret')).toBe('Dreamy celesta carols');
  expect(row('secret')?.disabled).toBe(false); // never "Unavailable right now"
});
