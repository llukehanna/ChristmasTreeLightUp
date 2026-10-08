import type { Bucket } from './lib/bucket.js';
import type { Db } from './lib/db.js';
import type { AppEnv, Ctx, RateLimitBinding } from './lib/env.js';
import { handle } from './router.js';

/** The real bindings (wrangler.jsonc). Only this file and tsconfig.worker.json know the Workers runtime types. */
export interface Env {
  /** R2 bucket "aglow-music": stations/current.json plus uploaded tracks/ and covers/. */
  MUSIC: R2Bucket;
  /** Public origin of the bucket (R2 custom domain), no trailing slash. */
  MUSIC_BASE_URL: string;
  /** D1 database "aglow": users, sessions and games (migrations/). */
  DB: D1Database;
  AUTH_MODE?: string;
  /** Secret: 256 random bits keying session, claim and IP hashes. */
  AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  /** Secret, pasted by Luke from the Google console. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma-separated, compared lower-cased: the radio admin's Google email(s). */
  ADMIN_EMAILS?: string;
  /** Secret, set by Luke. */
  ADMIN_PASSWORD?: string;
  /** Secret, 256 random bits that nobody sees. */
  SESSION_SECRET?: string;
  /** Optional ratelimit binding for login attempts. */
  LOGIN_LIMITER?: RateLimit;
}

// Type-level proofs that the runtime types satisfy the structural ones worker/lib and worker/routes are written against.
type Assignable<T extends U, U> = T;
export type BucketCheck = Assignable<R2Bucket, Bucket>;
export type DbCheck = Assignable<D1Database, Db>;
export type LimiterCheck = Assignable<RateLimit, RateLimitBinding>;
export type CtxCheck = Assignable<ExecutionContext, Ctx>;
export type EnvCheck = Assignable<Env, AppEnv>;

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
