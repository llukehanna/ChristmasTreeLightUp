import { describe, expect, it } from 'vitest';
import {
  COOKIE,
  SESSION_SECONDS,
  adminSecrets,
  clearCookie,
  createToken,
  isAdmin,
  passwordMatches,
  readCookie,
  sessionCookie,
  sessionKey,
  verifyToken,
} from '../../../worker/lib/session';

const SECRET = 'test-session-secret-not-real';
const PASSWORD = 'correct horse battery staple';
const KEY = await sessionKey(SECRET, PASSWORD);

describe('session key', () => {
  it('matches a known answer (fails if the derivation, label or token format change)', async () => {
    // HMAC-SHA256(SECRET, "aglow-admin-v1\0" + PASSWORD) is the key; the token signs "admin.<exp>" with it.
    expect(await createToken(KEY, 1000)).toBe('605800.9ltauFUhaBoS3k2vfkoevtHDQxYSzcMPBA6TwVza5ts');
  });
  it('memoises the key for the same secret and password', async () => {
    expect(await sessionKey(SECRET, PASSWORD)).toBe(KEY);
  });
  it('keeps only the latest key, so an old one is recomputed, not retained', async () => {
    const other = await sessionKey(SECRET, 'some other password');
    expect(other).not.toBe(KEY);
    expect(await sessionKey(SECRET, 'some other password')).toBe(other);
    const again = await sessionKey(SECRET, PASSWORD);
    expect(again).not.toBe(KEY);
    expect(await createToken(again, 1000)).toBe(await createToken(KEY, 1000));
  });
  it('is not extractable', () => {
    expect(KEY.extractable).toBe(false);
  });
  it('depends on both values and does not confuse where one ends and the other begins', async () => {
    const t = await createToken(KEY, 1000);
    const forged = [
      await sessionKey('another secret', PASSWORD),
      await sessionKey(SECRET, 'another password'),
      await sessionKey(`${SECRET}x`, PASSWORD.slice(1)),
    ];
    for (const k of forged) expect(await verifyToken(t, k, 1000)).toBe(false);
  });
});

describe('session tokens', () => {
  it('verifies its own tokens until they expire', async () => {
    const t = await createToken(KEY, 1000);
    expect(await verifyToken(t, KEY, 1000)).toBe(true);
    expect(await verifyToken(t, KEY, 1000 + SESSION_SECONDS)).toBe(true);
    expect(await verifyToken(t, KEY, 1000 + SESSION_SECONDS + 1)).toBe(false);
  });
  it('rejects tampered and missing tokens', async () => {
    const t = await createToken(KEY, 1000);
    const [exp, sig] = t.split('.');
    expect(await verifyToken(`${Number(exp) + 999}.${sig}`, KEY, 1000)).toBe(false);
    const flipped = `${sig.slice(0, 10)}${sig[10] === 'A' ? 'B' : 'A'}${sig.slice(11)}`;
    expect(await verifyToken(`${exp}.${flipped}`, KEY, 1000)).toBe(false);
    expect(await verifyToken(undefined, KEY, 1000)).toBe(false);
    expect(await verifyToken('garbage', KEY, 1000)).toBe(false);
  });
  it('rejects anything but the exact token format', async () => {
    const t = await createToken(KEY, 1000);
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
      `${exp}.${sig}=`,
      `.${sig}`,
      `${exp}.`,
      `${'9'.repeat(13)}.${sig}`,
    ];
    for (const b of bad) expect(await verifyToken(b, KEY, 1000), b).toBe(false);
    expect(await verifyToken(t, KEY, 1000)).toBe(true);
  });
  it('rejects a non-canonical signature: same bytes, different spare bits in the last character', async () => {
    const t = await createToken(KEY, 1000);
    const [exp, sig] = t.split('.');
    // 43 base64url characters carry 258 bits for a 256-bit MAC, so the last character has 2 spare bits.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(sig[42]);
    const twin = `${sig.slice(0, 42)}${alphabet[last ^ 1]}`;
    expect(twin).not.toBe(sig);
    expect(await verifyToken(`${exp}.${twin}`, KEY, 1000)).toBe(false);
  });
  it('rejects tokens made under a different password or secret, so changing either logs everyone out', async () => {
    const old = await createToken(await sessionKey(SECRET, 'old password'), 1000);
    expect(await verifyToken(old, await sessionKey(SECRET, 'old password'), 1000)).toBe(true);
    expect(await verifyToken(old, await sessionKey(SECRET, 'new password'), 1000)).toBe(false);
    expect(await verifyToken(old, await sessionKey('rotated secret', 'old password'), 1000)).toBe(false);
  });
});

describe('passwords and cookies', () => {
  it('compares passwords exactly', async () => {
    expect(await passwordMatches('correct horse', 'correct horse')).toBe(true);
    expect(await passwordMatches('correct hors', 'correct horse')).toBe(false);
    expect(await passwordMatches('', 'correct horse')).toBe(false);
    expect(await passwordMatches('Correct horse', 'correct horse')).toBe(false);
  });
  it('reads cookies and writes a locked-down session cookie', () => {
    const req = new Request('https://x/', { headers: { cookie: 'a=1; aglow_admin=tok%2Ben; b=2' } });
    expect(readCookie(req, 'aglow_admin')).toBe('tok+en');
    expect(readCookie(new Request('https://x/', { headers: { cookie: 'aglow_admin=%E0%A4%A' } }), 'aglow_admin')).toBeUndefined();
    expect(sessionCookie('t')).toBe('aglow_admin=t; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800');
    expect(clearCookie()).toBe('aglow_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  });
});

describe('adminSecrets', () => {
  it('needs both a password and a session secret, and treats blank values as unset', () => {
    expect(adminSecrets({ ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's' })).toEqual({ password: 'pw', secret: 's' });
    for (const [p, s] of [[undefined, 's'], ['pw', undefined], ['', 's'], ['pw', ''], ['   ', 's'], ['pw', ' \n'], [undefined, undefined]]) {
      expect(adminSecrets({ ADMIN_PASSWORD: p, SESSION_SECRET: s }), `${p}/${s}`).toBeNull();
    }
  });
});

describe('isAdmin', () => {
  const secrets = { password: PASSWORD, secret: SECRET };
  const reqWith = (cookie: string): Request => new Request('https://x/', { headers: { cookie } });
  it('accepts a real token and rejects missing, foreign and expired ones', async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = await createToken(KEY, now);
    expect(await isAdmin(reqWith(`${COOKIE}=${good}`), secrets)).toBe(true);
    expect(await isAdmin(new Request('https://x/'), secrets)).toBe(false);
    expect(await isAdmin(reqWith(`${COOKIE}=${await createToken(await sessionKey(SECRET, 'other password'), now)}`), secrets)).toBe(false);
    expect(await isAdmin(reqWith(`${COOKIE}=${await createToken(await sessionKey(SECRET, PASSWORD), now - SESSION_SECONDS - 5)}`), secrets)).toBe(false);
  });
});
