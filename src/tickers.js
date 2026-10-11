import { createCache } from "./cache.js";
import { getMarketDataProvider } from "./marketData/index.js";

const tickerCache = createCache({ ttlMs: 24 * 60 * 60_000, maxEntries: 300 });

export async function resolveTicker(query) {
  const key = query.trim().toLowerCase();
  return tickerCache.getOrSet(key, async () => {
    const matches = await getMarketDataProvider().searchTickers(query);
    return { query, matches, best: matches[0] ?? null };
  });
}
