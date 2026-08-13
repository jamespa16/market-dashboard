import { fetchPrices } from "./prices.js";
import { getDeals } from "./feeds.js";
import { ADVISER_FIRMS } from "./advisers.js";
import { resolveTicker } from "./tickers.js";
import { getInstitutionalHolders } from "./holders.js";
import { getEarnings } from "./earnings.js";
import { NotFoundError } from "./yahooSession.js";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handlePrices(req, res, url) {
  const symbol = (url.searchParams.get("symbol") || "NVDA").toUpperCase();
  const range = url.searchParams.get("range") || "1mo";
  try {
    sendJson(res, 200, await fetchPrices(symbol, range));
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}

async function handleDeals(req, res, url) {
  const acquirer = url.searchParams.get("acquirer") || undefined;
  const adviser = url.searchParams.get("adviser") || undefined;
  const limit = Number(url.searchParams.get("limit")) || 30;
  const result = await getDeals({ acquirer, adviser, limit });
  sendJson(res, 200, result);
}

async function handleAdvisersList(req, res) {
  sendJson(res, 200, { advisers: ADVISER_FIRMS });
}

async function handleTickerResolve(req, res, url) {
  const q = url.searchParams.get("q");
  if (!q) return sendJson(res, 400, { error: "Missing required query param: q" });
  try {
    sendJson(res, 200, await resolveTicker(q));
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}

async function handleHolders(req, res, url) {
  const symbol = url.searchParams.get("symbol");
  if (!symbol) return sendJson(res, 400, { error: "Missing required query param: symbol" });
  try {
    sendJson(res, 200, await getInstitutionalHolders(symbol));
  } catch (err) {
    if (err instanceof NotFoundError) {
      return sendJson(res, 404, { error: err.message });
    }
    sendJson(res, 502, { error: err.message });
  }
}

async function handleEarnings(req, res, url) {
  const symbol = url.searchParams.get("symbol");
  if (!symbol) return sendJson(res, 400, { error: "Missing required query param: symbol" });
  try {
    sendJson(res, 200, await getEarnings(symbol));
  } catch (err) {
    if (err instanceof NotFoundError) {
      return sendJson(res, 404, { error: err.message });
    }
    sendJson(res, 502, { error: err.message });
  }
}

const ROUTES = [
  { pathname: "/api/prices", handler: handlePrices },
  { pathname: "/api/deals", handler: handleDeals },
  { pathname: "/api/deals/advisers", handler: handleAdvisersList },
  { pathname: "/api/tickers/resolve", handler: handleTickerResolve },
  { pathname: "/api/holders", handler: handleHolders },
  { pathname: "/api/earnings", handler: handleEarnings },
];

export async function handleApi(req, res, url) {
  const route = ROUTES.find((r) => r.pathname === url.pathname);
  if (!route) return false;
  await route.handler(req, res, url);
  return true;
}
