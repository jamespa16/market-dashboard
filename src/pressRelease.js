import { decodeEntities } from "./xml.js";

const NAMED = {
  mdash: "-",
  ndash: "-",
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  hellip: "...",
  bull: "*",
  reg: "",
  trade: "",
  copy: "",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  middot: "*",
  deg: " degrees ",
  sect: "Section ",
};

/** Convert HTML to plain text: block tags become paragraph breaks, entities decoded, whitespace collapsed. */
export function htmlToPlainText(html) {
  if (!html) return "";
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol|center|blockquote)\s*>/gi, "\n\n")
    .replace(/<(p|div|tr|table|h[1-6]|li|ul|ol|center|blockquote)\b[^>]*>/gi, "\n\n")
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  s = s.replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
  s = decodeEntities(decodeEntities(s))
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");
  return s
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// Deal-term extraction from merger press releases (EX-99.1) and 8-K bodies. Pattern based, no
// company-specific rules. Everything is best-effort; unknown fields come back as null.
// ---------------------------------------------------------------------------------------------

import { detectAdvisers, detectLawFirms } from "./advisers.js";

const STOP_START = String.raw`(?!(?:Under|Pursuant|In|As|On|At|Following|After|With|Upon|For|By|Through|From|Subject|Based|According|Prior|Immediately|Each|Any|All|Also|Both|Such|This|These|Those|If|When|While|Item|Exhibit|Effective|Common|Merger|Agreement|Company|Parent|Buyer|Closing|Exchange|Securities|Section|Texas|Delaware|Nevada|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday)\b)`;
const CAPW = String.raw`(?:[A-Z][\w&.'’\-]*|\d+[A-Z][\w&.'’\-]*|[a-z]+[A-Z][\w&.'’\-]*)`;
const LOWER_START = String.raw`(?<=^|[\n,(\-–][ ]?)(?!(?:which|that|it|they|who|this|also|and|but|company|parent|buyer|we|all|each|the|a|an|partnership|subsidiary|merger|closing|transaction|offer|board|agreement|acquisition|deal|seller|purchaser|issuer|sponsor|parties|party|holders|stockholders|shareholders|management|lenders|shares|stock)\b)[a-z]{4,}(?=[ ]+(?:and|will|to|has|have|agrees?|agreed|completes?|completed|announces?|announced|enters?|entered|signs?|acquires?)\b)`;
const SUFFIX = String.raw`(?:,[ ]+(?:Inc|Corp|Ltd|LLC|L\.P|LP|Co|N\.A)\.?|,[ ]+(?:Corporation|Incorporated|Limited|plc))`;
const RUN_T = String.raw`(?:${LOWER_START}|${STOP_START}${CAPW})(?:${SUFFIX}|[ ]+and[ ]+Company(?![\w])|[ ]+(?:(?:&|of|de|the|for)[ ]+)?${CAPW})*`;
const RUN_A = String.raw`${RUN_T}(?:[ ]+and[ ]+${RUN_T})?`;
const PAREN = String.raw`(?:[ ]*\([^)]{0,90}\))`;
const FILL_CAP = String.raw`[ ]+(?:Into|Definitive|Binding|Agreement|Merger|Transaction|Plan|Enters|Entered|Signs|Signed|Announces|Announced|Agrees|Agreed|Reaches|Reached|Has|Have)`;
const FILL = String.raw`(?:${PAREN}|,[^,;.()]{0,200},|,|[ ]+[a-z][\w'’\-]*|${FILL_CAP}|[ ]*;){0,30}?`;
const PRE = String.raw`(?:[ ]+(?:will|to|has|have|had|agrees?[ ]to|agreed[ ]to|is[ ]to|plans[ ]to|intends[ ]to))?`;
const AFFIL = String.raw`(?:(?:affiliates|funds|an affiliate|a fund|an entity affiliated|investment funds)(?: of| managed by| advised by| affiliated with)?[ ]+)?`;

const TRIM = new Set(
  "announces announce announced enters enter entered signs sign signed agrees agree agreed reaches reach completes complete completed receives amends amend strikes acquires acquire closes close unveils launches files confirms today jointly will to has have names board lifts raises delivers expands into definitive agreement".split(
    " "
  )
);
const NOT_NAMES = new Set([
  "it",
  "they",
  "we",
  "he",
  "she",
  "which",
  "that",
  "who",
  "this",
  "all",
  "company",
  "the company",
  "parent",
  "buyer",
  "merger sub",
]);
const STATES = new Set(
  "alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada new hampshire jersey mexico york north carolina dakota ohio oklahoma oregon pennsylvania rhode island south tennessee texas utah vermont virginia washington wisconsin wyoming cayman islands bermuda england canada ontario".split(
    " "
  )
);
const BAD_NAME =
  /(?:\b(?:Agreement|Merger|Plan of Merger|Effective Time|Common Stock|Merger Sub|Closing Date|Exchange Act|Securities Act|Act)\.?|^Item\b.*)$/i;
