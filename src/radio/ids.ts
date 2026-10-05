// Ids of the built-in sources, with no imports: the station schema needs them, and the schema is shared with the
// Worker (worker/**), which must not pull in browser-only modules.
export const FIREPLACE_ID = 'fireplace';
/** Synthesized public-domain carols (`musicbox.ts`): always available, needs no catalog. */
export const MUSIC_BOX_ID = 'music-box';
