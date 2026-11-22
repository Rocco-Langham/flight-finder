// Shared upstream fetch: response cache, in-flight de-duplication, concurrency
// limit, per-host pacing and retry. State lives on globalThis so it survives
// Next.js hot reloads in dev. Ryanair answers are also saved to disk, so a
// restart doesn't mean asking Ryanair for them all again.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TTL_MS = 30 * 60 * 1000;
const MAX_CONCURRENT = 8;
const MAX_ENTRIES = 20_000;

/**
 * Hosts that block clients who ask too often (HTTP 403). There's no limit on
 * how much we ask, but once a host has blocked us we stop calling it for a
 * while: every call would fail anyway, and keeping on can make the block last
 * longer.
 */
const BLOCKING_HOSTS: Record<string, string> = {
  "services-api.ryanair.com": "Ryanair",
};
const BLOCK_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Minimum gap between requests to a host. Ryanair blocked us after ~1,300
 * requests in a few seconds; a steady 8 a second keeps big searches under it.
 */
const PACED_HOSTS: Record<string, number> = {
  "services-api.ryanair.com": 125,
  // Travelpayouts doesn't publish its limit; ~5 a second is gentle.
  "api.travelpayouts.com": 200,
};

/**
 * Hosts whose answers are kept longer, and on disk across restarts. Fares
 * barely move in a few hours, and every reuse is a request Ryanair doesn't see.
 */
const PERSISTED_HOSTS: Record<string, number> = {
  "services-api.ryanair.com": 3 * 60 * 60 * 1000,
};
const CACHE_FILE = path.join(process.cwd(), ".cache", "ryanair.json");
const SAVE_DELAY_MS = 2_000;

interface Entry {
  at: number;
  value: Promise<unknown>;
}

interface HttpState {
  cache: Map<string, Entry>;
  active: number;
  queue: (() => void)[];
  /** Host -> time until which we don't call it (it blocked us). */
  blockedUntil: Map<string, number>;
  /** Host -> earliest time the next request may start (pacing). */
  nextStart: Map<string, number>;
  /** Successful answers from persisted hosts, as saved to disk. */
  saved: Map<string, { at: number; data: unknown }>;
  saveTimer?: ReturnType<typeof setTimeout>;
}

const g = globalThis as unknown as { __ffHttpV4?: HttpState };
const state: HttpState = (g.__ffHttpV4 ??= loadState());

function persistTtl(url: string): number | undefined {
  return PERSISTED_HOSTS[new URL(url).host];
}

function loadState(): HttpState {
  const s: HttpState = {
    cache: new Map(),
    active: 0,
    queue: [],
    blockedUntil: new Map(),
    nextStart: new Map(),
    saved: new Map(),
  };
  try {
    const file = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<
      string,
      { at: number; data: unknown }
    >;
    const now = Date.now();
    for (const [url, e] of Object.entries(file)) {
      const ttl = persistTtl(url);
      if (!ttl || now - e.at >= ttl) continue;
      s.saved.set(url, e);
      s.cache.set(url, { at: e.at, value: Promise.resolve(e.data) });
    }
  } catch {
    // No cache file yet, or an unreadable one: start empty.
  }
  return s;
}

/** Writes saved answers to disk shortly after the last change, dropping expired ones. */
function scheduleSave(): void {
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(() => {
    state.saveTimer = undefined;
    const now = Date.now();
    for (const [url, e] of state.saved) {
      if (now - e.at >= (persistTtl(url) ?? 0)) state.saved.delete(url);
    }
    try {
      mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(state.saved)));
    } catch {
      // Disk cache is a nice-to-have; the in-memory cache still works.
    }
  }, SAVE_DELAY_MS);
}

/** Waits for this host's next free pacing slot, if it has pacing. */
async function pace(host: string): Promise<void> {
  const gap = PACED_HOSTS[host];
  if (!gap) return;
  const now = Date.now();
  const start = Math.max(now, state.nextStart.get(host) ?? 0);
  state.nextStart.set(host, start + gap);
  if (start > now) await new Promise((r) => setTimeout(r, start - now));
}

export interface FetchStats {
  upstreamCalls: number;
  cacheHits: number;
  /** Lookups (upstream calls and cache hits) that have finished, for progress. */
  done: number;
}

export function newStats(): FetchStats {
  return { upstreamCalls: 0, cacheHits: 0, done: 0 };
}

/** Thrown when a host is blocking us. */
export class RateLimitError extends Error {}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (state.active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.active++;
  try {
    return await fn();
  } finally {
    state.active--;
    state.queue.shift()?.();
  }
}

function minutesUntil(t: number): number {
  return Math.max(1, Math.ceil((t - Date.now()) / 60_000));
}

/** Throws if this host blocked us recently. */
function admit(host: string): void {
  const name = BLOCKING_HOSTS[host];
  const blocked = state.blockedUntil.get(host) ?? 0;
  if (name && blocked > Date.now()) {
    throw new RateLimitError(
      `${name} is temporarily refusing requests from this server (too many searches). Try again in about ${minutesUntil(blocked)} min.`,
    );
  }
}

async function fetchWithRetry(url: string): Promise<unknown> {
  const host = new URL(url).host;
  let delay = 500;
  for (let attempt = 0; ; attempt++) {
    await pace(host);
    admit(host); // another request may have been blocked while this one waited
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; flight-finder/0.1)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (res.ok) return res.json();
    const name = BLOCKING_HOSTS[host];
    if (name && res.status === 403) {
      state.blockedUntil.set(host, Date.now() + BLOCK_BACKOFF_MS);
      throw new RateLimitError(
        `${name} is temporarily refusing requests from this server (too many searches). Try again in about ${BLOCK_BACKOFF_MS / 60_000} min.`,
      );
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 3) {
      throw new Error(`Upstream ${res.status} for ${new URL(url).pathname}`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
}

export function cachedJson<T>(url: string, stats?: FetchStats, ttlMs?: number): Promise<T> {
  const persistFor = persistTtl(url);
  ttlMs ??= persistFor ?? TTL_MS;
  const now = Date.now();
  const hit = state.cache.get(url);
  if (hit && now - hit.at < ttlMs) {
    if (stats) {
      stats.cacheHits++;
      // A hit can still be waiting on another search's request.
      hit.value.finally(() => stats.done++).catch(() => {});
    }
    return hit.value as Promise<T>;
  }
  try {
    admit(new URL(url).host);
  } catch (e) {
    return Promise.reject(e);
  }
  if (stats) stats.upstreamCalls++;
  const value = withSlot(() => fetchWithRetry(url));
  state.cache.set(url, { at: now, value });
  if (stats) value.finally(() => stats.done++).catch(() => {});
  // Don't keep failures around.
  value.then(
    (data) => {
      if (persistFor) {
        state.saved.set(url, { at: now, data });
        scheduleSave();
      }
    },
    () => state.cache.delete(url),
  );
  if (state.cache.size > MAX_ENTRIES) {
    const oldest = state.cache.keys().next().value;
    if (oldest) state.cache.delete(oldest);
  }
  return value as Promise<T>;
}
