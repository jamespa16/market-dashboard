import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRateLimiter, createSecClient } from "../src/sec/client.js";
import { buildTickerMap, normalizeEntityName } from "../src/sec/tickerMap.js";
import { searchFilings, discoverDealFilings, buildSearchUrl } from "../src/sec/search.js";
import { parseFilingIndex, findPressRelease, fetchDocumentText } from "../src/sec/filings.js";
import { htmlToText } from "../src/sec/htmlText.js";
import { setConfig } from "../src/config.js";
import { setMarketDataProvider } from "../src/marketData/index.js";
import { resolveTicker } from "../src/tickers.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/sec/${name}`, import.meta.url), "utf8");

test("rate limiter spaces concurrent requests by 1/maxPerSecond using the injected clock", async () => {
  let t = 1000;
  const slept = [];
  const sleep = async (ms) => {
    slept.push(ms);
  };
  const acquire = createRateLimiter({ maxPerSecond: 8, now: () => t, sleep });
  await Promise.all(Array.from({ length: 9 }, acquire));
  // First goes immediately; the other 8 each wait one more 125 ms interval than the last.
  assert.equal(slept.length, 8);
  assert.deepEqual(slept.slice(0, 3), [125, 250, 375]);
  assert.equal(slept[7], 1000);
});

test("rate limiter does not delay when idle", async () => {
  let t = 0;
  const slept = [];
  const acquire = createRateLimiter({ maxPerSecond: 8, now: () => t, sleep: async (ms) => slept.push(ms) });
  await acquire();
  t = 500;
  await acquire();
  assert.deepEqual(slept, []);
});

test("secFetch sets User-Agent from config and goes through the limiter, retries included", async () => {
  setConfig({ secContact: "me@example.com" });
  const calls = [];
  const statuses = [503, 200];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: statuses[calls.length - 1] === 200, status: statuses[calls.length - 1], json: async () => ({ a: 1 }) };
  };
  const waits = [];
  const client = createSecClient({ fetchImpl, now: () => 0, sleep: async (ms) => waits.push(ms), backoffMs: 1 });
  const json = await client.secFetchJson("https://www.sec.gov/x.json");
  assert.deepEqual(json, { a: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers["User-Agent"], "ma-dashboard/0.1 (contact: me@example.com)");
  assert.ok(calls[0].init.headers["Accept-Encoding"]);
  assert.equal(waits.length, 1); // second attempt waited for its limiter slot
  setConfig({ secContact: "" });
});

test("secFetchText throws a descriptive error on non-OK", async () => {
  const client = createSecClient({
    fetchImpl: async () => ({ ok: false, status: 403, statusText: "Forbidden" }),
    now: () => 0,
    sleep: async () => {},
  });
  await assert.rejects(client.secFetchText("https://www.sec.gov/nope"), /403.*nope/);
});

const TICKERS = {
  0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  1: { cik_str: 1652044, ticker: "GOOGL", title: "Alphabet Inc." },
  2: { cik_str: 1652044, ticker: "GOOG", title: "Alphabet Inc." },
  3: { cik_str: 70858, ticker: "BAC", title: "BANK OF AMERICA CORP /DE/" },
  4: { cik_str: 36104, ticker: "USB", title: "US BANCORP \\DE\\" },
  5: { cik_str: 1, ticker: "FBK", title: "First Bank Holdings" },
  6: { cik_str: 2, ticker: "FBX", title: "First Bank Group Inc" },
  7: { cik_str: 3, ticker: "WLDA", title: "Wilder Systems Corporation" },
  8: { cik_str: 4, ticker: "WLDB", title: "Wilder Pharma Inc" },
  9: { cik_str: 5, ticker: "ACME", title: "ACME Co" },
  10: { cik_str: 6, ticker: "ACMX", title: "The Acme Company" },
};

test("normalizeEntityName strips punctuation and suffixes", () => {
  assert.equal(normalizeEntityName("Apple Inc."), "apple");
  assert.equal(normalizeEntityName("The Kroger Co."), "kroger");
  assert.equal(normalizeEntityName("Shell plc"), "shell");
  assert.equal(normalizeEntityName("Coca-Cola Holdings Group"), "coca cola");
  assert.equal(normalizeEntityName("Inc."), "inc"); // never normalize to empty
});

