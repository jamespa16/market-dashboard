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
  "Keefe, Bruyette & Woods",
  "KBW",
  "Truist Securities",
  "Truist",
  "TD Cowen",
  "TD Securities",
  "Cowen",
  "Stephens Inc",
  "Janney Montgomery Scott",
  "Janney",
  "D.A. Davidson",
  "Hovde Group",
  "Ardea Partners",
  "Leerink Partners",
  "SVB Leerink",
  "Cantor Fitzgerald",
  "Cantor",
  "Needham & Company",
  "Oppenheimer & Co",
  "BMO Capital Markets",
  "BMO",
  "Mizuho",
  "Nomura",
  "HSBC",
  "Santander",
  "SMBC Nikko",
  "SMBC",
  "BNP Paribas",
  "Macquarie Capital",
  "Macquarie",
  "Societe Generale",
  "Citizens Capital Markets",
  "Baird",
  "Canaccord Genuity",
  "H.C. Wainwright",
  "Craig-Hallum Capital Group",
  "Craig-Hallum",
  "Sandler O'Neill",
  "Compass Point",
  "LionTree",
  "Ducera Partners",
  "Harris Williams",
  "Lincoln International",
  "Kroll",
  "Duff & Phelps",
  "Wolfe Capital Markets",
  "Bourne Capital Partners",
  "Tidal Partners",
  "Houlihan Capital",
  "Mediobanca",
  "Jefferies Financial",
  "Citi",
];

/**
 * Law firms commonly named as deal counsel. `name` is the canonical form, `aliases` are other spellings.
 * Matching is tolerant of commas, "&" vs "and", case and "LLP"/"LLC" suffixes (which are simply not required).
 */
