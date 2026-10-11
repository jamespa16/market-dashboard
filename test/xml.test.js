import test from "node:test";
import assert from "node:assert/strict";
import { parseRssItems, stripHtml, decodeEntities } from "../src/xml.js";

const SAMPLE = `<?xml version="1.0"?>
<rss><channel><title>Feed</title>
<item>
  <title>Acme &amp; Co to acquire Beta - Reuters</title>
  <link>https://example.com/a?x=1&amp;y=2</link>
  <pubDate>Mon, 19 Jan 2026 10:00:00 GMT</pubDate>
  <description>&lt;a href="https://example.com"&gt;Acme &amp;amp; Co buys Beta&lt;/a&gt;</description>
  <source url="https://reuters.com">Reuters</source>
</item>
<item>
  <title><![CDATA[Gamma <b>to buy</b> Delta]]></title>
  <link>https://example.com/b</link>
</item>
</channel></rss>`;

test("parseRssItems parses entities, source and fields", () => {
  const [first] = parseRssItems(SAMPLE);
  assert.equal(first.title, "Acme & Co to acquire Beta - Reuters");
  assert.equal(first.link, "https://example.com/a?x=1&y=2");
  assert.equal(first.pubDate, "Mon, 19 Jan 2026 10:00:00 GMT");
  assert.equal(first.sourceName, "Reuters");
  assert.equal(first.sourceUrl, "https://reuters.com");
  assert.match(first.descriptionHtml, /^&lt;a href/);
});

test("parseRssItems handles missing fields", () => {
  const items = parseRssItems(SAMPLE);
  assert.equal(items.length, 2);
  assert.equal(items[1].pubDate, null);
  assert.equal(items[1].descriptionHtml, "");
  assert.equal(items[1].sourceName, null);
  assert.equal(items[1].sourceUrl, null);
});

test("parseRssItems with CDATA", () => {
  const [, second] = parseRssItems(SAMPLE);
  assert.equal(second.title, "Gamma <b>to buy</b> Delta");
});

test("parseRssItems on empty or item-less input", () => {
  assert.deepEqual(parseRssItems(""), []);
  assert.deepEqual(parseRssItems("<rss><channel></channel></rss>"), []);
});

test("stripHtml decodes escaped markup, strips tags, collapses whitespace", () => {
  assert.equal(stripHtml('&lt;a href="x"&gt;Acme &amp;amp; Co&lt;/a&gt;  buys\n Beta'), "Acme & Co buys Beta");
  assert.equal(stripHtml("<p>Hello</p>  <b>world</b>"), "Hello world");
  assert.equal(stripHtml(""), "");
  assert.equal(stripHtml(null), "");
});

test("decodeEntities handles named and numeric entities", () => {
  assert.equal(decodeEntities("&lt;&gt;&quot;&#39;&apos;&amp;"), "<>\"''&");
  assert.equal(decodeEntities("&#65;&#x42;"), "AB");
  assert.equal(decodeEntities("&unknown;"), "&unknown;");
  assert.equal(decodeEntities(undefined), "");
});
