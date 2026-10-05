/**
 * The slice of an R2 bucket the Worker uses, written structurally so worker/lib and worker/routes don't depend on
 * @cloudflare/workers-types (the unit tests type-check them under Node). worker/index.ts proves that the real
 * R2Bucket satisfies it.
 */
export interface BucketObject {
  readonly key: string;
  readonly etag: string;
  readonly size: number;
}

export interface BucketObjectBody extends BucketObject {
  text(): Promise<string>;
}

export interface BucketPutOptions {
  /** R2 conditional write: `put` resolves to null instead of writing when the condition fails. */
  onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
  httpMetadata?: { contentType?: string; cacheControl?: string };
}

export type BucketValue = ReadableStream | string;

export interface Bucket {
  get(key: string): Promise<BucketObjectBody | null>;
  put(key: string, value: BucketValue, options?: BucketPutOptions): Promise<BucketObject | null>;
  delete(keys: string | string[]): Promise<void>;
}
