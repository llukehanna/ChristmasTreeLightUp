import type { SceneId } from '../render/scenes';

export const FIREPLACE_ID = 'fireplace';
export const PIANO_ID = 'piano-carols';
export const PIANO_META = { id: PIANO_ID, name: 'Piano Carols', description: 'Public-domain carols, solo piano' } as const;

/** Each scene suggests a station without forcing it (spec §5.2). */
export const SCENE_STATION: Readonly<Record<SceneId, string>> = {
  fireside: 'christmas-jazz',
  midnight: PIANO_ID,
  frost: 'christmas-classics',
};
