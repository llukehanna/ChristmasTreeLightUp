/**
 * Backfills the facts of runs finished before migration 0008 (season two C2+C3): turns, the tree's minimum turns and
 * the feats, from each run's stored log. Running it against production is a deploy step, done only with Luke's go-ahead:
 *
 *   npx wrangler d1 execute aglow --remote --json --command \
 *     "SELECT id, seed, gen_version, unranked_reason, log FROM games WHERE finished_at IS NOT NULL AND log IS NOT NULL AND feats IS NULL" > rows.json
 *   node scripts/backfill-facts.ts rows.json backfill.sql
 *   npx wrangler d1 execute aglow --remote --file backfill.sql
 *
 * The rows file is a JSON array of rows, or wrangler's --json output (an array of { results }). Every UPDATE keeps
 * `feats IS NULL`, so a run finished (with its facts) since the export is never touched, and a rerun changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const direct = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// Plain node (type stripping) doesn't guess extensions, and src/ imports its modules without one (Vite does guess):
// try `.ts` on a relative import that fails. Only when run directly; Vitest resolves them itself.
if (direct) {
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (e) {
        if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier)) return next(`${specifier}.ts`, context);
        throw e;
      }
    },
  });
}
const [{ MAX_FACTS_ENTRIES, runFacts }, { parseLog }, { GRID }] = await Promise.all([import('../src/core/facts'), import('../src/core/log'), import('../src/core/mask')]);

export interface FactsRow {
  id: string;
  seed: number;
  gen_version: number;
  /** The stored reason: the judge's ('paused', 'too_fast', 'clock') says the run is never read for its facts. */
  unranked_reason: string | null;
  /** The stored log: JSON, as the finish saved it. */
  log: string;
}

/** An SQL string literal. */
const quoted = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** The judge's own reasons (the others are set by the route): such a run is never fresh (isFresh, src/core/goals.ts). */
const JUDGED_UNRANKED = new Set<string | null>(['paused', 'too_fast', 'clock']);

/**
 * One UPDATE per row whose log replays to a win; none for a row that doesn't, nor for what the finish route skips (a
 * run the judge unranked, a log past MAX_FACTS_ENTRIES: runFacts lights the whole tree per turn, so those cost most).
 * The rows' logs all passed the judge at their finish (its capped replay), which is what makes runFacts' uncapped full
 * replay safe to run on them.
 */
export function factsUpdates(rows: readonly FactsRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (JUDGED_UNRANKED.has(row.unranked_reason)) continue;
    let value: unknown;
    try {
      value = JSON.parse(row.log);
    } catch {
      continue;
    }
    if (Array.isArray(value) && value.length > MAX_FACTS_ENTRIES) continue;
    const log = parseLog(value, GRID);
    const facts = log && runFacts(row.seed, row.gen_version, log);
    if (!facts) continue;
    out.push(`UPDATE games SET turns = ${facts.turns}, min_turns = ${facts.minTurns}, feats = ${facts.feats} WHERE id = ${quoted(row.id)} AND feats IS NULL;`);
  }
  return out;
}

/** Rows from a plain array, or from wrangler's `--json` output ([{ results: rows }]). */
function rowsOf(value: unknown): FactsRow[] {
  if (!Array.isArray(value)) throw new Error('expected a JSON array');
  return value.flatMap((v: unknown) => (typeof v === 'object' && v !== null && 'results' in v ? (v.results as FactsRow[]) : [v as FactsRow]));
}

function main([input, output]: string[]): void {
  if (!input || !output) {
    console.error('usage: node scripts/backfill-facts.ts <rows.json> <out.sql>');
    process.exit(2);
  }
  const rows = rowsOf(JSON.parse(readFileSync(input, 'utf8')));
  const updates = factsUpdates(rows);
  writeFileSync(output, updates.map((u) => `${u}\n`).join(''));
  console.log(`backfill-facts: ${updates.length} of ${rows.length} rows replayed; wrote ${output}`);
}

if (direct) main(process.argv.slice(2));
