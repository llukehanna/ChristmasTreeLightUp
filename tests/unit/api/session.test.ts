import { afterEach, describe, expect, it, vi } from 'vitest';
import { COOKIE, SESSION_SECONDS, createToken, env, isAdmin, passwordMatches, readCookie, sessionCookie, sessionKey, verifyToken } from '../../../api/_lib/session';

const KEY = sessionKey('correct horse battery staple');

describe('session tokens', () => {
  it('derives a stable 32-byte key from the password', () => {
    expect(KEY.length).toBe(32);
    expect(sessionKey('correct horse battery staple').equals(KEY)).toBe(true);
  });
  it('matches a known answer (fails if the scrypt params, salt or HKDF info change)', () => {
    expect(KEY.toString('hex')).toBe('dda93777857358e01266656aee7816667401570f9175e6e0b18ec7914b737793');
  });
  it('memoises the derived key per password', () => {
    expect(sessionKey('correct horse battery staple')).toBe(KEY);
  });
  it('verifies its own tokens until they expire', () => {
    const t = createToken(KEY, 1000);
    expect(verifyToken(t, KEY, 1000)).toBe(true);
    expect(verifyToken(t, KEY, 1000 + SESSION_SECONDS + 1)).toBe(false);
  });
  it('rejects tampered and missing tokens', () => {
    const t = createToken(KEY, 1000);
    const [exp, sig] = t.split('.');
    expect(verifyToken(`${Number(exp) + 999}.${sig}`, KEY, 1000)).toBe(false);
    expect(verifyToken(undefined, KEY, 1000)).toBe(false);
    expect(verifyToken('garbage', KEY, 1000)).toBe(false);
  });
  it('rejects anything but the exact token format', () => {
    const t = createToken(KEY, 1000);
    const [exp, sig] = t.split('.');
    const bad = [
      `+${exp}.${sig}`,
      `0${exp}.${sig}`, // a leading zero would otherwise still carry a valid signature
      `0x1.${sig}`,
      `1e3.${sig}`,
      ` ${exp}.${sig}`,
      `${exp}.${sig} `,
      `${exp}.${sig}.x`,
      `${exp}.${sig}.`,
      `${exp}.${sig.slice(1)}`,
      `.${sig}`,
      `${exp}.`,
      `${'9'.repeat(13)}.${sig}`,
    ];
    for (const b of bad) expect(verifyToken(b, KEY, 1000), b).toBe(false);
    expect(verifyToken(t, KEY, 1000)).toBe(true);
  });
  it('rejects tokens made under a different password, so changing the password logs everyone out', () => {
    const old = createToken(sessionKey('old password'), 1000);
    expect(verifyToken(old, sessionKey('old password'), 1000)).toBe(true);
    expect(verifyToken(old, sessionKey('new password'), 1000)).toBe(false);
  });
  it('compares passwords exactly', () => {
    expect(passwordMatches('correct horse', 'correct horse')).toBe(true);
    expect(passwordMatches('correct hors', 'correct horse')).toBe(false);
  });
  it('reads cookies and writes a locked-down session cookie', () => {
    const req = new Request('https://x/', { headers: { cookie: 'a=1; aglow_admin=tok%2Ben; b=2' } });
    expect(readCookie(req, 'aglow_admin')).toBe('tok+en');
    expect(readCookie(new Request('https://x/', { headers: { cookie: 'aglow_admin=%E0%A4%A' } }), 'aglow_admin')).toBeUndefined();
    expect(sessionCookie('t')).toBe('aglow_admin=t; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800');
  });
});

describe('env', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('treats empty and whitespace-only values as unset', () => {
    vi.stubEnv('AGLOW_T', '');
    expect(() => env('AGLOW_T')).toThrow('AGLOW_T is not set');
    vi.stubEnv('AGLOW_T', '   ');
    expect(() => env('AGLOW_T')).toThrow('AGLOW_T is not set');
    vi.stubEnv('AGLOW_T', 'v');
    expect(env('AGLOW_T')).toBe('v');
  });
});

describe('isAdmin', () => {
  afterEach(() => vi.unstubAllEnvs());
  const reqWith = (cookie: string): Request => new Request('https://x/', { headers: { cookie } });
  it('accepts a real token and rejects missing, foreign and expired ones', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'hunter2 hunter2');
    const now = Math.floor(Date.now() / 1000);
    const good = createToken(sessionKey('hunter2 hunter2'), now);
    expect(isAdmin(reqWith(`${COOKIE}=${good}`))).toBe(true);
    expect(isAdmin(new Request('https://x/'))).toBe(false);
    expect(isAdmin(reqWith(`${COOKIE}=${createToken(sessionKey('other password'), now)}`))).toBe(false);
    expect(isAdmin(reqWith(`${COOKIE}=${createToken(sessionKey('hunter2 hunter2'), now - SESSION_SECONDS - 5)}`))).toBe(false);
  });
  it('throws when ADMIN_PASSWORD is not set', () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect(() => isAdmin(new Request('https://x/'))).toThrow('ADMIN_PASSWORD is not set');
  });
});
