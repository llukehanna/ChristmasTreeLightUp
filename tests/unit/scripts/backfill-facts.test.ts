import { describe, expect, it } from 'vitest';
import { MAX_FACTS_ENTRIES, runFacts } from '../../../src/core/facts';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { factsUpdates } from '../../../scripts/backfill-facts';
import { solvingTaps } from '../core/solver';

const SEED = 12345;
const solving = () => {
  const board = seededBoard(SEED, GEN_VERSION);
  if (!board) throw new Error('no board');
  return solvingTaps(board, 3000, 50);
};

describe('factsUpdates', () => {
  it('a replayable row gives one UPDATE with the runFacts numbers', () => {
    const log = solving();
    const facts = runFacts(SEED, GEN_VERSION, log);
    if (!facts) throw new Error('no facts');
    expect(factsUpdates([{ id: 'abcDEF123_-xyz00', seed: SEED, gen_version: GEN_VERSION, unranked_reason: null, log: JSON.stringify(log) }])).toEqual([
      `UPDATE games SET turns = ${facts.turns}, min_turns = ${facts.minTurns}, feats = ${facts.feats} WHERE id = 'abcDEF123_-xyz00' AND feats IS NULL;`,
    ]);
  });

  it("a row that doesn't replay gives none", () => {
    const log = solving();
    expect(
      factsUpdates([
        { id: 'unsolved-aaaaaaaa', seed: SEED, gen_version: GEN_VERSION, unranked_reason: null, log: JSON.stringify(log.slice(0, -1)) },
        { id: 'not-a-log-aaaaaaa', seed: SEED, gen_version: GEN_VERSION, unranked_reason: null, log: JSON.stringify([{ t: 0, a: 'nope' }]) },
        { id: 'not-json-aaaaaaaa', seed: SEED, gen_version: GEN_VERSION, unranked_reason: null, log: '{' },
        { id: 'unknown-gen-aaaaa', seed: SEED, gen_version: 999, unranked_reason: null, log: JSON.stringify(log) },
      ]),
    ).toEqual([]);
  });

  it('turns-only rows get turns and min_turns, and feats stay NULL', () => {
    const log = solving();
    const facts = runFacts(SEED, GEN_VERSION, log);
    if (!facts) throw new Error('no facts');
    const row = { id: 'turns-only-aaaaaaa', seed: SEED, gen_version: GEN_VERSION, unranked_reason: 'paused', log: JSON.stringify(log), feats: null };
    const expected = `UPDATE games SET turns = ${facts.turns}, min_turns = ${facts.minTurns} WHERE id = 'turns-only-aaaaaaa' AND turns IS NULL;`;
    expect(factsUpdates([row])).toEqual([expected]);
    // A row whose feats are already set gets turns only too, whatever its reason.
    expect(factsUpdates([{ ...row, unranked_reason: null, feats: 5 }])).toEqual([expected]);
  });

  it('quotes the id safely', () => {
    const [sql] = factsUpdates([{ id: "it's'; DROP TABLE games; --", seed: SEED, gen_version: GEN_VERSION, unranked_reason: null, log: JSON.stringify(solving()) }]);
    expect(sql).toMatch(/ WHERE id = 'it''s''; DROP TABLE games; --' AND feats IS NULL;$/);
  });

  it('a run the judge unranked gets turns only; a log past MAX_FACTS_ENTRIES gets nothing', () => {
    const log = solving();
    const row = (id: string, unranked_reason: string | null, entries: unknown[] = log) => ({ id, seed: SEED, gen_version: GEN_VERSION, unranked_reason, log: JSON.stringify(entries) });
    // The judge's reasons get turns only; 'daily', 'past' and 'anonymous' (and a ranked run) are fresh, so they get feats too.
    const kept = ['daily', 'past', 'anonymous', null];
    const judged = ['paused', 'too_fast', 'clock'];
    const rows = [...judged.map((r) => row(`skip-${r}-aaaaaaaa`, r)), ...kept.map((r) => row(`keep-${r}-aaaaaaaaa`, r))];
    const updates = factsUpdates(rows);
    expect(updates.map((u) => /WHERE id = '([^']+)'/.exec(u)?.[1])).toEqual([...judged.map((r) => `skip-${r}-aaaaaaaa`), ...kept.map((r) => `keep-${r}-aaaaaaaaa`)]);
    expect(updates.slice(0, 3).every((u) => !u.includes('feats') && u.endsWith('AND turns IS NULL;'))).toBe(true);
    expect(updates.slice(3).every((u) => u.includes('feats = '))).toBe(true);
    // The cap is on the entries, ahead of any replay (a run this long is never read for its facts).
    const long = new Array(MAX_FACTS_ENTRIES + 1).fill(log[0]);
    expect(factsUpdates([row('too-long-aaaaaaaaa', null, long), row('too-long-paused-aaa', 'paused', long)])).toEqual([]);
    expect(factsUpdates([row('fits-aaaaaaaaaaaaa', null, log)])).toHaveLength(1);
  });
});
