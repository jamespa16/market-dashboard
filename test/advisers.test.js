import test from "node:test";
import assert from "node:assert/strict";
import { detectAdvisers, detectLawFirms, ADVISER_FIRMS, LAW_FIRMS } from "../src/advisers.js";

const names = (text) =>
  detectAdvisers(text)
    .map((a) => a.name)
    .sort();

test("detects multiple banks", () => {
  assert.deepEqual(names("Goldman Sachs and Lazard advised the buyer; Evercore the seller."), [
    "Evercore",
    "Goldman Sachs",
    "Lazard",
  ]);
});

test("detects punctuated and alias names", () => {
  assert.deepEqual(names("J.P. Morgan advised"), ["J.P. Morgan"]);
  assert.deepEqual(names("JPMorgan advised"), ["JPMorgan"]);
  assert.deepEqual(names("Rothschild & Co and Moelis & Company"), ["Moelis & Company", "Rothschild & Co"]);
});

test("matching is case-insensitive and keeps the matched text", () => {
  const [hit] = detectAdvisers("advised by GOLDMAN SACHS today");
  assert.equal(hit.name, "Goldman Sachs");
  assert.equal(hit.matchedText, "GOLDMAN SACHS");
});

test("does not match bank names inside other words", () => {
  assert.deepEqual(detectAdvisers("The subsidiary built a bubs of rubs"), []);
  assert.deepEqual(detectAdvisers("Stifeling conditions"), []);
  assert.deepEqual(detectAdvisers("Lazarded results"), []);
});

test("each firm is reported once even if repeated", () => {
  assert.equal(detectAdvisers("Lazard, Lazard and more Lazard").length, 1);
});

test("empty input yields no advisers", () => {
  assert.deepEqual(detectAdvisers(""), []);
  assert.deepEqual(detectAdvisers(null), []);
  assert.deepEqual(detectAdvisers(undefined), []);
});

test("ADVISER_FIRMS is a non-empty list of strings", () => {
  assert.ok(ADVISER_FIRMS.length > 10);
  assert.ok(ADVISER_FIRMS.every((f) => typeof f === "string"));
});

test("detects newly added banks and aliases", () => {
  assert.deepEqual(names("Keefe, Bruyette & Woods, A Stifel Company, advised"), ["Keefe, Bruyette & Woods", "Stifel"]);
  assert.deepEqual(names("KBW and Truist Securities advised"), ["KBW", "Truist Securities"]);
  assert.deepEqual(names("TD Cowen, Piper Sandler and D.A. Davidson"), ["D.A. Davidson", "Piper Sandler", "TD Cowen"]);
  assert.deepEqual(names("Janney Montgomery Scott acted for the bank"), ["Janney Montgomery Scott"]);
  assert.deepEqual(names("Mizuho, Nomura, HSBC, Santander and SMBC Nikko"), [
    "HSBC",
    "Mizuho",
    "Nomura",
    "SMBC Nikko",
    "Santander",
  ]);
  assert.deepEqual(names("Canaccord Genuity and Baird"), ["Baird", "Canaccord Genuity"]);
});

test("new bank aliases still respect word boundaries", () => {
  assert.deepEqual(detectAdvisers("The Stephensons and Citizens met; Nomurabe"), []);
  assert.deepEqual(detectAdvisers("kbwx and mbmo"), []);
});

test("detectAdvisers stays bank-only unless includeLaw is set", () => {
  const text = "Goldman Sachs advised; Wachtell, Lipton, Rosen & Katz was legal counsel.";
  assert.deepEqual(names(text), ["Goldman Sachs"]);
  const both = detectAdvisers(text, { includeLaw: true }).map((a) => a.name);
  assert.deepEqual(both, ["Goldman Sachs", "Wachtell, Lipton, Rosen & Katz"]);
});

test("detectLawFirms matches canonical names and aliases, case-insensitively", () => {
  const law = (t) => detectLawFirms(t).map((f) => f.name);
  assert.deepEqual(law("Wachtell, Lipton, Rosen & Katz LLP"), ["Wachtell, Lipton, Rosen & Katz"]);
  assert.deepEqual(law("counsel: Wachtell Lipton"), ["Wachtell, Lipton, Rosen & Katz"]);
  assert.deepEqual(law("Skadden Arps and Sullivan & Cromwell LLP"), [
    "Skadden, Arps, Slate, Meagher & Flom",
    "Sullivan & Cromwell",
  ]);
  assert.deepEqual(law("Paul, Weiss, Rifkind, Wharton & Garrison LLP"), ["Paul, Weiss, Rifkind, Wharton & Garrison"]);
  assert.deepEqual(law("Paul Weiss"), ["Paul, Weiss, Rifkind, Wharton & Garrison"]);
  assert.deepEqual(law("KIRKLAND AND ELLIS"), ["Kirkland & Ellis"]);
  assert.deepEqual(law("Davis Polk & Wardwell LLP; Cravath, Swaine & Moore LLP"), [
    "Davis Polk & Wardwell",
    "Cravath, Swaine & Moore",
  ]);
  assert.deepEqual(law("Simpson Thacher, Latham & Watkins, Debevoise & Plimpton"), [
    "Simpson Thacher & Bartlett",
    "Latham & Watkins",
    "Debevoise & Plimpton",
  ]);
  assert.deepEqual(law("A&O Shearman and Linklaters"), ["A&O Shearman", "Linklaters"]);
});

test("law firm matching ignores look-alike words and empty input", () => {
  assert.deepEqual(detectLawFirms("akin to a weils of hunton"), []);
  assert.deepEqual(detectLawFirms(""), []);
  assert.deepEqual(detectLawFirms(null), []);
  assert.deepEqual(detectLawFirms("Goldman Sachs"), []);
});

test("LAW_FIRMS is a list of { name, aliases } with unique canonical names", () => {
  assert.ok(LAW_FIRMS.length >= 40);
  assert.ok(LAW_FIRMS.every((f) => typeof f.name === "string" && Array.isArray(f.aliases)));
  assert.equal(new Set(LAW_FIRMS.map((f) => f.name)).size, LAW_FIRMS.length);
});
