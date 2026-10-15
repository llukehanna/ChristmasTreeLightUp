/**
 * The account's copy of a toggle (the star head, Home Alone): one PUT at a time, and only the latest value goes next,
 * so a slow answer can never leave the account on an older toggle. A failed PUT is quiet: the next toggle or sign-in
 * resyncs.
 */
export class LatestPut {
  private unsent: boolean | null = null;
  private sending = false;

  constructor(private readonly put: (on: boolean) => Promise<unknown>) {}

  /** A PUT is out or waiting: an account answer arriving now may predate it. */
  get pending(): boolean {
    return this.sending || this.unsent !== null;
  }

  send(on: boolean): void {
    this.unsent = on;
    if (!this.sending) void this.flush();
  }

  private async flush(): Promise<void> {
    this.sending = true;
    while (this.unsent !== null) {
      const on = this.unsent;
      this.unsent = null;
      try {
        await this.put(on);
      } catch {
        // offline, or signed out meanwhile
      }
    }
    this.sending = false;
  }
}
