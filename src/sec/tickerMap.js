// CIK <-> ticker <-> company name lookups from SEC's company_tickers.json.

import { createCache } from "../cache.js";
import { secFetchJson } from "./client.js";

export const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

const SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "plc",
  "llc",
  "lp",
  "holdings",
  "holding",
  "group",
  "nv",
  "sa",
  "ag",
  "se",
  "the",
]);

/** Lowercase, strip punctuation and corporate suffixes ("Apple Inc." -> "apple"). */
export function normalizeEntityName(name) {
  if (!name) return "";
  const words = String(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  // Drop suffix words wherever they appear ("the", "holdings"), but never reduce to nothing.
  const kept = words.filter((w) => !SUFFIXES.has(w));
  return (kept.length ? kept : words).join(" ");
}

const MIN_PREFIX_LEN = 5;

const normCik = (cik) => String(cik).replace(/^0+/, "") || "0";

/**
 * @param {Record<string, {cik_str:number|string, ticker:string, title:string}>} json
 * @returns {{ byCik(cik): {cik:string, ticker:string, name:string, tickers:string[]}|null,
 *   byTicker(t): same|null, byName(n): same|null, size: number }}
 */
export function buildTickerMap(json) {
  const entries = Array.isArray(json) ? json : Object.values(json ?? {});
  const ciks = new Map(); // cik -> entry
  const tickers = new Map();
  const names = new Map(); // normalized name -> Set<cik>

  for (const row of entries) {
    if (!row?.ticker || row.cik_str == null) continue;
    const cik = normCik(row.cik_str);
    const ticker = String(row.ticker).toUpperCase();
    let entry = ciks.get(cik);
    if (!entry) {
      entry = { cik, ticker, name: row.title, tickers: [] };
      ciks.set(cik, entry);
      const n = normalizeEntityName(row.title);
      if (n) {
        if (!names.has(n)) names.set(n, new Set());
        names.get(n).add(cik);
      }
    }
    if (!entry.tickers.includes(ticker)) entry.tickers.push(ticker);
    if (!tickers.has(ticker)) tickers.set(ticker, entry);
  }

  const normalizedNames = [...names.keys()];

  function byName(name) {
    const q = normalizeEntityName(name);
    if (!q) return null;
    const exact = names.get(q);
    if (exact) return exact.size === 1 ? ciks.get([...exact][0]) : null;
    // Conservative fallback: query is a whole-word leading prefix of exactly one title
    // (e.g. "Kellogg" -> "kellogg"; never "Bank" -> every bank).
    if (q.length < MIN_PREFIX_LEN) return null;
    const hits = new Set();
    for (const n of normalizedNames) {
      if (n.startsWith(q + " ")) for (const c of names.get(n)) hits.add(c);
      if (hits.size > 1) return null;
    }
    return hits.size === 1 ? ciks.get([...hits][0]) : null;
  }

  return {
    size: ciks.size,
    byCik: (cik) => ciks.get(normCik(cik)) ?? null,
    byTicker: (t) =>
      tickers.get(
        String(t ?? "")
          .trim()
          .toUpperCase()
      ) ?? null,
    byName,
  };
}

const cache = createCache({ ttlMs: 24 * 60 * 60_000, maxEntries: 1 });

/** Cached (24h) ticker map; concurrent callers share one fetch. */
export function getTickerMap({ fetchJson = secFetchJson } = {}) {
  return cache.getOrSet("map", async () => buildTickerMap(await fetchJson(COMPANY_TICKERS_URL)));
}
