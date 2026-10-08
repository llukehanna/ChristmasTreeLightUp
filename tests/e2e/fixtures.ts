import { test as base, type TestInfo } from '@playwright/test';

export { expect } from '@playwright/test';

/** A private (10.x.y.z) address of its own for each test (and retry). */
export function testIp(info: Pick<TestInfo, 'testId' | 'workerIndex' | 'retry'>): string {
  let h = 0x811c9dc5;
  for (const c of `${info.testId}:${info.workerIndex}:${info.retry}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `10.${(h >>> 16) & 255}.${(h >>> 8) & 255}.${h & 255}`;
}

/**
 * Every e2e test reaches the Worker's /api/* with its own client IP (CF-Connecting-IP), so the limit of 200 starts
 * per IP per hour counts per test, not per run of the whole suite on one local D1. Miniflare only fills that header in
 * when it is missing; in production Cloudflare always overwrites it, so nothing changes there.
 *
 * Only same-origin /api/* requests get it (on any other origin the extra header would break CORS). A test's own route
 * that lets a request through must call route.fallback() (not continue()), so it still comes through here.
 */
export const test = base.extend({
  context: async ({ context, baseURL }, use, testInfo) => {
    const ip = testIp(testInfo);
    const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
    await context.route(
      (url) => url.origin === origin && url.pathname.startsWith('/api/'),
      (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }),
    );
    await use(context);
  },
});