test("ticker map lookups", () => {
  const map = buildTickerMap(TICKERS);
  assert.equal(map.byCik("0000320193").ticker, "AAPL");
  assert.equal(map.byCik(320193).name, "Apple Inc.");
  assert.equal(map.byTicker("aapl").cik, "320193");
  assert.equal(map.byName("Apple").ticker, "AAPL");
  assert.equal(map.byName("APPLE INC").ticker, "AAPL");
  // multiple tickers: first is primary, all exposed
  assert.equal(map.byCik(1652044).ticker, "GOOGL");
  assert.deepEqual(map.byCik(1652044).tickers, ["GOOGL", "GOOG"]);
  assert.equal(map.byName("Alphabet").ticker, "GOOGL");
  assert.equal(map.byTicker("GOOG").cik, "1652044");
  assert.equal(map.byCik(999), null);
  assert.equal(map.byTicker("NOPE"), null);
});

test("byName: leading-word fallback is conservative and ambiguity returns null", () => {
  const map = buildTickerMap(TICKERS);
  assert.equal(map.byName("Bank of America").ticker, "BAC"); // normalized exact
  assert.equal(map.byName("Bank"), null); // too short / ambiguous
  assert.equal(map.byName("Wilder"), null); // prefix of two companies
  assert.equal(map.byName("Wilder Systems").ticker, "WLDA");
  assert.equal(map.byName("Acme"), null); // two distinct CIKs normalize identically
  assert.equal(map.byName("First Bank"), null);
  assert.equal(map.byName(""), null);
  assert.equal(map.byName("Alph"), null);
});

test("normalizeHit and searchFilings use real efts response shape", async () => {
  const raw = JSON.parse(fixture("efts-8k.json"));
  const urls = [];
  const res = await searchFilings(
    { query: '"merger agreement"', forms: ["8-K"], startdt: "2026-09-20", enddt: "2026-10-10" },
    {
      fetchJson: async (u) => {
        urls.push(u);
        return raw;
      },
    }
  );
  assert.equal(res.total, raw.hits.total.value);
  assert.equal(res.hits.length, raw.hits.hits.length);
  const h = res.hits[0];
  const src = raw.hits.hits[0]._source;
  assert.equal(h.adsh, src.adsh);
  assert.equal(h.cik, String(Number(src.ciks[0])));
  assert.equal(h.form, src.form);
  assert.deepEqual(h.items, src.items);
  assert.equal(h.fileDate, src.file_date);
  assert.equal(h.fileName, raw.hits.hits[0]._id.split(":")[1]);
  assert.equal(h.url, `https://www.sec.gov/Archives/edgar/data/${h.cik}/${h.adsh.replace(/-/g, "")}/${h.fileName}`);
  assert.match(h.displayNames[0], /CIK/);
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get("q"), '"merger agreement"');
  assert.equal(u.searchParams.get("forms"), "8-K");
  assert.equal(u.searchParams.get("startdt"), "2026-09-20");
});

test("searchFilings refuses to page past the efts 10000 window", async () => {
  const r = await searchFilings({ query: "x", from: 9950 }, { fetchJson: async () => assert.fail("no request") });
  assert.deepEqual(r.hits, []);
  assert.match(buildSearchUrl({ forms: "425", from: 100 }), /from=100/);
});

test("discoverDealFilings dedupes by adsh, filters 8-K to Item 1.01, drops 8-K/A", async () => {
  const mk = (id, form, fileType, items) => ({
    _id: id,
    _source: {
      ciks: ["0000000123"],
      form,
      file_type: fileType,
      items,
      adsh: id.split(":")[0],
      file_date: "2026-10-01",
      display_names: ["X (CIK 0000000123)"],
    },
  });
  const pages = {
    '"merger agreement"': [
      mk("0000000001-26-000001:ex2-1.htm", "8-K", "EX-2.1", ["1.01"]),
      mk("0000000001-26-000001:a8k.htm", "8-K", "8-K", ["1.01"]),
      mk("0000000002-26-000001:b8k.htm", "8-K", "8-K", ["7.01"]),
      mk("0000000003-26-000001:c.htm", "8-K/A", "8-K/A", ["1.01"]),
    ],
    '"agreement and plan of merger"': [mk("0000000001-26-000001:a8k.htm", "8-K", "8-K", ["1.01"])],
  };
  const seen = [];
  const fetchJson = async (url) => {
    seen.push(url);
    const q = new URL(url).searchParams.get("q");
    const forms = new URL(url).searchParams.get("forms");
    const hits = pages[q] ?? (forms === "DEFM14A" ? [mk("0000000004-26-000001:p.htm", "DEFM14A", "DEFM14A", [])] : []);
    return { hits: { total: { value: hits.length }, hits } };
  };
  const r = await discoverDealFilings({ days: 30, now: new Date("2026-10-10T00:00:00Z"), fetchJson });
  assert.deepEqual(r.hits.map((h) => h.adsh).sort(), ["0000000001-26-000001", "0000000004-26-000001"]);
  const a = r.hits.find((h) => h.adsh === "0000000001-26-000001");
  assert.equal(a.fileType, "8-K"); // main doc preferred over exhibit
  assert.equal(a.queries.length, 2);
  assert.equal(seen.length, 6); // one request per query when results fit a page
  assert.equal(r.requests, 6);
  assert.match(seen[0], /startdt=2026-09-10/);
  assert.match(seen[0], /enddt=2026-10-10/);
  assert.deepEqual(r.errors, []);
});

