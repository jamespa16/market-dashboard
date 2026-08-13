import { getJSON } from "./api.js";

const SOURCE_LABELS = { "google-news": "Google News", "sec-edgar": "SEC EDGAR" };
const PAGE_SIZE = 15;

function formatDate(ms) {
  if (!ms) return "Date unknown";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function initDealsPanel({ onCompanyClick } = {}) {
  const acquirerInput = document.getElementById("filter-acquirer");
  const adviserSelect = document.getElementById("filter-adviser");
  const applyBtn = document.getElementById("apply-filters");
  const clearBtn = document.getElementById("clear-filters");
  const statusEl = document.getElementById("deals-status");
  const listEl = document.getElementById("deals-list");
  const loadMoreBtn = document.getElementById("deals-load-more");

  let limit = PAGE_SIZE;

  function renderDealCard(deal) {
    const li = document.createElement("li");
    li.className = "deal-card";

    const sourceBadges = deal.sources
      .map((s) => `<span class="badge badge-source">${SOURCE_LABELS[s.type] ?? s.type}</span>`)
      .join("");
    const adviserBadges = deal.advisers
      .map((a) => `<span class="badge badge-adviser">${escapeHtml(a.name)}</span>`)
      .join("");
    const companyChips = deal.companies
      .map(
        (c) =>
          `<button class="company-chip" data-name="${escapeHtml(c.name)}" data-ticker="${c.ticker ?? ""}">${escapeHtml(
            c.name
          )}</button>`
      )
      .join("");

    li.innerHTML = `
      <div class="deal-meta">
        <span class="deal-date">${formatDate(deal.publishedAt)}</span>
        ${sourceBadges}
        ${adviserBadges}
      </div>
      <a class="deal-title" href="${deal.primaryLink}" target="_blank" rel="noopener">${escapeHtml(deal.title)}</a>
      <p class="deal-summary">${escapeHtml(deal.summary)}</p>
      <div class="deal-companies">${companyChips}</div>
    `;

    li.querySelectorAll(".company-chip").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const name = chip.dataset.name;
        const ticker = chip.dataset.ticker || null;
        chip.classList.add("resolving");
        const resolved = await onCompanyClick?.({ name, ticker });
        chip.classList.remove("resolving");
        if (resolved === false) {
          chip.classList.add("unresolved");
          chip.disabled = true;
          chip.title = "No ticker found for this company";
          chip.textContent = `${name} — no ticker`;
        }
      });
    });

    return li;
  }

  function renderSourceBanner(sources) {
    const failed = sources.filter((s) => !s.ok);
    if (failed.length === 0) return "";
    const names = failed.map((s) => SOURCE_LABELS[s.name] ?? s.name).join(", ");
    return `<div class="degradation-banner">${escapeHtml(names)} unavailable right now — showing results from other sources.</div>`;
  }

  async function loadDeals() {
    statusEl.textContent = "Loading…";
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (acquirerInput.value.trim()) params.set("acquirer", acquirerInput.value.trim());
      if (adviserSelect.value) params.set("adviser", adviserSelect.value);

      const data = await getJSON(`/api/deals?${params}`);
      statusEl.innerHTML = renderSourceBanner(data.sources);
      listEl.innerHTML = "";
      if (data.deals.length === 0) {
        listEl.innerHTML = '<li class="empty-state">No deals match your filters.</li>';
      } else {
        for (const deal of data.deals) listEl.appendChild(renderDealCard(deal));
      }
      loadMoreBtn.hidden = data.deals.length < limit;
    } catch (err) {
      statusEl.textContent = err.message;
    }
  }

  async function loadAdvisers() {
    try {
      const { advisers } = await getJSON("/api/deals/advisers");
      for (const name of advisers) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        adviserSelect.appendChild(opt);
      }
    } catch {
      // Non-critical — the dropdown just stays at "Any adviser".
    }
  }

  applyBtn.addEventListener("click", () => {
    limit = PAGE_SIZE;
    loadDeals();
  });
  clearBtn.addEventListener("click", () => {
    acquirerInput.value = "";
    adviserSelect.value = "";
    limit = PAGE_SIZE;
    loadDeals();
  });
  loadMoreBtn.addEventListener("click", () => {
    limit += PAGE_SIZE;
    loadDeals();
  });
  acquirerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyBtn.click();
  });

  loadAdvisers();
  loadDeals();

  return { refresh: loadDeals };
}
