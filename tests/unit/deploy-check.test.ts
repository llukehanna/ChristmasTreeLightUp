import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { deployConfigProblems } from '../../scripts/deploy-check.ts';

// ADMIN_EMAILS is a Worker secret in production, so wrangler.jsonc has no such var and the check doesn't ask for one.
const ready = `{
  // a comment that mentions "AUTH_MODE": "fake" and "GOOGLE_CLIENT_ID": "REPLACE_WITH_x" must not count
  "d1_databases": [{ "binding": "DB", "database_name": "aglow", "database_id": "3f1c2a9e-1111-4222-8333-944455556666", "migrations_dir": "migrations" }],
  "vars": { "AUTH_MODE": "google", "GOOGLE_CLIENT_ID": "1234-abc.apps.googleusercontent.com" }
}`;

it('passes a filled-in config', () => {
  expect(deployConfigProblems(ready)).toEqual([]);
});

it('names every placeholder left from setup', () => {
  const problems = deployConfigProblems(
    ready.replace('3f1c2a9e-1111-4222-8333-944455556666', '00000000-0000-0000-0000-000000000000').replace('1234-abc.apps.googleusercontent.com', 'REPLACE_WITH_GOOGLE_CLIENT_ID'),
  );
  expect(problems).toHaveLength(2);
  expect(problems.join('\n')).toMatch(/database_id/);
  expect(problems.join('\n')).toMatch(/GOOGLE_CLIENT_ID/);
});

it('refuses a missing Google client id or database id, not only placeholders', () => {
  const noClient = deployConfigProblems(ready.replace(', "GOOGLE_CLIENT_ID": "1234-abc.apps.googleusercontent.com"', ''));
  expect(noClient.join('\n')).toMatch(/GOOGLE_CLIENT_ID/);
  const noDb = deployConfigProblems(ready.replace('3f1c2a9e-1111-4222-8333-944455556666', ''));
  expect(noDb.join('\n')).toMatch(/database_id/);
});

it('refuses fake sign-in in the deployed config', () => {
  expect(deployConfigProblems(ready.replace('"AUTH_MODE": "google"', '"AUTH_MODE": "fake"'))).toEqual([
    'vars.AUTH_MODE must be "google" in wrangler.jsonc (fake sign-in is for localhost only).',
  ]);
});

it('does not ask for ADMIN_EMAILS (a secret in production)', () => {
  expect(deployConfigProblems(ready).join('\n')).not.toMatch(/ADMIN_EMAILS/);
  expect(deployConfigProblems('{}').join('\n')).not.toMatch(/ADMIN_EMAILS/);
});

it('the committed wrangler.jsonc passes: the real database id and Google client id, and Google sign-in', () => {
  const config = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  expect(deployConfigProblems(config)).toEqual([]);
  expect(config).toContain('"database_id": "bcbc2e3a-2618-49f5-bc13-c922bac44585"');
  expect(config).toContain('"GOOGLE_CLIENT_ID": "100766354067-le88hcdj6tgaud7890cjevag6c8okts5.apps.googleusercontent.com"');
});
