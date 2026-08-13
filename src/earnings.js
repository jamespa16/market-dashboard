import { createCache } from "./cache.js";
import { fetchQuoteSummary } from "./yahooSession.js";

const earningsCache = createCache({ ttlMs: 6 * 60 * 60_000, maxEntries: 200 });

const NOTE =
  "Earnings dates and EPS/revenue estimates from Yahoo Finance. The upcoming date is often a 1–2 day estimated window until confirmed by the company.";

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

export async function getEarnings(symbol) {
  const key = symbol.toUpperCase();
  return earningsCache.getOrSet(key, async () => {
    const result = await fetchQuoteSummary(key, "earningsHistory,calendarEvents");

    const history = [...(result?.earningsHistory?.history ?? [])].sort(
      (a, b) => (b.quarter?.raw ?? 0) - (a.quarter?.raw ?? 0)
    );
    const lastReport = shapeQuarter(history[0]);
    const recentQuarters = history.slice(0, 4).map(shapeQuarter);

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

    return { symbol: key, asOf: Date.now(), lastReport, nextReport, recentQuarters, note: NOTE };
  });
}
