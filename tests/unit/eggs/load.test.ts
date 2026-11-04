// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { loadEggs, type EggModules } from '../../../src/eggs/load';

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
