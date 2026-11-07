import { Injectable } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { RequestContext } from "../platform/context";
import { infrastructureSecret } from "../platform/infrastructure-contract";
import { CrmCore, type Db } from "./crm-core.service";
import {
  parse,
  uuid,
  key,
  version,
  iso,
  money,
  currency,
  reason as rawReason,
  assertVersion,
  problem,
  json,
  hash,
  cleanText,
  pagination,
  pageResult,
} from "./crm.common";
const text = z.string().trim().min(1).max(200);
const reason = rawReason.transform(cleanText);
const note = z.string().trim().min(2).max(3000).transform(cleanText);
const common = { requestKey: key };
const scoped = { orgUnitId: uuid, channelId: uuid };
const leadFields = {
  ...scoped,
  name: text,
  companyName: text.optional(),
  contact: z.string().trim().min(3).max(200).optional(),
  source: text,
  requirement: note,
};
const opportunityFields = {
  customerId: uuid,
  channelId: uuid,
  name: text,
  kind: z.enum(["new", "renewal"]).default("new"),
  ownerMembershipId: uuid,
  participantMembershipIds: z.array(uuid).max(30).default([]),
  currency,
  estimatedAmount: money,
  probability: z.int().min(0).max(100).default(10),
  expectedCloseAt: iso.optional(),
  nextAction: note.optional(),
  nextActionAt: iso.optional(),
};
const normalized = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, "");
const mask = (s: string) =>
  s.includes("@")
    ? s.replace(/^(.).*(@.*)$/, "$1***$2")
    : s.length < 7
      ? "***"
      : s.slice(0, 3) + "****" + s.slice(-4);
