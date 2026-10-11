#!/usr/bin/env node
// Live smoke test: runs the real deal pipeline once and prints counts, timing, request count and top cards.
// Usage: MA_DASHBOARD_SEC_CONTACT=you@example.com node scripts/smoke-deals.js

import { getDeals } from "../src/feeds.js";
import { secRequestCount } from "../src/sec/client.js";

const t0 = Date.now();
const before = secRequestCount();
const all = await getDeals({ unconfirmed: true, limit: 1000 });
const elapsed = Date.now() - t0;
const confirmed = all.deals.filter((d) => d.confidence === "high");

console.log(`elapsed: ${(elapsed / 1000).toFixed(1)} s, SEC requests: ${secRequestCount() - before}`);
console.log("sources:", JSON.stringify(all.sources));
console.log(
  `cards: ${all.deals.length} total, ${confirmed.length} high confidence, ${all.deals.length - confirmed.length} low`
);
console.log(
  `with both CIKs: ${confirmed.filter((d) => d.acquirer?.cik && d.target?.cik).length}/${confirmed.length} high-confidence cards`
);
console.log(
  `with deal value: ${confirmed.filter((d) => d.dealValueUsd).length}; with advisers: ${confirmed.filter((d) => d.advisers.length).length}`
);
console.log("\nfirst 10 high-confidence cards:");
for (const d of confirmed.slice(0, 10)) {
  const value = d.dealValueUsd ? `$${(d.dealValueUsd / 1e9).toFixed(2)}B` : "n/a";
  const src = d.sources.map((s) => (s.type === "sec-edgar" ? `SEC ${s.form}` : s.sourceName)).join(", ");
  console.log(
    `- ${d.acquirer?.name ?? "?"}${d.acquirer?.ticker ? ` (${d.acquirer.ticker})` : ""} -> ` +
      `${d.target?.name ?? "?"}${d.target?.ticker ? ` (${d.target.ticker})` : ""} | ${value} | ${d.consideration ?? "-"} | ` +
      `${new Date(d.publishedAt).toISOString().slice(0, 10)} | ${src}`
  );
}
process.exit(0);
