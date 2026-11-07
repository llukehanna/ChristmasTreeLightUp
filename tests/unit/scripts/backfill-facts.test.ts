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

  it('quotes the id safely', () => {
    const [sql] = factsUpdates([{ id: "it's'; DROP TABLE games; --", seed: SEED, gen_version: GEN_VERSION, unranked_reason: null, log: JSON.stringify(solving()) }]);
    expect(sql).toMatch(/ WHERE id = 'it''s''; DROP TABLE games; --' AND feats IS NULL;$/);
  });

  it('skips what the finish skips: a run the judge unranked, and a log past MAX_FACTS_ENTRIES', () => {
    const log = solving();
    const row = (id: string, unranked_reason: string | null, entries: unknown[] = log) => ({ id, seed: SEED, gen_version: GEN_VERSION, unranked_reason, log: JSON.stringify(entries) });
    // The judge's reasons skip; 'daily', 'past' and 'anonymous' (and a ranked run) are fresh, so they keep their facts.
    const kept = ['daily', 'past', 'anonymous', null];
    const rows = [...['paused', 'too_fast', 'clock'].map((r) => row(`skip-${r}-aaaaaaaa`, r)), ...kept.map((r) => row(`keep-${r}-aaaaaaaaa`, r))];
    expect(factsUpdates(rows).map((u) => /WHERE id = '([^']+)'/.exec(u)?.[1])).toEqual(kept.map((r) => `keep-${r}-aaaaaaaaa`));
    // The cap is on the entries, ahead of any replay (a run this long is never read for its facts).
    const long = new Array(MAX_FACTS_ENTRIES + 1).fill(log[0]);
    expect(factsUpdates([row('too-long-aaaaaaaaa', null, long)])).toEqual([]);
    expect(factsUpdates([row('fits-aaaaaaaaaaaaa', null, log)])).toHaveLength(1);
  });
});
