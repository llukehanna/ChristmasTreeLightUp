// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEggs, settledWithin, type EggModules } from '../../../src/eggs/load';

/** Every key of EggModules, checked both ways by the compiler (a missing or extra key fails typecheck). */
const KEYS: Record<keyof EggModules, true> = {
  homeAlone: true,
  homeAloneRoom: true,
  homeAloneSounds: true,
  hector: true,
  aurora: true,
  secret: true,
  beat: true,
  winSound: true,
  beatFx: true,
  beatFrame: true,
  faces: true,
  faceSprites: true,
  pizza: true,
};

it('loadEggs() is memoised: called twice, the same promise', () => {
  const a = loadEggs();
  const b = loadEggs();
  expect(b).toBe(a);
});

it('resolves an object with every key of EggModules, each a loaded module', async () => {
  const eggs = await loadEggs();
  expect(Object.keys(eggs).sort()).toEqual(Object.keys(KEYS).sort());
  // What renderer.ts and app.ts make from them once loaded.
  expect(eggs.homeAlone.HomeAloneLayer).toBeTypeOf('function');
  expect(eggs.homeAlone.homeAloneAlpha).toBeTypeOf('function');
  expect(eggs.homeAloneRoom.paintHomeAlone).toBeTypeOf('function');
  expect(eggs.homeAloneSounds.HomeAloneSounds).toBeTypeOf('function');
  expect(eggs.homeAloneSounds.KevinCall).toBeTypeOf('function');
  expect(eggs.homeAloneSounds.hectorImageUrl).toBeTypeOf('function');
  expect(eggs.hector.HectorDesk).toBeTypeOf('function');
  expect(eggs.hector.HectorGlare).toBeTypeOf('function');
  expect(eggs.aurora.Aurora).toBeTypeOf('function');
  expect(eggs.secret.secretStep).toBeTypeOf('function');
  expect(eggs.beat.BeatTracker).toBeTypeOf('function');
  expect(eggs.winSound.WinSound).toBeTypeOf('function');
  expect(eggs.beatFx.beatPulse).toBeTypeOf('function');
  expect(eggs.beatFx.garlandBob).toBeTypeOf('function');
  expect(eggs.beatFrame.fillBeatFrame).toBeTypeOf('function');
  expect(eggs.faces.faceBulbTile).toBeTypeOf('function');
  expect(eggs.faceSprites.FaceSprites).toBeTypeOf('function');
  expect(eggs.pizza.PizzaSprite).toBeTypeOf('function');
  // Still the same promise once settled.
  expect(await loadEggs()).toBe(eggs);
});

describe('settledWithin', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves true when the promise resolves in time', async () => {
    vi.useFakeTimers();
    let done!: () => void;
    const p = new Promise<void>((r) => (done = r));
    const r = settledWithin(p, 2500);
    done();
    await expect(r).resolves.toBe(true);
  });

  it('resolves true when the promise rejects in time (a failed load carries on too)', async () => {
    vi.useFakeTimers();
    await expect(settledWithin(Promise.reject(new Error('offline')), 2500)).resolves.toBe(true);
  });

  it('resolves false after the timeout when the promise never settles', async () => {
    vi.useFakeTimers();
    const r = settledWithin(new Promise(() => {}), 2500);
    let settled: boolean | null = null;
    void r.then((v) => (settled = v));
    await vi.advanceTimersByTimeAsync(2499);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
  });

  it('a late settle after the timeout changes nothing', async () => {
    vi.useFakeTimers();
    let done!: () => void;
    const r = settledWithin(new Promise<void>((res) => (done = res)), 100);
    await vi.advanceTimersByTimeAsync(100);
    done();
    await expect(r).resolves.toBe(false);
  });
});
