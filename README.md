# M&A Dashboard

A zero-install V1 of [idea.md](./idea.md): a dashboard for tracking upcoming
M&A deals, the tickers involved, and who's advising.

## Run it

```bash
npx .
```

This starts a local server on `http://localhost:3000` and opens a browser tab.

| Flag | Env var | Default | |
|---|---|---|---|
| `--port <n>` | `PORT` | `3000` | |
| `--host <addr>` | `MA_DASHBOARD_HOST` | `127.0.0.1` | use `0.0.0.0` to opt in to LAN access |
| `--sec-contact <email>` | `MA_DASHBOARD_SEC_CONTACT` | none | strongly recommended: SEC asks every client to identify itself with contact info, and the deal feed sends it in its User-Agent; please set your email |
| `--no-open` | | | don't open a browser tab |

`--help` and `--version` work as usual. No state is persisted (per the v1 spec) — every load is a fresh
fetch, cached in memory only for the life of the process.

## What's here

- **Upcoming acquisitions** — discovered from SEC EDGAR full-text search: 8-K
  merger agreements (Item 1.01), DEFM14A, S-4, SC TO-T and 425 filings from the
  last 30 days. Google News headlines from the same window are merged in as
  enrichment. Each card shows the acquirer, target, deal value, per-share price,
  consideration, expected close and advisers. Filterable by acquirer/company or
  by adviser. Adviser detection is a keyword match against curated lists of
  banks and law firms, so it will miss firms not on the lists.
- **Ticker chart** — last month of daily closes from Yahoo Finance, either
  typed in directly or by clicking a company chip on a deal (resolved via
  Yahoo's ticker search when the deal doesn't already have one).
- **Institutional holders** — top holders and ownership breakdown from Yahoo
  Finance for whatever ticker is loaded. This is institutional ownership
  broadly (index funds, asset managers, etc), not strictly private equity —
  labeled as such in the UI.

### Deal pipeline

1. **Discover** — `sec/search.js` runs six EDGAR queries (`DEAL_QUERIES`) over the last 30 days; `feeds.js` fetches the Google News RSS headlines.
2. **Enrich** — for each recent 8-K, 425 and SC TO-T, `sec/enrich.js` fetches the press-release exhibit (EX-99.1) and parses acquirer, target, deal value, per-share price, consideration, expected close and financial/legal advisers. Parsed filings are cached in memory per accession number. Up to 60 of the newest filings are enriched per refresh, within an 8 s budget; the rest finish in the background.
3. **Identify** — companies are mapped to CIKs and tickers using SEC `company_tickers.json` (`sec/tickerMap.js`), with name matching as a fallback.
4. **Group** — `pipeline.js` (pure, no I/O) turns headlines and filings into observations, groups them into deals and builds the cards. Deals are deduplicated by the CIK pair of acquirer and target, falling back to normalized names.
5. **Confidence** — a card is `high` when both parties are identified and the terms are backed by a parsed filing, a headline, or two sources agreeing. `low` cards are hidden by default (see the "Show unconfirmed" checkbox).

### Server (`src/`)

| File | Responsibility |
|---|---|
| `server.js` | routes to `api.js`, else serves `public/` via `static.js` |
| `api.js` | `/api/*` route dispatcher |
| `config.js` | runtime config (host, port, SEC contact) from env vars and CLI flags; builds the SEC User-Agent |
| `http.js` | `fetchWithRetry`: every upstream call gets a 10 s timeout and one retry with backoff |
| `feeds.js` | deal orchestration: discovery, enrichment, then the pipeline; 10 min deal cache |
| `pipeline.js` | pure observation → grouping → card logic, shared by production and the fixture tests |
| `sec/client.js` | the single choke point for sec.gov requests: 8 req/s global rate limit, User-Agent, timeouts, retries |
| `sec/search.js` | EDGAR full-text search queries (`DEAL_QUERIES`) and hit normalization |
| `sec/enrich.js` | fetches and parses filings per accession number (30 day cache, 10 min failure cache) |
| `sec/filings.js` / `sec/tickerMap.js` / `sec/htmlText.js` | filing index lookup, CIK/ticker map, HTML-to-text |
| `dedupe.js` | filters deals by acquirer/adviser |
| `pressRelease.js` | parses press-release text into deal terms and advisers |
| `marketData/` | market-data provider interface; `yahoo.js` is the only provider today |
| `tickers.js` | company name → ticker via the market-data provider; 24h cache |
| `holders.js` / `earnings.js` | institutional holders and earnings via the provider; 6h cache |
| `prices.js` | ticker price chart data via the provider |
| `advisers.js` / `dealParsing.js` / `xml.js` / `cache.js` | supporting helpers |

