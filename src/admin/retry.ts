import { ApiError } from './api.js';

/** How long an upload waits before its one automatic retry. */
export const RETRY_DELAY_MS = 1500;

/**
 * Worth trying again by itself: the server could not be reached (status 0) or answered 5xx. Not a 401 (the queue
 * pauses for sign-in), not another 4xx (the file or request is wrong), and not "Upload stalled" (already waited
 * the full stall time; the row offers Retry).
 */
export function retryableUploadError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.message === 'Upload cancelled') return false;
  return e.status === 0 || e.status >= 500;
}

/** Runs `attempt`; when it fails with an error `retryIf` accepts, waits `delayMs` and runs it exactly once more. */
export async function retryOnce<T>(attempt: () => Promise<T>, retryIf: (e: unknown) => boolean = retryableUploadError, delayMs = RETRY_DELAY_MS): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if (!retryIf(e)) throw e;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return attempt();
  }
}
