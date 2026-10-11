import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCompanyName,
  significantTokens,
  titleSignature,
  googleDedupeKey,
  dedupeIntraSource,
  companiesShareToken,
  withinDays,
  mergeDealPair,
  dedupeAndMerge,
  filterDeals,
} from "../src/dedupe.js";

const DAY = 24 * 60 * 60_000;
const T0 = Date.parse("2026-01-20T00:00:00Z");

function deal(overrides = {}) {
  return {
    _dedupeKey: "k",
    id: "id",
    title: "Title",
    summary: "",
    publishedAt: T0,
    sources: [{ type: "google-news", link: "http://g", sourceName: "G" }],
    primaryLink: "http://g",
    parsedAcquirer: null,
    parsedTarget: null,
    companies: [],
    advisers: [],
    formTypes: [],
    items: [],
    ...overrides,
  };
}
const google = (o) => deal(o);
const sec = (o) =>
  deal({
    sources: [{ type: "sec-edgar", link: "http://s", sourceName: "SEC EDGAR" }],
    primaryLink: "http://s",
    formTypes: ["8-K"],
    items: ["1.01"],
    ...o,
  });

test("normalizeCompanyName drops punctuation and corporate suffixes", () => {
  assert.equal(normalizeCompanyName("Acme Holdings, Inc."), "acme");
  assert.equal(normalizeCompanyName("Beta  Corporation"), "beta");
});

test("significantTokens keeps words of 4+ chars and drops stopwords", () => {
  assert.deepEqual(significantTokens("Acme Widgets Inc"), ["acme", "widgets"]);
  assert.deepEqual(significantTokens("The Big Co"), []);
});

test("titleSignature is order-insensitive and de-duplicates words", () => {
  assert.equal(titleSignature("Alpha buys Gamma"), titleSignature("gamma, ALPHA buys"));
  assert.equal(titleSignature("Alpha Alpha"), "alpha");
});

test("googleDedupeKey uses the pair when known, else the title signature", () => {
  assert.equal(googleDedupeKey({ acquirer: "Acme Inc", target: "Beta Corp", title: "x" }), "pair:acme|beta");
  assert.match(googleDedupeKey({ acquirer: null, target: null, title: "Alpha buys Gamma" }), /^sig:/);
});

test("withinDays", () => {
  assert.equal(withinDays(T0, T0 + 14 * DAY, 14), true);
  assert.equal(withinDays(T0, T0 + 14 * DAY + 1, 14), false);
  assert.equal(withinDays(null, T0, 14), false);
});

test("companiesShareToken", () => {
  const a = deal({ companies: [{ name: "Acme Widgets Inc", ticker: null }] });
  const b = deal({ companies: [{ name: "Widgets Holdings", ticker: "WDG" }] });
  const c = deal({ companies: [{ name: "Other Corp", ticker: null }] });
  assert.equal(companiesShareToken(a, b), true);
  assert.equal(companiesShareToken(a, c), false);
});

test("dedupeIntraSource keeps the earliest per key", () => {
  const late = google({ id: "late", publishedAt: T0 + DAY });
  const early = google({ id: "early", publishedAt: T0 });
  const other = google({ id: "other", _dedupeKey: "other" });
  const out = dedupeIntraSource([late, early, other]);
  assert.deepEqual(out.map((d) => d.id).sort(), ["early", "other"]);
});

test("dedupeAndMerge merges Google and SEC deals sharing a token within 14 days", () => {
  const g = google({ companies: [{ name: "Acme Widgets", ticker: null }], publishedAt: T0 + 3 * DAY });
  const s = sec({ _dedupeKey: "adsh:1", companies: [{ name: "Acme Widgets Inc", ticker: "ACME" }], publishedAt: T0 });
  const out = dedupeAndMerge([g, s]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sources.length, 2);
  assert.equal(out[0].publishedAt, T0);
});

test("dedupeAndMerge does not merge when more than 14 days apart", () => {
  const g = google({ companies: [{ name: "Acme Widgets", ticker: null }], publishedAt: T0 + 15 * DAY });
  const s = sec({ _dedupeKey: "adsh:1", companies: [{ name: "Acme Widgets Inc", ticker: "ACME" }], publishedAt: T0 });
  assert.equal(dedupeAndMerge([g, s]).length, 2);
});

test("dedupeAndMerge does not merge when company tokens differ", () => {
  const g = google({ companies: [{ name: "Acme Widgets", ticker: null }] });
  const s = sec({ _dedupeKey: "adsh:1", companies: [{ name: "Zenith Rockets", ticker: "ZNR" }] });
  assert.equal(dedupeAndMerge([g, s]).length, 2);
});

test("mergeDealPair combines companies (ticker preferred), advisers and sources", () => {
  const g = google({
    companies: [
      { name: "Acme Widgets", ticker: null },
      { name: "Beta", ticker: null },
    ],
    advisers: [{ name: "Lazard", matchedText: "Lazard" }],
  });
  const s = sec({
    companies: [
      { name: "Acme Widgets Inc", ticker: "ACME" },
      { name: "Acme Widgets", ticker: "ACME" },
    ],
    advisers: [
      { name: "Lazard", matchedText: "lazard" },
      { name: "Evercore", matchedText: "Evercore" },
    ],
  });
  const m = mergeDealPair(g, s);
  assert.deepEqual(m.advisers.map((a) => a.name).sort(), ["Evercore", "Lazard"]);
  assert.equal(m.sources.length, 2);
  assert.equal(m.primaryLink, "http://s");
  assert.equal(m.companies.find((c) => c.name.startsWith("Acme Widgets")).ticker, "ACME");
  assert.ok(m.companies.some((c) => c.name === "Beta"));
  assert.deepEqual(m.formTypes, ["8-K"]);
});

test("dedupeAndMerge sorts newest first and strips _dedupeKey", () => {
  const a = google({ _dedupeKey: "a", id: "a", publishedAt: T0 });
  const b = google({ _dedupeKey: "b", id: "b", publishedAt: T0 + DAY });
  const c = sec({ _dedupeKey: "c", id: "c", publishedAt: T0 + 2 * DAY, companies: [{ name: "Zzzz", ticker: null }] });
  const out = dedupeAndMerge([a, b, c]);
  assert.deepEqual(
    out.map((d) => d.id),
    ["c", "b", "a"]
  );
  assert.ok(out.every((d) => !("_dedupeKey" in d)));
});

test("filterDeals by acquirer matches parsedAcquirer, companies, title and summary", () => {
  const d1 = deal({ id: "1", parsedAcquirer: "Acme Corp" });
  const d2 = deal({ id: "2", companies: [{ name: "Acme Widgets", ticker: null }] });
  const d3 = deal({ id: "3", title: "ACME makes a move" });
  const d4 = deal({ id: "4", summary: "mentions acme" });
  const d5 = deal({ id: "5" });
  const out = filterDeals([d1, d2, d3, d4, d5], { acquirer: "acme" });
  assert.deepEqual(
    out.map((d) => d.id),
    ["1", "2", "3", "4"]
  );
});

test("filterDeals by adviser and with no filters", () => {
  const d1 = deal({ id: "1", advisers: [{ name: "Goldman Sachs" }] });
  const d2 = deal({ id: "2" });
  assert.deepEqual(
    filterDeals([d1, d2], { adviser: "goldman" }).map((d) => d.id),
    ["1"]
  );
  assert.equal(filterDeals([d1, d2], {}).length, 2);
  assert.equal(filterDeals([d1, d2], { acquirer: "zzz", adviser: "goldman" }).length, 0);
});
