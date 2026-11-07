/**
 * Watching a replay (C4), loaded on first use as the eggs are (src/eggs/load.ts): the playback, the replay bar, the
 * frames that drive them and their styles stay out of the main chunk until a Watch button is pressed. The app imports
 * types only from here.
 */
import '../ui/replay.css';

export { Playback } from '../core/playback';
export { ReplayBar, replayCaption } from '../ui/replay-bar';
export { Replayer, type ReplayRun } from './replayer';
