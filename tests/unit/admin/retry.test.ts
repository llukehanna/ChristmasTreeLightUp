import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/admin/api';
import { RETRY_DELAY_MS, retryableUploadError, retryOnce } from '../../../src/admin/retry';

describe('retryableUploadError', () => {
  it('accepts an unreachable server (status 0) and any 5xx', () => {
    expect(retryableUploadError(new ApiError(0, "Couldn't reach the server."))).toBe(true);
    for (const status of [500, 502, 503, 504]) expect(retryableUploadError(new ApiError(status, 'Upload failed. Try again.'))).toBe(true);
  });
  it('refuses 401 and other 4xx, a stall, a cancel, and anything that is not an ApiError', () => {
    for (const status of [400, 401, 403, 411, 413, 415, 429]) expect(retryableUploadError(new ApiError(status, 'no')), String(status)).toBe(false);
    expect(retryableUploadError(new Error('Upload stalled'))).toBe(false);
    expect(retryableUploadError(new ApiError(0, 'Upload cancelled'))).toBe(false);
    expect(retryableUploadError('boom')).toBe(false);
    expect(retryableUploadError(null)).toBe(false);
  });
});

describe('retryOnce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not wait or retry when the first attempt works', async () => {
    const attempt = vi.fn().mockResolvedValue('ok');
    await expect(retryOnce(attempt)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries once after about 1.5 s on a network error, and returns the second attempt', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new ApiError(0, 'down')).mockResolvedValueOnce('ok');
    const result = retryOnce(attempt);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(RETRY_DELAY_MS).toBe(1500);
  });

  it('retries a 5xx, and fails with the second error (never a third attempt)', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new ApiError(503, 'first')).mockRejectedValueOnce(new ApiError(503, 'second'));
    const result = retryOnce(attempt);
    const settled = expect(result).rejects.toMatchObject({ status: 503, message: 'second' });
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 10);
    await settled;
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('never retries 401, other 4xx or a stall', async () => {
    for (const e of [new ApiError(401, 'Not signed in'), new ApiError(413, 'too large'), new Error('Upload stalled')]) {
      const attempt = vi.fn().mockRejectedValue(e);
      await expect(retryOnce(attempt)).rejects.toBe(e);
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });
});