const GENERIC_TAIL = /\s+(?:Business|Businesses|Division|Segment)$/i;

function cleanName(raw) {
  if (!raw) return null;
  let toks = raw.replace(/\s+/g, " ").trim().split(" ");
  for (let i = 1; i < toks.length; i++) {
    if (TRIM.has(toks[i].toLowerCase().replace(/[^a-z]/g, ""))) {
      toks = toks.slice(0, i);
      break;
    }
  }
  let name = toks.join(" ").replace(/[,\s]+$/, "");
  // Drop a trailing legal suffix for readability: "Capital Bancorp, Inc." -> "Capital Bancorp".
  name = name
    .replace(/,?\s+(?:Inc|Corp|Ltd|LLC|LP|L\.P|Co|N\.A)\.?$/i, "")
    .replace(/,?\s+(?:Incorporated|Corporation)$/i, "");
  name = name.replace(GENERIC_TAIL, "").replace(/['’]s$/, "");
  if (!name || name.length < 2 || NOT_NAMES.has(name.toLowerCase()) || BAD_NAME.test(name)) return null;
  if (
    name
      .toLowerCase()
      .split(" ")
      .every((w) => STATES.has(w))
  )
    return null;
  return name;
}

// Each pattern: regex + which groups are acquirer/target.
const ACQ = String.raw`(?:[Aa]cquire|[Bb]uy|[Pp]urchase|[Aa]cquires|[Bb]uys|[Pp]urchases)`;
const DEAL_NOUN = String.raw`(?:[Aa]cquisition|[Pp]urchase|[Mm]erger|[Cc]ombination)`;
const PATTERNS = [
  {
    // "X ... will acquire Y", "X to acquire Y", "X agrees to acquire Y"
    re: new RegExp(
      `(${RUN_A})${FILL}${PRE}[ ]+${ACQ}[ ]+(?:(?:all|100%)[ ]+(?:of[ ]+)?(?:the[ ]+)?(?:(?:issued and )?outstanding[ ]+)?(?:(?:common[ ]+)?(?:stock|shares|equity interests?)(?:[ ]+not[ ]+already[ ]+owned)?[ ]+(?:of|in)[ ]+)?)?(${RUN_T})`,
      "g"
    ),
    acquirer: 1,
    target: 2,
  },
  {
    // "X completes / announces (the) (previously announced) acquisition/merger/combination of/with Y"
    re: new RegExp(
      `(${RUN_A})${FILL}[ ]+(?:[Cc]ompletes|[Cc]ompleted|has[ ]completed|[Cc]loses|[Cc]losed|[Aa]nnounces|[Aa]nnounced|[Ss]igns|[Ss]igned|enters[ ]into)[ ]+(?:the[ ]+|its[ ]+|an?[ ]+)?(?:(?:previously|definitive)[ ]+(?:announced[ ]+)?)?(?:agreement[ ]+for[ ]+(?:the[ ]+)?)?${DEAL_NOUN}[ ]+(?:of|with)[ ]+(?:(?:the[ ]+)?(?:outstanding[ ]+)?(?:shares|stock)[ ]+of[ ]+)?(${RUN_T})`,
      "g"
    ),
    acquirer: 1,
    target: 2,
  },
  {
    // "Y to be acquired by X" / "Y ... has agreed to be acquired by X"
    re: new RegExp(
      `(${RUN_T})${FILL}[ ]+(?:to[ ]+be|will[ ]+be|is[ ]+being|being|has[ ]+been|was)[ ]+acquired[ ]+by[ ]+${AFFIL}(${RUN_A})`,
      "g"
    ),
    acquirer: 2,
    target: 1,
    caseInsensitiveVerb: true,
  },
  {
    // "Y announces completion of its acquisition by X"
    re: new RegExp(
      `(${RUN_T})${FILL}[ ]+(?:completion[ ]+of|completed)[ ]+its[ ]+(?:acquisition|merger)[ ]+(?:by|with)[ ]+${AFFIL}(${RUN_A})`,
      "g"
    ),
    acquirer: 2,
    target: 1,
  },
  {
    // "the (previously announced) acquisition of Y[, a ...] by X"
    re: new RegExp(`${DEAL_NOUN}[ ]+of[ ]+(${RUN_T})(?:Inc\\.|Corp\\.|[^.;]){0,150}?[ ]by[ ]+${AFFIL}(${RUN_A})`, "g"),
    acquirer: 2,
    target: 1,
  },
  {
    // "X ... announced the completion of its acquisition of Y"
    re: new RegExp(
      `(${RUN_A})${FILL}[ ]+(?:the[ ]+)?completion[ ]+of[ ]+(?:its|the)[ ]+(?:previously[ ]+announced[ ]+)?${DEAL_NOUN}[ ]+of[ ]+(${RUN_T})`,
      "g"
    ),
    acquirer: 1,
    target: 2,
  },
];

function findParties(text) {
  const head = text.slice(0, 12000);
  let best = null;
  for (const p of PATTERNS) {
    const src = p.caseInsensitiveVerb ? head.replace(/\b[Tt]o [Bb]e [Aa]cquired [Bb]y\b/g, "to be acquired by") : head;
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(src))) {
      const acquirer = cleanName(m[p.acquirer]);
      const target = cleanName(m[p.target]);
      if (acquirer && target && !sameParty(acquirer, target)) {
        if (!best || m.index < best.index) best = { acquirer, target, index: m.index };
        break;
      }
      if (p.re.lastIndex === m.index) p.re.lastIndex++;
    }
  }
  if (best) return { acquirer: best.acquirer, target: best.target, via: "pattern" };
  return findPartiesByDefinition(head);
}

