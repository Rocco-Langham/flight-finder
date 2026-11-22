import type { FetchStats } from "@/lib/http";

/**
 * A streamed search response: newline-delimited JSON with a
 * {"progress":{done,total}} line every half second while `run` works, then one
 * {"result":...} or {"error":...}. If the browser goes away (closed tab, new
 * search), `signal` aborts so the search can stop early.
 */
export function streamSearch<T>(
  stats: FetchStats,
  run: (signal: AbortSignal) => Promise<T>,
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream({
    async start(controller) {
      const send = (msg: unknown) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(msg) + "\n"));
        } catch {
          abort.abort(); // the browser went away
        }
      };
      const progress = () =>
        send({ progress: { done: stats.done, total: stats.upstreamCalls + stats.cacheHits } });
      timer = setInterval(progress, 500);
      try {
        const result = await run(abort.signal);
        send({ result });
      } catch (e) {
        if (!abort.signal.aborted) console.error(e);
        send({ error: "Search failed. The fare source may be busy, so try again shortly." });
      } finally {
        clearInterval(timer);
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      clearInterval(timer);
      abort.abort();
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
