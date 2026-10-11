import { createHash } from "node:crypto";
import { createCache } from "./cache.js";
import { parseRssItems, stripHtml } from "./xml.js";
import {
  cleanGoogleTitle,
  extractCompanyPair,
  looksLikeCompanyName,
  cleanSecDisplayName,
  extractTickerFromSecName,
  buildSecFilingUrl,
} from "./dealParsing.js";
import { detectAdvisers } from "./advisers.js";
import { fetchWithRetry } from "./http.js";
import { secUserAgent } from "./config.js";
import { dedupeAndMerge, filterDeals, googleDedupeKey } from "./dedupe.js";

const GOOGLE_NEWS_URL =
  "https://news.google.com/rss/search?q=%22to+acquire%22+OR+%22merger+agreement%22+OR+%22acquisition+agreement%22+when:7d&hl=en-US&gl=US&ceid=US:en";

const GOOGLE_USER_AGENT = "Mozilla/5.0 (compatible; ma-dashboard/0.1)";

const dealsCache = createCache({ ttlMs: 10 * 60_000, maxEntries: 20 });
const DEALS_CACHE_KEY = "deals:merged";

function makeId(key) {
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

async function fetchGoogleNewsDeals() {
  const res = await fetchWithRetry(GOOGLE_NEWS_URL, { headers: { "User-Agent": GOOGLE_USER_AGENT } });
  if (!res.ok) throw new Error(`Google News RSS failed: ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml).map(googleItemToDeal);
}

// Maps one parsed RSS item to a raw (pre-dedupe) deal. Exported for the fixture tests.
export function googleItemToDeal(item) {
  const title = cleanGoogleTitle(item.title);
  const summary = stripHtml(item.descriptionHtml);
  const { acquirer, target } = extractCompanyPair(title);
  const companies = [acquirer, target]
    .filter(Boolean)
    .filter(looksLikeCompanyName)
    .map((name) => ({ name, ticker: null }));
  const publishedAt = item.pubDate ? Date.parse(item.pubDate) : null;
  const dedupeKey = googleDedupeKey({ acquirer, target, title });

  return {
    _dedupeKey: dedupeKey,
    id: makeId(dedupeKey),
    title,
    summary,
    publishedAt: Number.isNaN(publishedAt) ? null : publishedAt,
    sources: [{ type: "google-news", link: item.link, sourceName: item.sourceName }],
    primaryLink: item.link,
    parsedAcquirer: acquirer,
    parsedTarget: target,
    companies,
    advisers: detectAdvisers(`${title} ${summary}`),
    formTypes: [],
    items: [],
  };
}

async function fetchSecEdgarDeals() {
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60_000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url =
    `https://efts.sec.gov/LATEST/search-index?q=%22merger+agreement%22&forms=8-K` +
    `&dateRange=custom&startdt=${fmt(start)}&enddt=${fmt(end)}`;

  const res = await fetchWithRetry(url, { headers: { "User-Agent": secUserAgent() } });
  if (!res.ok) throw new Error(`SEC EDGAR search failed: ${res.status}`);
  const data = await res.json();
  return (data?.hits?.hits ?? []).map(secHitToDeal);
}

// Maps one EDGAR full-text-search hit to a raw (pre-dedupe) deal. Exported for the fixture tests.
export function secHitToDeal(hit) {
  const s = hit._source;
  const displayName = s.display_names?.[0] ?? "Unknown company";
  const companyName = cleanSecDisplayName(displayName);
  const ticker = extractTickerFromSecName(displayName);
  const primaryDoc = hit._id?.split(":")[1];
  const cik = s.ciks?.[0];
  const primaryLink = cik && s.adsh && primaryDoc ? buildSecFilingUrl({ cik, adsh: s.adsh, primaryDoc }) : null;
  const title = `${companyName} — ${s.form} filing (${(s.items ?? []).join(", ") || "no items listed"})`;
  const summary = `Filed ${s.file_date}.`;
  const publishedAt = s.file_date ? Date.parse(s.file_date) : null;

  return {
    _dedupeKey: `adsh:${s.adsh}`,
    id: makeId(`adsh:${s.adsh}`),
    title,
    summary,
    publishedAt: Number.isNaN(publishedAt) ? null : publishedAt,
    sources: [{ type: "sec-edgar", link: primaryLink, sourceName: "SEC EDGAR" }],
    primaryLink: primaryLink ?? "https://www.sec.gov/cgi-bin/browse-edgar",
    parsedAcquirer: null,
    parsedTarget: null,
    companies: [{ name: companyName, ticker }],
    advisers: detectAdvisers(title),
    formTypes: [s.form],
    items: s.items ?? [],
  };
}

async function refreshAll() {
  const [g, s] = await Promise.allSettled([fetchGoogleNewsDeals(), fetchSecEdgarDeals()]);
  const sources = [
    { name: "google-news", ok: g.status === "fulfilled", count: g.value?.length ?? 0, error: g.reason?.message },
    { name: "sec-edgar", ok: s.status === "fulfilled", count: s.value?.length ?? 0, error: s.reason?.message },
  ];
  const raw = [...(g.value ?? []), ...(s.value ?? [])];

  if (raw.length === 0) {
    const stale = dealsCache.getStale(DEALS_CACHE_KEY);
    if (stale) return { ...stale, sources, stale: true };
    return { deals: [], sources, cachedAt: Date.now() };
  }

  return { deals: dedupeAndMerge(raw), sources, cachedAt: Date.now() };
}

export async function getDeals({ acquirer, adviser, limit = 30 } = {}) {
  const merged = await dealsCache.getOrSet(DEALS_CACHE_KEY, refreshAll);

  const deals = filterDeals(merged.deals, { acquirer, adviser });

  return {
    deals: deals.slice(0, limit),
    sources: merged.sources,
    cachedAt: merged.cachedAt,
    stale: merged.stale ?? false,
  };
}
