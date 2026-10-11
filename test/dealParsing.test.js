import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanGoogleTitle,
  extractCompanyPair,
  classifyHeadline,
  looksLikeCompanyName,
  cleanSecDisplayName,
  extractTickerFromSecName,
  buildSecFilingUrl,
} from "../src/dealParsing.js";

test("cleanGoogleTitle strips the trailing publisher", () => {
  assert.equal(
    cleanGoogleTitle("Acme to acquire Beta for $1 billion - Reuters"),
    "Acme to acquire Beta for $1 billion"
  );
  assert.equal(cleanGoogleTitle("No publisher here"), "No publisher here");
});

test("cleanGoogleTitle strips leading label words", () => {
  assert.equal(cleanGoogleTitle("Breaking: Acme buys Beta - CNBC"), "Acme buys Beta");
  assert.equal(cleanGoogleTitle("Exclusive Acme to buy Beta"), "Acme to buy Beta");
});

test("extractCompanyPair: 'agrees to acquire' keeps the verb out of the acquirer", () => {
  assert.deepEqual(extractCompanyPair("Acme Corp Agrees to Acquire Beta Inc"), {
    acquirer: "Acme Corp",
    target: "Beta Inc",
  });
  assert.deepEqual(extractCompanyPair("Acme announces agreement to acquire Beta"), {
    acquirer: "Acme",
    target: "Beta",
  });
});

test("extractCompanyPair: 'to acquire' with trailing price", () => {
  assert.deepEqual(extractCompanyPair("Acme to acquire Beta for $470 million"), { acquirer: "Acme", target: "Beta" });
});

test("extractCompanyPair: 'to buy' and 'to purchase'", () => {
  assert.deepEqual(extractCompanyPair("Acme to buy Beta"), { acquirer: "Acme", target: "Beta" });
  assert.deepEqual(extractCompanyPair("Acme to purchase Beta for $5 billion"), { acquirer: "Acme", target: "Beta" });
});

test("extractCompanyPair: 'acquires' and 'completes acquisition of'", () => {
  assert.deepEqual(extractCompanyPair("Acme acquires Beta"), { acquirer: "Acme", target: "Beta" });
  assert.deepEqual(extractCompanyPair("Acme completes acquisition of Beta"), { acquirer: "Acme", target: "Beta" });
});

test("extractCompanyPair: merger pattern", () => {
  assert.deepEqual(extractCompanyPair("Acme and Beta to merge"), { acquirer: "Acme", target: "Beta" });
  assert.deepEqual(extractCompanyPair("Acme and Beta agree to merge"), { acquirer: "Acme", target: "Beta" });
  assert.deepEqual(extractCompanyPair("Acme and Beta announce merger"), { acquirer: "Acme", target: "Beta" });
});

test("extractCompanyPair strips trailing deal-size context", () => {
  assert.deepEqual(extractCompanyPair("Acme acquires Beta in a $2.3 Billion Deal"), {
    acquirer: "Acme",
    target: "Beta",
  });
});

test("extractCompanyPair negatives", () => {
  const none = { acquirer: null, target: null };
  assert.deepEqual(extractCompanyPair("Stocks rally as markets close higher"), none);
  assert.deepEqual(extractCompanyPair(""), none);
});

test("looksLikeCompanyName accepts plausible names", () => {
  assert.equal(looksLikeCompanyName("Acme Corp"), true);
  assert.equal(looksLikeCompanyName("Bank of America"), true);
  assert.equal(looksLikeCompanyName("AT&T"), true);
});

test("looksLikeCompanyName rejects non-names", () => {
  assert.equal(looksLikeCompanyName(""), false);
  assert.equal(looksLikeCompanyName(null), false);
  assert.equal(looksLikeCompanyName(undefined), false);
  assert.equal(looksLikeCompanyName("Acme for $5 billion"), false);
  assert.equal(looksLikeCompanyName("up 5%"), false);
  assert.equal(looksLikeCompanyName("a b c d e f g".toUpperCase()), false); // 7 words
  assert.equal(looksLikeCompanyName("Acme plans to grow"), false); // lowercase prose words
});

test("cleanSecDisplayName removes ticker and CIK suffixes", () => {
  assert.equal(cleanSecDisplayName("Acme Corp  (ACME)  (CIK 0000123456)"), "Acme Corp");
  assert.equal(cleanSecDisplayName("Acme Corp  (CIK 0000123456)"), "Acme Corp");
  assert.equal(cleanSecDisplayName("Berkshire  (BRK.B)  (CIK 0001067983)"), "Berkshire");
  assert.equal(cleanSecDisplayName("Plain Name"), "Plain Name");
});

test("extractTickerFromSecName", () => {
  assert.equal(extractTickerFromSecName("Acme Corp  (ACME)  (CIK 0000123456)"), "ACME");
  assert.equal(extractTickerFromSecName("Berkshire  (BRK.B)  (CIK 0001067983)"), "BRK.B");
  assert.equal(extractTickerFromSecName("Acme Corp  (CIK 0000123456)"), null);
  assert.equal(extractTickerFromSecName("Acme Corp"), null);
});

test("buildSecFilingUrl strips CIK zeros and accession dashes", () => {
  assert.equal(
    buildSecFilingUrl({ cik: "0000123456", adsh: "0001234567-24-000012", primaryDoc: "d1.htm" }),
    "https://www.sec.gov/Archives/edgar/data/123456/000123456724000012/d1.htm"
  );
});

