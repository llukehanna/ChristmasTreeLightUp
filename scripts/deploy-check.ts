import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZERO_ID = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What must change in wrangler.jsonc before a deploy: placeholders left from setup, or fake sign-in.
 * ADMIN_EMAILS is not checked: in production it is a Worker secret (it is Luke's email, kept out of the repo).
 */
export function deployConfigProblems(config: string): string[] {
  // Whole-line // comments only, so a comment that quotes a var name can't count (the config has no other kind).
  const text = config.replace(/^\s*\/\/.*$/gm, '');
  const problems: string[] = [];

  const dbId = /"database_id"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? '';
  if (dbId === ZERO_ID || !UUID.test(dbId)) {
    problems.push('d1_databases[0].database_id is missing or still the zero placeholder: create the database (npx wrangler d1 create aglow) and paste its id.');
  }

  const clientId = /"GOOGLE_CLIENT_ID"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? '';
  if (!clientId || clientId.startsWith('REPLACE_WITH')) {
    problems.push('vars.GOOGLE_CLIENT_ID is missing or still a placeholder in wrangler.jsonc (the Google Web client id).');
  }

  if (/"AUTH_MODE"\s*:\s*"fake"/.test(text)) problems.push('vars.AUTH_MODE must be "google" in wrangler.jsonc (fake sign-in is for localhost only).');
  return problems;
}

// Run directly (npm run deploy): refuse to go on while anything is left.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = deployConfigProblems(readFileSync('wrangler.jsonc', 'utf8'));
  for (const p of problems) console.error(`deploy-check: ${p}`);
  process.exit(problems.length ? 1 : 0);
}
