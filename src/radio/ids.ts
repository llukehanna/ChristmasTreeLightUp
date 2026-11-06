// Ids of the built-in sources, with no imports: the station schema needs them, and the schema is shared with the
// Worker (worker/**), which must not pull in browser-only modules.
export const FIREPLACE_ID = 'fireplace';
/** Synthesized rain on the window (`rain.ts`) and a storm with wind and thunder (`storm.ts`): no catalog needed. */
export const RAIN_ID = 'rain';
export const STORM_ID = 'storm';
/** Synthesized public-domain carols (`musicbox.ts`): always available, needs no catalog. */
export const MUSIC_BOX_ID = 'music-box';
/** Secret mode's fallback (spec 2026-10-08 secret mode §4.5): the Music Box's carols on a dreamy celesta. */
export const CELESTA_ID = 'celesta';
/** The Secret station (spec 2026-10-08 secret mode §4.1): listed in the game only in secret mode; the only station that may carry a win ad-lib. */
export const SECRET_ID = 'secret';

/** The sources only secret mode plays. */
export const isSecretSource = (id: string | null): boolean => id === SECRET_ID || id === CELESTA_ID;
