import { expect, it } from 'vitest';
import { LatestPut } from '../../../src/ui/latest-put';

const flush = () => new Promise((r) => setTimeout(r, 0));

it('one PUT at a time, only the latest value next; pending until all have settled; a failure is quiet', async () => {
  const sent: boolean[] = [];
  const answers: (() => void)[] = [];
  const p = new LatestPut((on) => {
    sent.push(on);
    return new Promise<void>((resolve, reject) => answers.push(on ? resolve : () => reject(new Error('offline'))));
  });
  expect(p.pending).toBe(false);
  p.send(true);
  p.send(false);
  p.send(true);
  p.send(false);
  expect(sent).toEqual([true]);
  expect(p.pending).toBe(true);
  answers.shift()?.();
  await flush();
  expect(sent).toEqual([true, false]); // the in-between values were coalesced
  answers.shift()?.(); // fails, quietly
  await flush();
  expect(p.pending).toBe(false);
});
