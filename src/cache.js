export function createCache({ ttlMs = 5 * 60_000, maxEntries = 200, now = Date.now } = {}) {
  const store = new Map();
  const inflight = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (now() > entry.expiresAt) return undefined;
    return entry.value;
  }

  function getStale(key) {
    return store.get(key)?.value;
  }

  function set(key, value, ttlOverrideMs) {
    if (!store.has(key) && store.size >= maxEntries) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
    store.set(key, { value, expiresAt: now() + (ttlOverrideMs ?? ttlMs) });
  }

  async function getOrSet(key, fetcher, ttlOverrideMs) {
    const cached = get(key);
    if (cached !== undefined) return cached;
    // Concurrent callers for the same key share one in-flight fetch; rejections are not cached.
    let pending = inflight.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const value = await fetcher();
          set(key, value, ttlOverrideMs);
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, pending);
    }
    return pending;
  }

  function clear() {
    store.clear();
    inflight.clear();
  }

  return { get, getStale, set, getOrSet, clear };
}
