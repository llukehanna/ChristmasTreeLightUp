import type { SceneId } from '../render/scenes';
import { CELESTA_ID, FIREPLACE_ID, MUSIC_BOX_ID } from './ids';

export { CELESTA_ID, FIREPLACE_ID, MUSIC_BOX_ID };
export const MUSIC_BOX_META = { id: MUSIC_BOX_ID, name: 'Music Box', description: 'Public-domain carols on a music box' } as const;

/** Built-in sources that are synthesized in the browser, so they work without the station catalog. */
export const isSynthSource = (id: string | null): id is typeof FIREPLACE_ID | typeof MUSIC_BOX_ID | typeof CELESTA_ID =>
  id === FIREPLACE_ID || id === MUSIC_BOX_ID || id === CELESTA_ID;

/** Each scene suggests a station without forcing it (spec §5.2). */
export const SCENE_STATION: Readonly<Record<SceneId, string>> = {
  fireside: 'christmas-jazz',
  midnight: MUSIC_BOX_ID,
  frost: 'christmas-classics',
};
