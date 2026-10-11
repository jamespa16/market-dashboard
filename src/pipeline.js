// Pure deal-pipeline logic: raw feed items -> observations -> grouped deal cards.
// No I/O: the ticker map and any parsed filing text are passed in, so production (src/feeds.js)
// and the offline fixture evaluation (test/fixtures.test.js) run exactly the same code.

import { createHash } from "node:crypto";
import { normalizeEntityName } from "./sec/tickerMap.js";
import {
  classifyHeadline,
  extractCompanyPair,
  extractTickerFromSecName,
  isGenericParty,
  looksLikeCompanyName,
} from "./dealParsing.js";
import { detectAdvisers } from "./advisers.js";

export const MERGE_WINDOW_DAYS = 30;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------------------------

/** "LIFECORE BIOMEDICAL, INC. \DE\ (LCBM) (CIK 0000123)" -> "LIFECORE BIOMEDICAL, INC." */
export function cleanRegistrantName(displayName) {
  return String(displayName ?? "")
    .replace(/\s*\(CIK[^)]*\)/gi, "")
    .replace(/(?:\s*\([A-Z0-9.,\- ]{1,24}\))+\s*$/, "")
    .replace(/\s*\\[A-Z]{2}\\\s*/g, " ")
    .trim();
}

/** `inner` appears inside `outer` as whole words ("skydance" in "paramount skydance"); inner is 6+ chars. */
const containsWords = (outer, inner) => inner.length >= 6 && ` ${outer} `.includes(` ${inner} `);

const wordCount = (s) => s.split(" ").length;

/** Whole-word prefix relation between two normalized names, strict enough to avoid generic tokens. */
function prefixAlias(x, y) {
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return l.startsWith(s + " ") && (wordCount(s) >= 2 || s.length >= 8);
}

// Prefix or suffix of 5+ chars ("Marea" / "Marea Therapeutics", "Parafin" / "Embedded Finance Platform Parafin").
function looseAlias(x, y) {
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 5 && (l.startsWith(s + " ") || l.endsWith(" " + s));
}

/**
 * @typedef {{ id: string, name: string, cik: string|null, ticker: string|null, names: string[], hint: {cik:string,ticker:string}|null }} Party
 * Party id is `cik:<n>` when resolved, else `name:<normalized name>`.
 */
const NAME_ABBREVIATIONS = new Set(["inc", "corp", "co", "cos", "ltd", "bros", "llc", "plc", "sa", "no", "st", "lp"]);

