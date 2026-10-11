import { createCache } from "./cache.js";
import { getMarketDataProvider } from "./marketData/index.js";
import { getTickerMap } from "./sec/tickerMap.js";

const tickerCache = createCache({ ttlMs: 24 * 60 * 60_000, maxEntries: 300 });

// SEC ticker map first (free, authoritative for US filers); Yahoo search as fallback.
async function resolveFromSec(query, getMap) {
  try {
    const map = await getMap();
    const hit = map.byName(query) ?? map.byTicker(query);
    if (!hit) return null;
    return {
      symbol: hit.ticker,
      name: hit.name,
      exchange: null,
      quoteType: "EQUITY",
      score: 1000,
      cik: hit.cik,
      source: "sec",
    };
  } catch {
    return null; // SEC unavailable: fall back to the market-data provider
  }
}

export async function resolveTicker(query, { getMap = getTickerMap } = {}) {
  const key = query.trim().toLowerCase();
  return tickerCache.getOrSet(key, async () => {
    const sec = await resolveFromSec(query, getMap);
    if (sec) return { query, matches: [sec], best: sec };
    const matches = await getMarketDataProvider().searchTickers(query);
    return { query, matches, best: matches[0] ?? null };
  });
}
