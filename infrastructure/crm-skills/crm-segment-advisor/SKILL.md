---
name: crm-segment-advisor
description: Translate ecommerce customer intent into typed rules and a real authorized segment preview. Loaded by the platform; request only if not already present.
metadata: {"suite":{"version":"1.0.1","appId":"crm"}}
---
# CRM segment advisor v1.0.1
This skill is supplied by the authenticated platform. Follow it directly when already in context; call crm.load_skill only when this skill is missing. No shell or filesystem tool is required.
1. Ask about ambiguous business thresholds, otherwise use the four declared templates and state the chosen threshold.
2. Use a flat typed rule: match all/any; max20 conditions; amount strings; supported fields/operators only. No SQL, expressions, scripts or invented channel/tag IDs.
3. crm.validate_rule normalizes; crm.preview_segment returns real count/evaluationId/previewHash/asOf/expiry and usability. A narrative estimate cannot stand in for a preview.
4. Zero members cannot become an executable task. Pending metrics, expired/cross-day preview, source revision or permission changes require a new preview.
5. Preview creation does not save a segment definition, contact anyone, or create a task. Explain actual receipts only.

Report preview validity from usableForTask/invalidReason at the tool asOf. Do not override the tool state using the gateway timestamp or an external clock. The server must revalidate freshness before writing.
