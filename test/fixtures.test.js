import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCompanyPair, classifyHeadline } from "../src/dealParsing.js";
import { gunzipSync } from "node:zlib";
import { googleItemToRaw } from "../src/feeds.js";
import { buildTickerMap } from "../src/sec/tickerMap.js";
import { normalizeHit } from "../src/sec/search.js";
import { parsePressRelease } from "../src/pressRelease.js";
import { buildDeals, googleObservation, secObservation } from "../src/pipeline.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/deals.json", import.meta.url), "utf8"));

// Parser accuracy ratchet. Measured value rounded down to the nearest 5%.
// This must only ever go UP. Phase 2 target is 90% (see ROADMAP.md).
const BASELINE = 0.85;

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

// Classifier floors: measured values rounded down. Ratchet: only ever raise them.
const MIN_DEAL_RECALL = 0.95;
const MIN_NONDEAL_REJECTED = 0.9;

test("headline classifier on labeled Google News items", (t) => {
  const items = fixtures.items.filter((i) => i.source === "google-news");
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const errors = [];
  for (const item of items) {
    const verdict = classifyHeadline(item.title);
    if (verdict.isDeal && item.label.isDeal) tp++;
    else if (verdict.isDeal) (fp++, errors.push(`false positive ${item.id}: "${item.title}" (${verdict.reason})`));
    else if (item.label.isDeal) (fn++, errors.push(`false negative ${item.id}: "${item.title}" (${verdict.reason})`));
    else tn++;
  }
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  const rejected = tn / (tn + fp);
  t.diagnostic(
    `classifier: precision ${(precision * 100).toFixed(1)}% (${tp}/${tp + fp}), recall ${(recall * 100).toFixed(1)}% ` +
      `(${tp}/${tp + fn}), non-deals rejected ${(rejected * 100).toFixed(1)}% (${tn}/${tn + fp})`
  );
  for (const e of errors) t.diagnostic(e);
  assert.ok(recall >= MIN_DEAL_RECALL, `recall ${recall} below ${MIN_DEAL_RECALL}`);
  assert.ok(rejected >= MIN_NONDEAL_REJECTED, `non-deal rejection ${rejected} below ${MIN_NONDEAL_REJECTED}`);
});

// ---------------------------------------------------------------------------------------------
// Pipeline evaluation: the same pure grouping/merge code as production, run offline.
// ---------------------------------------------------------------------------------------------

// Phase 2 gate: bad-card rate < 5%, labeled-group recall and card-level parse accuracy >= 90%, no over-merges.
const MAX_BAD_RATE = 0.05;
const MIN_GROUP_RECALL = 0.9;
const MIN_CARD_ACCURACY = 0.9;

const tickerMap = buildTickerMap(
  JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/sec/company_tickers.json.gz", import.meta.url))).toString())
);

function fixtureToObservation(item) {
  if (item.source === "google-news") {
    const raw = googleItemToRaw({
      title: `${item.title} - ${item.sourceName}`,
      link: item.link,
      sourceName: item.sourceName,
      pubDate: item.publishedAt,
      descriptionHtml: "",
    });
    return googleObservation(raw, tickerMap);
  }
  const primaryDoc = item.link.split("/").pop();
  const hit = normalizeHit({ _id: `${item.adsh}:${primaryDoc}`, _source: { ...item, file_type: item.form } });
  const text = readFileSync(new URL(`./fixtures/filings/${item.adsh}.txt`, import.meta.url), "utf8");
  return secObservation({ hit, parsed: parsePressRelease(text), link: item.link }, tickerMap);
}

function evaluate(cards, itemByLink) {
  const groupTotal = new Set(fixtures.items.map((i) => i.label.dedupeGroup).filter(Boolean)).size;
  const cardGroups = cards.map((card) => {
    const items = card.sources.map((s) => itemByLink.get(s.link));
    return { card, items, groups: new Set(items.map((i) => i.label.dedupeGroup).filter(Boolean)) };
  });
  const cardsPerGroup = new Map();
  for (const { groups } of cardGroups) for (const g of groups) cardsPerGroup.set(g, (cardsPerGroup.get(g) ?? 0) + 1);
  const duplicateCards = [...cardsPerGroup.values()].reduce((sum, n) => sum + n - 1, 0);
  const nonDeal = cardGroups.filter(({ groups }) => groups.size === 0);
  const overMerged = cardGroups.filter(({ groups }) => groups.size > 1);

  const accuracy = { correct: 0, total: 0, wrong: [] };
  for (const { card, items, groups } of cardGroups) {
    if (groups.size === 0) continue;
    const counts = new Map();
    for (const i of items)
      if (i.label.dedupeGroup) counts.set(i.label.dedupeGroup, (counts.get(i.label.dedupeGroup) ?? 0) + 1);
    const group = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const majority = (field) => {
      const c = new Map();
      for (const i of items.filter((x) => x.label.dedupeGroup === group))
        c.set(i.label[field], (c.get(i.label[field]) ?? 0) + 1);
      return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };
    const want = { acquirer: majority("acquirer"), target: majority("target") };
    accuracy.total++;
    if (namesMatch(card.acquirer?.name, want.acquirer) && namesMatch(card.target?.name, want.target))
      accuracy.correct++;
    else
      accuracy.wrong.push(
        `${group}: got ${card.acquirer?.name} / ${card.target?.name}, want ${want.acquirer} / ${want.target} ["${card.title}"]`
      );
  }
  return {
    cards: cards.length,
    groupTotal,
    groupsCovered: cardsPerGroup.size,
    duplicateCards,
    nonDeal,
    overMerged,
    badRate: cards.length ? (duplicateCards + nonDeal.length) / cards.length : 0,
    recall: cardsPerGroup.size / groupTotal,
    accuracy,
    cardsPerGroup,
    missingGroups: [...new Set(fixtures.items.map((i) => i.label.dedupeGroup).filter(Boolean))].filter(
      (g) => !cardsPerGroup.has(g)
    ),
  };
}

