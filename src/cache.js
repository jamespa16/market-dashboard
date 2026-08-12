export function createCache({ ttlMs = 5 * 60_000, maxEntries = 200 } = {}) {
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) return undefined;
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
    store.set(key, { value, expiresAt: Date.now() + (ttlOverrideMs ?? ttlMs) });
  }

  async function getOrSet(key, fetcher, ttlOverrideMs) {
    const cached = get(key);
    if (cached !== undefined) return cached;
    const value = await fetcher();
    set(key, value, ttlOverrideMs);
    return value;
  }

  function clear() {
    store.clear();
  }

  return { get, getStale, set, getOrSet, clear };
}