// Headlines below are invented/realistic and deliberately NOT from test/fixtures/deals.json.
const PAIR_CASES = [
  [
    "Exclusive: Contoso Ltd to be acquired by Fabrikam Holdings in $4.2 billion deal | Reuters",
    "Fabrikam Holdings",
    "Contoso Ltd",
  ],
  [
    "Northwind Traders (NASDAQ: NWTD) to Be Acquired by Tailspin Corp. for $18.50 Per Share in Cash",
    "Tailspin Corp.",
    "Northwind Traders",
  ],
  ["Initech acquired by Globex", "Globex", "Initech"],
  ["Globex Corporation agrees to buy Initech for $1.2 billion", "Globex Corporation", "Initech"],
  ["Umbrella Group buys robotics startup Hooli Labs", "Umbrella Group", "Hooli Labs"],
  [
    "Vandelay Industries completes acquisition of Pied Piper Inc., expanding its cloud portfolio",
    "Vandelay Industries",
    "Pied Piper Inc.",
  ],
  ["Acme Bank closes $90 million deal to acquire Rival Bancorp", "Acme Bank", "Rival Bancorp"],
  ["Stark Industries and Wayne Enterprises to combine in all-stock merger", "Stark Industries", "Wayne Enterprises"],
  ["Oscorp to take Cyberdyne Systems private in $3 billion deal", "Oscorp", "Cyberdyne Systems"],
  ["Wonka Brands launches tender offer for Slate Rock Inc.", "Wonka Brands", "Slate Rock Inc."],
  ["Tyrell Corp wins bid for Weyland Yutani \u2013 Bloomberg", "Tyrell Corp", "Weyland Yutani"],
  ["Soylent Corp's $2 billion takeover of Gringotts Capital", "Soylent Corp", "Gringotts Capital"],
  [
    "Duff Beer Holdings announces definitive agreement to be acquired by Krusty Foods",
    "Krusty Foods",
    "Duff Beer Holdings",
  ],
  ["Hooli Shareholders Approve Raviga Merger", "Raviga", "Hooli"],
  ["Cogswell Cogs to merge with Spacely Sprockets, Creating a Leader in Widgets", "Cogswell Cogs", "Spacely Sprockets"],
  ["Prestige Worldwide Agrees to Acquire 100% of Sterling Archer Co", "Prestige Worldwide", "Sterling Archer Co"],
  [
    "Bluth Company Enters Into Agreement to Be Acquired by Sitwell Capital for Up to $500 Million",
    "Sitwell Capital",
    "Bluth Company",
  ],
  [
    "Los Pollos Group to acquire logistics firm Madrigal Freight in cash-and-stock transaction",
    "Los Pollos Group",
    "Madrigal Freight",
  ],
];

for (const [title, acquirer, target] of PAIR_CASES) {
  test(`extractCompanyPair generalizes: ${title}`, () => {
    assert.deepEqual(extractCompanyPair(title), { acquirer, target });
  });
}

test("extractCompanyPair returns nulls for non-deal headlines and refuses generic buyers", () => {
  assert.deepEqual(extractCompanyPair("Apple unveils new iPhone"), { acquirer: null, target: null });
  assert.deepEqual(extractCompanyPair("Dunder Mifflin to be acquired by private equity investors"), {
    acquirer: null,
    target: null,
  });
});

test("looksLikeCompanyName accepts extracted names", () => {
  for (const [, acquirer, target] of PAIR_CASES) {
    assert.ok(looksLikeCompanyName(acquirer), acquirer);
    assert.ok(looksLikeCompanyName(target), target);
  }
});

test("classifyHeadline: confirmed deal events are deals", () => {
  for (const [title] of PAIR_CASES) {
    assert.deepEqual(
      { isDeal: classifyHeadline(title).isDeal, confidence: classifyHeadline(title).confidence },
      { isDeal: true, confidence: "high" },
      title
    );
  }
  const unparsed = classifyHeadline("Pied Piper receives $2 billion acquisition offer from unnamed buyer");
  assert.equal(unparsed.isDeal, true);
  assert.equal(unparsed.confidence, "low");
});

test("classifyHeadline: negative signals are not deals", () => {
  const negatives = [
    "Hooli in talks to acquire Raviga",
    "Globex weighs bid for Initech, sources say",
    "Initech submits non-binding proposal to buy Hooli",
    "Starbuck Corp explored a takeover of Dunder Mifflin",
    "Initech terminates merger agreement with Globex",
    "Hooli scraps $3 billion bid for Raviga",
    "Contoso abandons plan to acquire Fabrikam",
    "Investors in Pied Piper: Halper Sadeh investigates the sale to Hooli",
    "Shareholder Alert: law firm reminds Initech investors of merger lawsuit",
    "Senators question Initech takeover of Hooli",
    "Judge blocks Globex merger with Initech on antitrust grounds",
    "Buy Contoso now? Merger arbitrage spread widens",
    "Why Fabrikam (FAB) Offers a Merger Arbitrage Opportunity",
    "Should you hold Vandelay stock through the takeover?",
    "Globex Reports Second Quarter 2026 Results",
    "Apple unveils new iPhone",
  ];
  for (const title of negatives) {
    const result = classifyHeadline(title);
    assert.equal(result.isDeal, false, title);
    assert.ok(result.reason.length > 0);
  }
});

test("classifyHeadline: completions, tender offers and shareholder approvals are deals", () => {
  for (const title of [
    "Acme completes acquisition of Rival Bancorp",
    "Wonka Brands extends tender offer for Slate Rock Inc.",
    "Hooli Shareholders Approve Raviga Merger Agreement",
    "Globex raises offer for Initech after revised merger agreement",
  ]) {
    assert.equal(classifyHeadline(title).isDeal, true, title);
  }
});
