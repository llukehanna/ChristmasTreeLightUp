import type { Db } from '../../../worker/lib/db';

/** For unit tests of routes that never touch D1: any use fails loudly. */
export const NO_DB: Db = {
  prepare(): never {
    throw new Error('this test has no database');
  },
  batch(): never {
    throw new Error('this test has no database');
  },
};
