/**
 * Cumulative statistics store for Master Presenter.
 *
 * Backed by Upstash Redis on Vercel:
 *   - KV_REST_API_URL + KV_REST_API_TOKEN
 *   - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   - KV_URL / REDIS_URL
 *
 * Fallback:
 *   In-process memory store for local development.
 *   Always starts at 0, never faked, strictly cumulative.
 *
 * Authoritative Redis schema:
 *   Hash "mp:stats":
 *     presentations_controlled  integer
 *     total_seconds             integer (duration in seconds)
 *     downloads                 integer (confirmed PWA installations)
 *
 *   Set "mp:presenters":
 *     Set of unique client IDs (SCARD = unique presenters)
 *
 *   Set "mp:sessions":
 *     Set of session IDs to ensure idempotent session start counting
 *
 *   Set "mp:installed_clients":
 *     Set of client IDs that confirmed PWA installation (ensures 1 install per client)
 */

import { Redis } from "@upstash/redis";

// --- Types -------------------------------------------------------------------

export interface CumulativeStats {
  presenters: number;
  presentations_controlled: number;
  hours_presented: number;
  downloads: number;
}

// --- In-memory fallback store -------------------------------------------------

interface InMemoryStore {
  presenters: Set<string>;
  sessions: Set<string>;
  installedClients: Set<string>;
  presentations_controlled: number;
  total_seconds: number;
  downloads: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __mpCumulativeStats: InMemoryStore | undefined;
}

function getMemoryStore(): InMemoryStore {
  if (!globalThis.__mpCumulativeStats) {
    globalThis.__mpCumulativeStats = {
      presenters: new Set(),
      sessions: new Set(),
      installedClients: new Set(),
      presentations_controlled: 0,
      total_seconds: 0,
      downloads: 0,
    };
  }
  return globalThis.__mpCumulativeStats;
}

// --- Redis client -------------------------------------------------------------

let _redis: Redis | null | undefined = undefined;

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      _redis = new Redis({ url, token });
    } catch {
      _redis = null;
    }
  } else {
    _redis = null;
  }
  return _redis;
}

const STATS_KEY = "mp:stats";
const PRESENTERS_KEY = "mp:presenters";
const SESSIONS_KEY = "mp:sessions";
const INSTALLED_KEY = "mp:installed_clients";

// --- Public API ---------------------------------------------------------------

/**
 * Record the start of a new presentation session.
 * Deduplicates unique presenters and sessions via atomic Redis sets.
 */
export async function recordSessionStart(clientId: string, sessionId?: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const promises: Promise<any>[] = [redis.sadd(PRESENTERS_KEY, clientId)];
      if (sessionId) {
        const added = await redis.sadd(SESSIONS_KEY, sessionId);
        if (added > 0) {
          promises.push(redis.hincrby(STATS_KEY, "presentations_controlled", 1));
        }
      } else {
        promises.push(redis.hincrby(STATS_KEY, "presentations_controlled", 1));
      }
      await Promise.all(promises);
      return;
    } catch {
      // Fall through to memory store on network error
    }
  }

  const store = getMemoryStore();
  store.presenters.add(clientId);
  if (sessionId) {
    if (!store.sessions.has(sessionId)) {
      store.sessions.add(sessionId);
      store.presentations_controlled += 1;
    }
  } else {
    store.presentations_controlled += 1;
  }
}

/**
 * Record the end of a presentation session and accumulate real elapsed duration.
 * Stored internally as integer seconds in Redis to prevent floating-point drift.
 */
export async function recordSessionEnd(durationSeconds: number): Promise<void> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
  // Cap at 8 hours to avoid runaway client timestamps
  const cappedSeconds = Math.min(Math.round(durationSeconds), 8 * 3600);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.hincrby(STATS_KEY, "total_seconds", cappedSeconds);
      return;
    } catch {
      // Fall through to memory store
    }
  }

  const store = getMemoryStore();
  store.total_seconds += cappedSeconds;
}

/**
 * Record a real, confirmed PWA download / installation.
 * Uses atomic Redis set `mp:installed_clients` to ensure each client is counted once.
 */
export async function recordDownload(clientId: string): Promise<void> {
  if (!clientId) return;

  const redis = getRedis();
  if (redis) {
    try {
      const added = await redis.sadd(INSTALLED_KEY, clientId);
      if (added > 0) {
        await redis.hincrby(STATS_KEY, "downloads", 1);
      }
      return;
    } catch {
      // Fall through to memory store
    }
  }

  const store = getMemoryStore();
  if (!store.installedClients.has(clientId)) {
    store.installedClients.add(clientId);
    store.downloads += 1;
  }
}

/**
 * Get current cumulative statistics for the public endpoint.
 * Zero hardcoding, strictly real persistent numbers.
 */
export async function getCumulativeStats(): Promise<CumulativeStats> {
  const redis = getRedis();
  if (redis) {
    try {
      const [statsHash, presenterCount] = await Promise.all([
        redis.hgetall(STATS_KEY) as Promise<Record<string, string> | null>,
        redis.scard(PRESENTERS_KEY),
      ]);
      const hash = statsHash ?? {};
      const totalSeconds = parseInt(hash["total_seconds"] ?? "0", 10) || 0;
      const hoursPresented = Math.round((totalSeconds / 3600) * 10) / 10;

      return {
        presenters: presenterCount ?? 0,
        presentations_controlled: parseInt(hash["presentations_controlled"] ?? "0", 10) || 0,
        hours_presented: hoursPresented,
        downloads: parseInt(hash["downloads"] ?? "0", 10) || 0,
      };
    } catch {
      // Fall through to memory store
    }
  }

  const store = getMemoryStore();
  const hours = Math.round((store.total_seconds / 3600) * 10) / 10;

  return {
    presenters: store.presenters.size,
    presentations_controlled: store.presentations_controlled,
    hours_presented: hours,
    downloads: store.downloads,
  };
}
