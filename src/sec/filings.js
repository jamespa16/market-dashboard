// Filing document discovery (index page), press-release selection, and document text.

import { secFetchText } from "./client.js";
import { htmlToText } from "./htmlText.js";
import { decodeEntities } from "../xml.js";

const stripZeros = (cik) => String(cik).replace(/^0+/, "") || "0";

export function filingIndexUrl({ cik, adsh }) {
  return `https://www.sec.gov/Archives/edgar/data/${stripZeros(cik)}/${adsh.replace(/-/g, "")}/${adsh}-index.htm`;
}

/**
 * Parse the "Document Format Files" table of an EDGAR -index.htm page.
 * @returns {{ name: string, type: string, url: string, description: string }[]}
 *   (data files like XBRL and the complete .txt submission are excluded)
 */
export function parseFilingIndex(html) {
  const table = html.match(/<table[^>]*summary="Document Format Files"[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) return [];
  const docs = [];
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 4) continue;
    const href = cells[2].match(/href="([^"]+)"/i)?.[1];
    if (!href) continue;
    let path = decodeEntities(href);
    // Inline-XBRL viewer links look like /ix?doc=/Archives/...
    const ix = path.match(/[?&]doc=([^&]+)/);
    if (ix) path = ix[1];
    const text = (c) =>
      decodeEntities(c.replace(/<[^>]*>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
    const type = text(cells[3]);
    if (!type) continue;
    docs.push({
      name: text(cells[2]).replace(/\s*iXBRL$/i, ""),
      type,
      url: new URL(path, "https://www.sec.gov").href,
      description: text(cells[1]),
    });
  }
  return docs;
}

export async function getFilingDocuments({ cik, adsh }, { fetchText = secFetchText } = {}) {
  return parseFilingIndex(await fetchText(filingIndexUrl({ cik, adsh })));
}

/** EX-99.1, else the first EX-99.x whose description mentions a press release, else null. */
export function findPressRelease(docs) {
  const ex99 = docs.filter((d) => /^EX-99(\.|$)/i.test(d.type));
  const exact = ex99.find((d) => /^EX-99\.1$/i.test(d.type));
  if (exact) return exact;
  return (
    ex99.find((d) => /press\s+release|news\s+release/i.test(`${d.description} ${d.name}`)) ??
    ex99.find((d) => /^EX-99$/i.test(d.type)) ??
    null
  );
}

export async function fetchDocumentText(url, { fetchText = secFetchText } = {}) {
  return htmlToText(await fetchText(url));
}
