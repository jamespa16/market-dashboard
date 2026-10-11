import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePressRelease, htmlToPlainText } from "../src/pressRelease.js";

const FILINGS = new URL("./fixtures/filings/", import.meta.url);

// ---------------------------------------------------------------------------------------------
// Unit tests on synthetic sentences
// ---------------------------------------------------------------------------------------------

test("htmlToPlainText keeps paragraphs, decodes entities, collapses whitespace", () => {
  const html =
    "<html><head><style>p{}</style></head><body><p>Acme&nbsp;Corp.  &amp; Co.</p><p>It&rsquo;s   <b>big</b>&mdash;really</p><br>x</body></html>";
  const text = htmlToPlainText(html);
  assert.equal(text, "Acme Corp. & Co.\n\nIt's big-really\n\nx");
  assert.equal(htmlToPlainText(""), "");
});

test("acquirer/target: 'X to acquire Y' headline", () => {
  const r = parsePressRelease(
    "Acme Holdings to Acquire Beta Systems for $5.8 billion\n\nNEW YORK - Acme Holdings today announced something."
  );
  assert.equal(r.acquirer, "Acme Holdings");
  assert.equal(r.target, "Beta Systems");
  assert.equal(r.confidence, "high");
});

test("acquirer/target: 'Y to be acquired by X'", () => {
  const r = parsePressRelease(
    "Beta Systems to be Acquired by Acme Capital Partners\n\nBeta Systems, Inc. (Nasdaq: BETA) today announced a definitive agreement."
  );
  assert.equal(r.acquirer, "Acme Capital Partners");
  assert.equal(r.target, "Beta Systems");
});

test("acquirer/target: 'X and Y announced ... definitive agreement under which X will acquire Y'", () => {
  const r = parsePressRelease(
    'Gamma Corp. ("Gamma") (NYSE: GAM) and Delta Inc. ("Delta") (Nasdaq: DLT) today announced that they have entered into a definitive agreement under which Gamma will acquire Delta in an all-stock transaction.'
  );
  assert.equal(r.acquirer, "Gamma");
  assert.equal(r.target, "Delta");
  assert.equal(r.consideration, "stock");
});

test("acquirer/target: completed acquisition", () => {
  const r = parsePressRelease(
    "Gamma Completes Acquisition of Delta Therapeutics\n\nGamma today announced the closing."
  );
  assert.equal(r.acquirer, "Gamma");
  assert.equal(r.target, "Delta Therapeutics");
});

test("acquirer/target: 8-K style defined terms", () => {
  const r = parsePressRelease(
    'On May 1, 2026, Omega Labs, Inc., a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Sigma Group, Inc., a Delaware corporation ("Parent"), and Sigma Merger Sub, Inc. ("Merger Sub").'
  );
  assert.equal(r.acquirer, "Sigma Group");
  assert.equal(r.target, "Omega Labs");
});

test("returns nulls for text that is not a deal", () => {
  const r = parsePressRelease("Quarterly results were strong and revenue grew 5%.");
  assert.deepEqual(
    {
      a: r.acquirer,
      t: r.target,
      v: r.dealValueUsd,
      p: r.perSharePrice,
      c: r.consideration,
      e: r.expectedClose,
      adv: r.advisers,
    },
    { a: null, t: null, v: null, p: null, c: null, e: null, adv: [] }
  );
  assert.equal(r.confidence, "low");
  assert.equal(parsePressRelease("").acquirer, null);
  assert.equal(parsePressRelease(null).acquirer, null);
});

test("dealValueUsd: billions, millions, abbreviations and 'approximately'", () => {
  const v = (s) => parsePressRelease(s).dealValueUsd;
  assert.equal(v("in an all-cash transaction valued at approximately $5.8 billion"), 5.8e9);
  assert.equal(v("a transaction valued at $1.2bn including debt"), 1.2e9);
  assert.equal(v("representing an enterprise value of approximately $866 million"), 866e6);
  assert.equal(v("for aggregate consideration of $1,250 million"), 1.25e9);
  assert.equal(v("at a purchase price of $22.50 per share"), null);
  assert.equal(v("expects $300 million of run-rate cost synergies"), null);
});

test("perSharePrice: cash price, implied price for mixed deals, ignores CVR and par value", () => {
  const p = (s) => parsePressRelease(s).perSharePrice;
  assert.equal(p("stockholders will receive $22.50 per share in cash"), 22.5);
  assert.equal(p("for $32.05 per share"), 32.05);
  assert.equal(
    p(
      "will receive $17.25 per share in cash and 0.0856 shares of Acme, an implied total consideration of $30.25 per share"
    ),
    30.25
  );
  assert.equal(p("common stock, par value $0.01 per share, was converted"), null);
  assert.equal(p("plus a CVR worth up to an additional $3.00 per share"), null);
});