const DEF_PARENT = String.raw`\((?:the[ ])?[\"“](?:Parent|Buyer|Acquirer|Purchaser|Acquiror|Purchaser Parent)[\"”]\)`;
const DEF_COMPANY = String.raw`\((?:[^)]*?[\"“])?(?:the[ ])?(?:Company|Target)[\"”]\)`;

// 8-K style text: 'X (the "Company") entered into an Agreement and Plan of Merger ... with Y ("Parent")'.
function findPartiesByDefinition(text) {
  const parent = new RegExp(`(${RUN_A})(?:,[ ]+an?[ ][^"(]{0,60})?${PAREN}?[ ]*${DEF_PARENT}`).exec(text);
  const company = new RegExp(`(${RUN_T})(?:,[ ]+an?[ ][^"(]{0,180})?[ ]*,?[ ]*${DEF_COMPANY}`).exec(text);
  if (parent && company) {
    const acquirer = cleanName(parent[1]);
    const target = cleanName(company[1]);
    if (acquirer && target && acquirer !== target) return { acquirer, target, via: "definition" };
  }
  // "X ... entered into [an] Agreement and Plan of Merger ... with Y": first named party is the acquirer
  // unless it is itself defined as "the Company".
  const m = new RegExp(
    `(${RUN_T})(?:Inc\\.|Corp\\.|[^.]){0,400}?[ ](?:entered|have[ ]entered|has[ ]entered|enters)[ ]into[ ](?:an?|the)[ ](?:[Aa]mended[ ]and[ ]Restated[ ])?(?:Agreement[ ]and[ ]Plan[ ]of[ ](?:Merger|Reorganization)|[Mm]erger[ ][Aa]greement)[^.]{0,300}?[ ]with[ ](${RUN_T})`
  ).exec(text);
  if (m) {
    const first = cleanName(m[1]);
    const second = cleanName(m[2]);
    if (first && second && !sameParty(first, second)) {
      const firstIsCompany = new RegExp(DEF_COMPANY).test(text.slice(m.index, m.index + 400));
      return firstIsCompany
        ? { acquirer: second, target: first, via: "agreement" }
        : { acquirer: first, target: second, via: "agreement" };
    }
  }
  // "... Merger Sub ... wholly owned subsidiary of X ..." names the acquirer; the other party in "by and among" is the target.
  const sub = new RegExp(
    `(?:Merger[ ]Sub|Acquisition[ ]Corp)[^.;]{0,160}?wholly[ -]owned[ ]subsidiary[ ]of[ ](${RUN_T})`
  ).exec(text);
  if (sub) {
    const aliases = collectAliases(text);
    const acquirer = aliases.get(cleanName(sub[1])?.toLowerCase()) ?? cleanName(sub[1]);
    const among = new RegExp(
      `(?:by[ ]and[ ]among|between)[ ](${RUN_T})(?:Inc\\.|Corp\\.|[^.]){0,80}?(?:,|[ ]and)[ ](?:and[ ])?(${RUN_T})`
    ).exec(text);
    if (acquirer && among) {
      const names = [cleanName(among[1]), cleanName(among[2])].filter(Boolean);
      const target = names.find((n) => !sameParty(n, acquirer));
      if (target) return { acquirer, target, via: "subsidiary" };
    }
  }
  return { acquirer: null, target: null, via: null };
}

// ----- money ---------------------------------------------------------------------------------

const UNIT = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mm: 1e6, m: 1e6, mn: 1e6, thousand: 1e3 };

