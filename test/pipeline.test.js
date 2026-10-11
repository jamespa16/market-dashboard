import test from "node:test";
import assert from "node:assert/strict";
import { buildTickerMap } from "../src/sec/tickerMap.js";
import { buildDeals, googleObservation, groupObservations, makeParty, secObservation } from "../src/pipeline.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-20T00:00:00Z");

const tickerMap = buildTickerMap({
  0: { cik_str: 100, ticker: "ACME", title: "Acme Corp." },
  1: { cik_str: 200, ticker: "BETA", title: "Beta Systems, Inc." },
  2: { cik_str: 300, ticker: "GAMM", title: "Gamma Holdings Inc" },
});

const day = (n) => new Date(T0 + n * DAY).toISOString().slice(0, 10);
const headline = (title, n = 0, sourceName = "Wire") =>
  googleObservation(
    { title, summary: "", link: `https://news/${encodeURIComponent(title)}`, sourceName, publishedAt: T0 + n * DAY },
    tickerMap
  );
const filing = ({ adsh, cik, name, parsed = null, n = 0, items = ["1.01"], form = "8-K" }) =>
  secObservation(
    {
      hit: {
        adsh,
        cik,
        ciks: [cik],
        displayNames: [`${name} (CIK 000${cik})`],
        form,
        items,
        fileDate: day(n),
        url: `https://sec/${adsh}`,
      },
      parsed,
    },
    tickerMap
  );
const parse = (acquirer, target, confidence = "high", extra = {}) => ({
  acquirer,
  target,
  dealValueUsd: null,
  perSharePrice: null,
  consideration: null,
  expectedClose: null,
  advisers: [],
  confidence,
  ...extra,
});

test("makeParty resolves CIK by name, ticker by CIK, and falls back to a name id", () => {
  const a = makeParty("Acme Corporation", { tickerMap });
  assert.equal(a.id, "cik:100");
  assert.equal(a.ticker, "ACME");
  const u = makeParty("Unknown Widgets LLC", { tickerMap });
  assert.equal(u.id, "name:unknown widgets");
  assert.equal(u.cik, null);
  assert.equal(makeParty("Investor Group", { tickerMap }), null);
});

test("non-deal headlines produce no observation", () => {
  assert.equal(headline("Acme in talks to acquire Beta Systems"), null);
  assert.equal(headline("Acme reports third quarter results"), null);
});

test("CIK pair merge: headline and SEC filing about the same pair, either orientation, become one card", () => {
  const g = headline("Acme to acquire Beta Systems for $1.2 billion", 0);
  const s = filing({
    adsh: "a-1",
    cik: "200",
    name: "Beta Systems, Inc.",
    parsed: parse("Acme Corporation", "Beta Systems, Inc.", "high", { dealValueUsd: 1.2e9, consideration: "cash" }),
    n: 1,
  });
  const g2 = headline("Beta Systems to be acquired by Acme Corp", 2, "Other wire");
  const cards = buildDeals([g, s, g2]).map((b) => b.card);
  assert.equal(cards.length, 1);
  const [c] = cards;
  assert.equal(c.confidence, "high");
  assert.equal(c.acquirer.cik, "100");
  assert.equal(c.target.ticker, "BETA");
  assert.equal(c.dealValueUsd, 1.2e9);
  assert.equal(c.consideration, "cash");
  assert.equal(c.sources.length, 3);
  assert.equal(c.publishedAt, T0);
  assert.equal(c.primaryLink, "https://sec/a-1");
  assert.deepEqual(c.formTypes, ["8-K"]);
});

test("same acquirer in two deals stays as two cards", () => {
  const obs = [
    headline("Acme to acquire Beta Systems", 0),
    headline("Acme to acquire Gamma Holdings", 3),
    headline("Acme agrees to acquire Gamma Holdings", 4, "Other wire"),
  ];
  const cards = buildDeals(obs).map((b) => b.card);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => c.target.name).sort(), ["Beta Systems", "Gamma Holdings"]);
});

test("single-party SEC filing attaches to the pair cluster containing its registrant", () => {
  const g = headline("Acme to acquire Beta Systems", 0);
  const s = filing({ adsh: "a-2", cik: "200", name: "Beta Systems, Inc.", n: 2 });
  const clusters = groupObservations([g, s]);
  assert.equal(clusters.length, 1);
  const [card] = buildDeals([g, s]).map((b) => b.card);
  assert.equal(card.sources.length, 2);
  assert.deepEqual(card.formTypes, ["8-K"]);
});

test("single-party filing outside the 30-day window does not attach", () => {
  const g = headline("Acme to acquire Beta Systems", 0);
  const s = filing({ adsh: "a-3", cik: "200", name: "Beta Systems, Inc.", n: 40 });
  assert.equal(groupObservations([g, s]).length, 2);
});

