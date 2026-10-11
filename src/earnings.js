import { createCache } from "./cache.js";
import { getMarketDataProvider } from "./marketData/index.js";

const earningsCache = createCache({ ttlMs: 6 * 60 * 60_000, maxEntries: 200 });

const NOTE =
  "Earnings dates and EPS/revenue estimates from Yahoo Finance. The upcoming date is often a 1–2 day estimated window until confirmed by the company.";

export async function getEarnings(symbol) {
  const key = symbol.toUpperCase();
  return earningsCache.getOrSet(key, async () => {
    const { lastReport, nextReport, recentQuarters } = await getMarketDataProvider().getEarnings(key);
    return { symbol: key, asOf: Date.now(), lastReport, nextReport, recentQuarters, note: NOTE };
  });
}