function toNumber(amount, unit) {
  const n = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return unit ? Math.round(n * UNIT[unit.toLowerCase()] * 100) / 100 : n;
}

const MONEY = String.raw`\$\s?(\d[\d,]*(?:\.\d+)?)\s?(billion|million|bn|mm|mn|b|m)?\b`;
const VALUE_KEY =
  /(?:valued|valuing|values|valuation|enterprise value|equity value|transaction value|total value|aggregate value|implied value|implied (?:total )?consideration|purchase price|(?:aggregate|total|upfront|up-front) (?:potential )?consideration|for approximately|worth|equity of)[^.$]{0,130}$/i;
const VALUE_BAD_AFTER =
  /^\s*(?:in|of)?\s*(?:total\s+)?(?:net\s+)?(?:assets|revenue|sales|deposits|loans|synergies|EBITDA|ARR|net income|cost|run-rate|in annual|in new|of revenue|of capital|private placement|of committed|of debt)/i;
const VALUE_BAD_BEFORE =
  /(?:placement|financing|synergies|revenue|premium|dividend|repurchase|buyback|termination fee|cash on hand|capital under management|assets under management|breakup|consisting of|contingent|CVR|milestone|including)[^.$]{0,40}$/i;

function findDealValue(text) {
  const re = new RegExp(MONEY, "gi");
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue; // want "$5.8 billion", not "$22.50"
    const before = text.slice(Math.max(0, m.index - 120), m.index);
    const sentenceBefore = before.split(/[.!?]\s+(?=[A-Z])|\n/).pop();
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (!VALUE_KEY.test(sentenceBefore)) continue;
    if (VALUE_BAD_BEFORE.test(sentenceBefore) || VALUE_BAD_AFTER.test(after)) continue;
    if (/^\s*(?:in|of)\s+(?:upfront|up-front)\s+consideration/i.test(after)) continue;
    const value = toNumber(m[1], m[2]);
    if (value) return value;
  }
  return null;
}

