import { getMarketDataProvider } from "./marketData/index.js";

export async function fetchPrices(symbol, range = "1mo", interval = "1d") {
  return getMarketDataProvider().getPriceHistory(symbol, range, interval);
}
