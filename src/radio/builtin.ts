import type { SceneId } from '../render/scenes';

export const FIREPLACE_ID = 'fireplace';
/** Synthesized public-domain carols (`musicbox.ts`): always available, needs no catalog. */
export const MUSIC_BOX_ID = 'music-box';
export const MUSIC_BOX_META = { id: MUSIC_BOX_ID, name: 'Music Box', description: 'Public-domain carols on a music box' } as const;

/** Built-in sources that are synthesized in the browser, so they work without the station catalog. */
export const isSynthSource = (id: string | null): id is typeof FIREPLACE_ID | typeof MUSIC_BOX_ID => id === FIREPLACE_ID || id === MUSIC_BOX_ID;

/** Each scene suggests a station without forcing it (spec §5.2). */
export const SCENE_STATION: Readonly<Record<SceneId, string>> = {
  fireside: 'christmas-jazz',
  midnight: MUSIC_BOX_ID,
  frost: 'christmas-classics',
};
