// Shared upstream fetch: response cache, in-flight de-duplication, concurrency
// limit and retry. State lives on globalThis so it survives Next.js hot reloads
// in dev.

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
}

const g = globalThis as unknown as { __ffHttpV3?: HttpState };
const state: HttpState = (g.__ffHttpV3 ??= {
  cache: new Map(),
  active: 0,
  queue: [],
  blockedUntil: new Map(),
});

export interface FetchStats {
  upstreamCalls: number;
  cacheHits: number;
}

export function newStats(): FetchStats {
  return { upstreamCalls: 0, cacheHits: 0 };
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

export function cachedJson<T>(url: string, stats?: FetchStats, ttlMs = TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = state.cache.get(url);
  if (hit && now - hit.at < ttlMs) {
    if (stats) stats.cacheHits++;
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
  // Don't keep failures around.
  value.catch(() => state.cache.delete(url));
  if (state.cache.size > MAX_ENTRIES) {
    const oldest = state.cache.keys().next().value;
    if (oldest) state.cache.delete(oldest);
  }
  return value as Promise<T>;
}