test("discoverDealFilings isolates per-query failures", async () => {
  let n = 0;
  const fetchJson = async () => {
    if (++n === 1) throw new Error("boom");
    return { hits: { total: { value: 0 }, hits: [] } };
  };
  const r = await discoverDealFilings({ fetchJson });
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].error.message, "boom");
});

test("parseFilingIndex lists documents with exhibit types", () => {
  const docs = parseFilingIndex(fixture("filing-index-table.html"));
  assert.deepEqual(
    docs.map((d) => [d.type, d.name]),
    [
      ["8-K", "tm2627097d1_8k.htm"],
      ["EX-2.1", "tm2627097d1_ex2-1.htm"],
      ["EX-99.1", "tm2627097d1_ex99-1.htm"],
      ["GRAPHIC", "tm2627097d1_8kimg001.jpg"],
    ]
  );
  assert.equal(docs[0].url, "https://www.sec.gov/Archives/edgar/data/1014739/000110465926113904/tm2627097d1_8k.htm");
  assert.equal(docs[2].description, "EXHIBIT 99.1");
  assert.equal(findPressRelease(docs).name, "tm2627097d1_ex99-1.htm");
});

test("findPressRelease selection rules", () => {
  const d = (type, description = "", name = "f.htm") => ({ type, description, name, url: "u" });
  assert.equal(findPressRelease([d("8-K"), d("EX-99.2", "slides"), d("EX-99.1", "x")]).type, "EX-99.1");
  assert.equal(findPressRelease([d("EX-99.2", "Investor slides"), d("EX-99.3", "Press Release")]).type, "EX-99.3");
  assert.equal(findPressRelease([d("EX-99", "x")]).type, "EX-99");
  assert.equal(findPressRelease([d("EX-99.2", "slides"), d("EX-2.1")]), null);
  assert.equal(findPressRelease([]), null);
});

test("htmlToText keeps paragraph breaks and decodes entities", () => {
  const html = `<html><head><title>x</title><style>p{}</style></head><body>
    <p>Acme&nbsp;Corp. &amp; Beta announced&#160;a deal&#8212;worth $1.5&nbsp;billion.</p>
    <p>&#8220;Quote&#8221; &#x2019;s &ldquo;two&rdquo;<br>next line</p>
    <table><tr><td>Price</td><td>$10.00</td></tr></table><!-- c --><script>var a=1;</script></body></html>`;
  const text = htmlToText(html);
  assert.equal(
    text,
    "Acme Corp. & Beta announced a deal—worth $1.5 billion.\n\n“Quote” ’s “two”\nnext line\n\nPrice $10.00"
  );
  assert.equal(htmlToText(""), "");
});

test("fetchDocumentText converts fetched html", async () => {
  const t = await fetchDocumentText("https://x", { fetchText: async () => "<p>a</p><p>b</p>" });
  assert.equal(t, "a\n\nb");
});

test("resolveTicker prefers the SEC map, falls back to provider", async () => {
  const map = buildTickerMap(TICKERS);
  const secHit = await resolveTicker("Apple", { getMap: async () => map });
  assert.equal(secHit.query, "Apple");
  assert.equal(secHit.best.symbol, "AAPL");
  assert.equal(secHit.best.name, "Apple Inc.");
  assert.equal(secHit.matches.length, 1);

  const stub = [{ symbol: "XYZ", name: "Xyz Ltd", exchange: "NYQ", quoteType: "EQUITY", score: 5 }];
  setMarketDataProvider({ searchTickers: async () => stub });
  try {
    const fallback = await resolveTicker("Unknown Co Zzz", { getMap: async () => map });
    assert.equal(fallback.best.symbol, "XYZ");
    const secDown = await resolveTicker("Another Unknown", {
      getMap: async () => {
        throw new Error("sec down");
      },
    });
    assert.equal(secDown.best.symbol, "XYZ");
  } finally {
    setMarketDataProvider(null);
  }
});
