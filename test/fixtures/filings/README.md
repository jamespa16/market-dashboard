# SEC filing text corpus

Plain-text copies of the press-release exhibit (EX-99.1) for each of the 40 `source: "sec-edgar"` items in
`../deals.json`, one file per accession number: `<adsh>.txt`. SEC filings are public domain.

- Line 1 is a header: `# source: <url> (<exhibit type>)`. The rest is the document converted to plain text
  (paragraph breaks kept, entities decoded, whitespace collapsed).
- Exhibit choice: EX-99.1; else the first EX-99.x whose description looks like a press release; else the primary
  8-K document from the item's `link` (shown as `primary document`). 9 of 40 filings had no EX-99.x and use the
  primary 8-K body (Item 1.01 / 2.01 / 3.02 text, including the cover page).
- Texts over 40,000 characters keep the first 24,990 and last 14,990 characters joined by a `[...]` marker (advisers
  sections sit near the end of press releases).
- `labels.json` holds hand-labeled expected values per filing: `acquirer`, `target`, `dealValueUsd`, `perSharePrice`,
  `consideration`, `expectedClose`, `financialAdvisers[]`, `legalAdvisers[]`. Values are null when the text does not
  state them. `acquirer`/`target` agree with `deals.json`; the optional `acquirerAlt`/`targetAlt` give the form the
  text itself uses when it differs (e.g. "CD&R"). Filings that `deals.json` marks as non-deals have null parties.
  `test/pressRelease.test.js` scores `src/pressRelease.js` against these labels.

## Re-running

```
SEC_USER_AGENT="my-app (contact: me@example.com)" node scripts/collect-filings.js          # fetch missing files
SEC_USER_AGENT="..." node scripts/collect-filings.js --force                                # refetch all
```

Requests are sequential with >=150 ms gaps and one retry on 429/5xx. After refetching, re-check `labels.json`
by hand if a text changed.
