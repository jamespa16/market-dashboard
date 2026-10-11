import { getJSON } from "./api.js";

const SOURCE_LABELS = { "google-news": "Google News", "sec-edgar": "SEC EDGAR" };
const CONSIDERATION_LABELS = { cash: "Cash", stock: "Stock", mixed: "Cash & stock" };
const SIDE_LABELS = { acquirer: "Acquirer", target: "Target" };
const PAGE_SIZE = 15;

function formatDate(ms) {
  if (!ms) return "Date unknown";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Only https URLs become links; anything else (relative, javascript:, http:, malformed) is shown as plain text.
function safeHref(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function formatCompactUsd(value) {
  if (!isFiniteNumber(value)) return null;
  if (value >= 1e9) return `$${Number((value / 1e9).toFixed(1))}B`;
  if (value >= 1e6) return `$${Number((value / 1e6).toFixed(1))}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

function partyLabel(party) {
  return party.ticker ? `${party.name} (${party.ticker})` : party.name;
}

function renderHeadline({ acquirer, target }) {
  if (!acquirer?.name || !target?.name) return "";
  return `<div class="deal-headline">${escapeHtml(partyLabel(acquirer))} <span class="deal-arrow">→</span> ${escapeHtml(
    partyLabel(target)
  )}</div>`;
}

function renderTerms(deal) {
  const items = [];
  const value = formatCompactUsd(deal.dealValueUsd);
  if (value) items.push(`<span class="term">${escapeHtml(value)}</span>`);
  if (isFiniteNumber(deal.perSharePrice))
    items.push(`<span class="term">${escapeHtml(`$${deal.perSharePrice.toFixed(2)}/share`)}</span>`);
  const consideration = CONSIDERATION_LABELS[deal.consideration];
  if (consideration) items.push(`<span class="badge badge-consideration">${escapeHtml(consideration)}</span>`);
  if (deal.expectedClose)
    items.push(`<span class="term term-muted">${escapeHtml(`Expected close: ${deal.expectedClose}`)}</span>`);
  return items.length ? `<div class="deal-terms">${items.join("")}</div>` : "";
}

function renderAdviserBadge(adviser) {
  const classes = adviser.role === "legal" ? "badge badge-adviser badge-legal" : "badge badge-adviser";
  const side = SIDE_LABELS[adviser.side];
  const title = side ? ` title="${escapeHtml(`Advises ${side}`)}"` : "";
  return `<span class="${classes}"${title}>${escapeHtml(adviser.name)}</span>`;
}

function sourceLabel(source) {
  if (source.type === "sec-edgar") return `SEC ${source.form ?? "filing"}`;
  return source.sourceName || SOURCE_LABELS[source.type] || source.type || "Source";
}

function renderSourceLinks(sources) {
  if (sources.length === 0) return "";
  const items = sources.map((s) => {
    const label = escapeHtml(sourceLabel(s));
    const href = safeHref(s.link);
    return href
      ? `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a></li>`
      : `<li>${label}</li>`;
  });
  return `<ul class="deal-sources">${items.join("")}</ul>`;
}

function renderCompanyChip(company) {
  return `<button class="company-chip" data-name="${escapeHtml(company.name)}" data-ticker="${escapeHtml(
    company.ticker
  )}">${escapeHtml(company.name)}</button>`;
}

export function initDealsPanel({ onCompanyClick } = {}) {
  const acquirerInput = document.getElementById("filter-acquirer");
  const adviserSelect = document.getElementById("filter-adviser");
  const unconfirmedToggle = document.getElementById("filter-unconfirmed");
  const applyBtn = document.getElementById("apply-filters");
  const clearBtn = document.getElementById("clear-filters");
  const statusEl = document.getElementById("deals-status");
  const hiddenNoteEl = document.getElementById("deals-hidden-note");
  const listEl = document.getElementById("deals-list");
  const loadMoreBtn = document.getElementById("deals-load-more");

  let limit = PAGE_SIZE;

  function renderDealCard(deal) {
    const li = document.createElement("li");
    const unconfirmed = deal.confidence === "low";
    li.className = unconfirmed ? "deal-card deal-card-unconfirmed" : "deal-card";

    const sources = deal.sources ?? [];
    const advisers = (deal.advisers ?? []).filter((a) => a?.name);
    const companies = (deal.companies ?? []).filter((c) => c?.name);

    const sourceBadges = [...new Set(sources.map((s) => s.type))]
      .map((type) => `<span class="badge badge-source">${escapeHtml(SOURCE_LABELS[type] ?? type)}</span>`)
      .join("");
    const href = safeHref(deal.primaryLink);
    const titleHtml = href
      ? `<a class="deal-title" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(deal.title)}</a>`
      : `<span class="deal-title">${escapeHtml(deal.title)}</span>`;

    li.innerHTML = `
      <div class="deal-meta">
        <span class="deal-date">${formatDate(deal.publishedAt)}</span>
        ${unconfirmed ? '<span class="badge badge-unconfirmed">Unconfirmed</span>' : ""}
        ${sourceBadges}
        ${advisers.map(renderAdviserBadge).join("")}
      </div>
      ${renderHeadline(deal)}
      ${titleHtml}
      ${renderTerms(deal)}
      <p class="deal-summary">${escapeHtml(deal.summary)}</p>
      ${renderSourceLinks(sources)}
      <div class="deal-companies">${companies.map(renderCompanyChip).join("")}</div>
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

  function updateHiddenNote(hiddenCount) {
    const count = Number(hiddenCount) || 0;
    hiddenNoteEl.hidden = unconfirmedToggle.checked || count <= 0;
    hiddenNoteEl.textContent = `${count} unconfirmed ${count === 1 ? "deal" : "deals"} hidden`;
  }

  async function loadDeals() {
    statusEl.textContent = "Loading…";
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (acquirerInput.value.trim()) params.set("acquirer", acquirerInput.value.trim());
      if (adviserSelect.value) params.set("adviser", adviserSelect.value);
      if (unconfirmedToggle.checked) params.set("unconfirmed", "1");

      const data = await getJSON(`/api/deals?${params}`);
      const deals = data.deals ?? [];
      statusEl.innerHTML = renderSourceBanner(data.sources ?? []);
      updateHiddenNote(data.hiddenCount);
      listEl.innerHTML = "";
      if (deals.length === 0) {
        listEl.innerHTML = '<li class="empty-state">No deals match your filters.</li>';
      } else {
        for (const deal of deals) listEl.appendChild(renderDealCard(deal));
      }
      loadMoreBtn.hidden = deals.length < limit;
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
  unconfirmedToggle.addEventListener("change", () => {
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
