import { api } from './client';
import type { User } from './types';

/** undefined while the first /api/me is in flight; null when signed out (or the server is unreachable). */
export type SessionState = User | null | undefined;

export class Session {
  private state: SessionState = undefined;
  private readonly listeners = new Set<(s: SessionState) => void>();

  get current(): SessionState {
    return this.state;
  }

  subscribe(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  set(user: User | null): void {
    this.state = user;
    for (const fn of [...this.listeners]) fn(user);
  }

  async load(): Promise<User | null> {
    let user: User | null = null;
    try {
      user = (await api.me()).user;
    } catch {
      // offline: play signed out
    }
    this.set(user);
    return user;
  }

  async signOut(): Promise<void> {
    try {
      await api.signOut();
    } catch {
      // the next /api/me tells if the cookie outlived this
    }
    this.set(null);
  }
}
