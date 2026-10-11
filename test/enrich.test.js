import test from "node:test";
import assert from "node:assert/strict";
import { createEnricher } from "../src/sec/enrich.js";

const PR = "Acme Corp to Acquire Beta Systems for $1.0 billion\n\nAcme Corp. today announced a definitive agreement.";
const hit = (adsh, extra = {}) => ({
  adsh,
  cik: "100",
  form: "8-K",
  fileType: "8-K",
  fileDate: "2026-09-01",
  url: `https://www.sec.gov/Archives/edgar/data/100/${adsh}/main.htm`,
  exhibits: [],
  ...extra,
});

test("uses the exhibit URL from search without fetching the filing index, and caches per adsh", async () => {
  const calls = [];
  const fetchText = async (url) => (calls.push(url), `<p>${PR}</p>`);
  const e = createEnricher({ fetchText });
  const h = hit("0001-26-000001", { exhibits: [{ fileType: "EX-99.1", url: "https://x/ex99.htm" }] });
  const r = await e.enrichWithin([h]);
  assert.deepEqual(calls, ["https://x/ex99.htm"]);
  assert.equal(r.pending, 0);
  assert.equal(e.get(h.adsh).parsed.acquirer, "Acme");
  await e.enrichWithin([h]);
  assert.equal(calls.length, 1);
});

test("caps to the newest filings and failures are isolated", async () => {
  const fetchText = async (url) => {
    if (url.includes("bad")) throw new Error("boom");
    return `<p>${PR}</p>`;
  };
  const e = createEnricher({ fetchText });
  const ex = (n) => [{ fileType: "EX-99.1", url: `https://x/${n}.htm` }];
  const hits = [
    hit("old", { fileDate: "2026-08-01", exhibits: ex("old") }),
    hit("bad", { fileDate: "2026-09-03", exhibits: ex("bad") }),
    hit("new", { fileDate: "2026-09-02", exhibits: ex("new") }),
  ];
  const r = await e.enrichWithin(hits, { max: 2 });
  assert.equal(r.attempted, 2);
  assert.ok(e.get("new"));
  assert.equal(e.get("bad"), null);
  assert.equal(e.get("old"), null);
});

test("time budget: unfinished filings keep running and onLate fires when they settle", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const fetchText = async () => (await gate, `<p>${PR}</p>`);
  const e = createEnricher({ fetchText });
  let late = false;
  const h = hit("slow", { exhibits: [{ fileType: "EX-99.1", url: "https://x/slow.htm" }] });
  const r = await e.enrichWithin([h], { budgetMs: 20, onLate: () => (late = true) });
  assert.equal(r.pending, 1);
  assert.equal(e.get("slow"), null);
  release();
  await new Promise((res) => setTimeout(res, 20));
  assert.ok(late);
  assert.ok(e.get("slow"));
});
