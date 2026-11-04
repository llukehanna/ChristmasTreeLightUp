import * as homeAloneSounds from '../audio/home-alone-sounds';
import * as beat from '../radio/beat';
import * as secret from '../radio/secret';
import * as winSound from '../radio/win-sound';
import * as aurora from '../render/aurora';
import * as beatFrame from '../render/beat-frame';
import * as beatFx from '../render/beat-fx';
import * as faceSprites from '../render/face-sprites';
import * as faces from '../render/faces';
import * as homeAlone from '../render/home-alone';
import * as homeAloneRoom from '../render/home-alone-room';
import * as pizza from '../render/pizza';
import * as hector from '../ui/hector';
import type { EggModules } from './load';

/** The eggs' chunk (src/eggs/load.ts imports it dynamically): every egg module, in one request. */
export const EGGS: EggModules = { homeAlone, homeAloneRoom, homeAloneSounds, hector, aurora, secret, beat, winSound, beatFx, beatFrame, faces, faceSprites, pizza };
