/**
 * Cumulative statistics store for Master Presenter.
 *
 * Persistence strategy (in priority order):
 *   1. Upstash Redis  -- when KV_REST_API_URL + KV_REST_API_TOKEN env vars are set
 *                        (set automatically by the Vercel Upstash Redis integration)
 *   2. In-memory      -- fallback for local dev or when env vars are absent.
 *                        Stats survive within a serverless instance lifetime but
 *                        reset on cold start. Numbers always start at 0, never faked.
 *
 * Schema (Redis hash "mp:stats"):
 *   presentations_controlled  integer
 *   hours_presented           float (stored as string, parsed on read)
 *
 * Known unique client IDs stored in Redis set "mp:presenters"
 */

import { Redis } from "@upstash/redis";

// --- Types -------------------------------------------------------------------

export interface CumulativeStats {
  presenters: number;
  presentations_controlled: number;
  hours_presented: number;
}

// --- In-memory fallback store -------------------------------------------------

interface InMemoryStore {
  presenters: Set<string>;
  presentations_controlled: number;
  hours_presented: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __mpCumulativeStats: InMemoryStore | undefined;
}

function getMemoryStore(): InMemoryStore {
  if (!globalThis.__mpCumulativeStats) {
    globalThis.__mpCumulativeStats = {
      presenters: new Set(),
      presentations_controlled: 0,
      hours_presented: 0,
    };
  }
  return globalThis.__mpCumulativeStats;
}

// --- Redis client (lazy, only created when env vars are present) --------------

let _redis: Redis | null | undefined = undefined; // undefined = not yet checked

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

// --- Public API ---------------------------------------------------------------

/**
 * Record the start of a new presentation session.
 * Increments presentations_controlled.
 * Adds clientId to the unique presenters set (deduplication via Redis SADD).
 */
export async function recordSessionStart(clientId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await Promise.all([
        redis.hincrby(STATS_KEY, "presentations_controlled", 1),
        redis.sadd(PRESENTERS_KEY, clientId),
      ]);
      return;
    } catch {
      // Redis failure: fall through to in-memory
    }
  }
  const store = getMemoryStore();
  store.presentations_controlled += 1;
  store.presenters.add(clientId);
}

/**
 * Record the end of a presentation session and accumulate its real duration.
 * @param durationSeconds - real elapsed seconds measured by the client
 */
export async function recordSessionEnd(durationSeconds: number): Promise<void> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
  // Cap a single session at 8 hours to guard against runaway client timers
  const capped = Math.min(durationSeconds, 8 * 3600);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.hincrbyfloat(STATS_KEY, "hours_presented", capped / 3600);
      return;
    } catch {
      // fall through
    }
  }
  const store = getMemoryStore();
  store.hours_presented += capped / 3600;
}

/**
 * Get the current cumulative statistics for the public endpoint.
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
      return {
        presenters: presenterCount ?? 0,
        presentations_controlled: parseInt(hash["presentations_controlled"] ?? "0", 10) || 0,
        hours_presented: parseFloat(hash["hours_presented"] ?? "0") || 0,
      };
    } catch {
      // fall through to memory
    }
  }
  const store = getMemoryStore();
  return {
    presenters: store.presenters.size,
    presentations_controlled: store.presentations_controlled,
    hours_presented: store.hours_presented,
  };
}
