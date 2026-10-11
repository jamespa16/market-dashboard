import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCompanyPair } from "../src/dealParsing.js";
import { googleItemToDeal, secHitToDeal } from "../src/feeds.js";
import { dedupeAndMerge } from "../src/dedupe.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/deals.json", import.meta.url), "utf8"));

// Parser accuracy ratchet. Measured value rounded down to the nearest 5%.
// This must only ever go UP. Phase 2 target is 90% (see ROADMAP.md).
const BASELINE = 0.45;

// Dedupe ratchet: share of cards that are duplicates or non-deals. Must only ever go DOWN.
const DEDUPE_CEILING = 0.65;
// Known over-merges from generic shared tokens ("Biosciences", "Services"); Phase 2's CIK-pair dedupe should reach 0.
const MAX_OVER_MERGED = 2;

test("fixture schema", () => {
  assert.equal(fixtures.version, 1);
  assert.ok(typeof fixtures.labelingGuide === "string" && fixtures.labelingGuide.length > 50);
  assert.ok(!Number.isNaN(Date.parse(fixtures.collectedAt)));
  assert.ok(Array.isArray(fixtures.items));
  assert.ok(fixtures.items.length >= 100, `expected >=100 items, got ${fixtures.items.length}`);

  const ids = new Set();
  for (const item of fixtures.items) {
    const where = `item ${item.id}`;
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    assert.ok(["google-news", "sec-edgar"].includes(item.source), where);
    assert.match(item.id, item.source === "google-news" ? /^g\d{3}$/ : /^s\d{3}$/, where);
    assert.ok(typeof item.title === "string" && item.title.length > 0, `${where} title`);
    assert.ok(typeof item.link === "string" && item.link.startsWith("https://"), `${where} https link`);
    assert.ok(!Number.isNaN(Date.parse(item.publishedAt)), `${where} publishedAt`);
    if (item.source === "google-news") {
      assert.ok(typeof item.sourceName === "string" && item.sourceName, `${where} sourceName`);
    } else {
      assert.match(item.adsh, /^\d{10}-\d{2}-\d{6}$/, `${where} adsh`);
      assert.ok(item.form, `${where} form`);
      assert.ok(Array.isArray(item.items), `${where} items`);
      assert.ok(item.file_date, `${where} file_date`);
      assert.ok(Array.isArray(item.display_names) && item.display_names.length > 0, `${where} display_names`);
      assert.ok(Array.isArray(item.ciks) && item.ciks.length > 0, `${where} ciks`);
    }

    const l = item.label;
    assert.ok(l && typeof l.isDeal === "boolean", `${where} label.isDeal`);
    if (l.isDeal) {
      assert.ok(l.acquirer && l.target && l.dedupeGroup, `${where} deal needs acquirer, target, dedupeGroup`);
      assert.match(l.dedupeGroup, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${where} dedupeGroup slug`);
    } else {
      assert.equal(l.dedupeGroup, null, `${where} non-deal must have null dedupeGroup`);
      assert.equal(l.acquirer, null, `${where} non-deal acquirer`);
      assert.equal(l.target, null, `${where} non-deal target`);
    }
  }
});

test("fixture mix", () => {
  const bySource = (s) => fixtures.items.filter((i) => i.source === s).length;
  assert.ok(bySource("google-news") >= 50);
  assert.ok(bySource("sec-edgar") >= 30);
  assert.ok(fixtures.items.some((i) => !i.label.isDeal));

  const groups = new Map();
  for (const i of fixtures.items) {
    if (i.label.dedupeGroup) groups.set(i.label.dedupeGroup, (groups.get(i.label.dedupeGroup) ?? 0) + 1);
  }
  const multi = [...groups.values()].filter((n) => n >= 2).length;
  assert.ok(multi >= 15, `expected >=15 dedupe groups with 2+ members, got ${multi}`);
});

const SUFFIXES =
  /\b(inc|incorporated|corp|corporation|ltd|limited|plc|llc|co|company|group|holdings|holding|sa|se|ag|nv)\b/g;

function normalize(name) {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(parsed, expected) {
  const a = normalize(parsed);
  const b = normalize(expected);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

test("parser accuracy on labeled Google News deals", (t) => {
  const deals = fixtures.items.filter((i) => i.source === "google-news" && i.label.isDeal);
  let correct = 0;
  const misses = [];
  for (const item of deals) {
    const { acquirer, target } = extractCompanyPair(item.title);
    if (namesMatch(acquirer, item.label.acquirer) && namesMatch(target, item.label.target)) {
      correct++;
    } else {
      misses.push(
        `${item.id}: "${item.title}" -> ${JSON.stringify({ acquirer, target })} (want ${item.label.acquirer} / ${item.label.target})`
      );
    }
  }
  const accuracy = correct / deals.length;
  t.diagnostic(
    `parser accuracy: ${correct}/${deals.length} = ${(accuracy * 100).toFixed(1)}% (baseline ${BASELINE * 100}%, Phase 2 target 90%)`
  );
  for (const m of misses) t.diagnostic(`miss ${m}`);
  assert.ok(accuracy >= BASELINE, `accuracy ${(accuracy * 100).toFixed(1)}% fell below baseline ${BASELINE * 100}%`);
});

// Rebuilds the raw feed item each fixture came from and runs it through the same mapping as src/feeds.js.
function fixtureToRawDeal(item) {
  if (item.source === "google-news") {
    return googleItemToDeal({
      title: `${item.title} - ${item.sourceName}`,
      link: item.link,
      sourceName: item.sourceName,
      pubDate: item.publishedAt,
      descriptionHtml: "",
    });
  }
  const primaryDoc = item.link.split("/").pop();
  return secHitToDeal({ _id: `${item.adsh}:${primaryDoc}`, _source: item });
}

test("dedupe quality on the fixture set", (t) => {
  const itemByLink = new Map();
  const raw = fixtures.items.map((item) => {
    const deal = fixtureToRawDeal(item);
    itemByLink.set(deal.sources[0].link, item);
    return deal;
  });
  const cards = dedupeAndMerge(raw).map((card) => card.sources.map((src) => itemByLink.get(src.link)));
  assert.ok(
    cards.every((members) => members.every(Boolean)),
    "every card source maps back to a fixture"
  );

  const cardsPerGroup = new Map();
  let nonDealCards = 0;
  let overMerged = 0;
  for (const members of cards) {
    const groups = new Set(members.map((i) => i.label.dedupeGroup).filter(Boolean));
    if (groups.size === 0) nonDealCards++;
    if (groups.size > 1) overMerged++;
    for (const g of groups) cardsPerGroup.set(g, (cardsPerGroup.get(g) ?? 0) + 1);
  }
  const duplicateCards = [...cardsPerGroup.values()].reduce((sum, n) => sum + n - 1, 0);
  const badRate = (duplicateCards + nonDealCards) / cards.length;

  t.diagnostic(
    `${cards.length} cards for ${cardsPerGroup.size} labeled deals: ${duplicateCards} duplicate, ` +
      `${nonDealCards} non-deal, ${overMerged} merging distinct deals; ` +
      `bad-card rate ${(badRate * 100).toFixed(1)}% (ceiling ${DEDUPE_CEILING * 100}%, Phase 2 target <5%)`
  );
  assert.ok(
    badRate <= DEDUPE_CEILING,
    `bad-card rate ${(badRate * 100).toFixed(1)}% exceeded ${DEDUPE_CEILING * 100}%`
  );
  assert.ok(overMerged <= MAX_OVER_MERGED, `${overMerged} cards merge different deals (max ${MAX_OVER_MERGED})`);
});
