import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  HOME_ALONE_CLIPS, HomeAloneSounds, hectorImageUrl, KEVIN_AWAY_MS, KEVIN_EVERY_MS, KevinCall, MUSIC_ORIGIN, clipUrl, type ClipBus,
} from '../../../src/audio/home-alone-sounds';
import { WinSound } from '../../../src/radio/win-sound';

function fakeCtx() {
  const started: unknown[] = [];
  const ctx = {
    decodeAudioData: vi.fn(async (b: ArrayBuffer) => ({ length: b.byteLength, duration: 1.5 })),
    createBufferSource: () => {
      const src = { buffer: null as unknown, connect: vi.fn(), start: () => started.push(src) };
      return src;
    },
  };
  return { ctx: ctx as unknown as AudioContext, started };
}
const out = {} as AudioNode;
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Enough macrotask turns for a mocked fetch, arrayBuffer and decode to have settled (for "nothing happened" checks). */
const settle = async () => {
  for (let k = 0; k < 10; k++) await flush();
};

function rig(volume = 0.8, ok = true) {
  const fetchFn = vi.fn(async (_url: RequestInfo | URL) => (ok ? new Response(new Uint8Array(8)) : new Response('', { status: 404 })));
  const { ctx, started } = fakeCtx();
  const bus: ClipBus = { ctx, out, volume };
  const duck = vi.fn();
  const s = new HomeAloneSounds(() => bus, duck, () => new WinSound(fetchFn as unknown as typeof fetch), MUSIC_ORIGIN);
  return { s, bus, fetchFn, started, duck };
}

it("the clips live under effects/home-alone/ on the public music origin, which is wrangler.jsonc's MUSIC_BASE_URL", () => {
  const config = readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8');
  expect(config).toContain(`"MUSIC_BASE_URL": "${MUSIC_ORIGIN}"`);
  expect(HOME_ALONE_CLIPS.map((c) => clipUrl(c, MUSIC_ORIGIN))).toEqual([
    'https://aglow-music.lukeghanna.com/effects/home-alone/scream.mp3',
    'https://aglow-music.lukeghanna.com/effects/home-alone/kevin.mp3',
    'https://aglow-music.lukeghanna.com/effects/home-alone/filthy-animal.mp3',
    'https://aglow-music.lukeghanna.com/effects/home-alone/hector-credit-card.mp3',
    'https://aglow-music.lukeghanna.com/effects/home-alone/hector-mistaken.mp3',
    'https://aglow-music.lukeghanna.com/effects/home-alone/hector-love.mp3',
  ]);
  expect(clipUrl('kevin', '')).toBe('/effects/home-alone/kevin.mp3'); // npm run dev serves them itself
});

it("Mr. Hector's still lives beside the clips (never in the repo)", () => {
  expect(hectorImageUrl(MUSIC_ORIGIN)).toBe('https://aglow-music.lukeghanna.com/effects/home-alone/hector.jpg');
  expect(hectorImageUrl('')).toBe('/effects/home-alone/hector.jpg');
});

describe('HomeAloneSounds', () => {
  it('plays a clip once on the effects bus, ducking the music for its length; playing it again never refetches', async () => {
    const { s, fetchFn, started, duck } = rig();
    s.play('scream');
    await vi.waitFor(() => expect(started).toHaveLength(1));
    await vi.waitFor(() => expect(duck).toHaveBeenCalledWith(1.5));
    s.play('scream');
    await vi.waitFor(() => expect(started).toHaveLength(2));
    await settle();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(s.asked.scream).toBe(2);
    expect(s.played.scream).toBe(2);
  });

  it('preload fetches each clip once, ahead of need', async () => {
    const { s, fetchFn } = rig();
    s.preload();
    s.preload();
    expect(fetchFn.mock.calls.map((c) => String(c[0]))).toEqual(HOME_ALONE_CLIPS.map((c) => clipUrl(c, MUSIC_ORIGIN)));
  });

  it('nothing at all with the effects volume at 0 or no audio context: nothing fetched, nothing asked', async () => {
    const { s, bus, fetchFn } = rig(0);
    s.preload();
    s.play('kevin');
    bus.volume = 0.8;
    bus.ctx = null;
    s.preload();
    s.play('kevin');
    await settle();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(s.asked.kevin).toBe(0);
  });

  it('turned up later (nothing preloaded), the first play fetches the clip then and plays it', async () => {
    const { s, bus, fetchFn, started } = rig(0);
    s.preload();
    expect(fetchFn).not.toHaveBeenCalled();
    bus.volume = 0.5;
    s.play('filthy-animal');
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a missing clip is silence: asked, never played, no duck', async () => {
    const { s, started, duck } = rig(0.8, false);
    s.play('scream');
    await settle();
    expect(s.asked.scream).toBe(1);
    expect(s.played.scream).toBe(0);
    expect(started).toHaveLength(0);
    expect(duck).not.toHaveBeenCalled();
  });

  it('a clip whose moment has passed (mode off, a new tree) by the time it decodes is not played', async () => {
    const { s, started } = rig();
    let still = true;
    s.play('filthy-animal', () => still);
    still = false;
    await settle();
    expect(started).toHaveLength(0);
    expect(s.played['filthy-animal']).toBe(0);
  });

  it('play() says whether it asked: not with the effects volume at 0, no context, or a clip that failed under a minute ago', async () => {
    const { s, bus, fetchFn } = rig(0.8, false);
    expect(s.play('scream')).toBe(true);
    await settle();
    expect(s.play('scream')).toBe(false); // just failed: left alone, nothing fetched
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(s.asked.scream).toBe(1);
    bus.volume = 0;
    expect(s.play('kevin')).toBe(false);
    bus.volume = 0.8;
    bus.ctx = null;
    expect(s.play('kevin')).toBe(false);
  });
});

