import { getJSON } from "./api.js";

function formatDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

function formatDateRange(startMs, endMs) {
  if (!startMs) return "—";
  if (!endMs || endMs === startMs) return formatDate(startMs);
  return `${formatDate(startMs)} – ${formatDate(endMs)}`;
}

function formatEps(v) {
  return v == null ? "—" : v.toFixed(2);
}

function formatSurprise(v) {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function formatMoney(v) {
  return v == null ? "—" : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function initEarningsPanel() {
  const titleEl = document.getElementById("earnings-title");
  const statusEl = document.getElementById("earnings-status");
  const nextDateEl = document.getElementById("earnings-next-date");
  const nextEstimatesEl = document.getElementById("earnings-next-estimates");
  const lastDateEl = document.getElementById("earnings-last-date");
  const lastDetailsEl = document.getElementById("earnings-last-details");
  const table = document.getElementById("earnings-table");
  const tbody = table.querySelector("tbody");
  const noteEl = document.getElementById("earnings-note");

  async function loadEarnings(symbol) {
    titleEl.textContent = `Earnings — ${symbol}`;
    statusEl.textContent = "Loading…";
    nextDateEl.textContent = "—";
    nextEstimatesEl.innerHTML = "";
    lastDateEl.textContent = "—";
    lastDetailsEl.innerHTML = "";
    tbody.innerHTML = "";
    noteEl.textContent = "";
    table.hidden = true;

    try {
      const data = await getJSON(`/api/earnings?symbol=${encodeURIComponent(symbol)}`);
      statusEl.textContent = "";
      table.hidden = false;

      if (data.nextReport) {
        nextDateEl.textContent = formatDateRange(data.nextReport.dateStart, data.nextReport.dateEnd);
        nextEstimatesEl.innerHTML = `
          <span>EPS est. <strong>${formatEps(data.nextReport.epsEstimate)}</strong></span>
          <span>Revenue est. <strong>${formatMoney(data.nextReport.revenueEstimate)}</strong></span>
        `;
      } else {
        nextDateEl.textContent = "No upcoming date announced.";
      }

      if (data.lastReport) {
        lastDateEl.textContent = formatDate(data.lastReport.date);
        lastDetailsEl.innerHTML = `
          <span>EPS actual <strong>${formatEps(data.lastReport.epsActual)}</strong></span>
          <span>EPS est. <strong>${formatEps(data.lastReport.epsEstimate)}</strong></span>
          <span>Surprise <strong>${formatSurprise(data.lastReport.surprisePercent)}</strong></span>
        `;
      } else {
        lastDateEl.textContent = "No past earnings reports available.";
      }

      if (data.recentQuarters.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No recent quarter data available.</td></tr>';
      } else {
        for (const q of data.recentQuarters) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${formatDate(q.date)}</td>
            <td>${formatEps(q.epsActual)}</td>
            <td>${formatEps(q.epsEstimate)}</td>
            <td>${formatSurprise(q.surprisePercent)}</td>
          `;
          tbody.appendChild(tr);
        }
      }

      noteEl.textContent = data.note;
    } catch (err) {
      table.hidden = true;
      statusEl.textContent = err.message.includes("not found")
        ? `No earnings data available for ${symbol}.`
        : `Couldn't load earnings data: ${err.message}`;
    }
  }

  return { loadEarnings };
}
