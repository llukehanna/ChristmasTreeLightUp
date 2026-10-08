/**
 * The slice of the D1 client the Worker uses, written structurally (like bucket.ts) so worker/lib and worker/routes
 * type-check under Node for the tests. worker/index.ts proves the real D1Database satisfies it.
 */
export interface DbResult<T> {
  results: T[];
  meta: { changes: number };
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  run(): Promise<DbResult<unknown>>;
}

export interface Db {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<DbResult<unknown>[]>;
}
