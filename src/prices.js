// Unofficial Yahoo Finance chart endpoint - no API key required.
export async function fetchPrices(symbol, range = "1mo", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ma-dashboard/0.1)" },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance request failed: ${res.status}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const err = data?.chart?.error?.description || "No data returned";
    throw new Error(err);
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
