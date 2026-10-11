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
| `--sec-contact <email>` | `MA_DASHBOARD_SEC_CONTACT` | none | SEC asks every client to identify itself with contact info; please set your email |
| `--no-open` | | | don't open a browser tab |

`--help` and `--version` work as usual. No state is persisted (per the v1 spec) — every load is a fresh
fetch, cached in memory only for the life of the process.

## What's here

- **Upcoming acquisitions** — merges Google News RSS and SEC EDGAR full-text
  search (8-K filings), deduped, filterable by acquirer/company or by
  financial adviser. Adviser detection is a best-effort keyword match against
  a curated list of advisory banks — it will miss firms not on the list.
- **Ticker chart** — last month of daily closes from Yahoo Finance, either
  typed in directly or by clicking a company chip on a deal (resolved via
  Yahoo's ticker search when the deal doesn't already have one).
- **Institutional holders** — top holders and ownership breakdown from Yahoo
  Finance for whatever ticker is loaded. This is institutional ownership
  broadly (index funds, asset managers, etc), not strictly private equity —
  labeled as such in the UI.

### Server (`src/`)

| File | Responsibility |
|---|---|
| `server.js` | routes to `api.js`, else serves `public/` via `static.js` |
| `api.js` | `/api/*` route dispatcher |
| `config.js` | runtime config (host, port, SEC contact) from env vars and CLI flags |
| `http.js` | `fetchWithRetry`: every upstream call gets a 10 s timeout and one retry with backoff |
| `feeds.js` | fetches the two deal sources; 10 min cache |
| `dedupe.js` | dedupes, merges and filters deals across sources |
| `marketData/` | market-data provider interface; `yahoo.js` is the only provider today |
| `tickers.js` | company name → ticker via the market-data provider; 24h cache |
| `holders.js` / `earnings.js` | institutional holders and earnings via the provider; 6h cache |
| `prices.js` | ticker price chart data via the provider |
| `advisers.js` / `dealParsing.js` / `xml.js` / `cache.js` | supporting helpers |

### Frontend (`public/`)

No build step — native ES modules loaded straight from `public/`. Chart.js
comes from a CDN. `main.js` wires `chart.js`, `deals.js`, and `holders.js`
together (clicking a deal's company chip loads its chart and holders panel).

## Development

```bash
npm install      # dev tools only (ESLint, Prettier); the app itself has no dependencies
npm test         # node --test
npm run lint
npm run format   # Prettier
npm run check    # lint + format check + tests, as CI runs them
```

CI runs the tests on Node 18, 20 and 22 across Linux, macOS and Windows.

`test/fixtures/deals.json` is a labeled set of 100 real headlines and SEC filings.
`test/fixtures.test.js` scores the parser and dedupe against it and fails if
either gets worse; see `test/fixtures/README.md` to re-collect or extend it.

## Known limitations (V1, by design)

- Deal dedup across sources is best-effort (company-name + date-window
  matching) — near-duplicate headlines from different outlets can still
  appear as separate cards.
- Adviser detection only covers a fixed list of banks, no law firms.
- "Institutional holders" is a broader dataset than true PE/VC stakes — see
  idea.md's V2 ideas for the real thing.

## Not built yet (see idea.md V2)

- Breakdowns of PE/VC/HF stakes & their returns
