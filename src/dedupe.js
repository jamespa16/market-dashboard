// Card filters. Grouping/merging lives in src/pipeline.js (CIK-pair based).

/**
 * @param {object[]} deals cards in the /api/deals shape
 * @param {{ acquirer?: string, adviser?: string }} filters case-insensitive substring matches
 */
export function filterDeals(deals, { acquirer, adviser } = {}) {
  let out = deals;
  if (acquirer) {
    const needle = acquirer.toLowerCase();
    out = out.filter(
      (d) =>
        d.acquirer?.name?.toLowerCase().includes(needle) ||
        d.companies.some((c) => c.name.toLowerCase().includes(needle)) ||
        d.title.toLowerCase().includes(needle) ||
        d.summary.toLowerCase().includes(needle)
    );
  }
  if (adviser) {
    const needle = adviser.toLowerCase();
    out = out.filter((d) => d.advisers.some((a) => a.name.toLowerCase().includes(needle)));
  }
  return out;
}