describe('HomeAloneSounds.playResumed (Kevin!, back from the background)', () => {
  function suspended(resumes: 'run' | 'stay' | 'reject') {
    const r = rig();
    const ctx = r.bus.ctx as unknown as { state: string; resume: () => Promise<void> };
    ctx.state = 'suspended';
    ctx.resume = vi.fn(async () => {
      if (resumes === 'reject') throw new Error('not allowed');
      if (resumes === 'run') ctx.state = 'running';
    });
    return { ...r, ctx };
  }

  it('a running context plays at once', async () => {
    const r = rig();
    (r.bus.ctx as unknown as { state: string }).state = 'running';
    expect(await r.s.playResumed('kevin', () => true)).toBe(true);
    await vi.waitFor(() => expect(r.started).toHaveLength(1));
  });

  it('a suspended context is resumed first, then the clip plays', async () => {
    const { s, ctx, started } = suspended('run');
    expect(await s.playResumed('kevin', () => true)).toBe(true);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(started).toHaveLength(1));
  });

  it("skipped when the context can't run (resume refused or still suspended), or the moment passed while it resumed", async () => {
    for (const how of ['reject', 'stay'] as const) {
      const { s, started } = suspended(how);
      expect(await s.playResumed('kevin', () => true)).toBe(false);
      expect(s.asked.kevin).toBe(0);
      await settle();
      expect(started).toHaveLength(0);
    }
    const { s } = suspended('run');
    expect(await s.playResumed('kevin', () => false)).toBe(false);
    expect(s.asked.kevin).toBe(0);
  });

  it('nothing resumed or asked with the effects volume at 0', async () => {
    const { s, bus, ctx } = suspended('run');
    bus.volume = 0;
    expect(await s.playResumed('kevin', () => true)).toBe(false);
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});

describe('KevinCall', () => {
  const yes = () => true;
  it('"Kevin!" only back from ≥ 3 s away, with a run in progress, at most once per 30 s', async () => {
    const k = new KevinCall();
    expect(await k.show(1000, true, yes)).toBe(false); // never hidden
    k.hide(0);
    expect(await k.show(KEVIN_AWAY_MS - 1, true, yes)).toBe(false);
    k.hide(10_000);
    expect(await k.show(10_000 + KEVIN_AWAY_MS, false, yes)).toBe(false); // no run in progress
    k.hide(20_000);
    expect(await k.show(20_000 + KEVIN_AWAY_MS, true, yes)).toBe(true);
    const last = 20_000 + KEVIN_AWAY_MS;
    k.hide(last + 1000);
    expect(await k.show(last + 1000 + 5000, true, yes)).toBe(false); // within 30 s of the last
    k.hide(last + KEVIN_EVERY_MS);
    expect(await k.show(last + KEVIN_EVERY_MS + KEVIN_AWAY_MS, true, yes)).toBe(true);
  });

  it('only a call actually asked for spends the 30 s: one that was not asked leaves the next return free', async () => {
    const k = new KevinCall();
    const ask = vi.fn(() => false);
    k.hide(0);
    expect(await k.show(KEVIN_AWAY_MS, true, ask)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    k.hide(KEVIN_AWAY_MS + 1000);
    expect(await k.show(2 * KEVIN_AWAY_MS + 1000, true, async () => true)).toBe(true);
  });

  it('a call still being asked (the context resuming) is not asked again by a quick second return', async () => {
    const k = new KevinCall();
    let answer!: (asked: boolean) => void;
    k.hide(0);
    const first = k.show(KEVIN_AWAY_MS, true, () => new Promise<boolean>((r) => (answer = r)));
    k.hide(KEVIN_AWAY_MS + 10);
    const ask = vi.fn(() => true);
    expect(await k.show(2 * KEVIN_AWAY_MS + 10, true, ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    answer(true);
    expect(await first).toBe(true);
  });
});