/** Strip descriptors headline/filing parsers leave attached to a company name. */
function cleanPartyName(raw) {
  let name = String(raw ?? "").trim();
  // "Modine's Performance Technologies" -> "Modine Performance Technologies"
  name = name.replace(/^(\S+?)['\u2019]s\s+(?=[A-Z])/, "$1 ");
  // "Humble-based Third Coast Bancshares" -> "Third Coast Bancshares"
  name = name.replace(/^.{1,40}?-(?:based|backed|owned|headquartered)\s+/i, "");
  // "RXO. Learn" -> "RXO" (sentence tail), but keep "Bros. Discovery" / "Inc. Holdings"
  const m = /\b([A-Za-z]{3,})\.\s+[A-Z]/.exec(name);
  if (m && !NAME_ABBREVIATIONS.has(m[1].toLowerCase())) name = name.slice(0, m.index + m[1].length);
  return name.trim();
}

export function makeParty(rawName, { cik = null, tickerMap, ticker = null, aliases = [] } = {}) {
  const name = cleanPartyName(rawName);
  const norm = normalizeEntityName(name);
  if (!norm || isGenericParty(name)) return null;
  let entry = cik ? tickerMap?.byCik(cik) : null;
  let hint = null; // unconfirmed single-word prefix match ("Paramount" -> "Paramount Gold Nevada")
  if (!cik) {
    entry = tickerMap?.byName(name, { exact: true }) ?? null;
    // Bare tickers / acronyms in headlines ("AMD", "IBM")
    if (!entry && /^[A-Z][A-Z0-9.]{2,4}$/.test(name)) entry = tickerMap?.byTicker(name) ?? null;
    if (!entry) {
      const fuzzy = tickerMap?.byName(name) ?? null;
      if (fuzzy) {
        if (wordCount(norm) >= 2) entry = fuzzy;
        else hint = fuzzy;
      }
    }
    cik = entry?.cik ?? null;
  }
  const names = [norm];
  for (const alias of [entry?.name, hint?.name, ...aliases]) {
    const n = normalizeEntityName(alias);
    if (n && !names.includes(n)) names.push(n);
  }
  return {
    id: cik ? `cik:${cik}` : `name:${norm}`,
    name,
    cik,
    ticker: entry?.ticker ?? ticker ?? null,
    names,
    // A single-word prefix match is good enough to group on but not to show as a ticker.
    hint: hint ? { cik: hint.cik, ticker: hint.ticker } : null,
  };
}

/**
 * How strongly two parties are the same company: 2 = same CIK or identical normalized name,
 * 1 = one name is a whole-word prefix of the other ("Acme Therapeutics" / "Acme Therapeutics Holdings"),
 * 0.5 = looser single-word prefix of 5+ chars ("Marea" / "Marea Therapeutics"), 0 = unrelated.
 * Two different CIKs are never the same company.
 */
export function partySimilarity(a, b) {
  if (!a || !b) return 0;
  if (a.id === b.id) return 2;
  if (a.cik && b.cik) return 0;
  let best = 0;
  for (const x of a.names) {
    for (const y of b.names) {
      if (x === y) return 2;
      if (prefixAlias(x, y)) best = Math.max(best, 1);
      else if (best < 0.5 && looseAlias(x, y)) best = 0.5;
    }
  }
  return best;
}

/** Same real-world company (similarity >= 1)? */
export function sameParty(a, b) {
  return partySimilarity(a, b) >= 1;
}

// ---------------------------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------------------------

const toMs = (v) => {
  if (v == null) return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

// "Conversational AI Is Finally Connected: Automation Anywhere to Acquire Boost.ai": prefer the segment
// after the last colon when it carries the deal on its own.
function pairFromTitle(title) {
  const tail = title.includes(": ") ? title.slice(title.lastIndexOf(": ") + 2) : null;
  if (tail) {
    const p = extractCompanyPair(tail);
    if (p.acquirer && p.target) return p;
  }
  return extractCompanyPair(title);
}

/**
 * One headline -> observation, or null when the classifier says it is not a deal.
 * @param {{ title: string, summary?: string, link: string, sourceName?: string, publishedAt?: number|string|null }} raw
 */
export function googleObservation(raw, tickerMap) {
  const verdict = classifyHeadline(raw.title);
  if (!verdict.isDeal) return null;
  const { acquirer, target } = pairFromTitle(raw.title);
  const ok = (n) => (n && looksLikeCompanyName(n) ? n : null);
  const acq = ok(acquirer) ? makeParty(acquirer, { tickerMap }) : null;
  const tgt = ok(target) ? makeParty(target, { tickerMap }) : null;
  return {
    type: "google-news",
    sourceKey: `g:${raw.sourceName ?? raw.link}`,
    publishedAt: toMs(raw.publishedAt),
    acquirer: acq,
    target: tgt,
    headline: raw.title,
    summary: raw.summary ?? "",
    headlineHigh: verdict.confidence === "high" && !!acq && !!tgt,
    source: { type: "google-news", link: raw.link, sourceName: raw.sourceName ?? "Google News" },
    advisers: detectAdvisers(`${raw.title} ${raw.summary ?? ""}`).map((a) => ({
      name: a.name,
      role: "financial",
      side: null,
    })),
  };
}

/**
 * One SEC discovery hit (+ optional parsePressRelease result) -> observation.
 * Parsed party names are mapped to CIKs through the registrant (display name <-> cik) and the ticker map.
 * Without parsed parties the observation is a "single": it carries only the registrant.
 */
export function secObservation({ hit, parsed = null, link = null }, tickerMap) {
  const registrants = (hit.ciks ?? []).map((cik, i) => {
    const display = hit.displayNames?.[i] ?? hit.displayNames?.[0] ?? "";
    return {
      cik,
      name: cleanRegistrantName(display),
      ticker: extractTickerFromSecName(display.replace(/\s*\\[A-Z]{2}\\/, "")),
    };
  });
  let matchedRegistrant = false;
  const partyFor = (name) => {
    if (!name) return null;
    const norm = normalizeEntityName(name);
    const reg = registrants.find((r) => {
      const rn = normalizeEntityName(r.name);
      return rn && (rn === norm || prefixAlias(rn, norm) || containsWords(rn, norm));
    });
    if (reg && (normalizeEntityName(reg.name) === norm || prefixAlias(normalizeEntityName(reg.name), norm)))
      matchedRegistrant = true;
    return makeParty(name, reg ? { cik: reg.cik, tickerMap, ticker: reg.ticker, aliases: [reg.name] } : { tickerMap });
  };
  let acquirer = partyFor(parsed?.acquirer);
  let target = partyFor(parsed?.target);
  if (acquirer && target && sameParty(acquirer, target)) acquirer = target = null;

  const reg0 = registrants[0];
  const single =
    !acquirer && !target && reg0?.name ? makeParty(reg0.name, { cik: reg0.cik, tickerMap, ticker: reg0.ticker }) : null;

  const fileDate = hit.fileDate ?? null;
  const dealFiling8K = hit.form === "8-K" && (hit.items ?? []).some((i) => i === "1.01" || i === "2.01");
  return {
    type: "sec-edgar",
    sourceKey: `s:${hit.adsh}`,
    publishedAt: toMs(fileDate),
    acquirer,
    target,
    registrant: single,
    parse: parsed,
    // High-confidence press-release parse (for non-8-K forms the filer must be one of the parties,
    // since those texts are noisier), or a pair parse corroborated by the filer being one of the
    // named parties in an 8-K that reports a definitive agreement / completed acquisition.
    parseHigh: !!(
      acquirer &&
      target &&
      parsed &&
      ((parsed.confidence === "high" && (hit.form === "8-K" || matchedRegistrant)) ||
        (matchedRegistrant && dealFiling8K))
    ),
    summary: "",
    headline: null,
    headlineHigh: false,
    form: hit.form ?? null,
    items: hit.items ?? [],
    source: {
      type: "sec-edgar",
      link: link ?? hit.url ?? null,
      sourceName: "SEC EDGAR",
      form: hit.form ?? undefined,
      fileDate: fileDate ?? undefined,
    },
    advisers: (parsed?.advisers ?? []).map((a) => ({ name: a.name, role: a.role, side: a.side ?? null })),
  };
}

const partiesOf = (o) => [o.acquirer, o.target, o.registrant].filter(Boolean);
const isPair = (o) => !!(o.acquirer && o.target);

// ---------------------------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------------------------

const timeGap = (a, b) => Math.abs((a.publishedAt ?? 0) - (b.publishedAt ?? 0));

const near = (a, b, days) =>
  a.publishedAt != null && b.publishedAt != null && Math.abs(a.publishedAt - b.publishedAt) <= days * DAY;

// Pairs match when both sides are the same company; the weaker side may only be a loose name match
// if the other side is an exact match (similarity sum >= 2).
function samePair(a, b) {
  const s = (x, y) => partySimilarity(x, y);
  const straight = [s(a.acquirer, b.acquirer), s(a.target, b.target)];
  const crossed = [s(a.acquirer, b.target), s(a.target, b.acquirer)];
  return [straight, crossed].some(([x, y]) => x >= 0.5 && y >= 0.5 && x + y >= 2);
}

/**
 * Group observations into deals.
 *  1. Observations naming the same unordered pair of parties merge (union-find).
 *  2. Observations with only one known party attach to the pair-cluster containing that party
 *     (closest in time when several qualify); unattached ones group with each other by party.
 * Merges only happen within `windowDays`. Two pairs sharing one party but differing on the other
 * stay separate (one company in two deals).
 * @returns {object[][]} clusters of observations
 */
export function groupObservations(observations, { windowDays = MERGE_WINDOW_DAYS } = {}) {
  const obs = observations;
  const parent = obs.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = (i, j) => {
    parent[find(i)] = find(j);
  };

  const pairIdx = obs.map((o, i) => i).filter((i) => isPair(obs[i]));
  for (let a = 0; a < pairIdx.length; a++) {
    for (let b = a + 1; b < pairIdx.length; b++) {
      const i = pairIdx[a];
      const j = pairIdx[b];
      if (near(obs[i], obs[j], windowDays) && samePair(obs[i], obs[j])) union(i, j);
    }
  }

  const singles = obs
    .map((o, i) => i)
    .filter((i) => !isPair(obs[i]) && partiesOf(obs[i]).length > 0)
    .sort((a, b) => (obs[a].publishedAt ?? 0) - (obs[b].publishedAt ?? 0));
  const placed = [];
  for (const i of singles) {
    const party = partiesOf(obs[i])[0];
    const dist = (j) => timeGap(obs[i], obs[j]);
    let best = null;
    for (const j of pairIdx) {
      if (!near(obs[i], obs[j], windowDays)) continue;
      if (!(sameParty(party, obs[j].acquirer) || sameParty(party, obs[j].target))) continue;
      if (best == null || dist(j) < dist(best)) best = j;
    }
    if (best != null) {
      union(i, best);
    } else {
      for (const j of placed) {
        if (near(obs[i], obs[j], windowDays) && sameParty(party, partiesOf(obs[j])[0])) union(i, j);
      }
      placed.push(i);
    }
  }

  // Headlines with no extracted party attach to a pair-cluster whose party name (5+ chars) they mention
  // as whole words ("Option Care Health Receives ... Offer"); closest in time wins.
  obs.forEach((o, i) => {
    if (o.headline == null || partiesOf(o).length > 0) return;
    const text = ` ${normalizeEntityName(o.headline)} `;
    let best = null;
    for (const j of pairIdx) {
      if (!near(o, obs[j], windowDays)) continue;
      const mentioned = [obs[j].acquirer, obs[j].target].some((p) =>
        p.names.some((n) => n.length >= 5 && text.includes(` ${n} `))
      );
      if (mentioned && (best == null || timeGap(o, obs[j]) < timeGap(o, obs[best]))) best = j;
    }
    if (best != null) union(i, best);
  });

  const clusters = new Map();
  obs.forEach((o, i) => {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(o);
  });
  return [...clusters.values()];
}

// ---------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------

const fmtMoney = (n) => {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(2)} billion`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(1)} million`;
  return `$${n.toLocaleString("en-US")}`;
};

const asParty = (p) => (p ? { name: p.name, cik: p.cik, ticker: p.ticker } : null);

// Parties/terms preference: SEC press-release parse (high), then headline, then low-confidence SEC parse.
function priority(o) {
  if (o.parseHigh) return 0;
  if (o.headlineHigh) return 1;
  if (isPair(o) && o.type === "sec-edgar") return 2;
  if (isPair(o)) return 3;
  return 4;
}

/** Merge one cluster of observations into the API card shape (see ROADMAP / api contract). */
export function buildCard(cluster) {
  const sorted = [...cluster].sort(
    (a, b) => priority(a) - priority(b) || (a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity)
  );
  const lead = sorted.find(isPair) ?? null;
  const pairObs = sorted.filter(isPair);

  let acquirer = lead?.acquirer ?? null;
  let target = lead?.target ?? null;
  // Fill CIK/ticker from any agreeing observation.
  const enrich = (party) => {
    if (!party || party.cik) return party;
    for (const o of cluster) {
      for (const p of partiesOf(o))
        if (p.cik && sameParty(party, p)) return { ...party, cik: p.cik, ticker: p.ticker, id: p.id };
    }
    return party;
  };
  // Display the name most observations use ("AMD" over "Advanced Micro Devices" when two headlines say AMD);
  // ties keep the lead observation's name.
  const commonName = (party) => {
    if (!party) return party;
    const counts = new Map([[party.name.toLowerCase(), { name: party.name, n: 0.5 }]]);
    for (const o of pairObs) {
      for (const p of [o.acquirer, o.target]) {
        if (!sameParty(party, p)) continue;
        const k = p.name.toLowerCase();
        counts.set(k, { name: p.name, n: (counts.get(k)?.n ?? 0) + 1 });
      }
    }
    return { ...party, name: [...counts.values()].sort((a, b) => b.n - a.n)[0].name };
  };
  acquirer = commonName(enrich(acquirer));
  target = commonName(enrich(target));

  // Single-party card: show the registrant as an unlabeled company.
  const loneParty = !lead ? cluster.map((o) => partiesOf(o)[0]).find(Boolean) : null;

  const terms = (field) => {
    for (const o of sorted) {
      const v = o.parse?.[field];
      if (v != null) return v;
    }
    return null;
  };
  const dealValueUsd = terms("dealValueUsd");
  const perSharePrice = terms("perSharePrice");
  const consideration = terms("consideration");
  const expectedClose = terms("expectedClose");

  const googleObs = cluster
    .filter((o) => o.type === "google-news")
    .sort((a, b) => (a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity));
  const headlineObs =
    googleObs.find((o) => isPair(o) && acquirer && sameParty(o.acquirer, acquirer)) ??
    googleObs.find(isPair) ??
    googleObs[0] ??
    null;

  const secObs = cluster
    .filter((o) => o.type === "sec-edgar")
    .sort((a, b) => (a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity));
  let title;
  if (headlineObs) title = headlineObs.headline;
  else if (acquirer && target)
    title = `${acquirer.name} to acquire ${target.name}${dealValueUsd ? ` for ${fmtMoney(dealValueUsd)}` : ""}`;
  else {
    const o = secObs[0];
    title = `${loneParty?.name ?? "Unknown company"} - ${o?.form ?? "SEC"} filing${o?.items?.length ? ` (Items ${o.items.join(", ")})` : ""}`;
  }

  let summary = headlineObs?.summary ?? "";
  if (!summary && secObs[0]) {
    const o = secObs[0];
    summary =
      `${o.form} filed ${o.source.fileDate ?? ""}`.trim() +
      (o.items?.length ? ` (Items ${o.items.join(", ")})` : "") +
      ".";
  }

  const advisers = new Map();
  for (const o of sorted) {
    for (const a of o.advisers) {
      const key = `${a.name}|${a.role}`;
      const prev = advisers.get(key);
      if (!prev || (!prev.side && a.side)) advisers.set(key, a);
    }
  }
  const seen = new Set();
  const sources = [...cluster]
    .sort((a, b) => (a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity))
    .map((o) => o.source)
    .filter((s) => s.link && !seen.has(s.link) && seen.add(s.link));

  const times = cluster.map((o) => o.publishedAt).filter((t) => t != null);
  const publishedAt = times.length ? Math.min(...times) : null;

  const bothKnown = !!(acquirer && target);
  const agree = new Set(pairObs.map((o) => o.sourceKey)).size >= 2;
  const confidence =
    bothKnown && (cluster.some((o) => o.parseHigh) || cluster.some((o) => o.headlineHigh) || agree) ? "high" : "low";

  const companies = bothKnown
    ? [
        { ...asParty(acquirer), role: "acquirer" },
        { ...asParty(target), role: "target" },
      ]
    : [
        acquirer && { ...asParty(acquirer), role: "acquirer" },
        target && { ...asParty(target), role: "target" },
        loneParty && { ...asParty(loneParty), role: null },
      ].filter(Boolean);

  const primaryLink =
    sources.find((s) => s.type === "sec-edgar")?.link ?? sources[0]?.link ?? "https://www.sec.gov/cgi-bin/browse-edgar";
  const idKey = bothKnown ? [acquirer.id, target.id].sort().join("|") : (loneParty?.id ?? sources[0]?.link ?? title);

  return {
    id: createHash("sha1").update(idKey).digest("hex").slice(0, 16),
    title,
    summary,
    publishedAt,
    acquirer: asParty(acquirer),
    target: asParty(target),
    companies,
    dealValueUsd,
    perSharePrice,
    consideration,
    expectedClose,
    advisers: [...advisers.values()].map((a) => ({ name: a.name, role: a.role, side: a.side ?? null })),
    sources,
    primaryLink,
    formTypes: [...new Set(secObs.map((o) => o.form).filter(Boolean))],
    items: [...new Set(secObs.flatMap((o) => o.items ?? []))].sort(),
    confidence,
  };
}

/** Observations -> cards, newest first. Also returns which observations went into each card. */
export function buildDeals(observations, opts) {
  return groupObservations(observations, opts)
    .map((cluster) => ({ card: buildCard(cluster), cluster }))
    .sort((a, b) => (b.card.publishedAt ?? 0) - (a.card.publishedAt ?? 0));
}
