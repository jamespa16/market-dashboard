import test from "node:test";
import assert from "node:assert/strict";
import { filterDeals } from "../src/dedupe.js";

const card = (overrides = {}) => ({
  id: "id",
  title: "Title",
  summary: "",
  acquirer: null,
  target: null,
  companies: [],
  advisers: [],
  ...overrides,
});

test("filterDeals by acquirer matches acquirer, companies, title and summary", () => {
  const d1 = card({ id: "1", acquirer: { name: "Acme Corp", cik: null, ticker: null } });
  const d2 = card({ id: "2", companies: [{ name: "Acme Widgets", ticker: null, cik: null, role: null }] });
  const d3 = card({ id: "3", title: "ACME makes a move" });
  const d4 = card({ id: "4", summary: "mentions acme" });
  const d5 = card({ id: "5" });
  const out = filterDeals([d1, d2, d3, d4, d5], { acquirer: "acme" });
  assert.deepEqual(
    out.map((d) => d.id),
    ["1", "2", "3", "4"]
  );
});

test("filterDeals by adviser (financial or legal) and with no filters", () => {
  const d1 = card({ id: "1", advisers: [{ name: "Goldman Sachs", role: "financial", side: null }] });
  const d2 = card({ id: "2", advisers: [{ name: "Kirkland & Ellis", role: "legal", side: "target" }] });
  const d3 = card({ id: "3" });
  assert.deepEqual(
    filterDeals([d1, d2, d3], { adviser: "goldman" }).map((d) => d.id),
    ["1"]
  );
  assert.deepEqual(
    filterDeals([d1, d2, d3], { adviser: "KIRKLAND" }).map((d) => d.id),
    ["2"]
  );
  assert.equal(filterDeals([d1, d2, d3], {}).length, 3);
  assert.equal(filterDeals([d1, d2, d3], { acquirer: "zzz", adviser: "goldman" }).length, 0);
});
