import { createCache } from "./cache.js";
import { fetchQuoteSummary } from "./yahooSession.js";

const holdersCache = createCache({ ttlMs: 6 * 60 * 60_000, maxEntries: 200 });

const APPROXIMATION_NOTE =
  "Institutional ownership (broad, from Yahoo Finance) — includes index/mutual funds and asset managers generally, not limited to private equity or VC.";

export async function getInstitutionalHolders(symbol) {
  const key = symbol.toUpperCase();
  return holdersCache.getOrSet(key, async () => {
    const result = await fetchQuoteSummary(key, "institutionOwnership,majorHoldersBreakdown");
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
      symbol: key,
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
      note: APPROXIMATION_NOTE,
    };
  });
}
