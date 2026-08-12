const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(str) {
  if (!str) return "";
  return str.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code) => {
    if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? match;
  });
}

export function stripHtml(str) {
  if (!str) return "";
  // Google News wraps its <description> content as HTML-escaped entities
  // (e.g. "&lt;a href=...&gt;"), so decode first, then strip actual tags.
  const decoded = decodeEntities(str);
  return decodeEntities(decoded.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function matchTag(item, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return item.match(re)?.[1]?.trim();
}

export function parseRssItems(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((item) => {
    const sourceMatch = item.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
    return {
      title: decodeEntities(matchTag(item, "title") ?? ""),
      link: decodeEntities(matchTag(item, "link") ?? ""),
      pubDate: matchTag(item, "pubDate") ?? null,
      descriptionHtml: matchTag(item, "description") ?? "",
      sourceName: sourceMatch ? decodeEntities(sourceMatch[2].trim()) : null,
      sourceUrl: sourceMatch ? sourceMatch[1] : null,
    };
  });
}
