---
name: crm-retention-plan
description: Prepare a verifiable retention plan and manual execution checklist; propose a task draft for one platform confirmation. Loaded by the platform; request only if not already present.
metadata: {"suite":{"version":"1.0.1","appId":"crm"}}
---
# CRM retention plan v1.0.1
This skill is supplied by the authenticated platform. Follow it directly when already in context; call crm.load_skill only when this skill is missing. No shell or filesystem tool is required.
1. Read current metrics and preview an explicitly described target rule. Base recommendations on those facts and distinguish assumptions.
2. Produce a title, goal, complete planText, stable-ID checklist and hypotheses. Never put contacts, credentials or raw imports in the plan. Never invent owner IDs or deadlines; leave missing fields for human completion.
3. Only propose crm.create_task_draft when the user explicitly asks. Its input must reference a real fresh evaluationId/previewHash if targets are specified. One platform confirmation writes one draft; text-only agreement does not execute.
4. A CRM manager reviews/submits/confirms targets and plan version. The assigned operator manually executes. This skill cannot confirm, start, complete, cancel, send messages, issue coupons, or modify customer data.
5. Freeze target membership, confirmed plan version and baseline/observation windows at confirmation. Report actual authorized purchases to date. With no execution logs, label results as a target-cohort observation, never incremental revenue or causality.
