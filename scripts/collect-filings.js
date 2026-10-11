#!/usr/bin/env node
// Fetches the press-release exhibit (EX-99.1, else the primary 8-K document) for every sec-edgar item in
// test/fixtures/deals.json and stores plain text in test/fixtures/filings/<adsh>.txt.
// Usage: node scripts/collect-filings.js [--force]
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { htmlToPlainText } from "../src/pressRelease.js";

const UA = process.env.SEC_USER_AGENT || "ma-dashboard fixture collector (contact: test@example.com)";
const OUT = new URL("../test/fixtures/filings/", import.meta.url);
const MAX = 40000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

async function get(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = last + 150 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" } });
    if (res.ok) return res.text();
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await sleep(1000);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
}

export function capText(text) {
  if (text.length <= MAX) return text;
  return `${text.slice(0, 24990)}\n\n[...]\n\n${text.slice(-14990)}`;
}

function parseIndex(html, base) {
  const rows = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const href = tr.match(/<a[^>]+href="([^"]+)"/i)?.[1];
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => htmlToPlainText(m[1]));
    if (!href || cells.length < 4) continue;
    const type = cells[3];
    if (!type) continue;
    rows.push({ type, desc: cells[1], url: new URL(href.replace(/^\/ix\?doc=/, ""), base).href });
  }
  return rows;
}

function pickExhibit(rows) {
  const ex = rows.filter((r) => /^EX-99/i.test(r.type) && /\.html?$/i.test(r.url));
  const ex1 = ex.find((r) => /^EX-99\.1$/i.test(r.type));
  if (ex1) return ex1;
  return ex.find((r) => /press|release|announce|merger|acqui/i.test(r.desc)) ?? null;
}

async function main() {
  const force = process.argv.includes("--force");
  const deals = JSON.parse(await readFile(new URL("../test/fixtures/deals.json", import.meta.url), "utf8"));
  await mkdir(OUT, { recursive: true });
  const seen = new Set();
  for (const item of deals.items.filter((i) => i.source === "sec-edgar")) {
    if (seen.has(item.adsh)) continue;
    seen.add(item.adsh);
    const file = new URL(`${item.adsh}.txt`, OUT);
    if (!force) {
      try {
        await access(file);
        continue;
      } catch {
        /* not yet fetched */
      }
    }
    try {
      const cik = String(Number(item.ciks[0]));
      const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${item.adsh.replace(/-/g, "")}/${item.adsh}-index.htm`;
      let source;
      let type;
      try {
        const rows = parseIndex(await get(indexUrl), indexUrl);
        const pick = pickExhibit(rows);
        if (pick) ({ url: source, type } = pick);
      } catch (err) {
        console.error(`${item.adsh}: index failed (${err.message}); using item.link`);
      }
      if (!source) {
        source = item.link;
        type = "primary document";
      }
      const text = capText(htmlToPlainText(await get(source)));
      await writeFile(file, `# source: ${source} (${type})\n${text}\n`);
      console.log(`${item.adsh}\t${type}\t${text.length}`);
    } catch (err) {
      console.error(`${item.adsh}: FAILED ${err.message}`);
    }
  }
}

main();
