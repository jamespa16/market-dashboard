import { createCache } from "./cache.js";

const USER_AGENT = "Mozilla/5.0 (compatible; ma-dashboard/0.1)";
const tickerCache = createCache({ ttlMs: 24 * 60 * 60_000, maxEntries: 300 });

async function searchYahoo(query) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Yahoo Finance search failed: ${res.status}`);
  const data = await res.json();
  return data?.quotes ?? [];
}

export async function resolveTicker(query) {
  const key = query.trim().toLowerCase();
  return tickerCache.getOrSet(key, async () => {
    const quotes = await searchYahoo(query);
    const matches = quotes
      .filter((q) => q.quoteType === "EQUITY" && q.symbol)
      .map((q) => ({
        symbol: q.symbol,
        name: q.longname ?? q.shortname ?? q.symbol,
        exchange: q.exchDisp ?? q.exchange ?? null,
        quoteType: q.quoteType,
        score: q.score ?? 0,
      }))
      .sort((a, b) => b.score - a.score);

    return { query, matches, best: matches[0] ?? null };
  });
}
