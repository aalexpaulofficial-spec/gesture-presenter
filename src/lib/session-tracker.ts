/**
 * Server-side active session tracker for Master Presenter.
 * In-memory active user counter with heartbeat timeouts and multi-tab deduplication.
 */

interface ClientSessionRecord {
  lastSeen: number;
  sessions: Set<string>;
}

export class SessionTracker {
  private clients = new Map<string, ClientSessionRecord>();
  private timeoutMs: number;

  constructor(timeoutMs = 25000) {
    this.timeoutMs = timeoutMs;
  }

  heartbeat(clientId: string, sessionId?: string): number {
    const now = Date.now();
    this.prune(now);

    let client = this.clients.get(clientId);
    if (!client) {
      client = { lastSeen: now, sessions: new Set() };
      this.clients.set(clientId, client);
    }
    client.lastSeen = now;
    if (sessionId) {
      client.sessions.add(sessionId);
    }
    return this.clients.size;
  }

  endSession(clientId: string, sessionId?: string): number {
    const now = Date.now();
    const client = this.clients.get(clientId);
    if (client) {
      if (sessionId) {
        client.sessions.delete(sessionId);
      }
      if (!sessionId || client.sessions.size === 0) {
        this.clients.delete(clientId);
      }
    }
    this.prune(now);
    return this.clients.size;
  }

  getActiveCount(): number {
    this.prune(Date.now());
    return this.clients.size;
  }

  private prune(now: number): void {
    for (const [clientId, record] of this.clients.entries()) {
      if (now - record.lastSeen > this.timeoutMs) {
        this.clients.delete(clientId);
      }
    }
  }
}

// Global instance (persists across SSR / handler reloads)
declare global {
  // eslint-disable-next-line no-var
  var __mpSessionTracker: SessionTracker | undefined;
}

export const globalSessionTracker: SessionTracker =
  globalThis.__mpSessionTracker ?? (globalThis.__mpSessionTracker = new SessionTracker());
