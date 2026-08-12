import { getJSON } from "./api.js";

function formatPct(raw) {
  return raw == null ? "—" : `${(raw * 100).toFixed(1)}%`;
}

function formatDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

export function initHoldersPanel() {
  const titleEl = document.getElementById("holders-title");
  const statusEl = document.getElementById("holders-status");
  const summaryEl = document.getElementById("holders-summary");
  const table = document.getElementById("holders-table");
  const tbody = table.querySelector("tbody");
  const noteEl = document.getElementById("holders-note");

  async function loadHolders(symbol) {
    titleEl.textContent = `Institutional holders — ${symbol}`;
    statusEl.textContent = "Loading…";
    summaryEl.innerHTML = "";
    tbody.innerHTML = "";
    noteEl.textContent = "";
    table.hidden = true;

    try {
      const data = await getJSON(`/api/holders?symbol=${encodeURIComponent(symbol)}`);
      statusEl.textContent = "";
      table.hidden = false;

      if (data.summary) {
        summaryEl.innerHTML = `
          <span>Institutions hold <strong>${formatPct(data.summary.institutionsPercentHeld)}</strong>
          across ${data.summary.institutionsCount ?? "—"} holders</span>
          <span>Insiders hold <strong>${formatPct(data.summary.insidersPercentHeld)}</strong></span>
        `;
      }

      if (data.topHolders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No institutional holder data available.</td></tr>';
      } else {
        for (const h of data.topHolders) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${h.organization}</td>
            <td>${formatPct(h.pctHeld)}</td>
            <td>${h.position?.toLocaleString() ?? "—"}</td>
            <td>${formatDate(h.reportDate)}</td>
          `;
          tbody.appendChild(tr);
        }
      }

      noteEl.textContent = data.note;
    } catch (err) {
      table.hidden = true;
      statusEl.textContent = err.message.includes("not found")
        ? `No institutional holder data available for ${symbol}.`
        : `Couldn't load holder data: ${err.message}`;
    }
  }

  return { loadHolders };
}
