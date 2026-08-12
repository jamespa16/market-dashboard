import { getJSON } from "./api.js";

export function initChartPanel({ onSymbolLoaded } = {}) {
  const symbolInput = document.getElementById("symbol");
  const loadBtn = document.getElementById("load");
  const statusEl = document.getElementById("status");
  const titleEl = document.getElementById("chart-title");
  const priceEl = document.getElementById("latest-price");
  const canvas = document.getElementById("price-chart");

  let chart;

  async function loadSymbol(symbol) {
    statusEl.textContent = "Loading…";
    try {
      const data = await getJSON(`/api/prices?symbol=${encodeURIComponent(symbol)}&range=1mo`);
      render(data);
      statusEl.textContent = "";
      onSymbolLoaded?.(data.symbol);
    } catch (err) {
      statusEl.textContent = err.message;
    }
  }

  function render(data) {
    titleEl.textContent = `${data.symbol} — last month`;
    priceEl.textContent = data.regularMarketPrice
      ? `${data.regularMarketPrice.toFixed(2)} ${data.currency}`
      : "";

    const labels = data.points.map((p) =>
      new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    );
    const closes = data.points.map((p) => p.close);

    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `${data.symbol} close (${data.currency})`,
            data: closes,
            borderColor: "#4f8cff",
            backgroundColor: "rgba(79,140,255,0.15)",
            fill: true,
            tension: 0.25,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "#262a33" }, ticks: { color: "#8a8f98" } },
          y: { grid: { color: "#262a33" }, ticks: { color: "#8a8f98" } },
        },
      },
    });
  }

  loadBtn.addEventListener("click", () => loadSymbol(symbolInput.value.trim() || "NVDA"));
  symbolInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadBtn.click();
  });

  return { loadSymbol };
}
