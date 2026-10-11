# Market Dashboard — V1 Roadmap

As of Oct 11, 2026. Exported from the [living doc](https://claude.ai/code/artifact/ee8de340-2336-415c-bfaf-3c9d1196b860); edits there don't sync here.

## Where it stands today

The repo is a working prototype: about 1,200 lines of dependency-free Node 18+ that runs with `npx .` and opens a three-column dashboard. The feature surface is close to V1; what's missing is the hardening, tests and packaging that make it shippable.

| Area | What exists | Gap to V1 |
| --- | --- | --- |
| Deal feed | Google News RSS (7 days) + SEC EDGAR full-text search for 8-Ks with "merger agreement" (14 days), merged and deduped by company tokens within 14 days | Duplicate headlines still slip through; no deal value, status or expected close date; SEC hits are filings, not deals |
| Company parsing | Regex headline patterns pull acquirer and target; SEC display names give tickers | Misses passive-voice and non-English-style headlines; no confidence signal |
| Advisers | Keyword match against 31 banks | No law firms; only matches text in the headline/summary, not the filing |
| Ticker panel | 1-month price chart, institutional holders, earnings (Yahoo Finance) | Relies on Yahoo's unofficial cookie/crumb endpoints, which break without notice |
| Filters | Acquirer/company and adviser text filters | idea.md's "breakdown of M&A by company or adviser" view isn't built |
| Server | Plain `node:http`, in-memory TTL caches, stale fallback when both feeds fail | Listens on all interfaces; static handler doesn't strip query strings; no request logging |
| Engineering | README, `.claude/launch.json` | No tests, linter, CI, changelog or release process; SEC User-Agent hard-codes a personal email |

## V1 definition

V1 is a free, open-source `npx ma-dashboard` that shows a trustworthy, deduplicated list of announced US public-company deals from the last 30 days, with the tickers, advisers and market reaction for each. It stays local-first and stateless, as idea.md intends: no accounts, no hosting bill, no paid data.

**Who it's for:** analysts, students and retail investors who follow M&A and want one screen instead of a news search plus EDGAR plus a quote site.

**The core promise:** every card is one real deal, links to its primary source, and loads in under 3 seconds.

**In V1**

- One card per deal: acquirer, target, tickers, announced date, deal value and consideration (cash/stock) when stated, advisers, all source links
- Deal detail view: target and acquirer charts since announcement, with the offer price line and the merger-arb spread for cash deals
- Breakdown views from idea.md: deals by acquirer and by adviser, with counts and total disclosed value
- Filters (date range, deal size, sector, adviser) kept in the URL so views can be shared and bookmarked
- Source health shown in the UI: which feeds loaded, when, and whether data is stale
- Expected close date when the filing or press release states one

**Cut from V1** (moved to the post-V1 list)

- PE/VC/HF stakes and their returns; V1 keeps the labeled "institutional holders" panel
- Accounts, watchlists, alerts and anything that needs persisted state
- Non-US deals and private-target deals with no SEC footprint
- AI-generated deal summaries

## Milestones

Four phases get the prototype to v1.0.0 in about 10 weeks of solo work, and the order is deliberate: tests and data quality come before new features, because every later view depends on the deal list being right.

1. **Foundations** (weeks 1–2)
    - `node --test` suite, ESLint + Prettier, GitHub Actions on 3 OSes
    - Bind to 127.0.0.1, fix static paths, configurable SEC contact
    - Yahoo behind a provider interface; timeouts and retries everywhere
    - **Gate:** CI green; 100-item labeled fixture set committed
2. **Deal data** (weeks 3–5)
    - EDGAR-first pipeline: 8-K 1.01, DEFM14A, S-4, SC TO-T, 425
    - Parse EX-99.1 for value, price, consideration, close, advisers
    - SEC ticker map; dedupe rebuilt around CIK pairs + fixtures
    - **Gate:** 90%+ parse accuracy, under 5% duplicate cards on fixtures
3. **Product** (weeks 6–8)
    - Deal detail: charts since announcement, offer line, arb spread
    - Breakdowns by acquirer and adviser: counts, disclosed value
    - URL-backed filters (date, size, sector, adviser); source health
    - **Gate:** feature-complete; every V1 scope item demoable
4. **Polish and launch** (weeks 9–10)
    - Responsive to 375 px, light/dark, empty/loading/error states
    - First paint under 1 s, deals under 3 s; nightly source check
    - README + screenshot, CHANGELOG, CLI flags, npm publish
    - **Gate:** ship v1.0.0 when every Quality bar box is ticked

Each gate is a hard stop: don't start the next phase until its criteria hold on the fixture set. Phase 2 is the riskiest and the one most likely to run long; if it does, cut sector filtering from Phase 3 before cutting any Quality bar item.

## Data sources and licensing

Make SEC EDGAR the backbone and treat news as enrichment: filings are free, stable, legally reusable and say what a deal actually is, while headlines only say a deal happened. Yahoo is the biggest shipping risk and needs an isolation layer before launch.

| Source | Use in V1 | Constraint | Action |
| --- | --- | --- | --- |
| SEC EDGAR full-text search | Discover deals: 8-K Item 1.01, plus DEFM14A, S-4, SC TO-T and 425 filings | Max 10 requests/second; requests must declare a User-Agent with contact info ([SEC](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)) | Add a global rate limiter; make the contact email configurable, not hard-coded |
| SEC filing documents | Parse deal value, per-share price, consideration, expected close, and named advisers | Unstructured HTML; formats vary by filer | Parse the press-release exhibit (EX-99.1) first; it's shorter and more uniform |
| SEC `company_tickers.json` | CIK to ticker mapping | Refreshed daily by SEC | Replace Yahoo ticker search for US filers |
| Google News RSS | Early headlines, non-filer deals, context links | Unofficial feed, no stated terms for reuse | Show headline + link only, never republish article text |
| Yahoo Finance (chart, quoteSummary) | Prices, holders, earnings | Unofficial endpoints; cookie/crumb scheme breaks without notice; personal-use terms | Wrap behind one provider interface, degrade gracefully, and document that a keyed provider can be swapped in |
| Keyed market-data API (optional) | Fallback price provider via user-supplied key | Free tiers are rate-limited | Read the key from an env var; never ship a key |

V1 stays on free sources. A paid deal database (deal values, status, advisers as structured fields) is the main post-V1 upgrade if this becomes a product.

## Quality bar

V1 ships when every box below is ticked. Each is checkable, so this list doubles as the release gate.

**Correctness**

- [ ] A labeled set of 100 real headlines and filings, kept as fixtures, with expected acquirer, target and dedupe groups
- [ ] Parser extracts acquirer and target correctly on 90%+ of the labeled set
- [ ] Fewer than 1 in 20 cards on a typical day is a duplicate or a non-deal
- [ ] Unit tests for `dealParsing`, `advisers`, dedupe and cache; run with built-in `node --test`, no new dependency

**Reliability**

- [ ] Any one source failing still renders the page, with a visible "source unavailable" notice
- [ ] Upstream calls have timeouts (10 s) and one retry with backoff
- [ ] A nightly CI job hits each live source and fails loudly when a format changes

**Performance**

- [ ] First paint under 1 s; deal list under 3 s on a cold cache
- [ ] Panels load independently, with skeleton states instead of blank columns

**Security**

- [ ] Server binds to `127.0.0.1` by default; `--host` opts in to LAN access
- [ ] Static handler strips query strings and rejects paths outside `public/`
- [ ] Deal links validated as `https:` and escaped before going into `href` (titles are escaped today; links are not)
- [ ] Chart.js vendored, or pinned to an exact version with an SRI hash (today it loads `chart.js@4`, any 4.x)

**Polish**

- [ ] Responsive down to 375 px; columns stack on mobile
- [ ] Light and dark themes; keyboard navigation through cards
- [ ] Empty, loading and error states designed for every panel
- [ ] Footer disclaimer: not investment advice; data may be delayed or wrong

**Release**

- [ ] ESLint + Prettier, GitHub Actions on Node 18/20/22 across Linux, macOS, Windows
- [ ] `npx ma-dashboard` works from a clean machine; `--port`, `--host`, `--no-open` flags
- [ ] README with screenshot, CHANGELOG, semver tags, published to npm

## Risks, open questions and post-V1 ideas

The two risks that could sink V1 are data quality and Yahoo breaking; both are addressed early in the plan rather than at the end.

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Yahoo changes or blocks its unofficial endpoints | High, over months | Provider interface, nightly contract check, panels degrade instead of erroring |
| Headline parsing stays noisy | Medium | EDGAR-first pipeline; hide low-confidence cards behind a "show unconfirmed" toggle |
| SEC throttles or blocks the user's IP | Low | Rate limiter under 10 req/s, configurable contact User-Agent, on-disk cache of filings |
| Scope creep into PE stakes and alerts | Medium | Hold the cut list; ship V1 before starting any post-V1 item |

**Open questions**

- Ship as an npm CLI only, or also a hosted read-only demo site? A demo helps adoption but adds hosting and data-terms questions.
- Is US-only acceptable for V1? Non-US deals need different filing sources.
- Should V1 cache to disk (e.g. `~/.ma-dashboard`) to speed up cold starts? It bends the "no state" rule from idea.md.

**Post-V1 ideas**

- PE/VC/HF stakes and their returns (idea.md V2), via 13F and Schedule 13D/G filings
- One merged story per deal with a dated timeline: announced, shareholder vote, regulatory approval, closed
- Watchlists and alerts for an acquirer, adviser or sector
- Deal status tracking and completion rates by adviser
- Optional LLM summaries of the merger agreement's key terms
