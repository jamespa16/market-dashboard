# M&A Dashboard

A zero-install V1 of [idea.md](./idea.md): a dashboard for tracking upcoming
M&A deals, the tickers involved, and who's advising.

## Run it

```bash
npx .
```

This starts a local server (default port 3000, or set `PORT`) and opens a
browser tab. No state is persisted (per the v1 spec) — every load is a fresh
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
| `feeds.js` | fetches, dedupes, and merges the two deal sources; 10 min cache |
| `tickers.js` | company name → ticker via Yahoo search; 24h cache |
| `holders.js` | institutional holders via Yahoo `quoteSummary` (crumb/cookie session); 6h cache |
| `prices.js` | ticker price chart data via Yahoo `chart` |
| `advisers.js` / `dealParsing.js` / `xml.js` / `cache.js` | supporting helpers |

### Frontend (`public/`)

No build step — native ES modules loaded straight from `public/`. Chart.js
comes from a CDN. `main.js` wires `chart.js`, `deals.js`, and `holders.js`
together (clicking a deal's company chip loads its chart and holders panel).

## Known limitations (V1, by design)

- Deal dedup across sources is best-effort (company-name + date-window
  matching) — near-duplicate headlines from different outlets can still
  appear as separate cards.
- Adviser detection only covers a fixed list of banks, no law firms.
- "Institutional holders" is a broader dataset than true PE/VC stakes — see
  idea.md's V2 ideas for the real thing.

## Not built yet (see idea.md V2)

- Breakdowns of PE/VC/HF stakes & their returns