test("consideration: cash, stock and mixed", () => {
  const c = (s) => parsePressRelease(s).consideration;
  assert.equal(c("an all-cash transaction"), "cash");
  assert.equal(c("holders will receive $22.50 per share in cash"), "cash");
  assert.equal(c("in an all-stock transaction"), "stock");
  assert.equal(
    c("each holder will receive an exchange ratio of 0.8 shares of Acme common stock for each share"),
    "stock"
  );
  assert.equal(c("will receive 0.8 shares of Acme common stock and $10 in cash for each share"), "mixed");
  assert.equal(c("will receive $10 in cash and 0.8 shares of Acme common stock"), "mixed");
  assert.equal(c("in a stock-and-cash transaction"), "mixed");
  assert.equal(c("No terms were disclosed."), null);
});

test("expectedClose: quarters, halves, years and mid-year", () => {
  const e = (s) => parsePressRelease(s).expectedClose;
  assert.equal(
    e("The transaction is expected to close in the first half of 2027, subject to approvals."),
    "first half of 2027"
  );
  assert.equal(e("The transaction is expected to close in the fourth quarter of 2026."), "fourth quarter of 2026");
  assert.equal(e("The deal is anticipated to close by the end of 2026."), "end of 2026");
  assert.equal(
    e("The merger is expected to be completed in the first half of calendar year 2027"),
    "first half of calendar year 2027"
  );
  assert.equal(e("The transaction is still expected to close by mid-2027, subject to approval."), "mid-2027");
  assert.equal(e("Closing is not yet scheduled."), null);
});

test("advisers: Advisors section with sides and roles", () => {
  const text =
    "Acme Holdings to Acquire Beta Systems\n\nAdvisors\n\nGoldman Sachs & Co. LLC is serving as exclusive financial advisor to Acme Holdings and Wachtell, Lipton, Rosen & Katz is serving as legal counsel. Evercore is serving as financial advisor to Beta Systems, and Skadden, Arps, Slate, Meagher & Flom LLP is serving as its legal counsel.";
  const { advisers } = parsePressRelease(text);
  const get = (name) => advisers.find((a) => a.name === name);
  assert.deepEqual(get("Goldman Sachs"), { name: "Goldman Sachs", role: "financial", side: "acquirer" });
  assert.deepEqual(get("Wachtell, Lipton, Rosen & Katz"), {
    name: "Wachtell, Lipton, Rosen & Katz",
    role: "legal",
    side: "acquirer",
  });
  assert.deepEqual(get("Evercore"), { name: "Evercore", role: "financial", side: "target" });
  assert.equal(get("Skadden, Arps, Slate, Meagher & Flom").role, "legal");
});

test("advisers: possessive side, unknown firms, PR advisers ignored, side null when unclear", () => {
  const text =
    "Acme Holdings to Acquire Beta Systems\n\nSmallBoutique Partners is serving as financial advisor to Beta Systems. Davis Polk & Wardwell LLP and Reed Smith LLP are serving as Acme's legal advisors. Joele Frank is serving as strategic communications advisor. Barclays is acting as financial advisor.";
  const { advisers } = parsePressRelease(text);
  const by = Object.fromEntries(advisers.map((a) => [a.name, a]));
  assert.equal(by["SmallBoutique Partners"].side, "target");
  assert.equal(by["Davis Polk & Wardwell"].side, "acquirer");
  assert.equal(by["Reed Smith"].role, "legal");
  assert.equal(by["Joele Frank"], undefined);
  assert.equal(by["Barclays"].side, null);
});

// ---------------------------------------------------------------------------------------------
// Corpus test: every labeled SEC filing
// ---------------------------------------------------------------------------------------------

const SUFFIXES =
  /\b(inc|incorporated|corp|corporation|ltd|limited|plc|llc|co|company|group|holdings|holding|sa|se|ag|nv)\b/g;
