import type { Bucket } from './bucket.js';
import type { Db } from './db.js';

/** The slice of a Workers rate-limit binding the login route uses. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Bindings as the routes see them (structural; worker/index.ts proves the real Env satisfies this). */
export interface AppEnv {
  MUSIC: Bucket;
  /** Public origin of the bucket (its R2 custom domain), e.g. "https://aglow-music.lukeghanna.com". */
  MUSIC_BASE_URL: string;
  /** D1 database "aglow": users, sessions and games. */
  DB: Db;
  /** "google" (default) or "fake" (localhost only: sign in as ?as=<email> without Google). */
  AUTH_MODE?: string;
  /** Secret: 256 random bits keying session, claim and IP hashes. */
  AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  /** Secret, pasted by Luke from the Google console. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma-separated, compared lower-cased: the radio admin's Google email(s). */
  ADMIN_EMAILS?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  LOGIN_LIMITER?: RateLimitBinding;
}

/** The slice of ExecutionContext the routes use. */
export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

/** A route handler. `params` are the route pattern's capture groups. */
export type Handler = (req: Request, env: AppEnv, ctx: Ctx, params: readonly string[]) => Response | Promise<Response>;
