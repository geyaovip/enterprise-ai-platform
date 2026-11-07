# Source-bound extraction rules

Apply these rules within the caller's JSON schema. This is a transcription pass, not a redesign or a search for likely components.

- Establish the header-to-field map before emitting rows. Each destination scalar refers to one original column; another column must not be appended merely because no destination key was provided for it. Keep unmapped source-column information in a concise uncertainty note rather than mixing unrelated facts.
- Distinguish an actual repeated parts-list body from title-block metadata, revision records, process requirements, pin definitions and empty continuation headers. Drawing-level metadata cannot become component rows.
- Preserve row boundaries across wraps. Check the first/last visible row and repeated identifiers once. Do not invent sequential source item numbers or reuse a prior page to complete an empty page.
- A literal value and its provenance matter. Preserve identifier punctuation, prefixes, separators and leading zeros. Check confusable glyphs against the image; do not replace a less familiar code with a more common catalogue code. If a character is genuinely unreadable, abstain in that field and identify the row for review, rather than outputting a confident guess.
- Read quantity and unit from their own source cells. Do not fill blanks from a drawn object count, a neighbouring row, a revision, a length or a unit printed elsewhere on the page. An unresolved source quantity stays unresolved after extraction.
- Do one compact internal consistency pass for field placement, quantity context and omitted rows. Return the schema once; do not narrate the checks, append a second alternative BOM or request another model call.