function findPerShare(text) {
  const money = String.raw`\$\s?(\d[\d,]*(?:\.\d+)?)`;
  const per = String.raw`(?:\([^)]{0,60}\))?\s*(?:in\s+cash\s+)?per\s+(?:common\s+)?share`;
  const implied = new RegExp(
    `(?:implied|total|aggregate)\\s+(?:total\\s+)?(?:consideration|value|price|equity value)\\s+of\\s+(?:approximately\\s+)?${money}\\s*${per}|or\\s+${money}\\s*${per}`,
    "i"
  ).exec(text);
  if (implied) return Number((implied[1] ?? implied[2]).replace(/,/g, ""));
  const re = new RegExp(
    `${money}(?:\\s*\\([^)]{0,60}\\))?\\s+(?:in\\s+cash\\s+)?(?:per\\s+(?:common\\s+)?share|per\\s+[A-Z]\\w+\\s+share)|(?:in cash|cash) (?:equal to|of) ${money}\\s+per\\s+share`,
    "gi"
  );
  let m;
  while ((m = re.exec(text))) {
    const before = text
      .slice(Math.max(0, m.index - 300), m.index)
      .split(/[.!?]\s+(?=[A-Z])|\n/)
      .pop();
    if (
      /additional|up to|premium|dividend|CVR|contingent|exercise price|conversion|Conversion|par value|Series [A-Z]|preferred|placement|stated value/i.test(
        before
      )
    )
      continue;
    if (
      /^\s*(?:in\s+cash\s+)?(?:and|plus)\s+[\d.,]+\s+(?:of\s+)?(?:\w+[ '’]+){0,4}shares?/i.test(
        text.slice(re.lastIndex, re.lastIndex + 80)
      )
    )
      continue;
    if (/^\s*(?:of\s+)?(?:a\s+)?(?:CVR|contingent)/i.test(text.slice(re.lastIndex, re.lastIndex + 20))) continue;
    return Number((m[1] ?? m[2]).replace(/,/g, ""));
  }
  return null;
}

function findConsideration(text) {
  const t = text;
  if (
    /stock[- ]and[- ]cash|cash[- ]and[- ]stock|cash[- ]and[- ]equity|combination of cash and (?:equity|stock|shares)|mix of cash and|cash (?:and|plus) (?:shares|stock)/i.test(
      t
    )
  )
    return "mixed";
  const NP = String.raw`(?:[^.]|(?<=\d)\.(?=\d))`;
  const cashAmt = String.raw`(?:\$\s?\d[\d,.]*(?:\s(?:million|billion))?(?:\s+in\s+cash)?|\d+%\s+of\s+[\w\s]{0,40}?in\s+cash)`;
  const shareAmt = String.raw`(?<![$\d.,])\d[\d,.]*(?:\s+(?:\([^)]{0,40}\)\s+)?(?:validly\s+issued,?\s+fully\s+paid\s+and\s+nonassessable\s+)?(?:of\s+)?(?:[\w'’.\-]+\s+){0,5}?(?:shares?\s+of|common\s+stock|ordinary\s+shares)|%\s+(?:of\s+(?:the\s+)?\w+\s+)?shares)`;
  const mixed = new RegExp(
    `${cashAmt}${NP}{0,80}?(?:\\band\\b|\\bplus\\b|\\(B\\))${NP}{0,40}?${shareAmt}|${shareAmt}${NP}{0,180}?(?:\\band\\b|\\bplus\\b)${NP}{0,40}?${cashAmt}`,
    "i"
  );
  if (mixed.test(t)) return "mixed";
  if (
    /in\s+cash[^.]{0,60}?(?:and|plus)\s+(?:\(ii\)\s+)?\$\s?[\d,.]+(?:\s+(?:million|billion))?\s+in\s+(?:shares|stock|equity)|\$\s?[\d,.]+(?:\s+(?:million|billion))?\s+in\s+(?:shares|stock)[^.]{0,60}?(?:and|plus)\s+\$\s?[\d,.]+(?:\s+(?:million|billion))?\s+in\s+cash/i.test(
      t
    )
  )
    return "mixed";
  if (
    /\ball[- ]stock\b|stock[- ]for[- ]stock|\ball[- ]equity\b|entirely in (?:shares|stock)|paid in shares|to be paid in shares/i.test(
      t
    )
  )
    return "stock";
  if (
    /\ball[- ]cash\b|cash transaction|cash consideration|in an all cash|per\s+(?:common\s+)?share\s+in\s+cash|in\s+cash\s+(?:at|per|for|equal|without)|in\s+cash\s+per\s+share|\$\s?\d[\d,.]*(?:\s(?:million|billion))?\s+in\s+cash|[\d.]+%\s+in\s+cash/i.test(
      t
    )
  )
    return "cash";
  if (
    /exchange ratio|exchanged (?:based on|for)|shares of .{0,40}common stock for each|will receive [\d.]+ shares/i.test(
      t
    )
  )
    return "stock";
  return null;
}

const CLOSE_VERB = String.raw`(?:expected|anticipated|projected|scheduled|on track|intended|currently expected|still expected|now expected|expects?|anticipates?)(?:[ ]+(?:the|this)[ ]+(?:transaction|acquisition|merger|deal|combination|closing|offer|sale|business combination)(?:[ ]+to)?)?`;
const WHEN = String.raw`((?:(?:by|in|during|at|before|on|around|within|no later than)[ ]+)?(?:the[ ]+)?(?:(?:very[ ]+)?(?:end|beginning|middle|start|close)[ ]+of[ ]+(?:the[ ]+)?|(?:early|late|mid|first[ ]half|second[ ]half|(?:first|second|third|fourth|1st|2nd|3rd|4th)[ ]quarter)[ -]*(?:of[ ]+)?)?(?:(?:the[ ]+)?(?:first|second|third|fourth)[ ]+(?:half|quarter)[ ]+of[ ]+|(?:calendar|fiscal)[ ]+(?:year[ ]+)?|(?:late|early|mid)[ -]?)*(?:(?:the[ ]+)?(?:first|second|third|fourth)[ ]+(?:half|quarter)[ ]+(?:of[ ]+)?)?(?:(?:calendar|fiscal)[ ]+year[ ]+)?(?:20\d\d)(?:[ ]+or[ ]+(?:early|late|earlier|mid)[ -]?(?:20\d\d)?|[ ]+or[ ]+(?:the[ ]+)?(?:first|second|third|fourth)[ ]+(?:half|quarter)[ ]+of[ ]+20\d\d)?|(?:by|in|during)[ ]+(?:the[ ]+)?(?:first|second|third|fourth)[ ]+(?:half|quarter)(?:[ ]+of[ ]+20\d\d)?|by[ ]+mid-20\d\d|(?:in|by|during)[ ]+(?:early|late|mid)[ -]20\d\d(?:[ ]+or[ ]+(?:early|late)[ ]20\d\d)?)`;

function findExpectedClose(text) {
  const closeVerb = String.raw`(?:to[ ]+)?(?:close|be[ ]+completed|be[ ]+consummated|complete|be[ ]+closed|be[ ]+finalized|be[ ]+effective|become[ ]+effective|occur)`;
  const re1 = new RegExp(`(?:${CLOSE_VERB})[ ]+${closeVerb}[ ,]+${WHEN}`, "i");
  const re2 = new RegExp(
    `(?:closing|completion)[^.]{0,60}?(?:expected|anticipated)[^.]{0,30}?(?:in|by|during)[ ]+${WHEN}`,
    "i"
  );
  const re3 = new RegExp(
    `(?:expected|anticipated)[ ]+(?:closing|completion)[^.]{0,30}?(?:in|by|during)?[ ]*${WHEN}`,
    "i"
  );
  for (const re of [re1, re2, re3]) {
    const m = re.exec(text);
    if (m) {
      return m[1]
        .replace(/^(?:by|in|during|at|before|on|around|within|no later than)\s+/i, "")
        .replace(/^the\s+/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }
  }
  return null;
}

// ----- advisers ------------------------------------------------------------------------------

const ABBREV = /\b(Inc|Corp|Co|Ltd|LLC|LLP|L\.P|N\.A|P\.C|Bros|Mr|Ms|Dr|U\.S|No|vs|Plc|S\.A|St)\./g;
const ROLE_LEAD = String.raw`\b(?:(?:is|are|was|were|has[ ]been|have[ ]been|will[ ]be)[ ]+(?:also[ ]+)?(?:(?:serving|acting|acted|served|acts)[ ]+(?:also[ ]+)?as[ ]+)?|(?:also[ ]+)?(?:serving|acting|acted|served|acts|retained|engaged)[ ]+(?:also[ ]+)?as[ ]+)`;
const ROLE_RE = new RegExp(`${ROLE_LEAD}((?:[A-Za-z&'’\\-]+[ ]+){0,6}?)(advis[eo]rs?|counsel)\\b`, "g");
const ADVICE_RE =
  /\b(?:provided|providing|rendered|delivered)\s+(?:(?:its|a|an|the)\s+)?(?:[a-z,-]+\s+){0,3}?(financial|legal|strategic)?\s*(?:and\s+(financial|legal)\s+)?(advice|advisory services|fairness opinion|opinion)/gi;
const MOD_OK =
  /^(?:a|an|its|the|their|our|lead|exclusive|sole|independent|joint|co-?|also|financial|legal|M&A|strategic|communications|capital|markets|tax|and|investment|banking|public|relations|principal|U\.S\.|regulatory|antitrust|special|bank|merger|transaction|lead|primary|external|outside)$|['’]s?$/i;

function classify(mods, role) {
  const m = mods.toLowerCase();
  if (/communications|public relations|\btax\b|investor relations/.test(m)) return null;
  if (/counsel/i.test(role) || /\blegal\b|antitrust|regulatory/.test(m)) return "legal";
  return "financial";
}

function splitSentences(text) {
  const masked = text.replace(ABBREV, (m) => m.slice(0, -1) + "\uE000").replace(/\b([A-Z])\.(?=\s?[A-Z])/g, "$1\uE000");
  return masked
    .split(/(?<=[.!?])\s+(?=[A-Z"“])|\n{2,}/)
    .map((s) => s.replace(/\uE000/g, "."))
    .filter(Boolean);
}

function firmsIn(segment) {
  const out = [];
  const taken = [];
  const addAll = (items, kind) => {
    for (const f of items) {
      const idx = segment.toLowerCase().indexOf(f.matchedText.toLowerCase());
      if (idx > 0 && /\b(?:a|an)\s+$/i.test(segment.slice(Math.max(0, idx - 3), idx))) continue; // "A Stifel Company"
      const tail =
        /^(?:[ ]+(?:Associates|Bank|Securities|Capital|Europe|SE|AG|Plc|PLC|LLC|L\.L\.C\.|LLP|Inc\.?|International|Capital Markets|Co\.?|Corp\.?|N\.A\.?|Limited|Ltd\.?|LP|L\.P\.|Group|US|USA|Company|&))+/.exec(
          segment.slice(idx + f.matchedText.length)
        );
      const end = idx + f.matchedText.length + (tail ? tail[0].length : 0);
      out.push({ name: f.name, kind, at: idx, len: f.matchedText.length });
      taken.push([idx, end]);
    }
  };
  addAll(detectLawFirms(segment), "legal");
  addAll(detectAdvisers(segment), "bank");
  const lawSpans = out.filter((o) => o.kind === "legal");
  // A bank alias nested inside a law-firm match (or vice versa) is noise.
  const kept = out.filter(
    (o) => o.kind === "legal" || !lawSpans.some((l) => o.at >= l.at && o.at + o.len <= l.at + l.len)
  );
  const known = kept.sort((a, b) => a.at - b.at);
  // Leftover names (unknown firms): remove known spans, split on commas/and, keep capitalised phrases.
  let rest = segment;
  for (const [a, b] of taken.sort((x, y) => y[0] - x[0])) rest = rest.slice(0, a) + "," + rest.slice(b);
  rest = rest.replace(/\([^)]*\)/g, ",");
  const leftovers = rest
    .split(/,|\band\b|;|\bwith\b/)
    .map((s) =>
      s
        .replace(/\b(?:L\.L\.C|LLC|LLP|LP|L\.P|PLC|Inc|P\.C|N\.A|Co|Corp|Bank|Ltd)\.?\b/g, "")
        .replace(/\s+(?:also|both|each)$/i, "")
        .replace(/[()"“”]/g, "")
        .trim()
    )
    .filter(
      (s) =>
        /^[A-Z]/.test(s) &&
        !/^(?:A|An|The|Also|Both|Each|Its|Their|As|In|On|For|Company|Special|Board)\b/.test(s) &&
        s.split(/\s+/).length <= 5 &&
        !/\b(?:advis|counsel|said|announce|transaction|committee|stockholders|shareholders)\b/i.test(s) &&
        !/^(?:the )?company$/i.test(s)
    );
  for (const l of leftovers) known.push({ name: l.replace(/\s+/g, " "), kind: "other", at: 1e6, len: 0 });
  return known;
}

function resolveSide(tail, mods, parties, aliases) {
  const hint = `${mods} ${tail ?? ""}`;
  const poss = /([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)['’]s?(?:\s+[a-z][\w-]*)*\s*$/.exec(mods.trim());
  const cands = [];
  if (poss) cands.push(poss[1]);
  if (tail) cands.push(tail.replace(/^(?:the\s+)?/i, ""));
  for (let c of cands) {
    c = c.trim();
    if (/special committee|transaction committee|board of directors|independent directors/i.test(c)) return "target";
    const alias = aliases.get(c.toLowerCase().replace(/^the\s+/, ""));
    const full = alias ?? c;
    if (parties.acquirer && sameParty(full, parties.acquirer)) return "acquirer";
    if (parties.target && sameParty(full, parties.target)) return "target";
  }
  void hint;
  return null;
}

const GENERIC_TOKENS = new Set([
  "inc",
  "corp",
  "corporation",
  "company",
  "co",
  "the",
  "group",
  "holdings",
  "partners",
  "and",
  "ltd",
  "llc",
  "limited",
  "of",
  "capital",
  "technologies",
  "bancorp",
  "financial",
  "services",
]);

function normName(n) {
  return n
    .toLowerCase()
    .replace(/['’]s?\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameParty(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const tx = x.split(" ").filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
  const ty = y.split(" ").filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
  return tx.length > 0 && tx[0] === ty[0];
}

function collectAliases(text) {
  const aliases = new Map();
  const re = new RegExp(
    `(${RUN_T})(?:,[ ]+an?[ ][^"(]{0,60})?${PAREN}?[ ]*\\([^)]{0,60}?[\\"“]([A-Za-z][\\w .&'’\\-]{0,40})[\\"”](?:[^)]{0,40})\\)`,
    "g"
  );
  let m;
  while ((m = re.exec(text))) {
    const full = cleanName(m[1]);
    if (full) aliases.set(m[2].toLowerCase().replace(/^the\s+/, ""), full);
  }
  return aliases;
}

function findAdvisers(text, parties) {
  const aliases = collectAliases(text);
  const found = [];
  const seen = new Set();
  const push = (name, role, side) => {
    if (!role) return;
    const key = `${role}|${normName(name)}`;
    if (seen.has(key)) {
      const existing = found.find((f) => `${f.role}|${normName(f.name)}` === key);
      if (existing && !existing.side && side) existing.side = side;
      return;
    }
    seen.add(key);
    found.push({ name, role, side: side ?? null });
  };
  for (const sentence of splitSentences(text)) {
    if (!/advis|counsel|advice|fairness opinion/i.test(sentence) || /forward-looking/i.test(sentence)) continue;
    const roles = [];
    ROLE_RE.lastIndex = 0;
    let m;
    while ((m = ROLE_RE.exec(sentence))) {
      const mods = m[1].trim();
      if (
        mods &&
        !mods
          .split(/\s+/)
          .every((w) => MOD_OK.test(w) || /^[A-Z][\w.&]*['’]s?$/.test(w) || /^[A-Z][\w.&]*['’]$/.test(w))
      ) {
        ROLE_RE.lastIndex = m.index + 1;
        continue;
      }
      const tailM = /^(?:[ ]+(?:to|for)[ ]+(?:the[ ]+)?([^,;]+?))?(?=[,;.]|[ ]and[ ]|$)/.exec(
        sentence.slice(m.index + m[0].length)
      );
      roles.push({
        start: m.index,
        end: m.index + m[0].length + (tailM ? tailM[0].length : 0),
        role: classify(mods, m[2]),
        mods,
        tail: tailM?.[1]?.trim() ?? null,
      });
    }
    ADVICE_RE.lastIndex = 0;
    while ((m = ADVICE_RE.exec(sentence))) {
      const kind = (m[1] || m[2] || "").toLowerCase();
      const role = /legal/.test(kind) ? "legal" : "financial";
      const tailM = /^[ ]+(?:to|for)[ ]+(?:the[ ]+)?([^,;.]+)/.exec(sentence.slice(m.index + m[0].length));
      roles.push({ start: m.index, end: m.index + m[0].length, role, mods: "", tail: tailM?.[1]?.trim() ?? null });
    }
    roles.sort((a, b) => a.start - b.start);
    // Inherit the first later tail for clauses that have none ("X is serving as A, Y as B to Company").
    for (let i = 0; i < roles.length; i++) {
      if (!roles[i].tail) {
        roles[i].tail =
          roles.slice(i + 1).find((r) => r.tail)?.tail ??
          [...roles.slice(0, i)].reverse().find((r) => r.tail)?.tail ??
          null;
      }
    }
    let cursor = 0;
    for (const r of roles) {
      const seg = sentence
        .slice(cursor, r.start)
        .replace(/^[\s,;]*(?:(?:and|with|while|also|both|as well as|in addition,?)\s+)+/i, "")
        .trim();
      cursor = Math.max(cursor, r.end);
      const side = resolveSide(r.tail, r.mods, parties, aliases);
      for (const f of firmsIn(seg)) push(f.name, r.role, side);
    }
    // "with the assistance of its financial advisor Baird"
    const post =
      /\b(?:its|their|the)\s+(financial|legal)\s+(?:advis[eo]rs?|counsel)\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3})/g;
    while ((m = post.exec(sentence))) {
      const known = firmsIn(m[2]).filter((f) => f.kind !== "other");
      for (const f of known) push(f.name, m[1].toLowerCase() === "legal" ? "legal" : "financial", null);
    }
  }
  return found;
}

function stripCoverPage(text) {
  // 8-K cover page boilerplate (checkboxes, Rule 425, registrant info) ends with the emerging-growth-company paragraph.
  const m =
    /accounting standards provided pursuant to Section 13\(a\) of the (?:Exchange|Securities Exchange) Act(?: of 1934)?\.?[ \t☐☒]*/i.exec(
      text
    );
  return m && m.index < 6000 ? text.slice(m.index + m[0].length) : text;
}

function cleanText(text) {
  return stripCoverPage(String(text ?? ""))
    .replace(/^# source:.*$/m, "")
    .replace(/^EX-99\.\d\s+\d+\s+\S+\s+[^\n]*$/m, "")
    .replace(/\bExhibit\s+99\.\d\b\.?/gi, "")
    .replace(
      /\bItem\s+\d\.\d\d\.?\s+(?:Entry into a Material Definitive Agreement|Completion of Acquisition or Disposi[a-z]+ of Assets|Unregistered Sales of Equity Securities|Regulation FD Disclosure|Other Events|Results of Operations and Financial Condition|Financial Statements and Exhibits|Termination of a Material Definitive Agreement|Notice of Delisting[^.]*|Material Modification[^.]*|Changes in Control of Registrant)\.?/g,
      "\n\n"
    )
    .replace(/\b(?:FOR\s+IMMEDIATE\s+RELEASE|NEWS\s+RELEASE)\b:?/g, "")
    .replace(/\r/g, "")
    .replace(/^(?:Transaction |Legal |Financial )?Advis[eo]rs?:?[ \t]*$/gim, "")
    .replace(/[•·▪]/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

/**
 * Extract deal terms from a merger press release / 8-K body.
 * @param {string} text plain text (see htmlToPlainText)
 * @returns {{acquirer: string|null, target: string|null, dealValueUsd: number|null, perSharePrice: number|null,
 *   consideration: "cash"|"stock"|"mixed"|null, expectedClose: string|null,
 *   advisers: {name: string, role: "financial"|"legal", side: "acquirer"|"target"|null}[],
 *   confidence: "high"|"low"}}
 */
export function parsePressRelease(text) {
  const t = cleanText(text);
  const parties = findParties(t);
  const advisers = findAdvisers(t, parties);
  return {
    acquirer: parties.acquirer,
    target: parties.target,
    dealValueUsd: findDealValue(t),
    perSharePrice: findPerShare(t),
    consideration: findConsideration(t),
    expectedClose: findExpectedClose(t),
    advisers,
    confidence: parties.acquirer && parties.target && parties.via === "pattern" ? "high" : "low",
  };
}
