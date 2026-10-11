// HTML -> plain text for SEC filing documents, preserving paragraph breaks.

import { decodeEntities } from "../xml.js";

// nbsp, figure space, narrow nbsp, thin space, zero-width space (as escapes, not literals)
const ODD_SPACES = new RegExp("[\\u00a0\\u2007\\u202f\\u2009\\u200b]", "g");

// Named entities beyond the handful xml.js knows about.
const NAMED = {
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  bull: "\u2022",
  reg: "\u00ae",
  trade: "\u2122",
  copy: "\u00a9",
  sect: "\u00a7",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
};

const BLOCK_TAGS = "p|div|tr|li|ul|ol|table|h[1-6]|blockquote|section|article|pre|center";

export function htmlToText(html) {
  if (!html) return "";
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    // iXBRL header blocks are hidden metadata
    .replace(/<ix:header\b[^>]*>[\s\S]*?<\/ix:header>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(new RegExp(`</(${BLOCK_TAGS})\\s*>`, "gi"), "\n\n")
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<hr\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s.replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m))
    .replace(ODD_SPACES, " ")
    .replace(/\r/g, "");
  return s
    .split(/\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
