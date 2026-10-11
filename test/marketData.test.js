import { test } from "node:test";
import assert from "node:assert/strict";
import { createYahooProvider } from "../src/marketData/yahoo.js";
import { NotFoundError, setMarketDataProvider } from "../src/marketData/index.js";
import { fetchPrices } from "../src/prices.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sessionResponse(url) {
  if (url.includes("fc.yahoo.com")) {
    const res = new Response("", { status: 404 });
    res.headers.getSetCookie = () => ["A3=abc; Path=/", "B=def; Path=/"];
    return res;
  }
  if (url.includes("getcrumb")) return new Response("crumb1");
  return null;
}

// Routes session calls automatically; `handler(url, init)` serves everything else.
function makeProvider(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    url = String(url);
    calls.push(url);
    return sessionResponse(url) ?? handler(url, init);
  };
  return { provider: createYahooProvider({ fetchImpl, retries: 0 }), calls };
}

test("getPriceHistory drops null closes and converts timestamps", async () => {
  const { provider } = makeProvider(() =>
    json({
      chart: {
        result: [
          {
            meta: { symbol: "AAPL", currency: "USD", exchangeName: "NMS", regularMarketPrice: 3 },
            timestamp: [1, 2, 3],
            indicators: { quote: [{ close: [1.5, null, 3] }] },
          },
        ],
      },
    })
  );
  const r = await provider.getPriceHistory("AAPL", "1mo");
  assert.equal(r.symbol, "AAPL");
  assert.deepEqual(r.points, [
    { date: 1000, close: 1.5 },
    { date: 3000, close: 3 },
  ]);
});

test("getPriceHistory maps Not Found to NotFoundError", async () => {
  const { provider } = makeProvider(() =>
    json({ chart: { result: null, error: { code: "Not Found", description: "No data found" } } }, 404)
  );
  await assert.rejects(provider.getPriceHistory("ZZZZ"), NotFoundError);
});

test("searchTickers keeps EQUITY only and sorts by score", async () => {
  const { provider } = makeProvider(() =>
    json({
      quotes: [
        { symbol: "LOW", quoteType: "EQUITY", shortname: "Low", score: 1 },
        { symbol: "ETF1", quoteType: "ETF", score: 99 },
        { symbol: "HIGH", quoteType: "EQUITY", longname: "High Corp", exchDisp: "NASDAQ", score: 10 },
      ],
    })
  );
  const matches = await provider.searchTickers("x");
  assert.deepEqual(
    matches.map((m) => m.symbol),
    ["HIGH", "LOW"]
  );
  assert.equal(matches[0].name, "High Corp");
  assert.equal(matches[0].exchange, "NASDAQ");
});

test("getHolders returns the top 10 by pctHeld", async () => {
  const ownershipList = Array.from({ length: 12 }, (_, i) => ({
    organization: `Org${i}`,
    pctHeld: { raw: i / 100 },
    reportDate: { raw: 100 + i },
  }));
  const { provider } = makeProvider(() =>
    json({
      quoteSummary: {
        result: [
          {
            institutionOwnership: { ownershipList },
            majorHoldersBreakdown: { insidersPercentHeld: { raw: 0.1 } },
          },
        ],
      },
    })
  );
  const r = await provider.getHolders("AAPL");
  assert.equal(r.topHolders.length, 10);
  assert.equal(r.topHolders[0].organization, "Org11");
  assert.equal(r.topHolders[9].organization, "Org2");
  assert.equal(r.summary.insidersPercentHeld, 0.1);
  assert.equal(r.summary.institutionsCount, null);
  assert.equal(r.asOf, 111_000);
});

test("quoteSummary Not Found becomes NotFoundError", async () => {
  const { provider } = makeProvider(() =>
    json({ quoteSummary: { result: null, error: { code: "Not Found", description: "Quote not found" } } }, 404)
  );
  await assert.rejects(provider.getEarnings("ZZZZ"), (err) => err instanceof NotFoundError);
});

test("Unauthorized refreshes the crumb once and retries", async () => {
  let summaryCalls = 0;
  const { provider, calls } = makeProvider(() => {
    summaryCalls++;
    if (summaryCalls === 1) {
      return json(
        { quoteSummary: { result: null, error: { code: "Unauthorized", description: "Invalid Crumb" } } },
        401
      );
    }
    return json({ quoteSummary: { result: [{ earningsHistory: { history: [] } }] } });
  });
  const r = await provider.getEarnings("AAPL");
  assert.equal(r.lastReport, null);
  assert.equal(r.nextReport, null);
  assert.equal(summaryCalls, 2);
  assert.equal(calls.filter((u) => u.includes("getcrumb")).length, 2);
});

test("persistent Unauthorized gives up after one retry", async () => {
  let summaryCalls = 0;
  const { provider } = makeProvider(() => {
    summaryCalls++;
    return json({ quoteSummary: { result: null, error: { code: "Unauthorized", description: "Invalid Crumb" } } }, 401);
  });
  await assert.rejects(provider.getHolders("AAPL"), /Invalid Crumb/);
  assert.equal(summaryCalls, 2);
});

test("setMarketDataProvider changes what fetchPrices returns", async () => {
  const fake = {
    name: "fake",
    getPriceHistory: async (symbol, range) => ({ symbol, currency: "USD", points: [], range }),
  };
  setMarketDataProvider(fake);
  try {
    const r = await fetchPrices("MSFT", "5d");
    assert.equal(r.symbol, "MSFT");
    assert.equal(r.range, "5d");
  } finally {
    setMarketDataProvider(null);
  }
});
