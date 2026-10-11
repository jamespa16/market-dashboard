// EDGAR full-text search (efts) client and the EDGAR-first deal discovery query set.

import { secFetchJson } from "./client.js";

export const SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
export const PAGE_SIZE = 100; // efts returns at most 100 hits per page
export const MAX_RESULT_WINDOW = 10_000; // efts rejects from + size > 10000

const stripZeros = (cik) => String(cik).replace(/^0+/, "") || "0";

/** Normalize one raw efts hit. Note efts returns one hit per *document* (main doc and exhibits). */
export function normalizeHit(hit) {
  const src = hit._source ?? {};
  const [idAdsh, ...rest] = String(hit._id ?? "").split(":");
  const adsh = src.adsh ?? idAdsh;
  const fileName = rest.join(":") || null;
  const ciks = src.ciks ?? [];
  const cik = ciks[0] ? stripZeros(ciks[0]) : null;
  return {
    adsh,
    cik,
    ciks: ciks.map(stripZeros),
    displayNames: src.display_names ?? [],
    form: src.form ?? null,
    items: src.items ?? [],
    fileDate: src.file_date ?? null,
    fileType: src.file_type ?? null,
    fileName,
    description: src.file_description ?? null,
    url:
      cik && adsh && fileName
        ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${fileName}`
        : null,
  };
}

export function buildSearchUrl({ query, forms, startdt, enddt, from } = {}) {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (forms?.length) p.set("forms", Array.isArray(forms) ? forms.join(",") : forms);
  if (startdt || enddt) {
    p.set("dateRange", "custom");
    if (startdt) p.set("startdt", startdt);
    if (enddt) p.set("enddt", enddt);
  }
  if (from) p.set("from", String(from));
  return `${SEARCH_URL}?${p}`;
}

/**
 * One page of efts results.
 * @returns {Promise<{ total: number, from: number, hits: ReturnType<typeof normalizeHit>[] }>}
 */
export async function searchFilings(
  { query, forms, startdt, enddt, from = 0 } = {},
  { fetchJson = secFetchJson } = {}
) {
  if (from + PAGE_SIZE > MAX_RESULT_WINDOW) return { total: 0, from, hits: [] };
  const json = await fetchJson(buildSearchUrl({ query, forms, startdt, enddt, from }));
  const raw = json?.hits?.hits ?? [];
  return { total: json?.hits?.total?.value ?? raw.length, from, hits: raw.map(normalizeHit) };
}

/** Pages through a search until `maxPages` pages or the results run out. */
export async function searchAllPages(params, { maxPages = 3, fetchJson } = {}) {
  const out = [];
  let from = params.from ?? 0;
  let requests = 0;
  for (let page = 0; page < maxPages; page++) {
    const r = await searchFilings({ ...params, from }, { fetchJson });
    requests++;
    out.push(...r.hits);
    from += PAGE_SIZE;
    if (r.hits.length < PAGE_SIZE || from >= r.total) break;
  }
  return { hits: out, requests };
}

const has101 = (h) => h.items.includes("1.01");

/** The discovery query set. `filter` runs client-side because efts ignores an `items` param. */
export const DEAL_QUERIES = [
  { label: "8-K 1.01 merger agreement", query: '"merger agreement"', forms: ["8-K"], filter: has101 },
  {
    label: "8-K 1.01 agreement and plan of merger",
    query: '"agreement and plan of merger"',
    forms: ["8-K"],
    filter: has101,
  },
  { label: "DEFM14A", query: "merger", forms: ["DEFM14A"] },
  { label: "S-4", query: "merger", forms: ["S-4"] },
  { label: "SC TO-T", forms: ["SC TO-T"] }, // also returns SC TO-T/A
  { label: "425", query: "merger", forms: ["425"] },
];

const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * Run the discovery queries for the last `days` days and dedupe by accession number.
 * Request cost: up to `maxPages` per query; with defaults (maxPages 3, 6 queries) at most 18
 * requests, typically ~11-13 for a 30-day window (DEFM14A / S-4 / SC TO-T fit in 1 page).
 * At 8 req/s that is 2-3 s.
 * Failures in one query don't abort the rest; they're reported in `errors`.
 * @returns {Promise<{ hits: object[], errors: {label:string, error:Error}[], requests: number }>}
 *   each hit is a normalizeHit() object plus `queries: string[]` (which queries found it) and
 *   `exhibits: {fileType, url, description}[]` (EX-99.x documents the search returned for that filing).
 */
export async function discoverDealFilings({ days = 30, maxPages = 3, now = new Date(), fetchJson } = {}) {
  const enddt = isoDay(now);
  const startdt = isoDay(new Date(now.getTime() - days * 86_400_000));
  const byAdsh = new Map();
  const errors = [];
  let requests = 0;

  for (const q of DEAL_QUERIES) {
    let res;
    try {
      res = await searchAllPages({ query: q.query, forms: q.forms, startdt, enddt }, { maxPages, fetchJson });
    } catch (error) {
      errors.push({ label: q.label, error });
      continue;
    }
    requests += res.requests;
    for (const hit of res.hits) {
      if (q.filter && !q.filter(hit)) continue;
      if (hit.form === "8-K/A") continue; // amendments don't announce deals
      let entry = byAdsh.get(hit.adsh);
      if (!entry) {
        entry = { ...hit, queries: [q.label], exhibits: [] };
        byAdsh.set(hit.adsh, entry);
      } else {
        if (!entry.queries.includes(q.label)) entry.queries.push(q.label);
        // Prefer the main document (fileType === form) over exhibits as the representative hit.
        if (entry.fileType !== entry.form && hit.fileType === hit.form) {
          Object.assign(entry, hit, { queries: entry.queries, exhibits: entry.exhibits });
        }
      }
      // Keep press-release exhibit URLs so enrichment can skip the filing-index request.
      if (/^EX-99/i.test(hit.fileType ?? "") && hit.url && !entry.exhibits.some((e) => e.url === hit.url)) {
        entry.exhibits.push({ fileType: hit.fileType, url: hit.url, description: hit.description });
      }
    }
  }
  return { hits: [...byAdsh.values()], errors, requests };
}
