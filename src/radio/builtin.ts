import type { SceneId } from '../render/scenes';
import { CELESTA_ID, FIREPLACE_ID, MUSIC_BOX_ID, RAIN_ID, STORM_ID } from './ids';

export { CELESTA_ID, FIREPLACE_ID, MUSIC_BOX_ID, RAIN_ID, STORM_ID };
export const MUSIC_BOX_META = { id: MUSIC_BOX_ID, name: 'Music Box', description: 'Public-domain carols on a music box' } as const;

/** Built-in sources that are synthesized in the browser, so they work without the station catalog. */
export const isSynthSource = (
  id: string | null,
): id is typeof FIREPLACE_ID | typeof RAIN_ID | typeof STORM_ID | typeof MUSIC_BOX_ID | typeof CELESTA_ID =>
  id === FIREPLACE_ID || id === RAIN_ID || id === STORM_ID || id === MUSIC_BOX_ID || id === CELESTA_ID;

/** The ambiences (no music): synthesized live, each its own radio source. */
export type AmbientKind = 'fireplace' | 'rain' | 'storm';
export const AMBIENT_ID: Readonly<Record<AmbientKind, string>> = { fireplace: FIREPLACE_ID, rain: RAIN_ID, storm: STORM_ID };
export const ambientKind = (id: string | null): AmbientKind | null =>
  id === FIREPLACE_ID ? 'fireplace' : id === RAIN_ID ? 'rain' : id === STORM_ID ? 'storm' : null;
export const isAmbient = (kind: string | null): kind is AmbientKind => kind === 'fireplace' || kind === 'rain' || kind === 'storm';

/** Each scene suggests a station without forcing it (spec §5.2). */
export const SCENE_STATION: Readonly<Record<SceneId, string>> = {
  fireside: 'christmas-jazz',
  midnight: MUSIC_BOX_ID,
  frost: 'christmas-classics',
  sash: MUSIC_BOX_ID,
  square: 'christmas-classics',
  // The Parlour has a coal fire (embers and all): the fire suits it.
  parlour: FIREPLACE_ID,
};
