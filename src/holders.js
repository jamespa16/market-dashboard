import { createCache } from "./cache.js";

const USER_AGENT = "Mozilla/5.0 (compatible; ma-dashboard/0.1)";
const SESSION_MAX_AGE_MS = 60 * 60_000;
const holdersCache = createCache({ ttlMs: 6 * 60 * 60_000, maxEntries: 200 });

export class NotFoundError extends Error {}

let session = { cookie: null, crumb: null, fetchedAt: 0 };

function extractCookie(res) {
  // Node's fetch exposes multiple Set-Cookie headers via getSetCookie().
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

async function ensureYahooSession(force = false) {
  const isFresh = session.cookie && session.crumb && Date.now() - session.fetchedAt < SESSION_MAX_AGE_MS;
  if (isFresh && !force) return session;

  const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": USER_AGENT } });
  const cookie = extractCookie(cookieRes);
  if (!cookie) throw new Error("Failed to obtain Yahoo Finance session cookie");

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": USER_AGENT, Cookie: cookie },
  });
  if (!crumbRes.ok) throw new Error(`Failed to obtain Yahoo Finance crumb: ${crumbRes.status}`);
  const crumb = await crumbRes.text();

  session = { cookie, crumb, fetchedAt: Date.now() };
  return session;
}

async function fetchQuoteSummary(symbol, attempt = 0) {
  const { cookie, crumb } = await ensureYahooSession();
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=institutionOwnership,majorHoldersBreakdown&crumb=${encodeURIComponent(crumb)}`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Cookie: cookie } });
  const data = await res.json();
  const error = data?.quoteSummary?.error;

  if (error?.code === "Unauthorized" && attempt === 0) {
    await ensureYahooSession(true);
    return fetchQuoteSummary(symbol, attempt + 1);
  }
  if (error?.code === "Not Found") {
    throw new NotFoundError(error.description ?? `No data for symbol: ${symbol}`);
  }
  if (error) {
    throw new Error(error.description ?? "Yahoo Finance quoteSummary request failed");
  }
  if (!res.ok) {
    throw new Error(`Yahoo Finance quoteSummary failed: ${res.status}`);
  }

  return data.quoteSummary.result[0];
}

const APPROXIMATION_NOTE =
  "Institutional ownership (broad, from Yahoo Finance) — includes index/mutual funds and asset managers generally, not limited to private equity or VC.";

export async function getInstitutionalHolders(symbol) {
  const key = symbol.toUpperCase();
  return holdersCache.getOrSet(key, async () => {
    const result = await fetchQuoteSummary(key);
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
