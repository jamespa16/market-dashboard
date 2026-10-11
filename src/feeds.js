// Deal feed orchestration: discovery (SEC EDGAR + Google News) -> SEC enrichment -> pure pipeline.
// The grouping/merging logic lives in src/pipeline.js; this file is the I/O around it.

import { createCache } from "./cache.js";
import { parseRssItems, stripHtml } from "./xml.js";
import { cleanGoogleTitle } from "./dealParsing.js";
import { fetchWithRetry } from "./http.js";
import { filterDeals } from "./dedupe.js";
import { discoverDealFilings } from "./sec/search.js";
import { getTickerMap, buildTickerMap } from "./sec/tickerMap.js";
import { defaultEnricher } from "./sec/enrich.js";
import { buildDeals, googleObservation, secObservation } from "./pipeline.js";

const GOOGLE_NEWS_URL =
  "https://news.google.com/rss/search?q=%22to+acquire%22+OR+%22merger+agreement%22+OR+%22acquisition+agreement%22+when:30d&hl=en-US&gl=US&ceid=US:en";

const GOOGLE_USER_AGENT = "Mozilla/5.0 (compatible; ma-dashboard/0.1)";

export const ENRICH_MAX_FILINGS = 60;
export const ENRICH_BUDGET_MS = 8000;

const dealsCache = createCache({ ttlMs: 10 * 60_000, maxEntries: 20 });
const DEALS_CACHE_KEY = "deals:merged";

/** Maps one parsed RSS item to the raw headline record the pipeline consumes. */
export function googleItemToRaw(item) {
  const publishedAt = item.pubDate ? Date.parse(item.pubDate) : null;
  return {
    title: cleanGoogleTitle(item.title),
    summary: stripHtml(item.descriptionHtml),
    link: item.link,
    sourceName: item.sourceName,
    publishedAt: Number.isNaN(publishedAt) ? null : publishedAt,
  };
}

async function fetchGoogleNews() {
  const res = await fetchWithRetry(GOOGLE_NEWS_URL, { headers: { "User-Agent": GOOGLE_USER_AGENT } });
  if (!res.ok) throw new Error(`Google News RSS failed: ${res.status}`);
  return parseRssItems(await res.text()).map(googleItemToRaw);
}

const emptyTickerMap = buildTickerMap({});

/** Build all cards from discovery output + whatever filings are already enriched. Pure apart from cache reads. */
export function assembleDeals({ headlines, hits, tickerMap, enriched = (adsh) => defaultEnricher.get(adsh) }) {
  const observations = [];
  for (const h of headlines) {
    const o = googleObservation(h, tickerMap);
    if (o) observations.push(o);
  }
  for (const hit of hits) {
    const e = enriched(hit.adsh);
    observations.push(secObservation({ hit, parsed: e?.parsed ?? null, link: e?.url ?? null }, tickerMap));
  }
  return buildDeals(observations).map((b) => b.card);
}

async function refreshAll() {
  const [g, s, tm] = await Promise.allSettled([fetchGoogleNews(), discoverDealFilings({ days: 30 }), getTickerMap()]);
  const headlines = g.value ?? [];
  const hits = s.value?.hits ?? [];
  const secErrors = s.status === "rejected" ? [s.reason] : (s.value?.errors ?? []).map((e) => e.error);
  const tickerMap = tm.value ?? emptyTickerMap;
  if (tm.status === "rejected") secErrors.push(new Error(`ticker map unavailable: ${tm.reason?.message}`));

  const sources = [
    { name: "google-news", ok: g.status === "fulfilled", count: headlines.length, error: g.reason?.message },
    {
      name: "sec-edgar",
      ok: s.status === "fulfilled" && (hits.length > 0 || secErrors.length === 0),
      count: hits.length,
      error: secErrors.length ? secErrors.map((e) => e.message).join("; ") : undefined,
    },
  ];

  if (headlines.length === 0 && hits.length === 0) {
    const stale = dealsCache.getStale(DEALS_CACHE_KEY);
    if (stale) return { ...stale, sources, stale: true };
    return { deals: [], sources, cachedAt: Date.now() };
  }

  const recompute = () => ({
    deals: assembleDeals({ headlines, hits, tickerMap }),
    sources,
    cachedAt: Date.now(),
  });
  const { attempted, pending } = await defaultEnricher.enrichWithin(hits, {
    max: ENRICH_MAX_FILINGS,
    budgetMs: ENRICH_BUDGET_MS,
    // Filings that missed the time budget finished in the background: refresh the cached cards.
    onLate: () => dealsCache.set(DEALS_CACHE_KEY, recompute()),
  });
  sources[1].enriched = attempted - pending;
  sources[1].pending = pending;
  return recompute();
}

export async function getDeals({ acquirer, adviser, limit = 30, unconfirmed = false } = {}) {
  const merged = await dealsCache.getOrSet(DEALS_CACHE_KEY, refreshAll);
  const deals = filterDeals(merged.deals, { acquirer, adviser });
  const visible = unconfirmed ? deals : deals.filter((d) => d.confidence === "high");
  return {
    deals: visible.slice(0, limit),
    sources: merged.sources,
    cachedAt: merged.cachedAt,
    stale: merged.stale ?? false,
    hiddenCount: deals.length - visible.length,
  };
}
