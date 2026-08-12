export function cleanGoogleTitle(rawTitle) {
  return rawTitle
    .replace(/\s+-\s+[^-]+$/, "")
    .replace(/^(?:Watch|Exclusive|Breaking|Report|Update|Video)\s*:?\s+/i, "")
    .trim();
}

const PAIR_PATTERNS = [
  // "X Agrees/Announces/Signs/Reaches (an Agreement/Deal) to Acquire Y" —
  // tried before the generic pattern below so verbs like "Agrees" or
  // "Announces" don't get swallowed into the acquirer's name.
  /^(.+?)\s+(?:agrees?|announces|signs|reaches|enters into)\s+(?:an?\s+)?(?:agreement|deal)?\s*to\s+acquire\s+(.+?)(?:\s+for\s+.+)?$/i,
  /^(.+?)\s+to\s+acquire\s+(.+?)(?:\s+for\s+.+)?$/i,
  /^(.+?)\s+to\s+(?:buy|purchase)\s+(.+?)(?:\s+for\s+.+)?$/i,
  /^(.+?)\s+(?:acquires|completes acquisition of)\s+(.+)$/i,
  /^(.+?)\s+and\s+(.+?)\s+(?:to merge|announce merger|agree to merge)$/i,
];

// Headline clauses often trail off into deal-size/context info that a
// non-greedy regex alone won't cut ("... in a $2.3 Billion Deal", "... for
// $470 Million"). Strip that off before treating the remainder as a name.
function stripTrailingDealContext(phrase) {
  return phrase
    .replace(/\s+(?:for|in)\s+(?:up to\s+|approximately\s+|about\s+)?\$[\d,.]+\s*(?:billion|million|bn|m)?\b.*$/i, "")
    .trim();
}

const FILLER_WORDS = new Set(["and", "the", "of", "for", "in", "on", "at", "to", "from", "after", "amid", "its", "a", "an", "with", "by"]);

// Best-effort sanity check that an extracted phrase reads like a company
// name rather than a fragment of ordinary headline prose (verbs, sentence
// tails, price clauses). Deliberately conservative: better to show no chip
// than a chip that can never resolve to a ticker.
export function looksLikeCompanyName(name) {
  if (!name) return false;
  const words = name.trim().split(/\s+/);
  if (words.length === 0 || words.length > 6) return false;
  if (/[\d$%]/.test(name)) return false;
  return words.every((w) => FILLER_WORDS.has(w.toLowerCase()) || /^[A-Z0-9]/.test(w));
}

export function extractCompanyPair(title) {
  for (const pattern of PAIR_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      return {
        acquirer: stripTrailingDealContext(match[1].trim()),
        target: stripTrailingDealContext(match[2].trim()),
      };
    }
  }
  return { acquirer: null, target: null };
}

export function cleanSecDisplayName(displayName) {
  return displayName.replace(/\s*\(CIK\s*\d+\)\s*$/i, "").replace(/\s*\([A-Z.]{1,6}\)\s*$/, "").trim();
}

export function extractTickerFromSecName(displayName) {
  const match = displayName.match(/\(([A-Z.]{1,6})\)\s*\(CIK/);
  return match ? match[1] : null;
}

export function buildSecFilingUrl({ cik, adsh, primaryDoc }) {
  const cikNoZeros = String(Number(cik));
  const adshNoDashes = adsh.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${adshNoDashes}/${primaryDoc}`;
}