test("single-party filing for a company in two deals attaches to the nearer one", () => {
  const obs = [
    headline("Acme to acquire Beta Systems", 0),
    headline("Gamma Holdings to acquire Acme", 20),
    filing({ adsh: "a-4", cik: "100", name: "Acme Corp.", n: 21 }),
  ];
  const cards = buildDeals(obs).map((b) => b.card);
  assert.equal(cards.length, 2);
  const withSec = cards.find((c) => c.sources.some((s) => s.type === "sec-edgar"));
  assert.equal(withSec.acquirer.name, "Gamma Holdings");
});

test("name-only fallback: unresolved private parties merge on normalized name, not on shared tokens", () => {
  const obs = [
    headline("Zenith Rockets Inc to acquire Quark Labs", 0),
    headline("Quark Labs to be acquired by Zenith Rockets", 1, "Other wire"),
    headline("Zenith Rockets to acquire Nimbus Labs", 2),
    headline("Quark Industries to acquire Orbit Labs", 3),
  ];
  const cards = buildDeals(obs).map((b) => b.card);
  assert.equal(cards.length, 3);
  assert.equal(cards.filter((c) => c.sources.length === 2).length, 1);
});

test("two different CIKs never merge even with similar names", () => {
  const a = makeParty("Acme Corp.", { tickerMap });
  const b = makeParty("Acme Corp Holdings", { cik: "999", tickerMap });
  const g1 = headline("Acme to acquire Beta Systems", 0);
  const o2 = { ...g1, acquirer: b, sourceKey: "x" };
  assert.equal(a.cik, "100");
  assert.equal(groupObservations([g1, o2]).length, 2);
});

test("headline with no extracted party attaches by exact name mention", () => {
  const g = headline("Acme to acquire Beta Systems", 0);
  const vague = headline("Beta Systems receives $5 billion acquisition offer", 1);
  assert.ok(vague && !vague.acquirer && !vague.target);
  assert.equal(groupObservations([g, vague]).length, 1);
});

test("confidence: single low-confidence SEC parse is low; headline pair or two sources make it high", () => {
  const s = filing({
    adsh: "a-5",
    cik: "300",
    name: "Gamma Holdings Inc",
    parsed: parse("Zed Co", "Yarn Co", "low"),
    items: ["1.02"],
  });
  const [lowCard] = buildDeals([s]).map((b) => b.card);
  assert.equal(lowCard.confidence, "low");
  assert.match(lowCard.title, /Zed Co to acquire Yarn Co/);

  const s2 = filing({
    adsh: "a-6",
    cik: "300",
    name: "Gamma Holdings Inc",
    parsed: parse("Zed Co", "Yarn Co", "low"),
    items: ["1.02"],
    n: 1,
  });
  assert.equal(buildDeals([s, s2])[0].card.confidence, "high");

  const [unparsed] = buildDeals([filing({ adsh: "a-7", cik: "300", name: "Gamma Holdings Inc" })]).map((b) => b.card);
  assert.equal(unparsed.confidence, "low");
  assert.equal(unparsed.acquirer, null);
  assert.equal(unparsed.companies[0].name, "Gamma Holdings Inc");
});

test("registrant corroboration needs a 1.01/2.01 item", () => {
  const p = parse("Gamma Holdings", "Yarn Co", "low");
  const defm = filing({ adsh: "a-8", cik: "300", name: "Gamma Holdings Inc", parsed: p, items: ["1.01"] });
  const termination = filing({ adsh: "a-9", cik: "300", name: "Gamma Holdings Inc", parsed: p, items: ["1.02"] });
  assert.equal(buildDeals([defm])[0].card.confidence, "high");
  assert.equal(buildDeals([termination])[0].card.confidence, "low");
});

test("advisers are unioned; SEC terms beat headline; cards sorted newest first", () => {
  const g = headline("Acme to acquire Beta Systems, advised by Goldman Sachs", 5);
  const s = filing({
    adsh: "a-10",
    cik: "200",
    name: "Beta Systems, Inc.",
    parsed: parse("Acme Corp", "Beta Systems", "high", {
      perSharePrice: 12.5,
      advisers: [{ name: "Kirkland & Ellis", role: "legal", side: "acquirer" }],
    }),
    n: 6,
  });
  const newer = headline("Gamma Holdings to acquire Quark Labs", 10);
  const cards = buildDeals([g, s, newer]).map((b) => b.card);
  assert.equal(cards[0].target.name, "Quark Labs");
  const deal = cards[1];
  assert.equal(deal.perSharePrice, 12.5);
  assert.deepEqual(deal.advisers.map((a) => [a.name, a.role, a.side]).sort(), [
    ["Goldman Sachs", "financial", null],
    ["Kirkland & Ellis", "legal", "acquirer"],
  ]);
});
