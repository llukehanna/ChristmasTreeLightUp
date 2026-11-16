/**
 * Backfills the facts of runs finished before migration 0008 (season two C2+C3): turns, the tree's minimum turns and
 * the feats, from each run's stored log. Running it against production is a deploy step, done only with Luke's go-ahead:
 *
 *   npx wrangler d1 execute aglow --remote --json --command \
 *     "SELECT id, seed, gen_version, unranked_reason, log FROM games WHERE finished_at IS NOT NULL AND log IS NOT NULL AND feats IS NULL" > rows.json
 *   node scripts/backfill-facts.ts rows.json backfill.sql
 *   npx wrangler d1 execute aglow --remote --file backfill.sql
 *
 * A second mode fills only the turns, for runs the judge unranked (they never get feats) and for any run whose feats
 * are set but whose turns are not. Export with the feats column and `turns IS NULL`; every UPDATE keeps `turns IS NULL`:
 *
 *   npx wrangler d1 execute aglow --remote --json --command \
 *     "SELECT id, seed, gen_version, unranked_reason, log, feats FROM games WHERE finished_at IS NOT NULL AND log IS NOT NULL AND turns IS NULL" > rows.json
 *
 * The rows file is a JSON array of rows, or wrangler's --json output (an array of { results }). Every UPDATE keeps
 * `feats IS NULL`, so a run finished (with its facts) since the export is never touched, and a rerun changes nothing.
 *
 * A third mode, --par, recomputes `min_turns` alone from each run's seed and generator version, for rows stored before
 * par became the clockwise turns (minTurnsOf, src/core/facts.ts). It needs no log. Export every row with a par:
 *
 *   npx wrangler d1 execute aglow --remote --json --command \
 *     "SELECT id, seed, gen_version, min_turns FROM games WHERE min_turns IS NOT NULL" > par.json
 *   node scripts/backfill-facts.ts --par par.json par.sql
 *   npx wrangler d1 execute aglow --remote --file par.sql
 *
 * Every UPDATE keeps `min_turns` at the exported value, so a rerun, or a run finished since with the new par, is never
 * touched; a row whose par is already right gets no UPDATE.
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
const [{ MAX_FACTS_ENTRIES, minTurnsOf, runFacts, turnsOf }, { parseLog }, { GRID }, { seededBoard }] = await Promise.all([
  import('../src/core/facts'),
  import('../src/core/log'),
  import('../src/core/mask'),
  import('../src/core/seeded'),
]);

export interface FactsRow {
  id: string;
  seed: number;
  gen_version: number;
  /** The stored reason: the judge's ('paused', 'too_fast', 'clock') says the run is never read for its facts. */
  unranked_reason: string | null;
  /** The stored log: JSON, as the finish saved it. */
  log: string;
  /** The stored feats (turns-only mode): set means the run already has its facts and only turns are missing. */
  feats?: number | null;
}

/** An SQL string literal. */
const quoted = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** The judge's own reasons (the others are set by the route): such a run is never fresh (isFresh, src/core/goals.ts). */
const JUDGED_UNRANKED = new Set<string | null>(['paused', 'too_fast', 'clock']);

/**
 * One UPDATE per row whose log fits MAX_FACTS_ENTRIES. A run the judge unranked, or one whose feats are already set,
 * gets only its turns and the minimum (guarded by `turns IS NULL`); any other gets turns and feats from runFacts
 * (guarded by `feats IS NULL`), and none when its log doesn't replay to a win. The rows' logs all passed the judge at
 * their finish (its capped replay), which is what makes runFacts' uncapped full replay safe to run on them; a
 * turns-only row needs no replay at all.
 */
export function factsUpdates(rows: readonly FactsRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    let value: unknown;
    try {
      value = JSON.parse(row.log);
    } catch {
      continue;
    }
    if (Array.isArray(value) && value.length > MAX_FACTS_ENTRIES) continue;
    const log = parseLog(value, GRID);
    if (JUDGED_UNRANKED.has(row.unranked_reason) || (row.feats !== undefined && row.feats !== null)) {
      const counted = log && turnsOf(row.seed, row.gen_version, log);
      if (counted) out.push(`UPDATE games SET turns = ${counted.turns}, min_turns = ${counted.minTurns} WHERE id = ${quoted(row.id)} AND turns IS NULL;`);
      continue;
    }
    const facts = log && runFacts(row.seed, row.gen_version, log);
    if (!facts) continue;
    out.push(`UPDATE games SET turns = ${facts.turns}, min_turns = ${facts.minTurns}, feats = ${facts.feats} WHERE id = ${quoted(row.id)} AND feats IS NULL;`);
  }
  return out;
}

export interface ParRow {
  id: string;
  seed: number;
  gen_version: number;
  /** The stored par. */
  min_turns: number;
}

/**
 * One UPDATE per row whose stored par differs from the tree's par now (minTurnsOf on the seed's starting board),
 * guarded by the stored value. None for a seed or generator version with no tree.
 */
export function parUpdates(rows: readonly ParRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const board = seededBoard(row.seed, row.gen_version, true);
    if (!board) continue;
    const par = minTurnsOf(board);
    if (par === row.min_turns) continue;
    out.push(`UPDATE games SET min_turns = ${par} WHERE id = ${quoted(row.id)} AND min_turns = ${Number(row.min_turns)};`);
  }
  return out;
}

/** Rows from a plain array, or from wrangler's `--json` output ([{ results: rows }]). */
function rowsOf<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error('expected a JSON array');
  return value.flatMap((v: unknown) => (typeof v === 'object' && v !== null && 'results' in v ? (v.results as T[]) : [v as T]));
}

function main(args: string[]): void {
  const par = args[0] === '--par';
  const [input, output] = par ? args.slice(1) : args;
  if (!input || !output) {
    console.error('usage: node scripts/backfill-facts.ts [--par] <rows.json> <out.sql>');
    process.exit(2);
  }
  const value: unknown = JSON.parse(readFileSync(input, 'utf8'));
  const rows = par ? rowsOf<ParRow>(value) : rowsOf<FactsRow>(value);
  const updates = par ? parUpdates(rows as ParRow[]) : factsUpdates(rows as FactsRow[]);
  writeFileSync(output, updates.map((u) => `${u}\n`).join(''));
  console.log(par ? `backfill-facts --par: ${updates.length} of ${rows.length} rows get a new par; wrote ${output}` : `backfill-facts: ${updates.length} of ${rows.length} rows replayed; wrote ${output}`);
}

if (direct) main(process.argv.slice(2));
