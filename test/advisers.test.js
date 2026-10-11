import test from "node:test";
import assert from "node:assert/strict";
import { detectAdvisers, ADVISER_FIRMS } from "../src/advisers.js";

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
