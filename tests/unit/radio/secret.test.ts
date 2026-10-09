import { describe, expect, it } from 'vitest';
import { SECRET_OFF, isSecretSource, secretStep, type RadioSnapshot, type SecretState } from '../../../src/radio/secret';

const jazz: RadioSnapshot = { source: 'christmas-jazz', pending: false, on: true, remembered: 'christmas-jazz' };
const on = (autoplay: boolean, muted = false) => ({ type: 'on' as const, autoplay, muted, current: jazz });
const off = (playingSecret: boolean, musicOn = true) => ({ type: 'off' as const, playingSecret, musicOn });

describe('secretStep (spec §4.4)', () => {
  it('by hand and not muted: saves what was playing and plays the Secret station', () => {
    expect(secretStep(SECRET_OFF, on(true))).toEqual({ state: { on: true, saved: jazz }, effect: { kind: 'play-secret' } });
  });
  it('a quiet switch, or a muted radio: on, nothing saved, nothing played', () => {
    expect(secretStep(SECRET_OFF, on(false))).toEqual({ state: { on: true, saved: null }, effect: { kind: 'none' } });
    expect(secretStep(SECRET_OFF, on(true, true))).toEqual({ state: { on: true, saved: null }, effect: { kind: 'none' } });
  });
  it('on again is a no-op', () => {
    const s: SecretState = { on: true, saved: jazz };
    expect(secretStep(s, on(true))).toEqual({ state: s, effect: { kind: 'none' } });
  });
  it('off with something saved restores it', () => {
    expect(secretStep({ on: true, saved: jazz }, off(true))).toEqual({ state: SECRET_OFF, effect: { kind: 'restore', to: jazz } });
  });
  it('off with nothing saved: leaves a secret source (resuming if music is on), else does nothing', () => {
    expect(secretStep({ on: true, saved: null }, off(true, true))).toEqual({ state: SECRET_OFF, effect: { kind: 'leave', resume: true } });
    expect(secretStep({ on: true, saved: null }, off(true, false))).toEqual({ state: SECRET_OFF, effect: { kind: 'leave', resume: false } });
    expect(secretStep({ on: true, saved: null }, off(false))).toEqual({ state: SECRET_OFF, effect: { kind: 'none' } });
  });
  it('off again is a no-op', () => {
    expect(secretStep(SECRET_OFF, off(true))).toEqual({ state: SECRET_OFF, effect: { kind: 'none' } });
  });
  it("the listener's own choice drops what was saved", () => {
    expect(secretStep({ on: true, saved: jazz }, { type: 'choice' })).toEqual({ state: { on: true, saved: null }, effect: { kind: 'none' } });
    expect(secretStep(SECRET_OFF, { type: 'choice' }).state).toBe(SECRET_OFF);
  });
  it('knows the sources only secret mode plays', () => {
    expect(['secret', 'celesta', 'music-box', null].map(isSecretSource)).toEqual([true, true, false, false]);
  });
});
