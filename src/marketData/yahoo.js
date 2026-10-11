import { fetchWithRetry } from "../http.js";
import { NotFoundError } from "./index.js";

const USER_AGENT = "Mozilla/5.0 (compatible; ma-dashboard/0.1)";
const SESSION_MAX_AGE_MS = 60 * 60_000;

function extractCookie(res) {
  // Node's fetch exposes multiple Set-Cookie headers via getSetCookie().
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

// Unofficial Yahoo Finance endpoints - no API key required. `http` options go to fetchWithRetry.
export function createYahooProvider(http = {}) {
  const get = (url, headers = {}) =>
    fetchWithRetry(url, { ...http, headers: { "User-Agent": USER_AGENT, ...headers } });

  let session = { cookie: null, crumb: null, fetchedAt: 0 };

  async function ensureSession(force = false) {
    const isFresh = session.cookie && session.crumb && Date.now() - session.fetchedAt < SESSION_MAX_AGE_MS;
    if (isFresh && !force) return session;

    const cookie = extractCookie(await get("https://fc.yahoo.com"));
    if (!cookie) throw new Error("Failed to obtain Yahoo Finance session cookie");

    const crumbRes = await get("https://query2.finance.yahoo.com/v1/test/getcrumb", { Cookie: cookie });
    if (!crumbRes.ok) throw new Error(`Failed to obtain Yahoo Finance crumb: ${crumbRes.status}`);
    const crumb = await crumbRes.text();

    session = { cookie, crumb, fetchedAt: Date.now() };
    return session;
  }

  async function quoteSummary(symbol, modules, attempt = 0) {
    const { cookie, crumb } = await ensureSession();
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}`;

    const res = await get(url, { Cookie: cookie });
    const data = await res.json().catch(() => null);
    const error = data?.quoteSummary?.error;

    if (error?.code === "Unauthorized" && attempt === 0) {
      await ensureSession(true);
      return quoteSummary(symbol, modules, attempt + 1);
    }
    if (error?.code === "Not Found") {
      throw new NotFoundError(error.description ?? `No data for symbol: ${symbol}`);
    }
    if (error) throw new Error(error.description ?? "Yahoo Finance quoteSummary request failed");
    if (!res.ok) throw new Error(`Yahoo Finance quoteSummary failed: ${res.status}`);

    return data.quoteSummary.result[0];
  }

  async function getPriceHistory(symbol, range = "1mo", interval = "1d") {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const res = await get(url);
    const data = await res.json().catch(() => null);
    const result = data?.chart?.result?.[0];

    if (!result) {
      const error = data?.chart?.error;
      if (error?.code === "Not Found") throw new NotFoundError(error.description ?? `No data for ${symbol}`);
      if (!res.ok) throw new Error(`Yahoo Finance request failed: ${res.status}`);
      throw new Error(error?.description || "No data returned");
    }

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    return {
      symbol: result.meta.symbol,
      currency: result.meta.currency,
      exchangeName: result.meta.exchangeName,
      regularMarketPrice: result.meta.regularMarketPrice,
      points: timestamps
        .map((t, i) => ({ date: t * 1000, close: closes[i] }))
        .filter((p) => typeof p.close === "number"),
    };
  }

  async function searchTickers(query) {
    const res = await get(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Yahoo Finance search failed: ${res.status}`);
    const data = await res.json();
    return (data?.quotes ?? [])
      .filter((q) => q.quoteType === "EQUITY" && q.symbol)
      .map((q) => ({
        symbol: q.symbol,
        name: q.longname ?? q.shortname ?? q.symbol,
        exchange: q.exchDisp ?? q.exchange ?? null,
        quoteType: q.quoteType,
        score: q.score ?? 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  async function getHolders(symbol) {
    const result = await quoteSummary(symbol, "institutionOwnership,majorHoldersBreakdown");
    const ownership = result?.institutionOwnership?.ownershipList ?? [];
    const breakdown = result?.majorHoldersBreakdown;

    const topHolders = [...ownership]
      .sort((a, b) => (b.pctHeld?.raw ?? 0) - (a.pctHeld?.raw ?? 0))
      .slice(0, 10)
      .map((h) => ({
        organization: h.organization,
        pctHeld: h.pctHeld?.raw ?? null,
        position: h.position?.raw ?? null,
        value: h.value?.raw ?? null,
        reportDate: h.reportDate?.raw ? h.reportDate.raw * 1000 : null,
      }));

    const asOf = topHolders.reduce((max, h) => (h.reportDate && h.reportDate > (max ?? 0) ? h.reportDate : max), null);

    return {
      asOf,
      topHolders,
      summary: breakdown
        ? {
            insidersPercentHeld: breakdown.insidersPercentHeld?.raw ?? null,
            institutionsPercentHeld: breakdown.institutionsPercentHeld?.raw ?? null,
            institutionsFloatPercentHeld: breakdown.institutionsFloatPercentHeld?.raw ?? null,
            institutionsCount: breakdown.institutionsCount?.raw ?? null,
          }
        : null,
    };
  }

  function shapeQuarter(h) {
    if (!h) return null;
    return {
      date: h.quarter?.raw ? h.quarter.raw * 1000 : null,
      period: h.period ?? null,
      epsActual: h.epsActual?.raw ?? null,
      epsEstimate: h.epsEstimate?.raw ?? null,
      epsDifference: h.epsDifference?.raw ?? null,
      surprisePercent: h.surprisePercent?.raw ?? null,
    };
  }

  async function getEarnings(symbol) {
    const result = await quoteSummary(symbol, "earningsHistory,calendarEvents");

    const history = [...(result?.earningsHistory?.history ?? [])].sort(
      (a, b) => (b.quarter?.raw ?? 0) - (a.quarter?.raw ?? 0)
    );
    const earningsCal = result?.calendarEvents?.earnings;
    const dates = earningsCal?.earningsDate ?? [];
    const nextReport = dates.length
      ? {
          dateStart: dates[0]?.raw ? dates[0].raw * 1000 : null,
          dateEnd: dates[1]?.raw ? dates[1].raw * 1000 : null,
          epsEstimate: earningsCal?.earningsAverage?.raw ?? null,
          epsLow: earningsCal?.earningsLow?.raw ?? null,
          epsHigh: earningsCal?.earningsHigh?.raw ?? null,
          revenueEstimate: earningsCal?.revenueAverage?.raw ?? null,
          revenueLow: earningsCal?.revenueLow?.raw ?? null,
          revenueHigh: earningsCal?.revenueHigh?.raw ?? null,
        }
      : null;

    return {
      lastReport: shapeQuarter(history[0]),
      nextReport,
      recentQuarters: history.slice(0, 4).map(shapeQuarter),
    };
  }

  return { name: "yahoo", getPriceHistory, searchTickers, getHolders, getEarnings };
}
