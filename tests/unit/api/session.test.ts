import { describe, expect, it } from 'vitest';
import { SESSION_SECONDS, createToken, passwordMatches, readCookie, sessionCookie, sessionKey, verifyToken } from '../../../api/_lib/session';

const KEY = sessionKey('correct horse battery staple');

describe('session tokens', () => {
  it('derives a stable 32-byte key from the password', () => {
    expect(KEY.length).toBe(32);
    expect(sessionKey('correct horse battery staple').equals(KEY)).toBe(true);
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
