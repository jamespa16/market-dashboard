export function cleanGoogleTitle(rawTitle) {
  return rawTitle
    .replace(/\s+-\s+[^-]+$/, "")
    .replace(/^(?:Watch|Exclusive|Breaking|Report|Update|Video)\s*:?\s+/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Headline parsing. Everything here is a general English-syntax pattern
// (voice, verb phrase, deal-size clause); no company names are hard-coded.
// ---------------------------------------------------------------------------

const EXCHANGES =
  "NASDAQ|NYSE|NYSE American|NYSEAMERICAN|AMEX|OTC|OTCQB|OTCQX|OTCMKTS|TSX|TSXV|TSX-V|CSE|LSE|AIM|ASX|NSE|BSE|HKEX|SGX|XETRA|Euronext|NYSE Arca|CBOE";

// "(NASDAQ: ABC)", "(NYSE:ABC)", "(ABC)", "(TSX: ABC, NYSE: ABC)"
const TICKER_PAREN = new RegExp(
  `\\s*\\((?:(?:${EXCHANGES})\\s*[:.]\\s*[A-Z0-9.\\-]{1,8}|[A-Z][A-Z0-9.]{0,5})(?:\\s*[,;/]\\s*(?:(?:${EXCHANGES})\\s*[:.]\\s*)?[A-Z0-9.\\-]{1,8})*\\)`,
  "gi"
);
const TICKER_PAREN_STRICT = /\s*\([A-Z][A-Z0-9.]{0,5}\)/g;

const LEADING_LABEL =
  /^(?:exclusive|breaking(?: news)?|just in|update|updated|analysis|opinion|watch|video|report|deal alert|press release)\s*[:|]\s*/i;

function normalizeTitle(title) {
  let t = String(title ?? "").trim();
  t = t.replace(LEADING_LABEL, "");
  // trailing outlet after a pipe ("... | CNN Business") or spaced dash
  t = t.replace(/\s+\|\s+[^|]*$/, "");
  t = t.replace(/\s+[–—]\s+.*$/, "");
  t = t.replace(TICKER_PAREN, (m) => (/:/.test(m) ? "" : TICKER_PAREN_STRICT.test(m) ? "" : m));
  TICKER_PAREN_STRICT.lastIndex = 0;
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// Deal-size / consideration / context clauses that trail a company name.
const MONEY = String.raw`(?:[A-Z]{0,3}\$|[£€¥]|\d)`;
const TRAILING_CLAUSES = [
  // "for $470 million", "for up to $663 Million", "in $5.8 billion deal", "in CA$5.7 Billion Deal"
  String.raw`\s+(?:for|in|valued at|worth|at)\s+(?:an?\s+)?(?:up to\s+|approximately\s+|about\s+|around\s+|nearly\s+)?${MONEY}.*$`,
  // "in all-cash deal", "in all-stock transaction", "in cash and stock deal"
  String.raw`\s+in\s+(?:an?\s+)?(?:all[- ]|cash\b|stock\b|share\b).*$`,
  // "in a takeover bid", "in a big deal" style closers
  String.raw`\s+in\s+(?:an?\s+|the\s+)?(?:[\w$.,%'-]+\s+){0,3}?(?:deal|bid|offer|transaction|merger|takeover|buyout)\b.*$`,
  // "to scale ...", "to create ..." purpose clauses
  String.raw`\s+to\s+(?!be\b).*$`,
  String.raw`\s*[;:?!]\s.*$`,
  String.raw`\s*[;?!]$`,
  // " amid ..." / " after ..." / " as ..." context tails
  String.raw`\s+(?:amid|after|as|while|following|despite|on)\s+.*$`,
  // " plus CVR..." / " with ..." consideration tails
  String.raw`\s+(?:plus|including|with)\s+.*$`,
];
const TRAILING_CLAUSE = new RegExp(TRAILING_CLAUSES.join("|"), "i");
// Case-sensitive: a comma followed by a lowercase word or an -ing word starts a trailing clause.
const COMMA_CLAUSE = /,\s+(?:[a-z]|[A-Z][a-z]+ing\b|Which\b|Who\b|After\b|As\b|With\b).*$/;

// Verb phrases that sit between a subject company and "to acquire/to be acquired".
const SUBJECT_VERBS =
  "in talks|in discussions|weighs|explores|considers|eyes|nears|agrees?|agreed|announces?|announced|signs?|signed|reaches|reached|enters?|entered|inks?|inked|confirms?|unveils?|reveals?|receives?|accepts?|plans?|planned|set|poised|ready|moves|looks|seeks|says|said|will|has|have|is|are";
const SUBJECT_VERB_TAIL = new RegExp(`\\s+(?:${SUBJECT_VERBS})\\b.*$`, "i");

const DESCRIPTOR_HEAD =
  /^(?:[\w&.'-]+\s+){0,6}?(?:firm|company|startup|start-up|maker|provider|developer|operator|giant|unit|division|rival|chain|brand|lender|insurer|manufacturer|supplier|vendor|platform|specialist|producer|retailer|distributor)\s+(?=[A-Z0-9])/;
const CORPORATE_SUFFIX = /^(?:inc|corp|corporation|ltd|limited|plc|llc|co|company|group|holdings?|sa|se|ag|nv|lp)\.?$/i;

const GENERIC_PARTY =
  /^(?:(?:\w+\s+){0,2}(?:investors?|buyers?|bidders?|suitors?|consortium|investor group|private equity(?: firm)?|a rival|rival|unnamed \w+|undisclosed \w+|a buyer|an investor group))$/i;

function cleanName(raw, { isTarget = false } = {}) {
  if (!raw) return "";
  let name = raw.trim();
  name = name.replace(TICKER_PAREN, (m) => (/:/.test(m) ? "" : m));
  name = name.replace(TICKER_PAREN_STRICT, "");
  name = name.replace(COMMA_CLAUSE, "");
  // repeat: stripping one clause can expose another ("X for $1B in cash")
  for (let i = 0; i < 3; i++) {
    const next = name.replace(TRAILING_CLAUSE, "").trim();
    if (next === name) break;
    name = next;
  }
  name = name.replace(/^(?:the|a|an)\s+(?=[A-Z])/i, "");
  // "100% of X", "all of X", "remaining shares of X", "majority stake in X"
  name = name.replace(
    /^(?:(?:the\s+)?(?:remaining\s+|outstanding\s+)?(?:\d+(?:\.\d+)?%|all|majority|controlling)\s+(?:of\s+|stake\s+in\s+|interest\s+in\s+)?(?:the\s+)?(?:shares\s+of\s+|stock\s+of\s+)?)/i,
    ""
  );
  if (isTarget) {
    const stripped = name.replace(DESCRIPTOR_HEAD, "");
    if (stripped && !CORPORATE_SUFFIX.test(stripped)) name = stripped;
    // lowercase industry word(s) before a proper name: "fintech Bluevine"
    const lead = name.match(/^(?:[a-z][\w-]*\s+)+(?=[A-Z0-9])(.+)$/);
    if (lead && !CORPORATE_SUFFIX.test(lead[1])) name = lead[1];
  }
  name = name.replace(/['’]s$/i, "");
  name = name.replace(/[\s,.;:\-–—]+$/, (m) => (/^\.$/.test(m) ? "." : ""));
  name = name.replace(/\s*,\s*$/, "").trim();
  return name;
}

const ACQUIRE_VERB = String.raw`(?:acquire|buy|purchase|take over|snap up|take control of|swallow)\b`;
const PASSIVE_VERB = String.raw`(?:acquired|bought|purchased|taken over|taken private|snapped up|taken out|swallowed up|absorbed)`;
const DEAL_NOUN = String.raw`(?:acquisition|takeover|buyout|buy-out|purchase|merger|deal|offer|bid|tender offer)`;
const MID = String.raw`(?:[\w$.,%'/&-]+\s+){0,4}?`; // a few adjective/size words

// Each entry: [regex, which capture is the acquirer, which is the target].
// Ordered most-specific first.
const PAIR_PATTERNS = [
  // Passive: "X to be acquired by Y", "X agrees to be bought by Y", "X acquired by Y"
  [
    new RegExp(
      String.raw`^(.+?)\s+(?:(?:to|will|is to|is going to|set to|agrees to|has agreed to|set to)\s+)?(?:be|being|get|gets|been)?\s*${PASSIVE_VERB}\s+by\s+(.+)$`,
      "i"
    ),
    2,
    1,
  ],
  // "Y agrees to $340 Million Acquisition by X", "Y receives takeover offer from X"
  [
    new RegExp(
      String.raw`^(.+?)\s+(?:agrees?|accepts|receives|gets|backs)\s+(?:to\s+)?(?:an?\s+)?${MID}${DEAL_NOUN}\s+(?:by|from)\s+(.+)$`,
      "i"
    ),
    2,
    1,
  ],
  // "X to take Y private"
  [/^(.+?)\s+(?:to\s+|will\s+|agrees to\s+)?(?:takes?|taking)\s+(.+?)\s+private\b.*$/i, 1, 2],
  // "X closes $110 billion deal to acquire Y", "X completes acquisition of Y"
  [
    new RegExp(
      String.raw`^(.+?)\s+(?:has\s+)?(?:completes?|completed|closes?|closed|finalizes?|finalized|wraps up|consummates?)\s+(?:its\s+|the\s+|an?\s+)?(?:${MID})?(?:acquisition|purchase|takeover|buyout|merger|deal)\s+(?:of|for|to acquire|to buy|to purchase|with)\s+(.+)$`,
      "i"
    ),
    1,
    2,
  ],
  // Offers: "X launches/extends/enhances (tender) offer to acquire/for Y", "X wins bid for Y"
  [
    new RegExp(
      String.raw`^(.+?)\s+(?:announces\s+|announced\s+)?(?:launch(?:es)?|commences?|makes?|submits?|extends?|extension|enhances?|raises?|improves?|sweetens?|wins?|amends?|lodges?|tables?|revises?|launches)\s+(?:of\s+|an?\s+|the\s+|its\s+)?(?:${MID})?(?:tender offer|exchange offer|takeover bid|takeover offer|offer|bid)\s+(?:to acquire|to buy|to purchase|for)\s+(.+)$`,
      "i"
    ),
    1,
    2,
  ],
  // Possessive: "X's $5bn takeover of Y"
  [
    new RegExp(
      String.raw`^(.+?)['’]s\s+${MID}(?:acquisition|takeover|buyout|purchase|bid|offer)\s+(?:of|for)\s+(.+)$`,
      "i"
    ),
    1,
    2,
  ],
  // "Y shareholders approve X merger agreement"
  [
    /^(.+?)\s+(?:shareholders|stockholders|investors|holders|board|directors)\s+(?:vote\s+(?:to\s+)?)?(?:approve|back|backs|ratify|ratifies|endorse|endorses|accept|accepts|support|supports|votes? for)\s+(.+?)['’]?s?\s+(?:merger|acquisition|takeover|buyout|deal|offer|bid|tender offer)\b.*$/i,
    2,
    1,
  ],
  // Verb-led: "X (agrees|announces|signs|...) (an|a definitive) (agreement|deal) to acquire/buy Y", "X to acquire Y"
  [new RegExp(String.raw`^(.+?)\s+(?:to|will)\s+${ACQUIRE_VERB}\s+(.+)$`, "i"), 1, 2],
  [
    new RegExp(
      String.raw`^(.+?)\s+(?:agrees?|agreed|announces?|announced|signs?|signed|reaches|reached|enters?|entered|inks?|inked|confirms?|moves|set|poised|plans?|says|seeks)\s+(?:${MID})?to\s+${ACQUIRE_VERB}\s+(.+)$`,
      "i"
    ),
    1,
    2,
  ],
  // "X acquires Y", "X buys Y", "X has acquired Y"
  [
    new RegExp(
      String.raw`^(.+?)\s+(?:has\s+|have\s+)?(?:acquires?|acquired|buys?|bought|purchases?|purchased|snaps up|snapped up|takes over|took over|swallows|absorbs)\s+(.+)$`,
      "i"
    ),
    1,
    2,
  ],
  // "X to merge with Y", "X merges with Y"
  [/^(.+?)\s+(?:to\s+|agrees to\s+|will\s+)?(?:merges?|combines?)\s+with\s+(.+)$/i, 1, 2],
  // "X and Y to combine/merge", "X and Y announce (revised) merger agreement", "X and Y amend merger agreement"
  [
    /^(.+?)\s+(?:and|&)\s+(.+?)\s+(?:to\s+(?:combine|merge|create|form|unite|join)\b.*|(?:announce|agree|sign|enter|amend|revise|complete|finalize|extend|expand)(?:s|d|ed|es)?\b.*?\b(?:merger|combination|business combination|amalgamation|agreement|transaction)\b.*)$/i,
    1,
    2,
  ],
  // "X, Y stocks rally on merger agreement"
  [/^([^,]+?),\s+(.+?)\s+(?:stocks?|shares)\s+.*\b(?:merger|acquisition|takeover|buyout|deal|combination)\b.*$/i, 1, 2],
  // "After a failed bid, X finds lifeline in Y merger" - subject is the surviving party
  [
    /^(?:after|following|despite)\s+[^,]+,\s+(.+?)\s+(?:finds|lands|gets|strikes|seals|secures|inks|clinches|turns|pivots)\b.*?\b(?:in|with|via|through)\s+(.+?)\s+(?:merger|combination|reverse merger)\b.*$/i,
    1,
    2,
  ],
];

const FILLER_WORDS = new Set([
  "and",
  "the",
  "of",
  "for",
  "in",
  "on",
  "at",
  "to",
  "from",
  "after",
  "amid",
  "its",
  "a",
  "an",
  "with",
  "by",
]);

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
  const normalized = normalizeTitle(title);
  if (!normalized) return { acquirer: null, target: null };
  for (const [pattern, acqIdx, tgtIdx] of PAIR_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const acquirer = cleanName(match[acqIdx].replace(SUBJECT_VERB_TAIL, ""));
    const target = cleanName(match[tgtIdx].replace(SUBJECT_VERB_TAIL, ""), { isTarget: true });
    if (!acquirer || !target) continue;
    // A pattern matched but a side is a placeholder ("investors"): stop rather than let looser patterns guess.
    if (GENERIC_PARTY.test(acquirer) || GENERIC_PARTY.test(target)) break;
    return { acquirer, target };
  }
  return { acquirer: null, target: null };
}

// ---------------------------------------------------------------------------
// Headline deal classifier. Keyword/pattern rules for the things that look
// like deals but are not (see test/fixtures/README.md labeling rules).
// ---------------------------------------------------------------------------

const NEGATIVE_RULES = [
  [
    "earnings",
    /\b(?:reports?|announces|posts|delivers|releases)\b[^|]*\b(?:results|earnings)\b|\b(?:quarterly|annual|fiscal|first|second|third|fourth)[- ](?:quarter|year)?\s*(?:results|earnings|\d{4})|\bearnings (?:call|release|results|report|beat|miss)\b|\bQ[1-4]\b[^|]*\b(?:results|earnings)\b/i,
  ],
  [
    "legal alert or investigation",
    /\b(?:legal alert|shareholder alert|investor alert|investors? (?:are|is) (?:hereby )?(?:notified|encouraged|reminded|urged|invited)|class action|lawsuits?|sues|sued|law firm|investigat(?:es?|ion|ing|ions)|securities fraud|fiduciary|subpoena|probe|attorneys?|shareholders? (?:are|is) (?:encouraged|urged|reminded)|contact (?:the|our) firm)\b/i,
  ],
  [
    "regulatory or political commentary",
    /\b(?:lawmakers?|senators?|congress(?:man|woman|ional)?|politicians?|judge|judges|court|courts|ruling|rules? against|regulators?|antitrust|FTC|DOJ|CMA|European Commission|critics?|oppos(?:e|es|ed|ition)|raise[sd]? (?:alarm|concerns?)|scrutiny|blocks?|blocked)\b/i,
  ],
  [
    "merger-arbitrage or analysis commentary",
    /\barbitrage\b|\bopportunity\b|\bupside\b|\bshould you\b|\bhold\b|\bprice target\b|\banalysts?\b|\bwhat (?:it means|to know|investors)\b|\bis it (?:a )?(?:good|worth)\b|\bworth (?:buying|owning)\b|\bwhy\b|\b(?:bullish|bearish)\b|\bspread\b/i,
  ],
  [
    "deal withdrawn or terminated",
    /\b(?:withdraw(?:s|n|ing|al)?|terminat(?:e|es|ed|ing|ion)|abandon(?:s|ed|ing)?|call(?:s|ed)? off|walks? away|collapses?|collapsed|falls? through|cancel(?:s|led|ed)?|nix(?:es|ed)?|rejects?|rejected|rebuffs?|rebuffed|turns? down|spurns?|pulls? out|backs? out)\b|\b(?:drops?|dropped|dropping|scraps?|scrapped|ditch(?:es|ed)?|axes|axed|shelves|shelved|ends?|ended)\b(?:\W+\S+){0,5}?\W+(?:deal|bid|offer|plan|pursuit|merger|acquisition|takeover|buyout|talks|proposal)\b/i,
  ],
  [
    "rumor, talks or non-binding proposal",
    /\b(?:in (?:advanced |early |preliminary )?(?:talks|discussions|negotiations)|talks (?:to|about|with|over)|explor(?:e|es|ed|ing)|weigh(?:s|ed|ing)?|consider(?:s|ed|ing)?|mull(?:s|ed|ing)?|contemplat\w+|rumou?rs?|rumou?red|reportedly|(?:according to|says?|said) (?:a )?(?:report|sources|people)|people familiar|sources? (?:say|said)|said to|(?:after|on|following) (?:a )?report|approach(?:es|ed)?|prelimin\w+|non-binding|nonbinding|indicative|unsolicited|may (?:buy|acquire|bid|make)|could (?:buy|acquire|bid|make)|might (?:buy|acquire)|eyes?|eyeing|sniff\w*|nears?|nearing|closing in on|sounds? out|feelers?|interested in|looking (?:to|at)|plans? (?:a |an )?(?:bid|offer|takeover)|potential|possible|speculat\w+|tipped)\b/i,
  ],
];

const DEAL_LANGUAGE =
  /\b(?:acqui\w+|merg(?:e|es|er|ers|ing)|buy(?:s|out|ing)?|bought|purchas\w+|takeover|take(?:s)? over|take(?:s)? \S+ private|taken private|combin\w+|tender offer|offer|bid|deal|transaction|amalgamation)\b/i;

export function classifyHeadline(title) {
  const raw = String(title ?? "");
  for (const [reason, pattern] of NEGATIVE_RULES) {
    if (pattern.test(raw)) return { isDeal: false, confidence: "high", reason };
  }
  if (!DEAL_LANGUAGE.test(raw)) {
    return { isDeal: false, confidence: "low", reason: "no deal language in headline" };
  }
  const { acquirer, target } = extractCompanyPair(raw);
  if (acquirer && target) {
    return { isDeal: true, confidence: "high", reason: "both parties identified, no negative signal" };
  }
  return { isDeal: true, confidence: "low", reason: "deal language but parties not identified" };
}

export function cleanSecDisplayName(displayName) {
  return displayName
    .replace(/\s*\(CIK\s*\d+\)\s*$/i, "")
    .replace(/\s*\([A-Z.]{1,6}\)\s*$/, "")
    .trim();
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
