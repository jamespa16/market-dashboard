// SEC filing enrichment: fetch a filing's press release (or main document) and parse deal terms.
//
// Cost model: one filing needs 1 request when the search already returned its EX-99.1 URL (or it is a
// 425 / SC TO-T, whose main document is parsed directly), else 2 (filing index + press release), plus 1-2 more when the press release names no parties
// and we fall back to the main document. Results are cached per accession number for 30 days
// (filings are immutable); failures are remembered for 10 minutes so they are not hammered.
// A cold refresh enriches at most `max` filings (newest first) within `budgetMs`; whatever is
// unfinished keeps running in the background and is picked up by the next refresh / `onLate`.

import { createCache } from "../cache.js";
import { htmlToPlainText, parsePressRelease } from "../pressRelease.js";
import { secFetchText } from "./client.js";
import { findPressRelease, getFilingDocuments } from "./filings.js";

const MAX_TEXT = 40_000;
const capText = (t) => (t.length > MAX_TEXT ? `${t.slice(0, 24_990)}\n[...]\n${t.slice(-14_990)}` : t);

/**
 * Forms worth parsing. Proxy statements and registration statements (DEFM14A, S-4) are multi-megabyte
 * and carry no press-release summary: they stay unenriched and ride along on the deal's 8-K / 425 / headline.
 */
export const isEnrichable = (hit) => /^(8-K|425|SC TO-T)/i.test(hit.form ?? "");

const hasParties = (p) => !!(p.acquirer || p.target);

/**
 * @param {{ fetchText?: (url:string)=>Promise<string>, concurrency?: number, now?: ()=>number }} [opts]
 */
export function createEnricher({ fetchText = secFetchText, concurrency = 6, now = Date.now } = {}) {
  const parsedCache = createCache({ ttlMs: 30 * 24 * 60 * 60_000, maxEntries: 2000, now });
  const failures = createCache({ ttlMs: 10 * 60_000, maxEntries: 2000, now });
  const inflight = new Map();
  const queue = [];
  let active = 0;

  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      job()
        .catch(() => {})
        .finally(() => {
          active--;
          pump();
        });
    }
  }
  const limited = (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      pump();
    });

  async function parseUrl(url) {
    return parsePressRelease(capText(htmlToPlainText(await fetchText(url))));
  }

  /** @returns {Promise<{ parsed: object, url: string }>} */
  async function fetchParsed(hit) {
    const ex = hit.exhibits?.find((e) => /^EX-99\.1$/i.test(e.fileType)) ?? hit.exhibits?.[0];
    let docs = null;
    const getDocs = async () => (docs ??= await getFilingDocuments({ cik: hit.cik, adsh: hit.adsh }, { fetchText }));
    let url = ex?.url ?? null;
    // 425 and tender-offer filings are themselves the communication: no index lookup needed.
    if (!url && hit.form !== "8-K") url = hit.url;
    if (!url) {
      const pr = findPressRelease(await getDocs());
      url = pr?.url ?? (hit.fileType === hit.form ? hit.url : null);
      if (!url) url = (await getDocs()).find((d) => d.type === hit.form)?.url ?? null;
    }
    if (!url) throw new Error(`no document found for ${hit.adsh}`);
    let result = { parsed: await parseUrl(url), url };
    if (!hasParties(result.parsed)) {
      const mainUrl =
        hit.fileType === hit.form ? hit.url : ((await getDocs()).find((d) => d.type === hit.form)?.url ?? null);
      if (mainUrl && mainUrl !== url) {
        const parsed = await parseUrl(mainUrl);
        if (hasParties(parsed)) result = { parsed, url: mainUrl };
      }
    }
    return result;
  }

  function ensure(hit) {
    const cached = parsedCache.get(hit.adsh);
    if (cached) return Promise.resolve(cached);
    if (failures.get(hit.adsh)) return Promise.resolve(null);
    let p = inflight.get(hit.adsh);
    if (!p) {
      p = limited(() => fetchParsed(hit))
        .then((r) => {
          parsedCache.set(hit.adsh, r);
          return r;
        })
        .catch(() => {
          failures.set(hit.adsh, true);
          return null;
        })
        .finally(() => inflight.delete(hit.adsh));
      inflight.set(hit.adsh, p);
    }
    return p;
  }

  /**
   * Enrich the newest `max` hits, waiting at most `budgetMs`. Unfinished work continues in the
   * background; `onLate` fires once all of it has settled (only if the budget expired first).
   * @returns {Promise<{ attempted: number, pending: number }>}
   */
  async function enrichWithin(hits, { max = 60, budgetMs = 8000, onLate } = {}) {
    const targets = hits
      .filter(isEnrichable)
      .sort((a, b) => String(b.fileDate).localeCompare(String(a.fileDate)))
      .slice(0, max);
    const all = Promise.allSettled(targets.map(ensure));
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), budgetMs);
    });
    const outcome = await Promise.race([all.then(() => "done"), timeout]);
    clearTimeout(timer);
    const pending = targets.filter((h) => inflight.has(h.adsh)).length;
    if (outcome === "timeout") all.then(() => onLate?.());
    return { attempted: targets.length, pending };
  }

  return { ensure, enrichWithin, get: (adsh) => parsedCache.get(adsh) ?? null };
}

export const defaultEnricher = createEnricher();