test("deal pipeline on the fixture set (Phase 2 gate)", (t) => {
  const itemByLink = new Map(fixtures.items.map((i) => [i.link, i]));
  const observations = [];
  const dropped = [];
  for (const item of fixtures.items) {
    const o = fixtureToObservation(item);
    if (o) observations.push(o);
    else dropped.push(item);
  }
  const built = buildDeals(observations);
  const all = built.map((b) => b.card);
  const def = all.filter((c) => c.confidence === "high");
  assert.ok(
    all.every((c) => c.sources.every((s) => itemByLink.has(s.link))),
    "every card source maps back to a fixture"
  );

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const report = (label, r) =>
    t.diagnostic(
      `${label}: ${r.cards} cards; ${r.duplicateCards} duplicate, ${r.nonDeal.length} non-deal, ${r.overMerged.length} over-merged; ` +
        `bad-card rate ${pct(r.badRate)}; group recall ${r.groupsCovered}/${r.groupTotal} = ${pct(r.recall)}; ` +
        `card parse accuracy ${r.accuracy.correct}/${r.accuracy.total} = ${pct(r.accuracy.total ? r.accuracy.correct / r.accuracy.total : 0)}`
    );
  const rDef = evaluate(def, itemByLink);
  const rAll = evaluate(all, itemByLink);
  report("DEFAULT (high confidence)", rDef);
  report("ALL (incl. low confidence)", rAll);
  const missedDeals = dropped.filter((i) => i.label.isDeal);
  t.diagnostic(`classifier dropped ${dropped.length} items, ${missedDeals.length} of them labeled deals`);

  const describe = (card) =>
    `${card.confidence} "${card.title}" [${card.acquirer?.name ?? "?"} -> ${card.target?.name ?? "?"}] ` +
    card.sources
      .map((s) => `${itemByLink.get(s.link).id}:${itemByLink.get(s.link).label.dedupeGroup ?? "-"}`)
      .join(" ");
  for (const { card } of rDef.nonDeal) t.diagnostic(`non-deal default card: ${describe(card)}`);
  for (const { card } of rDef.overMerged) t.diagnostic(`over-merged default card: ${describe(card)}`);
  for (const [g, n] of rDef.cardsPerGroup) {
    if (n > 1) {
      t.diagnostic(
        `duplicate default cards for ${g}: ${def
          .filter((c) => c.sources.some((s) => itemByLink.get(s.link).label.dedupeGroup === g))
          .map(describe)
          .join(" || ")}`
      );
    }
  }
  for (const g of rDef.missingGroups) {
    const inAll = all.filter((c) => c.sources.some((s) => itemByLink.get(s.link).label.dedupeGroup === g));
    t.diagnostic(
      `group not in a default card: ${g} (${inAll.length ? "low-confidence: " + inAll.map(describe).join(" || ") : "no card"})`
    );
  }
  for (const [g, n] of rAll.cardsPerGroup) {
    if (n > 1 && !(rDef.cardsPerGroup.get(g) > 1)) {
      t.diagnostic(
        `(all) duplicate cards for ${g}: ${all
          .filter((c) => c.sources.some((s) => itemByLink.get(s.link).label.dedupeGroup === g))
          .map(describe)
          .join(" || ")}`
      );
    }
  }
  for (const w of rDef.accuracy.wrong) t.diagnostic(`wrong parties: ${w}`);
  for (const { card } of rAll.nonDeal.filter(({ card }) => card.confidence === "low").slice(0, 40))
    t.diagnostic(`(all) non-deal low card: ${describe(card)}`);
  for (const w of rAll.accuracy.wrong) t.diagnostic(`(all) wrong parties: ${w}`);

  assert.ok(rDef.badRate < MAX_BAD_RATE, `bad-card rate ${pct(rDef.badRate)} >= ${MAX_BAD_RATE * 100}%`);
  assert.ok(rDef.recall >= MIN_GROUP_RECALL, `group recall ${pct(rDef.recall)} < ${MIN_GROUP_RECALL * 100}%`);
  assert.equal(rDef.overMerged.length, 0, "over-merged default cards");
  assert.ok(
    rDef.accuracy.correct / rDef.accuracy.total >= MIN_CARD_ACCURACY,
    `card parse accuracy ${rDef.accuracy.correct}/${rDef.accuracy.total} below ${MIN_CARD_ACCURACY * 100}%`
  );
});
