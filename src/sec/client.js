// Single choke point for every request to sec.gov / efts.sec.gov: global rate limit,
// declared User-Agent, timeouts and retries. SEC allows 10 req/s; we stay at 8.

import { fetchWithRetry } from "../http.js";
import { secUserAgent } from "../config.js";

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Min-interval rate limiter: each acquire() reserves the next free slot (slots are
 * 1000/maxPerSecond ms apart) and waits until it arrives. Safe under concurrency because
 * slot reservation is synchronous.
 */
export function createRateLimiter({ maxPerSecond = 8, now = Date.now, sleep = realSleep } = {}) {
  const interval = 1000 / maxPerSecond;
  let nextSlot = 0;
  return async function acquire() {
    const t = now();
    const slot = Math.max(t, nextSlot);
    nextSlot = slot + interval;
    const wait = slot - t;
    if (wait > 0) await sleep(wait);
  };
}

/**
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, sleep?: (ms:number)=>Promise<void>,
 *   maxPerSecond?: number, retries?: number, backoffMs?: number, timeoutMs?: number }} [opts]
 */
export function createSecClient({
  fetchImpl = fetch,
  now,
  sleep,
  maxPerSecond = 8,
  retries,
  backoffMs,
  timeoutMs,
} = {}) {
  const acquire = createRateLimiter({ maxPerSecond, now, sleep });
  // Retries inside fetchWithRetry go through this too, so they also count against the limit.
  let requestCount = 0;
  const limitedFetch = async (url, init) => {
    await acquire();
    requestCount++;
    return fetchImpl(url, init);
  };

  async function secFetch(url, opts = {}) {
    const { headers, ...rest } = opts;
    const extra = { retries, backoffMs, timeoutMs };
    for (const k of Object.keys(extra)) if (extra[k] === undefined) delete extra[k];
    return fetchWithRetry(url, {
      ...extra,
      ...rest,
      fetchImpl: limitedFetch,
      headers: {
        "Accept-Encoding": "gzip, deflate",
        ...headers,
        "User-Agent": secUserAgent(),
      },
    });
  }

  async function ok(url, opts) {
    const res = await secFetch(url, opts);
    if (!res.ok)
      throw new Error(`SEC request failed: ${res.status} ${res.statusText ?? ""} for ${url}`.replace(/ +/g, " "));
    return res;
  }

  const secFetchJson = async (url, opts) =>
    (await ok(url, { ...opts, headers: { Accept: "application/json", ...opts?.headers } })).json();
  const secFetchText = async (url, opts) => (await ok(url, opts)).text();

  return { secFetch, secFetchJson, secFetchText, requestCount: () => requestCount };
}

// Default singleton used by the app.
const defaultClient = createSecClient();
export const secFetch = defaultClient.secFetch;
export const secFetchJson = defaultClient.secFetchJson;
export const secFetchText = defaultClient.secFetchText;
/** Number of HTTP requests (including retries) the app has sent to SEC so far. */
export const secRequestCount = defaultClient.requestCount;