const normalize = (name) =>
  (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
// Same rule as namesMatch in test/fixtures.test.js: substring either way after normalisation.
function namesMatch(parsed, expected) {
  const a = normalize(parsed);
  const b = normalize(expected);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}
const normClose = (s) =>
  (s ?? "")
    .toLowerCase()
    .replace(/^(?:by|in|during|at|the)\s+/g, "")
    .replace(/\bthe\s+/g, "")
    .trim();
const closeMatch = (got, want) => {
  if (got == null || want == null) return got == null && want == null;
  const a = normClose(got);
  const b = normClose(want);
  return a.includes(b) || b.includes(a);
};

// Floors: what the parser achieves on the corpus today, rounded down to the nearest 5%. The parser rules were tuned
// against this same corpus (no held-out set yet), so treat these as regression floors, not generalisation estimates.
const FLOORS = {
  dealValueUsd: 1,
  perSharePrice: 1,
  consideration: 0.95,
  expectedClose: 1,
  adviserRecall: 1,
  adviserPrecision: 1,
};

const labels = JSON.parse(readFileSync(new URL("labels.json", FILINGS), "utf8"));
// Filings whose labeled acquirer is null are non-deals (completed fund merger, termination agreements, ...).
const deals = labels.filter((l) => l.acquirer);

function score(label) {
  const text = readFileSync(new URL(`${label.adsh}.txt`, FILINGS), "utf8");
  const got = parsePressRelease(text);
  const pair =
    (namesMatch(got.acquirer, label.acquirer) || (label.acquirerAlt && namesMatch(got.acquirer, label.acquirerAlt))) &&
    (namesMatch(got.target, label.target) || (label.targetAlt && namesMatch(got.target, label.targetAlt)));
  const wanted = [...label.financialAdvisers, ...label.legalAdvisers];
  const gotNames = got.advisers.map((a) => a.name);
  return {
    label,
    got,
    pair,
    value: got.dealValueUsd === label.dealValueUsd,
    perShare: got.perSharePrice === label.perSharePrice,
    consideration: got.consideration === label.consideration,
    close: closeMatch(got.expectedClose, label.expectedClose),
    advWanted: wanted.length,
    advHit: wanted.filter((w) => gotNames.some((g) => namesMatch(g, w))).length,
    advGot: gotNames.length,
    advCorrect: gotNames.filter((g) => wanted.some((w) => namesMatch(g, w))).length,
    sideOk: got.advisers.filter((a) => a.side).length,
  };
}

test("labels.json covers every fetched filing and is well formed", () => {
  assert.ok(labels.length >= 40, `expected >= 40 labeled filings, got ${labels.length}`);
  const seen = new Set();
  for (const l of labels) {
    assert.match(l.adsh, /^\d{10}-\d{2}-\d{6}$/);
    assert.ok(!seen.has(l.adsh), `duplicate ${l.adsh}`);
    seen.add(l.adsh);
    assert.ok([null, "cash", "stock", "mixed"].includes(l.consideration), l.adsh);
    assert.ok(Array.isArray(l.financialAdvisers) && Array.isArray(l.legalAdvisers), l.adsh);
    const text = readFileSync(new URL(`${l.adsh}.txt`, FILINGS), "utf8");
    assert.match(text.split("\n")[0], /^# source: https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/.+ \(.+\)$/);
    assert.ok(text.slice(text.indexOf("\n") + 1).length <= 40000, `${l.adsh} exceeds the 40k cap`);
  }
});

test("corpus: parsePressRelease accuracy on labeled SEC filings", (t) => {
  const results = deals.map(score);
  const rate = (ok, n) => (n ? ok / n : 1);
  const pairs = results.filter((r) => r.pair).length;
  const fields = {
    pair: rate(pairs, results.length),
    dealValueUsd: rate(results.filter((r) => r.value).length, results.length),
    perSharePrice: rate(results.filter((r) => r.perShare).length, results.length),
    consideration: rate(results.filter((r) => r.consideration).length, results.length),
    expectedClose: rate(results.filter((r) => r.close).length, results.length),
    adviserRecall: rate(
      results.reduce((n, r) => n + r.advHit, 0),
      results.reduce((n, r) => n + r.advWanted, 0)
    ),
    adviserPrecision: rate(
      results.reduce((n, r) => n + r.advCorrect, 0),
      results.reduce((n, r) => n + r.advGot, 0)
    ),
  };
  for (const [name, v] of Object.entries(fields)) t.diagnostic(`${name}: ${(v * 100).toFixed(1)}%`);
  t.diagnostic(`deals scored: ${results.length} (+${labels.length - results.length} non-deal filings excluded)`);
  for (const r of results.filter((x) => !x.pair)) {
    t.diagnostic(
      `pair miss ${r.label.adsh}: got ${r.got.acquirer} / ${r.got.target}, want ${r.label.acquirer} / ${r.label.target}`
    );
  }

  assert.ok(fields.pair >= 0.9, `acquirer+target accuracy ${(fields.pair * 100).toFixed(1)}% < 90%`);
  for (const [name, floor] of Object.entries(FLOORS)) {
    assert.ok(fields[name] >= floor, `${name} ${(fields[name] * 100).toFixed(1)}% fell below ${floor * 100}%`);
  }
});

test("corpus: every parsed adviser has a valid role and side", () => {
  for (const l of deals) {
    const { advisers } = score(l).got;
    for (const a of advisers) {
      assert.ok(typeof a.name === "string" && a.name.length > 1, `${l.adsh}: bad name`);
      assert.ok(["financial", "legal"].includes(a.role), `${l.adsh}: bad role ${a.role}`);
      assert.ok([null, "acquirer", "target"].includes(a.side), `${l.adsh}: bad side ${a.side}`);
    }
  }
});

test("corpus: non-deal filings do not produce advisers or values", () => {
  for (const l of labels.filter((x) => !x.acquirer)) {
    const got = parsePressRelease(readFileSync(new URL(`${l.adsh}.txt`, FILINGS), "utf8"));
    assert.equal(got.confidence, "low", l.adsh);
  }
});
