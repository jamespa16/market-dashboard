#!/usr/bin/env node
// Collects RAW candidate headlines (Google News RSS) and SEC 8-K hits for the
// labeled fixture set. Usage: node scripts/collect-fixtures.js /tmp/candidates.json
// Stores headline + link only (never article body/description text).
import { writeFile } from "node:fs/promises";
import { parseRssItems } from "../src/xml.js";
import { cleanGoogleTitle } from "../src/dealParsing.js";
import { secUserAgent } from "../src/config.js";

// SEC returns 403 for UAs containing a URL; set MA_DASHBOARD_SEC_CONTACT to your email, or override with SEC_USER_AGENT.
const SEC_UA = process.env.SEC_USER_AGENT || secUserAgent();
const GOOGLE_UA = "Mozilla/5.0 (compatible; ma-dashboard/0.1)";
const DAYS = 30;

const GOOGLE_QUERIES = [
  // Same query as src/feeds.js, widened to 30 days.
  '"to acquire" OR "merger agreement" OR "acquisition agreement" when:30d',
  '"agrees to acquire" when:30d',
  '"to be acquired by" when:30d',
  "merger when:30d",
  // Non-deal / hard-negative variety (arbitrage, earnings mentions of deals):
  '"merger arbitrage" when:30d',
  '"quarterly results" acquisition completed when:30d',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function googleCandidates() {
  const out = [];
  for (const q of GOOGLE_QUERIES) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { headers: { "User-Agent": GOOGLE_UA } });
    if (!res.ok) {
      console.error(`google query failed ${res.status}: ${q}`);
      continue;
    }
    for (const item of parseRssItems(await res.text())) {
      const t = item.pubDate ? Date.parse(item.pubDate) : NaN;
      out.push({
        source: "google-news",
        query: q,
        title: cleanGoogleTitle(item.title),
        link: item.link,
        sourceName: item.sourceName ?? null,
        publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
      });
    }
    await sleep(500);
  }
  return out;
}

async function secCandidates() {
  const end = new Date();
  const start = new Date(end.getTime() - DAYS * 86400_000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const out = [];
  const seen = new Set();
  for (const q of ["merger agreement", "agreement and plan of merger"]) {
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&forms=8-K` +
      `&dateRange=custom&startdt=${fmt(start)}&enddt=${fmt(end)}`;
    const res = await fetch(url, { headers: { "User-Agent": SEC_UA } });
    if (!res.ok) {
      console.error(`sec failed ${res.status}`);
      break;
    }
    const hits = (await res.json())?.hits?.hits ?? [];
    for (const hit of hits) {
      const s = hit._source;
      if (seen.has(s.adsh)) continue;
      seen.add(s.adsh);
      const doc = hit._id?.split(":")[1];
      const cik = s.ciks?.[0];
      out.push({
        source: "sec-edgar",
        adsh: s.adsh,
        form: s.form,
        items: s.items ?? [],
        file_date: s.file_date,
        display_names: s.display_names ?? [],
        ciks: s.ciks ?? [],
        link:
          cik && s.adsh && doc
            ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${s.adsh.replace(/-/g, "")}/${doc}`
            : null,
      });
    }
    await sleep(200); // well under SEC's 10 req/s limit
  }
  return out;
}

const outPath = process.argv[2];
if (!outPath) {
  console.error("usage: node scripts/collect-fixtures.js <out.json>");
  process.exit(1);
}
const [google, sec] = [await googleCandidates(), await secCandidates()];
await writeFile(outPath, JSON.stringify({ collectedAt: new Date().toISOString(), google, sec }, null, 2));
console.log(`wrote ${google.length} google + ${sec.length} sec candidates to ${outPath}`);