### Frontend (`public/`)

No build step — native ES modules loaded straight from `public/`. Chart.js
comes from a CDN. `main.js` wires `chart.js`, `deals.js`, and `holders.js`
together (clicking a deal's company chip loads its chart and holders panel).

## API

| Route | Returns |
|---|---|
| `GET /api/deals` | `{ deals, sources, cachedAt, stale, hiddenCount }`. Query: `acquirer`, `adviser`, `limit` (default 30), `unconfirmed=1` to include low-confidence cards |
| `GET /api/deals/advisers` | `{ advisers, banks, lawFirms }`: names for the adviser filter |

Each deal:

- `title`, `summary`, `publishedAt`, `primaryLink`
- `acquirer` / `target`: `{ name, cik, ticker }` or `null`; `companies[]` is the same with a `role`
- `dealValueUsd`, `perSharePrice`, `consideration`, `expectedClose`
- `advisers[]`: `{ name, role: "financial" | "legal", side: "acquirer" | "target" | null }`
- `sources[]`: `{ type, link, sourceName?, form? }`, plus `formTypes` and `items`
- `confidence`: `"high"` or `"low"`

Top level: `hiddenCount` is the number of low-confidence cards withheld, `stale` is true when
upstream failed and the last good result is served, and `sources` reports per-source health
(`{ name: "google-news" | "sec-edgar", ok, count, error?, enriched?, pending? }`).

## Development

```bash
npm install      # dev tools only (ESLint, Prettier); the app itself has no dependencies
npm test         # node --test
npm run lint
npm run format   # Prettier
npm run check    # lint + format check + tests, as CI runs them
```

CI runs the tests on Node 18, 20 and 22 across Linux, macOS and Windows.

Deal pipeline tools:

```bash
node --test test/fixtures.test.js                                  # prints fixture metrics vs the Phase 2 gate
MA_DASHBOARD_SEC_CONTACT=you@example.com node scripts/smoke-deals.js  # runs the live pipeline once
node scripts/collect-filings.js                                    # re-collects the EX-99.1 filing corpus
```

The Phase 2 gate: card parse accuracy ≥ 90%, bad-card rate < 5%, labeled-group recall ≥ 90%, and no
over-merges. `test/fixtures/deals.json` is a labeled set of 100 real headlines and SEC filings that
`test/fixtures.test.js` runs through the production pipeline; `test/fixtures/filings/` holds the
press-release corpus used to score the parser. See `test/fixtures/README.md` to re-collect or extend them.

## Known limitations (V1, by design)

- A cold refresh makes roughly 80 SEC requests and takes about 10–15 s; later loads are served from the
  10 min deal cache. Phase 4 targets this.
- Deals whose parties don't resolve to a CIK fall back to name matching, so near-duplicate cards can still
  appear for private or foreign parties.
- Adviser detection only covers fixed lists of banks and law firms.
- "Institutional holders" is a broader dataset than true PE/VC stakes — see
  idea.md's V2 ideas for the real thing.

## Not built yet (see idea.md V2)

- Breakdowns of PE/VC/HF stakes & their returns
