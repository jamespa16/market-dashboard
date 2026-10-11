import { createCache } from "./cache.js";
import { getMarketDataProvider } from "./marketData/index.js";

const holdersCache = createCache({ ttlMs: 6 * 60 * 60_000, maxEntries: 200 });

const APPROXIMATION_NOTE =
  "Institutional ownership (broad, from Yahoo Finance) — includes index/mutual funds and asset managers generally, not limited to private equity or VC.";

export async function getInstitutionalHolders(symbol) {
  const key = symbol.toUpperCase();
  return holdersCache.getOrSet(key, async () => {
    const { asOf, topHolders, summary } = await getMarketDataProvider().getHolders(key);
    return { symbol: key, asOf, topHolders, summary, note: APPROXIMATION_NOTE };
  });
}
