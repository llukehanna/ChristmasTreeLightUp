import { CELESTA_ID, SECRET_ID } from './ids';

/**
 * Secret mode's hold on the radio (spec 2026-10-08 secret mode §4.4), as a pure step: switching on by hand saves what
 * the radio was doing and plays the Secret station; switching off puts it back. A listener's own choice in between
 * wins: nothing is restored over it.
 */

/** What the radio was doing when secret mode took it over. */
export interface RadioSnapshot {
  /** The audible source (a station id, 'music-box', 'fireplace' or 'embed'), or null when nothing was playing. */
  source: string | null;
  /** The listener's saved settings at the time: music on, and the remembered source. */
  on: boolean;
  remembered: string | null;
}

export interface SecretState {
  on: boolean;
  saved: RadioSnapshot | null;
}

export type SecretEvent =
  | { type: 'on'; autoplay: boolean; muted: boolean; current: RadioSnapshot }
  | { type: 'off'; playingSecret: boolean; musicOn: boolean }
  | { type: 'choice' };

export type SecretEffect =
  | { kind: 'none' }
  | { kind: 'play-secret' }
  | { kind: 'restore'; to: RadioSnapshot }
  | { kind: 'leave'; resume: boolean };

export const SECRET_OFF: SecretState = { on: false, saved: null };
const NONE: SecretEffect = { kind: 'none' };

/** The sources only secret mode plays. */
export const isSecretSource = (id: string | null): boolean => id === SECRET_ID || id === CELESTA_ID;

export function secretStep(s: SecretState, e: SecretEvent): { state: SecretState; effect: SecretEffect } {
  switch (e.type) {
    case 'on':
      if (s.on) return { state: s, effect: NONE };
      if (e.autoplay && !e.muted) return { state: { on: true, saved: e.current }, effect: { kind: 'play-secret' } };
      return { state: { on: true, saved: null }, effect: NONE };
    case 'off':
      if (!s.on) return { state: s, effect: NONE };
      if (s.saved) return { state: SECRET_OFF, effect: { kind: 'restore', to: s.saved } };
      return { state: SECRET_OFF, effect: e.playingSecret ? { kind: 'leave', resume: e.musicOn } : NONE };
    case 'choice':
      return { state: s.saved ? { on: s.on, saved: null } : s, effect: NONE };
  }
}
