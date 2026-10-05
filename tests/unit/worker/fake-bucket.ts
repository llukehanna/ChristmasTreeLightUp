import type { Bucket, BucketObject, BucketObjectBody, BucketPutOptions, BucketValue } from '../../../worker/lib/bucket';

export interface StoredObject {
  body: Uint8Array;
  etag: string;
  httpMetadata?: BucketPutOptions['httpMetadata'];
}

/** In-memory stand-in for an R2 bucket, with R2's conditional-put semantics. Every write gets a new etag. */
export class FakeBucket implements Bucket {
  readonly objects = new Map<string, StoredObject>();
  private writes = 0;

  /** Stores a value directly (no conditions), as if it had been written earlier. */
  seed(key: string, value: string | Uint8Array, httpMetadata?: StoredObject['httpMetadata']): string {
    const etag = this.nextEtag();
    this.objects.set(key, { body: typeof value === 'string' ? new TextEncoder().encode(value) : value, etag, httpMetadata });
    return etag;
  }

  text(key: string): string | undefined {
    const o = this.objects.get(key);
    return o && new TextDecoder().decode(o.body);
  }

  async get(key: string): Promise<BucketObjectBody | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    const body = o.body;
    return { key, etag: o.etag, size: body.byteLength, text: async () => new TextDecoder().decode(body) };
  }

  async put(key: string, value: BucketValue, options?: BucketPutOptions): Promise<BucketObject | null> {
    const existing = this.objects.get(key);
    const cond = options?.onlyIf;
    if (cond?.etagMatches !== undefined && existing?.etag !== cond.etagMatches) return null;
    if (cond?.etagDoesNotMatch !== undefined && existing && (cond.etagDoesNotMatch === '*' || existing.etag === cond.etagDoesNotMatch)) return null;
    const body = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(await new Response(value).arrayBuffer());
    const etag = this.nextEtag();
    this.objects.set(key, { body, etag, httpMetadata: options?.httpMetadata });
    return { key, etag, size: body.byteLength };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const k of typeof keys === 'string' ? [keys] : keys) this.objects.delete(k);
  }

  private nextEtag(): string {
    this.writes += 1;
    return `etag-${this.writes}`;
  }
}
