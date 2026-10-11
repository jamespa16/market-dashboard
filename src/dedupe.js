// Pure helpers for de-duplicating deals within a source and merging Google News + SEC EDGAR deals.

const STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "for",
  "to",
  "in",
  "on",
  "a",
  "an",
  "with",
  "by",
  "its",
  "after",
  "as",
  "new",
]);

export function normalizeCompanyName(name) {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|incorporated|ltd|limited|corp|corporation|llc|plc|co|company|group|holdings|holding)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function significantTokens(name) {
  return normalizeCompanyName(name)
    .split(" ")
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

export function titleSignature(title) {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)].sort().slice(0, 6).join("-");
}

// Key used to collapse repeat coverage of the same Google News story.
export function googleDedupeKey({ acquirer, target, title }) {
  return acquirer && target
    ? `pair:${normalizeCompanyName(acquirer)}|${normalizeCompanyName(target)}`
    : `sig:${titleSignature(title)}`;
}

export function dedupeIntraSource(deals) {
  const byKey = new Map();
  for (const deal of deals) {
    const existing = byKey.get(deal._dedupeKey);
    if (!existing || (deal.publishedAt ?? Infinity) < (existing.publishedAt ?? Infinity)) {
      byKey.set(deal._dedupeKey, deal);
    }
  }
  return [...byKey.values()];
}

export function companiesShareToken(dealA, dealB) {
  const tokensA = new Set(dealA.companies.flatMap((c) => significantTokens(c.name)));
  return dealB.companies.some((c) => significantTokens(c.name).some((t) => tokensA.has(t)));
}

export function withinDays(a, b, days) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= days * 24 * 60 * 60_000;
}

export function mergeDealPair(googleDeal, secDeal) {
  const earlier = (googleDeal.publishedAt ?? Infinity) <= (secDeal.publishedAt ?? Infinity) ? googleDeal : secDeal;
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

export function dedupeAndMerge(rawDeals) {
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

  return merged.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).map(({ _dedupeKey, ...deal }) => deal);
}

export function filterDeals(deals, { acquirer, adviser } = {}) {
  let out = deals;
  if (acquirer) {
    const needle = acquirer.toLowerCase();
    out = out.filter(
      (d) =>
        d.parsedAcquirer?.toLowerCase().includes(needle) ||
        d.companies.some((c) => c.name.toLowerCase().includes(needle)) ||
        d.title.toLowerCase().includes(needle) ||
        d.summary.toLowerCase().includes(needle)
    );
  }
  if (adviser) {
    const needle = adviser.toLowerCase();
    out = out.filter((d) => d.advisers.some((a) => a.name.toLowerCase().includes(needle)));
  }
  return out;
}
