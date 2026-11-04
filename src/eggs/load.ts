/**
 * The easter eggs, loaded on first use (season two, task 12): Home Alone mode, secret mode (its aurora, its beat, its
 * win ad-lib) and the faces. Their code stays out of the main chunk; the detectors that see a trigger ("hohoho",
 * "kevin", five taps on the star, a saved mode) stay in it. Type-only imports here: none of this pulls code in.
 */
export interface EggModules {
  /** HomeAloneLayer and homeAloneAlpha (the renderer). */
  homeAlone: typeof import('../render/home-alone');
  /** paintHomeAlone: the room behind the tree (the renderer's backdrop). */
  homeAloneRoom: typeof import('../render/home-alone-room');
  /** HomeAloneSounds, KevinCall and hectorImageUrl (the app). */
  homeAloneSounds: typeof import('../audio/home-alone-sounds');
  /** HectorDesk and HectorGlare (the app). */
  hector: typeof import('../ui/hector');
  /** Aurora: secret mode's curtains (the renderer). */
  aurora: typeof import('../render/aurora');
  /** secretStep: secret mode's hold on the radio. */
  secret: typeof import('../radio/secret');
  /** BeatTracker: secret mode's beat, in the light show. */
  beat: typeof import('../radio/beat');
  /** WinSound: the Secret station's win ad-lib (the app). */
  winSound: typeof import('../radio/win-sound');
  /** beatPulse, garlandBob and the topper's nod (the renderer). */
  beatFx: typeof import('../render/beat-fx');
  /** fillBeatFrame (the app). */
  beatFrame: typeof import('../render/beat-frame');
  /** faceBulbTile, faceGarlandIndex and FACE_CONFETTI_PX (the renderer). */
  faces: typeof import('../render/faces');
  /** FaceSprites (the renderer). */
  faceSprites: typeof import('../render/face-sprites');
  /** PizzaSprite and PIZZA_PX: Home Alone's confetti (the renderer). */
  pizza: typeof import('../render/pizza');
}

let eggs: Promise<EggModules> | null = null;

/**
 * Loads the eggs (one chunk), once: every call returns the same promise. A failed load (offline, a deploy that replaced
 * the chunk) is forgotten, so the next call asks again (Chromium answers a failed dynamic import from its module map
 * for the page's life; other browsers may fetch it anew).
 */
export function loadEggs(): Promise<EggModules> {
  if (eggs) return eggs;
  const p = import('./eggs').then((m) => m.EGGS);
  eggs = p;
  p.catch(() => {
    if (eggs === p) eggs = null;
  });
  return p;
}

/** How long a saved mode's boot waits for the eggs before it carries on without them. */
export const EGGS_BOOT_WAIT_MS = 2500;

/**
 * Resolves true as soon as `p` settles (resolved or rejected), or false after `ms` if it has not: a load that stalls
 * (a dynamic `import()` that never answers) must not hold the first tree back. `p` is left running either way.
 */
export function settledWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    p.then(done, done);
  });
}
