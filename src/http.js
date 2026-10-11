// fetch() wrapper used for every upstream call: per-attempt timeout plus retry with backoff.

export const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpTimeoutError extends Error {
  constructor(url, timeoutMs) {
    super(`Request to ${new URL(url).host} timed out after ${timeoutMs} ms`);
    this.name = "HttpTimeoutError";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * Like fetch(), but each attempt is aborted after `timeoutMs`, and network errors,
 * timeouts, 429s and 5xx responses are retried `retries` times with exponential backoff.
 * Non-retryable responses (including 4xx) are returned as-is for the caller to inspect.
 */
export async function fetchWithRetry(
  url,
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, backoffMs = 500, fetchImpl = fetch, ...init } = {}
) {
  for (let attempt = 0; ; attempt++) {
    const isLast = attempt >= retries;
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (isLast || !isRetryableStatus(res.status)) return res;
    } catch (err) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      if (isLast) throw timedOut ? new HttpTimeoutError(url, timeoutMs) : err;
    }
    await sleep(backoffMs * 2 ** attempt);
  }
}
