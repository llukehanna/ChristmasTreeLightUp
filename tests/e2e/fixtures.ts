import { test as base, type BrowserContext, type TestInfo } from '@playwright/test';

export { expect } from '@playwright/test';

/** A private (10.x.y.z) address of its own for each test (and retry). */
export function testIp(info: Pick<TestInfo, 'testId' | 'workerIndex' | 'retry'>): string {
  let h = 0x811c9dc5;
  for (const c of `${info.testId}:${info.workerIndex}:${info.retry}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `10.${(h >>> 16) & 255}.${(h >>> 8) & 255}.${h & 255}`;
}

/**
 * A returning visitor: the first-visit opening (src/ui/opening.ts) has played, so it never plays here. Every test's own
 * context gets this (unless `firstVisit`); a context a test makes for itself calls it too.
 */
export async function returning(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('aglow.opened', 'true');
    } catch {
      // A page without storage (about:blank): nothing to open there.
    }
  });
}

/**
 * This device has already started today's Daily Tree (aglow.daily, src/store/daily.ts), so its first tree is a random
 * one, as before the Daily: the tests written for random trees keep them. The Daily's own tests opt out.
 */
export async function dailyStarted(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      const d = new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      localStorage.setItem('aglow.daily', JSON.stringify(day));
    } catch {
      // A page without storage (about:blank).
    }
  });
}

/**
 * Every e2e test reaches the Worker's /api/* with its own client IP (CF-Connecting-IP), so the limit of 200 starts
 * per IP per hour counts per test, not per run of the whole suite on one local D1. Miniflare only fills that header in
 * when it is missing; in production Cloudflare always overwrites it, so nothing changes there.
 *
 * Only same-origin /api/* requests get it (on any other origin the extra header would break CORS). A test's own route
 * that lets a request through must call route.fallback() (not continue()), so it still comes through here.
 */
export const test = base.extend<{ firstVisit: boolean; daily: boolean }>({
  /** The browser has never been here: the opening plays (tests/e2e/opening.spec.ts). Otherwise it is a returning visitor. */
  firstVisit: [false, { option: true }],
  /** The first tree may be the Daily Tree (this device hasn't started today's). Otherwise it has: see dailyStarted. */
  daily: [false, { option: true }],
  context: async ({ context, baseURL, firstVisit, daily }, use, testInfo) => {
    const ip = testIp(testInfo);
    const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
    await context.route(
      (url) => url.origin === origin && url.pathname.startsWith('/api/'),
      (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }),
    );
    if (!firstVisit) await returning(context);
    if (!daily) await dailyStarted(context);
    await use(context);
  },
});
