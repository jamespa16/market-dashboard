import test from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../src/cache.js";

function clock() {
  const c = { t: 1000, now: () => c.t };
  return c;
}

test("get/set round trip and miss", () => {
  const cache = createCache({ now: clock().now });
  assert.equal(cache.get("a"), undefined);
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
});

test("entries expire after the TTL but remain available via getStale", () => {
  const c = clock();
  const cache = createCache({ ttlMs: 100, now: c.now });
  cache.set("a", "v");
  c.t += 100;
  assert.equal(cache.get("a"), "v");
  c.t += 1;
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.getStale("a"), "v");
  assert.equal(cache.getStale("missing"), undefined);
});

test("per-call TTL override", () => {
  const c = clock();
  const cache = createCache({ ttlMs: 100, now: c.now });
  cache.set("a", 1, 10);
  c.t += 11;
  assert.equal(cache.get("a"), undefined);
});

test("maxEntries evicts the oldest entry", () => {
  const cache = createCache({ maxEntries: 2, now: clock().now });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.getStale("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
  cache.set("b", 22); // overwriting does not evict
  assert.equal(cache.get("c"), 3);
});

test("getOrSet calls the fetcher once while fresh, again after expiry", async () => {
  const c = clock();
  const cache = createCache({ ttlMs: 100, now: c.now });
  let calls = 0;
  const fetcher = async () => ++calls;
  assert.equal(await cache.getOrSet("k", fetcher), 1);
  assert.equal(await cache.getOrSet("k", fetcher), 1);
  c.t += 101;
  assert.equal(await cache.getOrSet("k", fetcher), 2);
});

test("concurrent getOrSet calls share one in-flight fetch", async () => {
  const cache = createCache({ now: clock().now });
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return "v";
  };
  const results = await Promise.all([
    cache.getOrSet("k", fetcher),
    cache.getOrSet("k", fetcher),
    cache.getOrSet("k", fetcher),
  ]);
  assert.deepEqual(results, ["v", "v", "v"]);
  assert.equal(calls, 1);
});

test("rejections are shared by concurrent callers but not cached", async () => {
  const cache = createCache({ now: clock().now });
  let calls = 0;
  const failing = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    throw new Error("boom");
  };
  const settled = await Promise.allSettled([cache.getOrSet("k", failing), cache.getOrSet("k", failing)]);
  assert.ok(settled.every((s) => s.status === "rejected"));
  assert.equal(calls, 1);
  assert.equal(await cache.getOrSet("k", async () => "ok"), "ok");
});

test("clear empties the cache", () => {
  const cache = createCache({ now: clock().now });
  cache.set("a", 1);
  cache.clear();
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.getStale("a"), undefined);
});
