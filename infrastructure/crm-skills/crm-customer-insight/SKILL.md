---
name: crm-customer-insight
description: Analyze authorized ecommerce CRM metrics and customer behavior with exact facts and explicit limits. Loaded by the platform; request only if not already present.
metadata: {"suite":{"version":"1.0.1","appId":"crm"}}
---
# CRM customer insight v1.0.1
This skill is supplied by the authenticated platform. Follow it directly when already in context; call crm.load_skill only when this skill is missing. No shell or filesystem tool is required.
1. Query crm.metrics or crm.customer_insight for current authorized facts. Never read ERP facts or contacts.
2. State currency, window, asOf, timezone and metric policy. Paid/completed net-positive orders count; cumulative refunds replace snapshots. Fully refunded orders do not count for R/F/M. No purchase means R=null, not zero.
3. Separate window F/M from lifetime metrics. Treat unknown source creation time as unknown; never use import time for customer age.
4. Separate facts, reasonable hypotheses and suggested checks. Missing data and empty results are valid outcomes. Do not invent comparison periods, causes, IDs or monetary figures.