export const LAW_FIRMS = [
  { name: "Wachtell, Lipton, Rosen & Katz", aliases: ["Wachtell Lipton", "Wachtell"] },
  { name: "Skadden, Arps, Slate, Meagher & Flom", aliases: ["Skadden Arps", "Skadden"] },
  { name: "Sullivan & Cromwell", aliases: [] },
  { name: "Davis Polk & Wardwell", aliases: ["Davis Polk"] },
  { name: "Kirkland & Ellis", aliases: [] },
  { name: "Latham & Watkins", aliases: [] },
  { name: "Cravath, Swaine & Moore", aliases: ["Cravath"] },
  { name: "Simpson Thacher & Bartlett", aliases: ["Simpson Thacher"] },
  { name: "Paul, Weiss, Rifkind, Wharton & Garrison", aliases: ["Paul Weiss"] },
  { name: "Cleary Gottlieb Steen & Hamilton", aliases: ["Cleary Gottlieb"] },
  { name: "Debevoise & Plimpton", aliases: ["Debevoise"] },
  { name: "Freshfields Bruckhaus Deringer", aliases: ["Freshfields"] },
  { name: "Gibson, Dunn & Crutcher", aliases: ["Gibson Dunn"] },
  { name: "Weil, Gotshal & Manges", aliases: ["Weil Gotshal"] },
  { name: "Sidley Austin", aliases: [] },
  { name: "Jones Day", aliases: [] },
  { name: "Wilson Sonsini Goodrich & Rosati", aliases: ["Wilson Sonsini"] },
  { name: "Goodwin Procter", aliases: [] },
  { name: "Cooley", aliases: [] },
  { name: "Ropes & Gray", aliases: [] },
  { name: "Fried, Frank, Harris, Shriver & Jacobson", aliases: ["Fried Frank"] },
  { name: "Milbank", aliases: ["Milbank Tweed"] },
  { name: "Willkie Farr & Gallagher", aliases: ["Willkie Farr", "Willkie"] },
  { name: "White & Case", aliases: [] },
  { name: "A&O Shearman", aliases: ["Allen & Overy Shearman Sterling", "Shearman & Sterling", "Allen & Overy"] },
  { name: "Covington & Burling", aliases: ["Covington"] },
  { name: "Hogan Lovells", aliases: [] },
  { name: "Morgan, Lewis & Bockius", aliases: ["Morgan Lewis"] },
  { name: "Vinson & Elkins", aliases: [] },
  { name: "Baker Botts", aliases: [] },
  { name: "Mayer Brown", aliases: [] },
  { name: "Linklaters", aliases: [] },
  { name: "Clifford Chance", aliases: [] },
  { name: "Dechert", aliases: [] },
  { name: "Proskauer Rose", aliases: ["Proskauer"] },
  { name: "Akin Gump Strauss Hauer & Feld", aliases: ["Akin Gump"] },
  { name: "Squire Patton Boggs", aliases: [] },
  { name: "Alston & Bird", aliases: [] },
  { name: "King & Spalding", aliases: [] },
  { name: "Bass, Berry & Sims", aliases: ["Bass Berry"] },
  { name: "Holland & Knight", aliases: [] },
  { name: "Hunton Andrews Kurth", aliases: [] },
  { name: "Reed Smith", aliases: [] },
  { name: "K&L Gates", aliases: [] },
  { name: "Troutman Pepper Locke", aliases: ["Troutman Pepper", "Troutman Sanders"] },
  { name: "Nelson Mullins Riley & Scarborough", aliases: ["Nelson Mullins"] },
  { name: "Mintz, Levin, Cohn, Ferris, Glovsky and Popeo", aliases: ["Mintz Levin"] },
  { name: "Sheppard, Mullin, Richter & Hampton", aliases: ["Sheppard Mullin"] },
  { name: "Loeb & Loeb", aliases: [] },
  { name: "Dinsmore & Shohl", aliases: ["Dinsmore"] },
  { name: "Holland & Hart", aliases: [] },
  { name: "Orrick, Herrington & Sutcliffe", aliases: ["Orrick"] },
  { name: "Fenwick & West", aliases: ["Fenwick"] },
  { name: "Venable", aliases: [] },
  { name: "Foley & Lardner", aliases: [] },
  { name: "Polsinelli", aliases: [] },
  { name: "Husch Blackwell", aliases: [] },
  { name: "Pillsbury Winthrop Shaw Pittman", aliases: ["Pillsbury"] },
  { name: "McDermott Will & Schulte", aliases: ["McDermott Will & Emery", "McDermott Will"] },
  { name: "Greenberg Traurig", aliases: [] },
  { name: "Norton Rose Fulbright", aliases: [] },
  { name: "Eversheds Sutherland", aliases: [] },
  { name: "Ballard Spahr", aliases: [] },
  { name: "Hunton & Williams", aliases: [] },
  { name: "Davis Wright Tremaine", aliases: [] },
  { name: "Stoel Rives", aliases: [] },
  { name: "Cadwalader, Wickersham & Taft", aliases: ["Cadwalader"] },
  { name: "Stroock & Stroock & Lavan", aliases: ["Stroock"] },
  { name: "Katten Muchin Rosenman", aliases: ["Katten"] },
  { name: "Arnold & Porter", aliases: [] },
  { name: "Sullivan & Worcester", aliases: [] },
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a tolerant regex: commas/whitespace interchangeable, "&" matches "and", not inside other words.
function aliasRegex(alias) {
  const body = escapeRegExp(alias)
    .replace(/\s*(?:,\s*)?(?:&|and)\s+/g, "[\\s,]*(?:&|and)\\s+")
    .replace(/,?\s+/g, "[\\s,]+");
  return new RegExp(`(?<![\\w])${body}(?![\\w])`, "i");
}

function buildEntries(list, kind) {
  const entries = [];
  for (const item of list) {
    const name = typeof item === "string" ? item : item.name;
    const aliases = typeof item === "string" ? [item] : [item.name, ...item.aliases];
    for (const alias of aliases) entries.push({ name, kind, alias, re: aliasRegex(alias) });
  }
  // Longest aliases first so e.g. "Centerview Partners" wins over a shorter alias.
  return entries.sort((a, b) => b.alias.length - a.alias.length);
}

const BANK_ENTRIES = buildEntries(ADVISER_FIRMS, "bank");
const LAW_ENTRIES = buildEntries(LAW_FIRMS, "law");

function scan(text, entries) {
  if (!text) return [];
  const found = new Map();
  const taken = [];
  for (const { name, re } of entries) {
    if (found.has(name)) continue;
    const m = re.exec(text);
    if (!m) continue;
    const span = [m.index, m.index + m[0].length];
    // Skip matches nested inside a longer already-accepted match ("Stifel" inside "Stifel Nicolaus").
    if (taken.some(([a, b]) => span[0] >= a && span[1] <= b)) continue;
    taken.push(span);
    found.set(name, { name, matchedText: m[0], index: m.index });
  }
  return [...found.values()].sort((a, b) => a.index - b.index);
}

const strip = ({ index: _index, ...rest }) => rest;

/** Detects banks (and optionally law firms with `includeLaw`). Returns [{ name, matchedText }]. */
export function detectAdvisers(text, { includeLaw = false } = {}) {
  const banks = scan(text, BANK_ENTRIES).map(strip);
  return includeLaw ? [...banks, ...detectLawFirms(text)] : banks;
}

/** Detects law firms by canonical name. Returns [{ name, matchedText }]. */
export function detectLawFirms(text) {
  return scan(text, LAW_ENTRIES).map(strip);
}