const leadStates: Record<string, string[]> = {
  assign: ["new", "returned", "assigned"],
  accept: ["assigned"],
  return: ["assigned", "working"],
  invalidate: ["new", "assigned", "working", "qualified", "returned"],
  qualify: ["working"],
  request_conversion: ["qualified"],
  approve: ["conversion_pending"],
  reject: ["conversion_pending"],
  convert: ["conversion_approved"],
};
@Injectable()
export class CrmEngagementService {
  constructor(readonly core: CrmCore) {}
  private digest(value: string) {
    const secret = process.env.AI_ENCRYPTION_KEY;
    if (!secret) problem("NOT_CONFIGURED", "加密密钥未配置", 503);
    return createHmac("sha256", secret).update(normalized(value)).digest("hex");
  }
  private async scope(
    ctx: RequestContext,
    permission: string,
    tx: Db = this.core.db,
    kind: "lead" | "opportunity" | "plan" | "risk" | "followup" = "lead",
  ) {
    const { access, bindings } = await this.core.bindings(ctx, permission, tx);
    return {
      access,
      where: {
        tenantId: ctx.tenantId,
        OR: bindings.map((b) => ({
          tenantId: ctx.tenantId,
          ...(b.portfolioOnly
            ? {
                AND: [
                  kind === "opportunity"
                    ? {
                        OR: [
                          { ownerMembershipId: ctx.membershipId },
                          {
                            participantMembershipIds: {
                              array_contains: [ctx.membershipId],
                            },
                          },
                        ],
                      }
                    : kind === "plan"
                      ? {
                          OR: [
                            { ownerMembershipId: ctx.membershipId },
                            {
                              tasks: {
                                some: {
                                  assigneeMembershipId: ctx.membershipId,
                                },
                              },
                            },
                          ],
                        }
                      : kind === "followup"
                        ? { authorMembershipId: ctx.membershipId }
                        : { ownerMembershipId: ctx.membershipId },
                ],
              }
            : {}),
          ...(b.orgUnitIds === "all"
            ? {}
            : { orgUnitId: { in: b.orgUnitIds } }),
          ...(b.channelIds === "all"
            ? {}
            : { channelId: { in: b.channelIds } }),
        })),
      } as any,
    };
  }
  private async manages(
    ctx: RequestContext,
    org: string,
    channel: string,
    tx: Db,
    service = false,
  ) {
    try {
      return await this.core.pairAllowed(
        ctx,
        service ? "crm.service.review" : "crm.sales.manage",
        org,
        channel,
        tx,
      );
    } catch {
      return false;
    }
  }
  private async location(
    ctx: RequestContext,
    permission: string,
    orgUnitId: string,
    channelId: string,
    tx: Db,
  ) {
    await this.core.requirePair(ctx, permission, orgUnitId, channelId, tx);
    if (
      !(await tx.orgUnit.findFirst({
        where: { id: orgUnitId, tenantId: ctx.tenantId, active: true },
      })) ||
      !(await tx.crmSalesChannel.findFirst({
        where: { id: channelId, tenantId: ctx.tenantId, active: true },
      }))
    )
      problem("INVALID_REQUEST", "请选择有效的组织和来源渠道", 400);
  }
  private async member(
    ctx: RequestContext,
    id: string,
    permission: string,
    org: string,
    channel: string,
    tx: Db,
  ) {
    const member = await tx.membership.findFirst({
      where: {
        id,
        tenantId: ctx.tenantId,
        active: true,
        user: { active: true },
      },
    });
    if (!member) problem("INVALID_ASSIGNEE", "负责人已停用或不属于本企业", 400);
    const target = { ...ctx, membershipId: member.id, userId: member.userId };
    try {
      await this.core.requirePair(target, permission, org, channel, tx);
    } catch {
      problem("INVALID_ASSIGNEE", "负责人缺少对应岗位或组织/渠道权限", 400);
    }
    return member;
  }
  private async customer(
    ctx: RequestContext,
    id: string,
    channelId: string,
    permission: string,
    tx: Db,
  ) {
    const c = await this.core.customer(ctx, id, "crm.customer.read", tx);
    if (c.status !== "active")
      problem("INVALID_STATE", "归档客户不能新增销售或服务记录");
    if (!c.identities.some((x: any) => x.channelId === channelId))
      problem("INVALID_REQUEST", "来源渠道不属于该客户", 400);
    await this.location(ctx, permission, c.orgUnitId, channelId, tx);
    return c;
  }
  private async lead(
    ctx: RequestContext,
    id: string,
    permission: string,
    tx: Db,
  ) {
    const { access, where } = await this.scope(ctx, permission, tx);
    const row = await tx.crmLead.findFirst({ where: { ...where, id } });
    if (!row || (!access.manager && row.ownerMembershipId !== ctx.membershipId))
      problem("NOT_FOUND", "线索不存在或不可见", 404);
    return row;
  }
  private async opportunity(
    ctx: RequestContext,
    id: string,
    permission: string,
    tx: Db,
  ) {
    const { access, where } = await this.scope(
      ctx,
      permission,
      tx,
      "opportunity",
    );
    const row = await tx.crmOpportunity.findFirst({ where: { ...where, id } });
    if (
      !row ||
      (!access.manager &&
        row.ownerMembershipId !== ctx.membershipId &&
        !(row.participantMembershipIds as string[]).includes(ctx.membershipId))
    )
      problem("NOT_FOUND", "商机不存在或不可见", 404);
    await this.core.customer(ctx, row.customerId, "crm.customer.read", tx);
    return row;
  }
  private async plan(
    ctx: RequestContext,
    id: string,
    permission: string,
    tx: Db,
  ) {
    const { access, where } = await this.scope(ctx, permission, tx, "plan");
    const row = await tx.crmServicePlan.findFirst({
      where: { ...where, id },
      include: { tasks: true },
    });
    if (
      !row ||
      (!access.manager &&
        row.ownerMembershipId !== ctx.membershipId &&
        !row.tasks.some(
          (t: any) => t.assigneeMembershipId === ctx.membershipId,
        ))
    )
      problem("NOT_FOUND", "服务计划不存在或不可见", 404);
    await this.core.customer(ctx, row.customerId, "crm.customer.read", tx);
    return row;
  }
  private async duplicates(ctx: RequestContext, i: any, tx: Db) {
    const { where, access } = await this.scope(ctx, "crm.sales.read", tx);
    return tx.crmLead.findMany({
      where: {
        ...where,
        ...(access.manager ? {} : { ownerMembershipId: ctx.membershipId }),
        AND: [
          {
            OR: [
              { normalizedName: normalized(i.name) },
              ...(i.contact ? [{ contactDigest: this.digest(i.contact) }] : []),
            ],
          },
        ],
      },
      select: { id: true, name: true, status: true },
      take: 20,
    });
  }
  async leadCandidates(ctx: RequestContext, raw: unknown) {
    const i = parse(
      z
        .object({ name: text, contact: z.string().max(200).optional() })
        .strict(),
      raw,
    );
    return { items: await this.duplicates(ctx, i, this.core.db) };
  }
  async leads(ctx: RequestContext, q: any) {
    const { access, where } = await this.scope(ctx, "crm.sales.read"),
      p = pagination(q);
    const filter: any = {
      ...where,
      ...(access.manager ? {} : { ownerMembershipId: ctx.membershipId }),
      ...(q.q
        ? { name: { contains: String(q.q).slice(0, 100), mode: "insensitive" } }
        : {}),
      ...(q.status ? { status: String(q.status) } : {}),
    };
    return pageResult(
      await this.core.db.crmLead.findMany({
        where: filter,
        select: {
          id: true,
          name: true,
          companyName: true,
          contactMasked: true,
          source: true,
          requirement: true,
          status: true,
          ownerMembershipId: true,
          version: true,
          customerId: true,
          createdAt: true,
          orgUnitId: true,
          channelId: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (p.page - 1) * p.page_size,
        take: p.page_size,
      }),
      await this.core.db.crmLead.count({ where: filter }),
      p,
    );
  }
  async getLead(ctx: RequestContext, id: string) {
    const row = await this.lead(ctx, id, "crm.sales.read", this.core.db);
    const { contactCiphertext, contactDigest, ...safe } = row;
    const activity = await this.core.db.auditEvent.findMany({
      where: {
        tenantId: ctx.tenantId,
        appId: "crm",
        resourceType: "CrmLead",
        resourceId: id,
      },
      select: {
        id: true,
        action: true,
        membershipId: true,
        createdAt: true,
        detail: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { ...safe, activity };
  }
  async leadContact(ctx: RequestContext, id: string) {
    const row = await this.lead(ctx, id, "crm.sales.read", this.core.db);
    await this.core.requirePair(
      ctx,
      "crm.customer.contact.read",
      row.orgUnitId,
      row.channelId,
    );
    await this.core.audit(
      this.core.db,
      ctx,
      "lead.contact.read",
      "CrmLead",
      id,
    );
    return {
      value: row.contactCiphertext
        ? infrastructureSecret(row.contactCiphertext, true)
        : null,
    };
  }
  async createLead(ctx: RequestContext, raw: unknown) {
    const i = parse(
      z
        .object({
          ...leadFields,
          ...common,
          allowDuplicate: z.boolean().default(false),
          duplicateReason: reason.optional(),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.sales.write",
      "lead.create",
      i,
      async (tx) => {
        await this.location(
          ctx,
          "crm.sales.write",
          i.orgUnitId,
          i.channelId,
          tx,
        );
        await this.core.lock(
          tx,
          ctx.tenantId + ":crm:lead:" + normalized(i.name),
        );
        if (i.contact)
          await this.core.lock(
            tx,
            ctx.tenantId + ":crm:lead-contact:" + this.digest(i.contact),
          );
        const dup = await this.duplicates(ctx, i, tx);
        if (dup.length && (!i.allowDuplicate || !i.duplicateReason))
          problem(
            "DUPLICATE_CANDIDATE",
            "存在同名或相同联系方式的线索，请查看候选并说明重复建档原因",
          );
        const managed = await this.manages(ctx, i.orgUnitId, i.channelId, tx);
        const r = await tx.crmLead.create({
          data: {
            tenantId: ctx.tenantId,
            orgUnitId: i.orgUnitId,
            channelId: i.channelId,
            name: i.name,
            normalizedName: normalized(i.name),
            companyName: i.companyName,
            source: i.source,
            requirement: i.requirement,
            ...(i.contact
              ? {
                  contactCiphertext: infrastructureSecret(i.contact),
                  contactMasked: mask(i.contact),
                  contactDigest: this.digest(i.contact),
                }
              : {}),
            ownerMembershipId: managed ? null : ctx.membershipId,
            status: managed ? "new" : "assigned",
          },
        });
        await this.core.audit(tx, ctx, "lead.create", "CrmLead", r.id, {
          duplicateConfirmed: dup.length > 0,
          reason: i.duplicateReason,
        });
        return { id: r.id, version: r.version, status: r.status };
      },
    );
  }
  async leadAction(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          version,
          action: z.enum([
            "assign",
            "accept",
            "return",
            "invalidate",
            "qualify",
            "request_conversion",
            "approve",
            "reject",
            "convert",
          ]),
          ownerMembershipId: uuid.optional(),
          poolId: uuid.optional(),
          reason: reason.optional(),
          customerId: uuid.optional(),
          createOpportunity: z.boolean().default(false),
        })
        .strict(),
      raw,
    );
    const manage = ["assign", "approve", "reject"].includes(i.action);
    return this.core.write(
      ctx,
      manage ? "crm.sales.manage" : "crm.sales.write",
      "lead." + id + "." + i.action,
      i,
      async (tx) => {
        await this.core.lock(tx, ctx.tenantId + ":crm:lead:" + id);
        const r = await this.lead(
          ctx,
          id,
          manage ? "crm.sales.manage" : "crm.sales.write",
          tx,
        );
        assertVersion(r, i.version);
        if (!leadStates[i.action].includes(r.status))
          problem("INVALID_STATE", "当前线索状态不支持此操作");
        const access = await this.core.guard(
          ctx,
          manage ? "crm.sales.manage" : "crm.sales.write",
          tx,
        );
        if (!access.manager && r.ownerMembershipId !== ctx.membershipId)
          problem("FORBIDDEN", "仅负责人可处理线索", 403);
        let data: any = { version: { increment: 1 } };
        const states: any = {
          accept: "working",
          return: "returned",
          invalidate: "invalid",
          qualify: "qualified",
          request_conversion: "conversion_pending",
          approve: "conversion_approved",
          reject: "qualified",
          assign: "assigned",
          convert: "converted",
        };
        data.status = states[i.action];
        if (["return", "invalidate", "reject"].includes(i.action) && !i.reason)
          problem("INVALID_REQUEST", "请填写原因", 400);
        if (i.action === "assign") {
          let owner = i.ownerMembershipId;
          if (i.poolId) {
            const pool = await tx.crmSalesPool.findFirst({
              where: {
                id: i.poolId,
                tenantId: ctx.tenantId,
                orgUnitId: r.orgUnitId,
                channelId: r.channelId,
                active: true,
              },
            });
            if (!pool) problem("INVALID_REQUEST", "销售池不可用", 400);
            await this.core.lock(tx, ctx.tenantId + ":crm:pool:" + pool.id);
            const fresh = await tx.crmSalesPool.findUnique({
              where: { id: pool.id },
            });
            const ids = fresh.memberIds as string[];
            owner = undefined;
            for (let offset = 0; offset < ids.length; offset++) {
              const n = (fresh.nextIndex + offset) % ids.length;
              try {
                await this.member(
                  ctx,
                  ids[n],
                  "crm.sales.write",
                  r.orgUnitId,
                  r.channelId,
                  tx,
                );
                owner = ids[n];
                await tx.crmSalesPool.update({
                  where: { id: pool.id },
                  data: {
                    nextIndex: fresh.nextIndex + offset + 1,
                    version: { increment: 1 },
                  },
                });
                break;
              } catch {}
            }
          }
          if (!owner)
            problem(
              "INVALID_ASSIGNEE",
              "请选择负责人或配置有可用成员的销售池",
              400,
            );
          await this.member(
            ctx,
            owner,
            "crm.sales.write",
            r.orgUnitId,
            r.channelId,
            tx,
          );
          data.ownerMembershipId = owner;
        }
        if (i.action === "return") data.ownerMembershipId = null;
        if (i.action === "convert") {
          if (!r.ownerMembershipId)
            problem("INVALID_STATE", "请先分配销售负责人");
          let c;
          if (i.customerId)
            c = await this.customer(
              ctx,
              i.customerId,
              r.channelId,
              "crm.sales.write",
              tx,
            );
          else
            c = await this.createCustomerIn(tx, ctx, {
              orgUnitId: r.orgUnitId,
              channelId: r.channelId,
              displayName: r.companyName ?? r.name,
              kind: r.companyName ? "organization" : "consumer",
              ownerMembershipId: r.ownerMembershipId,
            });
          data.customerId = c.id;
          if (r.contactCiphertext) {
            const value = infrastructureSecret(r.contactCiphertext, true);
            await tx.crmBusinessContact.create({
              data: {
                tenantId: ctx.tenantId,
                customerId: c.id,
                name: r.name,
                contactCiphertext: infrastructureSecret(value),
                maskedValue: mask(value),
                purpose: "销售跟进",
              },
            });
          }
          if (i.createOpportunity) {
            const o = await this.opportunityIn(
              ctx,
              {
                customerId: c.id,
                channelId: r.channelId,
                name: r.name + "合作商机",
                kind: "new",
                ownerMembershipId: r.ownerMembershipId,
                participantMembershipIds: [],
                currency: "CNY",
                estimatedAmount: "0.00",
                probability: 10,
              },
              tx,
            );
            data.convertedOpportunityId = o.id;
          }
        }
        delete data.version;
        const updated = await this.updateVersion(
          tx,
          "crmLead",
          id,
          r.version,
          data,
        );
        await this.core.audit(tx, ctx, "lead." + i.action, "CrmLead", id, {
          from: r.status,
          to: updated.status,
          ownerMembershipId: updated.ownerMembershipId,
          customerId: updated.customerId,
          reason: i.reason,
        });
        return {
          id,
          version: updated.version,
          status: updated.status,
          customerId: updated.customerId,
          opportunityId: updated.convertedOpportunityId,
        };
      },
    );
  }
  private async createCustomerIn(tx: Db, ctx: RequestContext, i: any) {
    await this.location(
      ctx,
      "crm.customer.write",
      i.orgUnitId,
      i.channelId,
      tx,
    );
    if (i.ownerMembershipId)
      await this.member(
        ctx,
        i.ownerMembershipId,
        "crm.sales.write",
        i.orgUnitId,
        i.channelId,
        tx,
      );
    if (i.registrationId) {
      await this.core.lock(
        tx,
        ctx.tenantId + ":crm:registration:" + i.registrationId,
      );
      if (
        await tx.crmCustomer.findFirst({
          where: { tenantId: ctx.tenantId, registrationId: i.registrationId },
        })
      )
        problem("DUPLICATE_CUSTOMER", "该统一标识已有客户");
    }
    const id = randomUUID(),
      r = await tx.crmCustomer.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          orgUnitId: i.orgUnitId,
          displayName: i.displayName,
          kind: i.kind,
          ownerMembershipId: i.ownerMembershipId,
          registrationId: i.registrationId,
          industry: i.industry,
          region: i.region,
          sourceCreatedAt: this.core.now(),
          sourceHash: hash({ manual: id }),
        },
      });
    await tx.crmCustomerIdentity.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: id,
        channelId: i.channelId,
        externalCustomerId: "manual:" + id,
      },
    });
    await this.core.bump(tx, ctx, [i.channelId], "customer");
    return r;
  }
  async createCustomer(ctx: RequestContext, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          ...scoped,
          displayName: text,
          kind: z.enum(["consumer", "organization"]).default("consumer"),
          ownerMembershipId: uuid.optional(),
          registrationId: text.optional(),
          industry: text.optional(),
          region: text.optional(),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.customer.write",
      "customer.create",
      i,
      async (tx) => {
        const a = await this.core.guard(ctx, "crm.customer.write", tx);
        if (
          !(await this.manages(ctx, i.orgUnitId, i.channelId, tx)) &&
          i.ownerMembershipId &&
          i.ownerMembershipId !== ctx.membershipId
        )
          problem("FORBIDDEN", "只能为自己建立客户，转派请联系负责人", 403);
        const r = await this.createCustomerIn(tx, ctx, {
          ...i,
          ownerMembershipId:
            i.ownerMembershipId ??
            (a.permissions.includes("crm.sales.write")
              ? ctx.membershipId
              : undefined),
        });
        await this.core.audit(tx, ctx, "customer.create", "CrmCustomer", r.id);
        return { id: r.id, version: r.version };
      },
    );
  }
  async assignCustomer(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          version,
          ownerMembershipId: uuid.nullable(),
          serviceOwnerMembershipId: uuid.nullable(),
          reason,
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.customer.assign",
      "customer.assign:" + id,
      i,
      async (tx) => {
        await this.core.lock(tx, ctx.tenantId + ":crm:customer:" + id);
        const c = await this.core.customer(ctx, id, "crm.customer.read", tx);
        assertVersion(c, i.version);
        for (const identity of c.identities) {
          await this.core.requirePair(
            ctx,
            "crm.customer.assign",
            c.orgUnitId,
            identity.channelId,
            tx,
          );
          if (i.ownerMembershipId)
            await this.member(
              ctx,
              i.ownerMembershipId,
              "crm.sales.write",
              c.orgUnitId,
              identity.channelId,
              tx,
            );
          if (i.serviceOwnerMembershipId)
            await this.member(
              ctx,
              i.serviceOwnerMembershipId,
              "crm.service.write",
              c.orgUnitId,
              identity.channelId,
              tx,
            );
        }
        const r = await this.updateVersion(tx, "crmCustomer", id, c.version, {
          ownerMembershipId: i.ownerMembershipId,
          serviceOwnerMembershipId: i.serviceOwnerMembershipId,
        });
        await this.core.audit(tx, ctx, "customer.assign", "CrmCustomer", id, {
          from: {
            owner: c.ownerMembershipId,
            serviceOwner: c.serviceOwnerMembershipId,
          },
          to: {
            owner: r.ownerMembershipId,
            serviceOwner: r.serviceOwnerMembershipId,
          },
          reason: i.reason,
        });
        return { id, version: r.version };
      },
    );
  }
  async contacts(ctx: RequestContext, id: string, reveal = false) {
    const c = await this.core.customer(
      ctx,
      id,
      reveal ? "crm.customer.contact.read" : "crm.customer.read",
    );
    const rows = await this.core.db.crmBusinessContact.findMany({
      where: { tenantId: ctx.tenantId, customerId: c.id },
      orderBy: { createdAt: "asc" },
    });
    if (reveal)
      await this.core.audit(
        this.core.db,
        ctx,
        "business-contact.read",
        "CrmCustomer",
        id,
      );
    return {
      items: rows.map(({ contactCiphertext, ...r }) => ({
        ...r,
        ...(reveal
          ? { value: infrastructureSecret(contactCiphertext, true) }
          : {}),
      })),
    };
  }
  async saveContact(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          id: uuid.optional(),
          version: version.optional(),
          name: text,
          title: text.optional(),
          value: z.string().trim().min(3).max(200),
          purpose: text,
          preferred: z.boolean().default(false),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.customer.write",
      "contact.save:" + id,
      i,
      async (tx) => {
        const c = await this.core.customer(ctx, id, "crm.customer.write", tx);
        for (const identity of c.identities)
          await this.core.requirePair(
            ctx,
            "crm.customer.write",
            c.orgUnitId,
            identity.channelId,
            tx,
          );
        if (i.id) {
          await this.core.customer(ctx, id, "crm.customer.contact.read", tx);
          const old = await tx.crmBusinessContact.findFirst({
            where: { id: i.id, tenantId: ctx.tenantId, customerId: id },
          });
          assertVersion(old, i.version ?? 0);
        }
        const data = {
          name: i.name,
          title: i.title,
          contactCiphertext: infrastructureSecret(i.value),
          maskedValue: mask(i.value),
          purpose: i.purpose,
          preferred: i.preferred,
        };
        const r = i.id
          ? await this.updateVersion(
              tx,
              "crmBusinessContact",
              i.id,
              i.version!,
              data,
            )
          : await tx.crmBusinessContact.create({
              data: { ...data, tenantId: ctx.tenantId, customerId: id },
            });
        await this.core.audit(
          tx,
          ctx,
          "business-contact.save",
          "CrmCustomer",
          id,
          { contactId: r.id, version: r.version },
        );
        return { id: r.id, version: r.version };
      },
    );
  }
  async pools(ctx: RequestContext) {
    const { where } = await this.scope(ctx, "crm.sales.manage");
    return {
      items: await this.core.db.crmSalesPool.findMany({
        where,
        orderBy: { createdAt: "desc" },
      }),
    };
  }
  async savePool(ctx: RequestContext, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          ...scoped,
          id: uuid.optional(),
          version: version.optional(),
          name: text,
          memberIds: z.array(uuid).min(1).max(100),
          active: z.boolean().default(true),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.sales.manage",
      "pool.save",
      i,
      async (tx) => {
        await this.location(
          ctx,
          "crm.sales.manage",
          i.orgUnitId,
          i.channelId,
          tx,
        );
        if (new Set(i.memberIds).size !== i.memberIds.length)
          problem("INVALID_REQUEST", "销售池成员不能重复", 400);
        for (const id of i.memberIds)
          await this.member(
            ctx,
            id,
            "crm.sales.write",
            i.orgUnitId,
            i.channelId,
            tx,
          );
        if (i.id) {
          await this.core.lock(tx, ctx.tenantId + ":crm:pool:" + i.id);
          const old = await tx.crmSalesPool.findFirst({
            where: { id: i.id, tenantId: ctx.tenantId },
          });
          assertVersion(old, i.version ?? 0);
          await this.core.requirePair(
            ctx,
            "crm.sales.manage",
            old.orgUnitId,
            old.channelId,
            tx,
          );
          if (old.orgUnitId !== i.orgUnitId || old.channelId !== i.channelId)
            problem("INVALID_REQUEST", "已有销售池不能改变组织和渠道", 400);
        }
        const data = {
          orgUnitId: i.orgUnitId,
          channelId: i.channelId,
          name: i.name,
          memberIds: json(i.memberIds),
          active: i.active,
          nextIndex: 0,
        };
        const r = i.id
          ? await this.updateVersion(tx, "crmSalesPool", i.id, i.version!, data)
          : await tx.crmSalesPool.create({
              data: { ...data, tenantId: ctx.tenantId },
            });
        await this.core.audit(tx, ctx, "pool.save", "CrmSalesPool", r.id);
        return { id: r.id, version: r.version };
      },
    );
  }
  async editLead(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          version,
          name: text,
          companyName: text.optional(),
          source: text,
          requirement: note,
          contact: z.string().trim().min(3).max(200).optional(),
          allowDuplicate: z.boolean().default(false),
          duplicateReason: reason.optional(),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.sales.write",
      "lead.edit:" + id,
      i,
      async (tx) => {
        const old = await this.lead(ctx, id, "crm.sales.write", tx);
        assertVersion(old, i.version);
        if (
          !["new", "assigned", "working", "qualified", "returned"].includes(
            old.status,
          )
        )
          problem("INVALID_STATE", "审核中或已结束的线索不可修改");
        if (normalized(i.name) !== old.normalizedName || i.contact) {
          await this.core.lock(
            tx,
            ctx.tenantId + ":crm:lead:" + normalized(i.name),
          );
          const duplicates = (await this.duplicates(ctx, i, tx)).filter(
            (r: any) => r.id !== id,
          );
          if (duplicates.length && (!i.allowDuplicate || !i.duplicateReason))
            problem("DUPLICATE_CANDIDATE", "请核对重复线索并说明保留原因");
        }
        const row = await this.updateVersion(tx, "crmLead", id, old.version, {
          name: i.name,
          normalizedName: normalized(i.name),
          companyName: i.companyName,
          source: i.source,
          requirement: i.requirement,
          ...(i.contact
            ? {
                contactCiphertext: infrastructureSecret(i.contact),
                contactMasked: mask(i.contact),
                contactDigest: this.digest(i.contact),
              }
            : {}),
        });
        await this.core.audit(tx, ctx, "lead.edit", "CrmLead", id, {
          version: row.version,
          reason: i.duplicateReason,
        });
        return { id, version: row.version };
      },
    );
  }
  async profile(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          version,
          kind: z.enum(["consumer", "organization"]),
          industry: text.optional(),
          region: text.optional(),
          registrationId: text.optional(),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.customer.write",
      "customer.profile:" + id,
      i,
      async (tx) => {
        const c = await this.core.customer(ctx, id, "crm.customer.write", tx);
        assertVersion(c, i.version);
        for (const identity of c.identities)
          await this.core.requirePair(
            ctx,
            "crm.customer.write",
            c.orgUnitId,
            identity.channelId,
            tx,
          );
        const r = await this.updateVersion(tx, "crmCustomer", id, c.version, {
          kind: i.kind,
          industry: i.industry ?? null,
          region: i.region ?? null,
          registrationId: i.registrationId ?? null,
        });
        await this.core.audit(tx, ctx, "customer.profile", "CrmCustomer", id, {
          version: r.version,
        });
        return { id, version: r.version };
      },
    );
  }
  async createRenewal(ctx: RequestContext, raw: unknown) {
    const i = parse(
      z.object({ ...common, ...opportunityFields }).strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.sales.renewal",
      "service.renewal",
      i,
      async (tx) => {
        const c = await this.customer(
            ctx,
            i.customerId,
            i.channelId,
            "crm.sales.renewal",
            tx,
          ),
          a = await this.core.guard(ctx, "crm.sales.renewal", tx);
        if (
          !(await this.manages(ctx, c.orgUnitId, i.channelId, tx, true)) &&
          c.serviceOwnerMembershipId !== ctx.membershipId
        )
          problem("FORBIDDEN", "仅服务负责人可发起续约商机", 403);
        for (const id of new Set([
          i.ownerMembershipId,
          ...i.participantMembershipIds,
        ]))
          await this.member(
            ctx,
            id,
            "crm.sales.write",
            c.orgUnitId,
            i.channelId,
            tx,
          );
        const { requestKey, ...fields } = i;
        const r = await tx.crmOpportunity.create({
          data: {
            ...fields,
            kind: "renewal",
            tenantId: ctx.tenantId,
            orgUnitId: c.orgUnitId,
            participantMembershipIds: json(i.participantMembershipIds),
          },
        });
        await this.core.audit(
          tx,
          ctx,
          "service.renewal",
          "CrmOpportunity",
          r.id,
          { customerId: c.id },
        );
        return { id: r.id, version: r.version };
      },
    );
  }
  private async updateVersion(
    tx: Db,
    table: string,
    id: string,
    expected: number,
    data: any,
  ) {
    const changed = await tx[table].updateMany({
      where: { id, version: expected },
      data: { ...data, version: { increment: 1 } },
    });
    if (changed.count !== 1)
      problem("VERSION_CONFLICT", "记录已变化，请重新核对");
    return tx[table].findUnique({ where: { id } });
  }
  private async opportunityIn(ctx: RequestContext, i: any, tx: Db) {
    const c = await this.customer(
      ctx,
      i.customerId,
      i.channelId,
      "crm.sales.write",
      tx,
    );
    const managed = await this.manages(ctx, c.orgUnitId, i.channelId, tx);
    if (!managed && i.ownerMembershipId !== ctx.membershipId)
      problem("FORBIDDEN", "请由主管分配其他销售负责人", 403);
    for (const id of new Set([
      i.ownerMembershipId,
      ...i.participantMembershipIds,
    ]))
      await this.member(
        ctx,
        id,
        "crm.sales.write",
        c.orgUnitId,
        i.channelId,
        tx,
      );
    return tx.crmOpportunity.create({
      data: {
        tenantId: ctx.tenantId,
        orgUnitId: c.orgUnitId,
        ...i,
        participantMembershipIds: json(i.participantMembershipIds),
      },
    });
  }
  async opportunities(ctx: RequestContext, q: any) {
    const { access, where } = await this.scope(
        ctx,
        "crm.sales.read",
        this.core.db,
        "opportunity",
      ),
      p = pagination(q);
    const w: any = {
      ...where,
      customer: await this.core.customerWhere(ctx),
      ...(q.customerId ? { customerId: parse(uuid, q.customerId) } : {}),
      ...(q.stage ? { stage: String(q.stage) } : {}),
      ...(q.overdue==='true'?{stage:{notIn:['won','lost']},nextActionAt:{lte:this.core.now()}}:{}),
      ...(q.q
        ? { name: { contains: String(q.q).slice(0, 100), mode: "insensitive" } }
        : {}),
    };
    if (!access.manager)
      w.AND = [
        {
          OR: [
            { ownerMembershipId: ctx.membershipId },
            {
              participantMembershipIds: { array_contains: [ctx.membershipId] },
            },
          ],
        },
      ];
    return pageResult(
      await this.core.db.crmOpportunity.findMany({
        where: w,
        orderBy: { createdAt: "desc" },
        skip: (p.page - 1) * p.page_size,
        take: p.page_size,
        include: { customer: { select: { displayName: true } } },
      }),
      await this.core.db.crmOpportunity.count({ where: w }),
      p,
    );
  }
  async getOpportunity(ctx: RequestContext, id: string) {
    return this.opportunity(ctx, id, "crm.sales.read", this.core.db);
  }
  async saveOpportunity(
    ctx: RequestContext,
    id: string | undefined,
    raw: unknown,
  ) {
    const i = parse(
      z
        .object({
          ...common,
          ...opportunityFields,
          version: version.optional(),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.sales.write",
      "opportunity.save:" + (id ?? "new"),
      i,
      async (tx) => {
        const { requestKey, version: v, ...fields } = i;
        let r;
        if (id) {
          const old = await this.opportunity(ctx, id, "crm.sales.write", tx);
          assertVersion(old, v ?? 0);
          const a = await this.core.guard(ctx, "crm.sales.write", tx);
          if (
            !(await this.manages(ctx, old.orgUnitId, old.channelId, tx)) &&
            old.ownerMembershipId !== ctx.membershipId
          )
            problem("FORBIDDEN", "参与人不能修改商机归属和金额", 403);
          if (["won", "lost"].includes(old.stage))
            problem("INVALID_STATE", "已结束商机不能修改");
          if (old.customerId !== i.customerId || old.channelId !== i.channelId)
            problem("INVALID_REQUEST", "不能直接修改商机客户和来源", 400);
          if (
            !(await this.manages(ctx, old.orgUnitId, old.channelId, tx)) &&
            i.ownerMembershipId !== ctx.membershipId
          )
            problem("FORBIDDEN", "转派商机需要主管操作", 403);
          for (const mid of new Set([
            i.ownerMembershipId,
            ...i.participantMembershipIds,
          ]))
            await this.member(
              ctx,
              mid,
              "crm.sales.write",
              old.orgUnitId,
              old.channelId,
              tx,
            );
          r = await this.updateVersion(tx, "crmOpportunity", id, old.version, {
            ...fields,
            participantMembershipIds: json(fields.participantMembershipIds),
          });
        } else r = await this.opportunityIn(ctx, fields, tx);
        await this.core.audit(
          tx,
          ctx,
          "opportunity.save",
          "CrmOpportunity",
          r.id,
          { version: r.version },
        );
        return { id: r.id, version: r.version };
      },
    );
  }
  async opportunityStage(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          version,
          stage: z.enum([
            "discovery",
            "solution",
            "negotiation",
            "won",
            "lost",
          ]),
          actualAmount: money.optional(),
          actualCloseAt: iso.optional(),
          reason: reason.optional(),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.sales.write",
      "opportunity.stage:" + id,
      i,
      async (tx) => {
        const r = await this.opportunity(ctx, id, "crm.sales.write", tx),
          a = await this.core.guard(ctx, "crm.sales.write", tx);
        assertVersion(r, i.version);
        if (
          !(await this.manages(ctx, r.orgUnitId, r.channelId, tx)) &&
          r.ownerMembershipId !== ctx.membershipId
        )
          problem("FORBIDDEN", "仅负责人可变更商机阶段", 403);
        const next: Record<string, string[]> = {
          discovery: ["solution", "lost"],
          solution: ["negotiation", "lost"],
          negotiation: ["won", "lost"],
        };
        if (!next[r.stage]?.includes(i.stage))
          problem("INVALID_STATE", "请按销售阶段推进，终态不能回退");
        if (i.stage === "won" && (!i.actualAmount || !i.actualCloseAt))
          problem("INVALID_REQUEST", "赢单需填写实际签约金额和日期", 400);
        if (i.stage === "won" && new Date(i.actualCloseAt!) > this.core.now())
          problem("INVALID_REQUEST", "实际签约时间不能在未来", 400);
        if (i.stage === "lost" && !i.reason)
          problem("INVALID_REQUEST", "请填写输单原因", 400);
        const row = await this.updateVersion(
          tx,
          "crmOpportunity",
          id,
          r.version,
          {
            stage: i.stage,
            ...(i.stage === "won"
              ? {
                  actualAmount: i.actualAmount,
                  actualCloseAt: new Date(i.actualCloseAt!),
                }
              : {}),
            ...(i.stage === "lost" ? { lostReason: i.reason } : {}),
          },
        );
        await this.core.audit(
          tx,
          ctx,
          "opportunity.stage",
          "CrmOpportunity",
          id,
          { from: r.stage, to: i.stage, reason: i.reason },
        );
        return { id, stage: row.stage, version: row.version };
      },
    );
  }
  private async target(
    ctx: RequestContext,
    type: string,
    id: string,
    channelId: string,
    permission: string,
    tx: Db,
  ) {
    let r: any;
    if (type === "customer") {
      r = await this.customer(ctx, id, channelId, permission, tx);
      return { orgUnitId: r.orgUnitId, channelId };
    }
    if (type === "lead") r = await this.lead(ctx, id, "crm.sales.read", tx);
    else r = await this.opportunity(ctx, id, "crm.sales.read", tx);
    if (r.channelId !== channelId) problem("NOT_FOUND", "来源不匹配", 404);
    await this.core.requirePair(ctx, permission, r.orgUnitId, r.channelId, tx);
    return { orgUnitId: r.orgUnitId, channelId: r.channelId };
  }
  async followUps(ctx: RequestContext, q: any) {
    const i = parse(
      z
        .object({
          targetType: z.enum(["customer", "lead", "opportunity"]),
          targetId: uuid,
          channelId: uuid,
        })
        .passthrough(),
      q,
    );
    await this.target(
      ctx,
      i.targetType,
      i.targetId,
      i.channelId,
      "crm.followup.read",
      this.core.db,
    );
    const p = pagination(q),
      where = {
        tenantId: ctx.tenantId,
        targetType: i.targetType,
        targetId: i.targetId,
        channelId: i.channelId,
      };
    return pageResult(
      await this.core.db.crmFollowUp.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (p.page - 1) * p.page_size,
        take: p.page_size,
      }),
      await this.core.db.crmFollowUp.count({ where }),
      p,
    );
  }
  async createFollowUp(ctx: RequestContext, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          targetType: z.enum(["customer", "lead", "opportunity"]),
          targetId: uuid,
          channelId: uuid,
          type: z
            .enum(["call", "visit", "chat", "email", "note"])
            .default("note"),
          content: note,
          occurredAt: iso,
          nextAt: iso.optional(),
          correctsId: uuid.optional(),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.followup.write",
      "followup.create",
      i,
      async (tx) => {
        const pair = await this.target(
          ctx,
          i.targetType,
          i.targetId,
          i.channelId,
          "crm.followup.write",
          tx,
        );
        if (
          new Date(i.occurredAt) > this.core.now() ||
          (i.nextAt && new Date(i.nextAt) < new Date(i.occurredAt))
        )
          problem("INVALID_REQUEST", "请检查发生时间与下次跟进时间", 400);
        if (i.correctsId) {
          const old = await tx.crmFollowUp.findFirst({
            where: {
              id: i.correctsId,
              tenantId: ctx.tenantId,
              targetId: i.targetId,
              targetType: i.targetType,
              channelId: i.channelId,
            },
          });
          if (!old || old.authorMembershipId !== ctx.membershipId)
            problem("FORBIDDEN", "只能更正自己的原记录", 403);
          await this.updateVersion(tx, "crmFollowUp", old.id, old.version, {
            doneAt: this.core.now(),
          });
        }
        const { requestKey, ...data } = i;
        const r = await tx.crmFollowUp.create({
          data: {
            ...data,
            ...pair,
            tenantId: ctx.tenantId,
            authorMembershipId: ctx.membershipId,
            occurredAt: new Date(i.occurredAt),
            nextAt: i.nextAt ? new Date(i.nextAt) : null,
          },
        });
        await this.core.audit(tx, ctx, "followup.create", "CrmFollowUp", r.id, {
          targetType: i.targetType,
          targetId: i.targetId,
          correctsId: i.correctsId,
        });
        return { id: r.id, version: r.version };
      },
    );
  }
  async completeFollowUp(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(z.object({ ...common, version }).strict(), raw);
    return this.core.write(
      ctx,
      "crm.followup.write",
      "followup.complete:" + id,
      i,
      async (tx) => {
        const row = await tx.crmFollowUp.findFirst({
          where: {
            id,
            tenantId: ctx.tenantId,
            authorMembershipId: ctx.membershipId,
          },
        });
        if (!row) problem("NOT_FOUND", "待办不存在", 404);
        await this.target(
          ctx,
          row.targetType,
          row.targetId,
          row.channelId,
          "crm.followup.write",
          tx,
        );
        assertVersion(row, i.version);
        if (!row.nextAt || row.doneAt)
          problem("INVALID_STATE", "待办已完成或没有下次跟进");
        const r = await this.updateVersion(tx, "crmFollowUp", id, row.version, {
          doneAt: this.core.now(),
        });
        await this.core.audit(tx, ctx, "followup.complete", "CrmFollowUp", id);
        return { id, version: r.version };
      },
    );
  }
  async plans(ctx: RequestContext, q: any) {
    const { access, where } = await this.scope(
        ctx,
        "crm.service.read",
        this.core.db,
        "plan",
      ),
      p = pagination(q);
    const w: any = {
      ...where,
      customer: await this.core.customerWhere(ctx),
      ...(q.customerId ? { customerId: parse(uuid, q.customerId) } : {}),
      ...(q.endingWithinDays?{status:'active',endsAt:{gte:this.core.now(),lte:new Date(this.core.now().getTime()+parse(z.coerce.number().int().min(1).max(365),q.endingWithinDays)*86400000)}}:{}),
    };
    if (!access.manager)
      w.AND = [
        {
          OR: [
            { ownerMembershipId: ctx.membershipId },
            { tasks: { some: { assigneeMembershipId: ctx.membershipId } } },
          ],
        },
      ];
    return pageResult(
      await this.core.db.crmServicePlan.findMany({
        where: w,
        include: {
          tasks: { orderBy: { dueAt: "asc" } },
          customer: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (p.page - 1) * p.page_size,
        take: p.page_size,
      }),
      await this.core.db.crmServicePlan.count({ where: w }),
      p,
    );
  }
  async createPlan(ctx: RequestContext, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          customerId: uuid,
          channelId: uuid,
          title: text,
          ownerMembershipId: uuid,
          startsAt: iso,
          endsAt: iso,
          note: note.optional(),
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.service.write",
      "service-plan.create",
      i,
      async (tx) => {
        const c = await this.customer(
            ctx,
            i.customerId,
            i.channelId,
            "crm.service.write",
            tx,
          ),
          a = await this.core.guard(ctx, "crm.service.write", tx);
        if (
          !(await this.manages(ctx, c.orgUnitId, i.channelId, tx, true)) &&
          (c.serviceOwnerMembershipId !== ctx.membershipId ||
            i.ownerMembershipId !== ctx.membershipId)
        )
          problem("FORBIDDEN", "请由客户服务负责人创建计划", 403);
        if (new Date(i.endsAt) <= new Date(i.startsAt))
          problem("INVALID_REQUEST", "计划结束须晚于开始", 400);
        await this.member(
          ctx,
          i.ownerMembershipId,
          "crm.service.write",
          c.orgUnitId,
          i.channelId,
          tx,
        );
        const { requestKey, ...data } = i;
        const r = await tx.crmServicePlan.create({
          data: {
            ...data,
            startsAt: new Date(i.startsAt),
            endsAt: new Date(i.endsAt),
            orgUnitId: c.orgUnitId,
            tenantId: ctx.tenantId,
          },
        });
        await this.core.audit(
          tx,
          ctx,
          "service-plan.create",
          "CrmServicePlan",
          r.id,
        );
        return { id: r.id, version: r.version };
      },
    );
  }
  async planAction(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          version,
          action: z.enum(["complete", "cancel"]),
          reason,
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.service.write",
      "service-plan.action:" + id,
      i,
      async (tx) => {
        await this.core.lock(tx, ctx.tenantId + ":crm:service-plan:" + id);
        const p = await this.plan(ctx, id, "crm.service.write", tx),
          a = await this.core.guard(ctx, "crm.service.write", tx);
        assertVersion(p, i.version);
        if (
          !(await this.manages(ctx, p.orgUnitId, p.channelId, tx, true)) &&
          p.ownerMembershipId !== ctx.membershipId
        )
          problem("FORBIDDEN", "仅计划负责人可以结束计划", 403);
        if (p.status !== "active") problem("INVALID_STATE", "计划已结束");
        if (
          i.action === "complete" &&
          p.tasks.some((t: any) => t.status !== "approved")
        )
          problem("INVALID_STATE", "请先完成并审核全部服务任务");
        if (i.action === "cancel")
          await tx.crmServiceTask.updateMany({
            where: {
              tenantId: ctx.tenantId,
              planId: id,
              status: { in: ["open", "rejected", "submitted"] },
            },
            data: { status: "cancelled", version: { increment: 1 } },
          });
        const r = await this.updateVersion(
          tx,
          "crmServicePlan",
          id,
          p.version,
          { status: i.action === "complete" ? "completed" : "cancelled" },
        );
        await this.core.audit(
          tx,
          ctx,
          "service-plan." + i.action,
          "CrmServicePlan",
          id,
          { reason: i.reason },
        );
        return { id, version: r.version };
      },
    );
  }
  async createServiceTask(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          title: text,
          assigneeMembershipId: uuid,
          dueAt: iso,
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.service.write",
      "service-task.create:" + id,
      i,
      async (tx) => {
        await this.core.lock(tx, ctx.tenantId + ":crm:service-plan:" + id);
        const p = await this.plan(ctx, id, "crm.service.write", tx),
          a = await this.core.guard(ctx, "crm.service.write", tx);
        if (
          !(await this.manages(ctx, p.orgUnitId, p.channelId, tx, true)) &&
          p.ownerMembershipId !== ctx.membershipId
        )
          problem("FORBIDDEN", "仅计划负责人可分派任务", 403);
        if (p.status !== "active") problem("INVALID_STATE", "计划已结束");
        if (new Date(i.dueAt) < p.startsAt || new Date(i.dueAt) > p.endsAt)
          problem("INVALID_REQUEST", "任务期限须在服务计划期间", 400);
        await this.member(
          ctx,
          i.assigneeMembershipId,
          "crm.service.write",
          p.orgUnitId,
          p.channelId,
          tx,
        );
        const r = await tx.crmServiceTask.create({
          data: {
            tenantId: ctx.tenantId,
            planId: id,
            title: i.title,
            assigneeMembershipId: i.assigneeMembershipId,
            dueAt: new Date(i.dueAt),
          },
        });
        await this.core.audit(
          tx,
          ctx,
          "service-task.create",
          "CrmServiceTask",
          r.id,
        );
        return { id: r.id, version: r.version };
      },
    );
  }
  async serviceTaskAction(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          version,
          action: z.enum(["submit", "approve", "reject"]),
          note,
        })
        .strict(),
      raw,
    );
    const permission =
      i.action === "submit" ? "crm.service.write" : "crm.service.review";
    return this.core.write(
      ctx,
      permission,
      "service-task.action:" + id,
      i,
      async (tx) => {
        const t = await tx.crmServiceTask.findFirst({
          where: { id, tenantId: ctx.tenantId },
        });
        if (!t) problem("NOT_FOUND", "服务任务不存在", 404);
        await this.core.lock(
          tx,
          ctx.tenantId + ":crm:service-plan:" + t.planId,
        );
        const p = await this.plan(ctx, t.planId, permission, tx);
        assertVersion(t, i.version);
        if (p.status !== "active") problem("INVALID_STATE", "计划已结束");
        if (i.action === "submit") {
          if (
            t.assigneeMembershipId !== ctx.membershipId ||
            !["open", "rejected"].includes(t.status)
          )
            problem("FORBIDDEN", "仅执行人可以提交未完成的任务", 403);
        } else {
          if (t.status !== "submitted")
            problem("INVALID_STATE", "任务尚未提交");
          if (t.submittedBy === ctx.membershipId)
            problem("FORBIDDEN", "任务须由另一位主管审核", 403);
        }
        const r = await this.updateVersion(
          tx,
          "crmServiceTask",
          id,
          t.version,
          i.action === "submit"
            ? {
                status: "submitted",
                completionNote: i.note,
                submittedBy: ctx.membershipId,
              }
            : {
                status: i.action === "approve" ? "approved" : "rejected",
                reviewReason: i.note,
                reviewedBy: ctx.membershipId,
              },
        );
        await this.core.audit(
          tx,
          ctx,
          "service-task." + i.action,
          "CrmServiceTask",
          id,
          { planId: p.id },
        );
        return { id, version: r.version, status: r.status };
      },
    );
  }
  async risks(ctx: RequestContext, q: any) {
    const { access, where } = await this.scope(ctx, "crm.service.read"),
      p = pagination(q);
    const w = {
      ...where,
      customer: await this.core.customerWhere(ctx),
      ...(access.manager ? {} : { ownerMembershipId: ctx.membershipId }),
      ...(q.customerId ? { customerId: parse(uuid, q.customerId) } : {}),
      ...(q.status?{status:parse(z.enum(['open','closed']),q.status)}:{}),
    };
    return pageResult(
      await this.core.db.crmServiceRisk.findMany({
        where: w,
        include: { customer: { select: { displayName: true } } },
        orderBy: { createdAt: "desc" },
        skip: (p.page - 1) * p.page_size,
        take: p.page_size,
      }),
      await this.core.db.crmServiceRisk.count({ where: w }),
      p,
    );
  }
  async createRisk(ctx: RequestContext, raw: unknown) {
    const i = parse(
      z
        .object({
          ...common,
          customerId: uuid,
          channelId: uuid,
          title: text,
          severity: z.enum(["low", "medium", "high"]),
          detail: note,
        })
        .strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.service.write",
      "risk.create",
      i,
      async (tx) => {
        const c = await this.customer(
          ctx,
          i.customerId,
          i.channelId,
          "crm.service.write",
          tx,
        );
        const { requestKey, ...data } = i;
        const r = await tx.crmServiceRisk.create({
          data: {
            ...data,
            tenantId: ctx.tenantId,
            orgUnitId: c.orgUnitId,
            ownerMembershipId: ctx.membershipId,
          },
        });
        await this.core.audit(tx, ctx, "risk.create", "CrmServiceRisk", r.id);
        return { id: r.id, version: r.version };
      },
    );
  }
  async closeRisk(ctx: RequestContext, id: string, raw: unknown) {
    const i = parse(
      z.object({ ...common, version, resolution: note }).strict(),
      raw,
    );
    return this.core.write(
      ctx,
      "crm.service.write",
      "risk.close:" + id,
      i,
      async (tx) => {
        const { access, where } = await this.scope(
          ctx,
          "crm.service.write",
          tx,
        );
        const r = await tx.crmServiceRisk.findFirst({
          where: { ...where, id },
        });
        if (!r || (!access.manager && r.ownerMembershipId !== ctx.membershipId))
          problem("NOT_FOUND", "风险不存在或不可见", 404);
        await this.core.customer(ctx, r.customerId, "crm.customer.read", tx);
        assertVersion(r, i.version);
        if (r.status !== "open") problem("INVALID_STATE", "风险已关闭");
        const row = await this.updateVersion(
          tx,
          "crmServiceRisk",
          id,
          r.version,
          {
            status: "closed",
            resolution: i.resolution,
            closedAt: this.core.now(),
          },
        );
        await this.core.audit(tx, ctx, "risk.close", "CrmServiceRisk", id);
        return { id, version: row.version };
      },
    );
  }
  async workbench(ctx: RequestContext) {
    const a = await this.core.guard(ctx, "crm.customer.read"),
      now = this.core.now(),
      result: any = {
        asOf: now,
        membershipId: ctx.membershipId,
        leads: [],
        opportunities: [],
        followUps: [],
        serviceTasks: [],
        risks: [],
        funnel: [],
        amounts: [],
      };
    if (a.permissions.includes("crm.sales.read")) {
      const { access, where } = await this.scope(ctx, "crm.sales.read");
      const own = access.manager ? {} : { ownerMembershipId: ctx.membershipId };
      const lw = { ...where, ...own };
      result.pendingLeads = await this.core.db.crmLead.count({
        where: {
          ...lw,
          status: {
            in: [
              "new",
              "assigned",
              "working",
              "qualified",
              "conversion_pending",
              "conversion_approved",
              "returned",
            ],
          },
        },
      });
      result.leads = await this.core.db.crmLead.findMany({
        where: {
          ...lw,
          status: {
            in: [
              "assigned",
              "working",
              "conversion_pending",
              "conversion_approved",
            ],
          },
        },
        select: { id: true, name: true, status: true },
        take: 8,
        orderBy: { createdAt: "asc" },
      });
      const opportunityScope = await this.scope(
        ctx,
        "crm.sales.read",
        this.core.db,
        "opportunity",
      );
      const ow: any = {
        ...opportunityScope.where,
        customer: await this.core.customerWhere(ctx),
      };
      if (!access.manager)
        ow.AND = [
          {
            OR: [
              { ownerMembershipId: ctx.membershipId },
              {
                participantMembershipIds: {
                  array_contains: [ctx.membershipId],
                },
              },
            ],
          },
        ];
      result.funnel = await this.core.db.crmOpportunity.groupBy({
        by: ["stage"],
        where: ow,
        _count: { _all: true },
      });
      result.amounts = await this.core.db.crmOpportunity.groupBy({
        by: ["currency"],
        where: { ...ow, stage: { notIn: ["won", "lost"] } },
        _sum: { estimatedAmount: true },
      });
      result.opportunities = await this.core.db.crmOpportunity.findMany({
        where: {
          ...ow,
          stage: { notIn: ["won", "lost"] },
          nextActionAt: { lte: now },
        },
        select: { id: true, name: true, nextAction: true, nextActionAt: true },
        orderBy: { nextActionAt: "asc" },
        take: 20,
      });
    }
    if (a.permissions.includes("crm.followup.read")) {
      const { where } = await this.scope(
        ctx,
        "crm.followup.read",
        this.core.db,
        "followup",
      );
      const candidates = await this.core.db.crmFollowUp.findMany({
        where: {
          ...where,
          authorMembershipId: ctx.membershipId,
          nextAt: { not: null },
          doneAt: null,
        },
        orderBy: { nextAt: "asc" },
        take: 100,
      });
      for (const row of candidates) {
        try {
          await this.target(
            ctx,
            row.targetType,
            row.targetId,
            row.channelId,
            "crm.followup.read",
            this.core.db,
          );
          result.followUps.push(row);
        } catch {}
      }
      result.overdueFollowUps = result.followUps.filter(
        (r: any) => new Date(r.nextAt) < now,
      ).length;
    }
    if (a.permissions.includes("crm.service.read")) {
      const { where } = await this.scope(
        ctx,
        "crm.service.read",
        this.core.db,
        "plan",
      );
      result.serviceTasks = await this.core.db.crmServiceTask.findMany({
        where: {
          tenantId: ctx.tenantId,
          assigneeMembershipId: ctx.membershipId,
          status: { in: ["open", "rejected"] },
          plan: {
            ...where,
            status: "active",
            customer: await this.core.customerWhere(ctx),
          },
        },
        include: { plan: { select: { title: true, customerId: true } } },
        orderBy: { dueAt: "asc" },
        take: 20,
      });
      result.risks = (await this.risks(ctx, { status: "open", page_size: 20 })).items.filter(
        (r: any) => r.status === "open",
      );
    }
    return result;
  }
}
