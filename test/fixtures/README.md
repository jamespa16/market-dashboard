# Labeled deal fixtures

`deals.json` is a hand-labeled set of 100 real items (60 Google News headlines, 40 SEC EDGAR 8-K hits) used to measure
parser accuracy and (later) dedupe quality. It backs the ROADMAP Phase 1 "Correctness" gate.
Only headline + link are stored for news (no article body or description text) for licensing reasons.

## Schema

```
{ "version": 1, "collectedAt": ISO, "labelingGuide": "...", "items": [ Item ] }
Item = {
  id: "g001" | "s001",            // g = google-news, s = sec-edgar
  source: "google-news" | "sec-edgar",
  title, link (https), publishedAt (ISO),
  sourceName?,                     // google-news only (outlet name)
  adsh, form, items[], file_date, display_names[], ciks[],   // sec-edgar only
  label: { isDeal, acquirer|null, target|null, dedupeGroup|null, notes? }
}
```

- Google titles are post-`cleanGoogleTitle`. Google links are news.google.com redirect URLs.
- SEC `title` is synthesised as `<registrant> - <form> filing (<items>)` like `src/feeds.js`; the registrant may be acquirer or target.
- Deals must have `acquirer`, `target` and a slug `dedupeGroup`; non-deals have all three `null`.
- Every item that describes the same deal (any outlet, SEC filings, amendments, completion) shares one `dedupeGroup`.

## Labeling rules (also in `labelingGuide`)

- `isDeal=true`: a specific transaction between named parties where one acquires control (>50%) of a company or a material
  business/asset package, and the item is a deal event: definitive agreement/announcement, formal public offer or tender offer
  (incl. improved/extended), amended terms, shareholder approval / go-shop expiry, or completion. **Completed deals count**
  and share the group of their announcement. Material asset packages count; minority stakes, small asset buys and
  licence-only purchases do not. SPAC business combinations and fund mergers count.
- `isDeal=false`: rumors, talks, "explored", non-binding/preliminary proposals; withdrawn/dropped/terminated deals;
  litigation/regulatory/political commentary on a pending deal; merger-arbitrage commentary; earnings releases; law-firm
  investor alerts; 8-K hits that only mention a merger agreement (e.g. credit facilities).
- Names are canonical as a human would write them (e.g. "Alphabet", "Wiz"); for mergers the surviving/public parent is the acquirer.
  Names may come from other outlets or the filing text when the headline omits them (noted in `notes`).

Borderline calls are flagged in `notes` (e.g. Twin Vee/USFM direction, Liquidity Services/Auction Holdings roles, Boots buyer).

## How it was collected

Collected 2026-10-11 with `node scripts/collect-fixtures.js /tmp/candidates.json`:

- Google News RSS (same query as `src/feeds.js`, widened to `when:30d`), plus `"agrees to acquire"`, `"to be acquired by"`,
  `merger`, `"merger arbitrage"`, and `"quarterly results" acquisition completed`, all `when:30d`.
- SEC EDGAR full-text search (`efts.sec.gov/LATEST/search-index`), forms=8-K, last 30 days, phrases `"merger agreement"`
  and `"agreement and plan of merger"` (first 100 hits each, deduped by accession number).
- SEC rejected (HTTP 403) a User-Agent containing a URL; the script uses `ma-dashboard fixture collector (contact: <email>)`.
  Override with the `SEC_USER_AGENT` env var. Requests are throttled well under 10 req/s.
- Parties for SEC items were identified by briefly reading the filing's primary document (Item 1.01 / 2.01 text).

## Re-collecting / extending

1. `node scripts/collect-fixtures.js /tmp/candidates.json` (raw candidates are not committed).
2. Pick new real items from the candidates, label them by hand per the rules above, append with the next free `gNNN`/`sNNN` id,
   and reuse existing `dedupeGroup` slugs where the deal is already present.
3. `node --test test/fixtures.test.js` validates the schema and prints parser accuracy. Never invent items.
   When the parser improves, raise `BASELINE` in `test/fixtures.test.js` (ratchet; Phase 2 target is 90%).

## SEC ticker map snapshot

`sec/company_tickers.json.gz` is the full, gzipped `https://www.sec.gov/files/company_tickers.json` captured 2026-10-11
(`curl -A "ma-dashboard/0.1 (contact: <email>)" https://www.sec.gov/files/company_tickers.json | gzip -9`). It is the full
file (not a subset) so name ambiguity matches production. `test/fixtures.test.js` reads it with `gunzipSync` and runs the
production pipeline (`src/pipeline.js`) over every item offline: bad-card rate, group recall, over-merges and card-level
parse accuracy are asserted for the default (high-confidence) cards.
