import { getJSON } from "./api.js";
import { initChartPanel } from "./chart.js";
import { initDealsPanel } from "./deals.js";
import { initHoldersPanel } from "./holders.js";
import { initEarningsPanel } from "./earnings.js";

const holders = initHoldersPanel();
const earnings = initEarningsPanel();

const chart = initChartPanel({
  onSymbolLoaded: (symbol) => {
    holders.loadHolders(symbol);
    earnings.loadEarnings(symbol);
  },
});

initDealsPanel({
  onCompanyClick: async ({ name, ticker }) => {
    let symbol = ticker;
    if (!symbol) {
      try {
        const { best } = await getJSON(`/api/tickers/resolve?q=${encodeURIComponent(name)}`);
        symbol = best?.symbol ?? null;
      } catch {
        symbol = null;
      }
    }
    if (!symbol) return false;

    document.getElementById("symbol").value = symbol;
    await chart.loadSymbol(symbol);
    document.getElementById("chart-section").scrollIntoView({ behavior: "smooth" });
    return true;
  },
});

chart.loadSymbol("NVDA");
