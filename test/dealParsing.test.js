import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanGoogleTitle,
  extractCompanyPair,
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
