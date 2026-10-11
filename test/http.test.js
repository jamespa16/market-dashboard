import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry, HttpTimeoutError } from "../src/http.js";

const URL_ = "https://example.com/x";
const opts = { backoffMs: 1, timeoutMs: 50 };
const res = (status) => ({ status, ok: status >= 200 && status < 300 });

function stub(...steps) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  fn.calls = calls;
  return fn;
}

test("returns on 200 first try and forwards init", async () => {
  const fetchImpl = stub(res(200));
  const r = await fetchWithRetry(URL_, { ...opts, fetchImpl, headers: { "User-Agent": "t" } });
  assert.equal(r.status, 200);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].init.headers["User-Agent"], "t");
  assert.ok(fetchImpl.calls[0].init.signal);
});

test("retries once on 503 then returns", async () => {
  const fetchImpl = stub(res(503), res(200));
  const r = await fetchWithRetry(URL_, { ...opts, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(fetchImpl.calls.length, 2);
});

test("returns the last retryable response when retries are exhausted", async () => {
  const fetchImpl = stub(res(503));
  const r = await fetchWithRetry(URL_, { ...opts, fetchImpl });
  assert.equal(r.status, 503);
  assert.equal(fetchImpl.calls.length, 2);
});

test("does not retry on 404", async () => {
  const fetchImpl = stub(res(404), res(200));
  const r = await fetchWithRetry(URL_, { ...opts, fetchImpl });
  assert.equal(r.status, 404);
  assert.equal(fetchImpl.calls.length, 1);
});

test("retries on network error then succeeds", async () => {
  const fetchImpl = stub(new TypeError("fetch failed"), res(200));
  const r = await fetchWithRetry(URL_, { ...opts, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(fetchImpl.calls.length, 2);
});

test("throws the network error after retries are exhausted", async () => {
  const fetchImpl = stub(new TypeError("fetch failed"));
  await assert.rejects(fetchWithRetry(URL_, { ...opts, retries: 2, fetchImpl }), { message: "fetch failed" });
  assert.equal(fetchImpl.calls.length, 3);
});

test("a hung request times out with HttpTimeoutError", async (t) => {
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  // AbortSignal.timeout timers are unref'd; keep the event loop alive while waiting.
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  await assert.rejects(
    fetchWithRetry(URL_, { timeoutMs: 20, backoffMs: 1, retries: 1, fetchImpl }),
    (err) => err instanceof HttpTimeoutError && /example\.com/.test(err.message)
  );
});
