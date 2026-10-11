import { createYahooProvider } from "./yahoo.js";

/**
 * @typedef {Object} MarketDataProvider
 * @property {string} name
 * @property {(symbol: string, range?: string, interval?: string) => Promise<{
 *   symbol: string, currency: string, exchangeName: string, regularMarketPrice: number,
 *   points: { date: number, close: number }[] }>} getPriceHistory
 * @property {(query: string) => Promise<{ symbol: string, name: string, exchange: string|null,
 *   quoteType: string, score: number }[]>} searchTickers  Equity matches only, best score first.
 * @property {(symbol: string) => Promise<{ asOf: number|null, topHolders: object[], summary: object|null }>} getHolders
 * @property {(symbol: string) => Promise<{ lastReport: object|null, nextReport: object|null,
 *   recentQuarters: object[] }>} getEarnings
 *
 * Providers throw NotFoundError for unknown symbols and plain Errors for upstream failures. Caching,
 * symbol upper-casing and the response notes live in the callers (prices.js, holders.js, ...).
 * A keyed provider (e.g. API key from an env var) can be swapped in later via setMarketDataProvider().
 */

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
  }
}

let provider = null;

// Created lazily: yahoo.js imports NotFoundError from this module.
export function getMarketDataProvider() {
  provider ??= createYahooProvider();
  return provider;
}

export function setMarketDataProvider(p) {
  provider = p;
}
