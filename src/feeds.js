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

const GOOGLE_NEWS_URL =
  "https://news.google.com/rss/search?q=%22to+acquire%22+OR+%22merger+agreement%22+OR+%22acquisition+agreement%22+when:7d&hl=en-US&gl=US&ceid=US:en";

// SEC requires a descriptive User-Agent identifying the requester (fair-access policy).
const SEC_USER_AGENT = "ma-dashboard/0.1 (contact: james.pa@outlook.com)";
const GOOGLE_USER_AGENT = "Mozilla/5.0 (compatible; ma-dashboard/0.1)";

const dealsCache = createCache({ ttlMs: 10 * 60_000, maxEntries: 20 });
const DEALS_CACHE_KEY = "deals:merged";

const STOPWORDS = new Set([
  "the", "and", "of", "for", "to", "in", "on", "a", "an", "with", "by", "its", "after", "as", "new",
]);

function normalizeCompanyName(name) {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|incorporated|ltd|limited|corp|corporation|llc|plc|co|company|group|holdings|holding)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(name) {
  return normalizeCompanyName(name)
    .split(" ")
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function titleSignature(title) {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)].sort().slice(0, 6).join("-");
}

function makeId(key) {
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

async function fetchGoogleNewsDeals() {
  const res = await fetch(GOOGLE_NEWS_URL, { headers: { "User-Agent": GOOGLE_USER_AGENT } });
  if (!res.ok) throw new Error(`Google News RSS failed: ${res.status}`);
  const xml = await res.text();
  const items = parseRssItems(xml);

  return items.map((item) => {
    const title = cleanGoogleTitle(item.title);
    const summary = stripHtml(item.descriptionHtml);
    const { acquirer, target } = extractCompanyPair(title);
    const companies = [acquirer, target]
      .filter(Boolean)
      .filter(looksLikeCompanyName)
      .map((name) => ({ name, ticker: null }));
    const publishedAt = item.pubDate ? Date.parse(item.pubDate) : null;
    const dedupeKey =
      acquirer && target
        ? `pair:${normalizeCompanyName(acquirer)}|${normalizeCompanyName(target)}`
        : `sig:${titleSignature(title)}`;

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
  });
}

async function fetchSecEdgarDeals() {
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60_000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url =
    `https://efts.sec.gov/LATEST/search-index?q=%22merger+agreement%22&forms=8-K` +
    `&dateRange=custom&startdt=${fmt(start)}&enddt=${fmt(end)}`;

  const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
  if (!res.ok) throw new Error(`SEC EDGAR search failed: ${res.status}`);
  const data = await res.json();
  const hits = data?.hits?.hits ?? [];

  return hits.map((hit) => {
    const s = hit._source;
    const displayName = s.display_names?.[0] ?? "Unknown company";
    const companyName = cleanSecDisplayName(displayName);
    const ticker = extractTickerFromSecName(displayName);
    const primaryDoc = hit._id?.split(":")[1];
    const cik = s.ciks?.[0];
    const primaryLink =
      cik && s.adsh && primaryDoc ? buildSecFilingUrl({ cik, adsh: s.adsh, primaryDoc }) : null;
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
  });
}

function dedupeIntraSource(deals) {
  const byKey = new Map();
  for (const deal of deals) {
    const existing = byKey.get(deal._dedupeKey);
    if (!existing || (deal.publishedAt ?? Infinity) < (existing.publishedAt ?? Infinity)) {
      byKey.set(deal._dedupeKey, deal);
    }
  }
  return [...byKey.values()];
}

function companiesShareToken(dealA, dealB) {
  const tokensA = new Set(dealA.companies.flatMap((c) => significantTokens(c.name)));
  return dealB.companies.some((c) => significantTokens(c.name).some((t) => tokensA.has(t)));
}

function withinDays(a, b, days) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= days * 24 * 60 * 60_000;
}

function mergeDealPair(googleDeal, secDeal) {
  const earlier =
    (googleDeal.publishedAt ?? Infinity) <= (secDeal.publishedAt ?? Infinity) ? googleDeal : secDeal;
  const companiesByName = new Map();
  for (const c of [...secDeal.companies, ...googleDeal.companies]) {
    const key = normalizeCompanyName(c.name);
    const existing = companiesByName.get(key);
    if (!existing || (!existing.ticker && c.ticker)) companiesByName.set(key, c);
  }
  return {
    _dedupeKey: googleDeal._dedupeKey,
    id: googleDeal.id,
    title: googleDeal.title,
    summary: googleDeal.summary,
    publishedAt: earlier.publishedAt,
    sources: [...googleDeal.sources, ...secDeal.sources],
    primaryLink: secDeal.primaryLink ?? googleDeal.primaryLink,
    parsedAcquirer: googleDeal.parsedAcquirer,
    parsedTarget: googleDeal.parsedTarget,
    companies: [...companiesByName.values()],
    advisers: [...new Map([...googleDeal.advisers, ...secDeal.advisers].map((a) => [a.name, a])).values()],
    formTypes: secDeal.formTypes,
    items: secDeal.items,
  };
}

function dedupeAndMerge(rawDeals) {
  const googleDeals = dedupeIntraSource(rawDeals.filter((d) => d.sources[0].type === "google-news"));
  const secDeals = dedupeIntraSource(rawDeals.filter((d) => d.sources[0].type === "sec-edgar"));

  const mergedSecIndexes = new Set();
  const merged = [];

  for (const g of googleDeals) {
    const matchIndex = secDeals.findIndex(
      (s, i) => !mergedSecIndexes.has(i) && companiesShareToken(g, s) && withinDays(g.publishedAt, s.publishedAt, 14)
    );
    if (matchIndex >= 0) {
      mergedSecIndexes.add(matchIndex);
      merged.push(mergeDealPair(g, secDeals[matchIndex]));
    } else {
      merged.push(g);
    }
  }

  secDeals.forEach((s, i) => {
    if (!mergedSecIndexes.has(i)) merged.push(s);
  });

  return merged
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .map(({ _dedupeKey, ...deal }) => deal);
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

  let deals = merged.deals;
  if (acquirer) {
    const needle = acquirer.toLowerCase();
    deals = deals.filter(
      (d) =>
        d.parsedAcquirer?.toLowerCase().includes(needle) ||
        d.companies.some((c) => c.name.toLowerCase().includes(needle)) ||
        d.title.toLowerCase().includes(needle) ||
        d.summary.toLowerCase().includes(needle)
    );
  }
  if (adviser) {
    const needle = adviser.toLowerCase();
    deals = deals.filter((d) => d.advisers.some((a) => a.name.toLowerCase().includes(needle)));
  }

  return {
    deals: deals.slice(0, limit),
    sources: merged.sources,
    cachedAt: merged.cachedAt,
    stale: merged.stale ?? false,
  };
}
