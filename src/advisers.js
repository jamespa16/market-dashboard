export const ADVISER_FIRMS = [
  "Goldman Sachs",
  "Morgan Stanley",
  "J.P. Morgan",
  "JPMorgan",
  "Lazard",
  "Evercore",
  "Centerview Partners",
  "Bank of America",
  "BofA Securities",
  "Citigroup",
  "Barclays",
  "Credit Suisse",
  "UBS",
  "Deutsche Bank",
  "Wells Fargo",
  "Jefferies",
  "Houlihan Lokey",
  "Rothschild & Co",
  "Moelis & Company",
  "PJT Partners",
  "Perella Weinberg Partners",
  "Guggenheim Securities",
  "RBC Capital Markets",
  "Raymond James",
  "William Blair",
  "Piper Sandler",
  "Robert W. Baird",
  "Stifel",
  "Qatalyst Partners",
  "Allen & Company",
  "Greenhill & Co",
];

// Longest names first so e.g. "Centerview Partners" wins over a shorter alias.
const SORTED_FIRMS = [...ADVISER_FIRMS].sort((a, b) => b.length - a.length);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectAdvisers(text) {
  if (!text) return [];
  const found = new Map();
  for (const firm of SORTED_FIRMS) {
    const re = new RegExp(`\\b${escapeRegExp(firm)}\\b`, "i");
    const match = text.match(re);
    if (match && !found.has(firm)) {
      found.set(firm, { name: firm, matchedText: match[0] });
    }
  }
  return [...found.values()];
}
