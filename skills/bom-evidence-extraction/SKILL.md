---
name: bom-evidence-extraction
description: Extract source-grounded BOM candidates from mechanical, electronic and wire-harness tables, with type-specific column rules and review gates. Use for drawing-to-BOM extraction or its quality evaluation, not for inferring hidden parts, CAD design or electrical validation.
---

# BOM evidence extraction

Keep source transcription, business material matching and BOM approval separate. This skill produces reviewable candidates; it cannot establish unknown quantities, variants or missing assembly relations.

## Choose the evidence path

- Prefer original worksheet cells or a usable PDF text layer. Verify that the table is a parts list and that its columns were mapped: zero parser rows can mean an unsupported header, not an empty BOM. A title block or fabrication specification is not a parts list.
- For image extraction, retain the original hash/page and prepare a readable table region including headers. A crop must not omit the first/last row or quantity/variant context. Higher-resolution rendering from the original PDF preserves evidence; invented detail does not.
- Record the profile from the visible source headings/layout, not from a benchmark answer or desired outcome. Ambiguous source type uses `general` and manual review.

## Load only the needed extraction rules

For production GLM/Kimi extraction, use the application's frozen, tested base prompt and deterministic field/review gates. D117 found no accuracy gain for these two models and 13-19% more tokens from the long appendix; do not append the whole Skill or all reference files to each call.

For agent-assisted extraction or an explicitly scoped evaluation, use [core](references/core.md) and select one profile:

- `mechanical`: [mechanical](references/mechanical.md), for distinct material identifiers and configuration columns.
- `electronics`: [electronics](references/electronics.md), for MPNs, manufacturers, references and population status.
- `wire-list`: [wire-list](references/wire-list.md), for tabulated wire specifications and separate connector/terminal columns.
- `drawing`: [drawing](references/drawing.md), for drawing sheets, harness tables and mixed table roles; applies to sheets with or without a BOM.
- `general`: core only. Do not read every profile by default.

`scripts/compile_rules.py --profile PROFILE` is an explicit agent/evaluation helper; it is not the GLM/Kimi production prompt. It emits the actual versioned rules to append to the caller's existing extraction schema. It never reads images, answer keys or model responses. For an API model, explicitly load these rules: placing a SKILL.md file on disk does not make the provider execute it.

Version 1.1.0: production rule loading follows the D117 A/B result; conditional references remain available for specific manual review.

## Review and reuse

Run `scripts/review_bom.py --profile PROFILE --input candidate.json` for deterministic structural/safety diagnostics. It reports issues without rewriting values or certifying source accuracy. Compare identifiers, quantity, units, fitted status and variant context with the original. Missing evidence remains unresolved.

Source-dependent corrections, approved column mappings and material aliases need their own provenance, tenant/product/version scope and approval. Never promote an unreviewed model answer into a trusted example, or use historical quantities to fill a new drawing.

## Bound execution

One primary extraction per region; at most one explicitly justified regional recheck. Do not repeatedly regenerate a whole document or use four-model voting as truth. Preserve request/usage state before dispatch, reuse settled results, and stop the affected batch on unknown usage or truncation. These rules do not authorize external writes, deployment, procurement or knowledge-base ingestion.

For evaluation, freeze the skill and source standard first. Compare unchanged images/schema/model parameters, retain failures and measure wrong nonempty values separately from abstentions. Include unseen material and token/price overhead; matched identifiers or a valid JSON object are not complete procurement-BOM correctness.
