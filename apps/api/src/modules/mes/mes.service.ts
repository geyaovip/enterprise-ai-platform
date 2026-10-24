import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma.service";
import type { RequestContext } from "../platform/context";
import { fingerprint } from "../orchestration/command-registry";
import {
  MES_ROLES,
  MES_ROLE_PERMISSIONS,
  mesPermissions,
} from "./mes-permissions";
import {
  fail,
  parse,
  json,
  version,
  requestKey,
  text,
  quantity,
  bomDraft,
  planDraft,
  findingsSchema,
  assertVersion,
} from "./mes.rules";
const keyInput = z.object({ requestKey });
const mutation = keyInput.extend({ version });
const paging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).default(""),
  status: z.string().max(30).optional(),
});
type Db = any;
// Isolate high-precision BOM arithmetic from the shared Decimal configuration.
const MesDecimal = Prisma.Decimal.clone({ precision: 200 });
@Injectable()
export class MesService {
  constructor(readonly db: PrismaService) {}
  async guard(c: RequestContext, p: string, tx: Db = this.db) {
    if (c.app.appId !== "mes") fail("FORBIDDEN", "应用上下文不匹配", 403);
    const member = await tx.membership.findFirst({
      where: {
        id: c.membershipId,
        tenantId: c.tenantId,
        userId: c.userId,
        active: true,
        user: { active: true },
        tenant: { active: true },
      },
    });
    const app = await tx.tenantApp.findUnique({
      where: { tenantId_appId: { tenantId: c.tenantId, appId: "mes" } },
    });
    if (!member || !app?.granted || !app.enabled)
      fail("FORBIDDEN", "成员或MES已停用", 403);
    const permissions = await mesPermissions(
      tx,
      c.tenantId,
      member.role,
      member.id,
    );
    if (!permissions.includes(p)) fail("FORBIDDEN", "没有此MES操作权限", 403);
    if (p === "mes.ai.use") {
      const cap = await tx.tenantCapability.findUnique({
        where: {
          tenantId_capability: { tenantId: c.tenantId, capability: "ai" },
        },
      });
      if (!cap?.delivered || !cap.enabled)
        fail("FORBIDDEN", "AI能力未启用", 403);
    }
    const grant = await tx.mesMemberGrant.findUnique({
      where: {
        tenantId_membershipId: {
          tenantId: c.tenantId,
          membershipId: c.membershipId,
        },
      },
    });
    return {
      permissions,
      role: member.role === "admin" ? "admin" : grant?.role,
      ownOnly: member.role !== "admin" && grant?.role === "operator",
      stamp: fingerprint({ id: member.id, role: member.role, grant }),
    };
  }
  async lock(tx: Db, c: RequestContext) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":mes"},0))`;
  }
  async write(
    c: RequestContext,
    p: string,
    command: string,
    input: any,
    fn: (tx: Db) => Promise<any>,
    external?: Db,
  ) {
    const run = async (tx: Db) => {
      await this.lock(tx, c);
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${c.membershipId} AND "tenantId"=${c.tenantId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "TenantApp" WHERE "tenantId"=${c.tenantId} AND "appId"='mes' FOR SHARE`;
      await this.guard(c, p, tx);
      const key = parse(requestKey, input.requestKey),
        hash = fingerprint(input),
        where = {
          tenantId_membershipId_command_requestKey: {
            tenantId: c.tenantId,
            membershipId: c.membershipId,
            command,
            requestKey: key,
          },
        };
      const previous = await tx.mesCommandReceipt.findUnique({ where });
      if (previous) {
        if (previous.fingerprint !== hash)
          fail("IDEMPOTENCY_CONFLICT", "相同请求标识对应不同参数");
        return { ...previous.result, repeated: true };
      }
      const result = await fn(tx);
      await tx.mesCommandReceipt.create({
        data: {
          tenantId: c.tenantId,
          membershipId: c.membershipId,
          command,
          requestKey: key,
          fingerprint: hash,
          result: json(result),
        },
      });
      return result;
    };
    return external
      ? run(external)
      : this.db.$transaction(run, { timeout: 30000 });
  }
  async audit(
    tx: Db,
    c: RequestContext,
    action: string,
    type: string,
    id: string,
    detail: any = {},
  ) {
    await tx.auditEvent.create({
      data: {
        tenantId: c.tenantId,
        userId: c.userId,
        membershipId: c.membershipId,
        appId: "mes",
        requestId: c.requestId,
        action: "mes." + action,
        resourceType: type,
        resourceId: id,
        detail: json(detail),
      },
    });
  }
  async metadata(c: RequestContext) {
    const a = await this.guard(c, "mes.production.read");
    return {
      ...a,
      membershipId: c.membershipId,
      roles: MES_ROLES,
      aiAvailability: {
        enabled: a.permissions.includes("mes.ai.use"),
        message: a.permissions.includes("mes.ai.use")
          ? ""
          : "MES AI尚未开放或未授权",
      },
    };
  }
  async members(c: RequestContext) {
    await this.guard(c, "mes.production.read");
    const [members, grants] = await Promise.all([
      this.db.membership.findMany({
        where: { tenantId: c.tenantId, active: true, user: { active: true } },
        select: { id: true, role: true, user: { select: { name: true } } },
      }),
      this.db.mesMemberGrant.findMany({ where: { tenantId: c.tenantId } }),
    ]);
    return members
      .filter(
        (m) =>
          m.role === "admin" || grants.some((g) => g.membershipId === m.id),
      )
      .map((m) => ({
        id: m.id,
        name: m.user.name,
        role:
          m.role === "admin"
            ? "admin"
            : grants.find((g) => g.membershipId === m.id)?.role,
      }));
  }
  async access(c: RequestContext) {
    await this.guard(c, "mes.settings.manage");
    const [members, grants] = await Promise.all([
      this.db.membership.findMany({
        where: { tenantId: c.tenantId, active: true, user: { active: true } },
        select: { id: true, role: true, user: { select: { name: true } } },
      }),
      this.db.mesMemberGrant.findMany({ where: { tenantId: c.tenantId } }),
    ]);
    return members.map((m) => ({
      ...m,
      grant: grants.find((g) => g.membershipId === m.id) ?? null,
    }));
  }
  async saveAccess(c: RequestContext, raw: unknown) {
    const i = parse(
      keyInput
        .extend({
          membershipId: z.uuid(),
          role: z.enum(MES_ROLES).nullable(),
          version: z.int().min(0),
        })
        .strict(),
      raw,
    );
    return this.write(c, "mes.settings.manage", "access", i, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { id: i.membershipId, tenantId: c.tenantId, active: true },
      });
      if (!m || m.role === "admin")
        fail("INVALID_MEMBER", "请选择有效的非管理员成员");
      const old = await tx.mesMemberGrant.findUnique({
        where: {
          tenantId_membershipId: { tenantId: c.tenantId, membershipId: m.id },
        },
      });
      if ((old?.version ?? 0) !== i.version)
        fail("VERSION_CONFLICT", "成员授权已变化");
      const result = i.role
        ? await tx.mesMemberGrant.upsert({
            where: {
              tenantId_membershipId: {
                tenantId: c.tenantId,
                membershipId: m.id,
              },
            },
            create: { tenantId: c.tenantId, membershipId: m.id, role: i.role },
            update: { role: i.role, version: { increment: 1 } },
          })
        : old
          ? await tx.mesMemberGrant.update({
              where: { id: old.id },
              data: { role: "none", version: { increment: 1 } },
            })
          : { role: "none", version: 0 };
      await this.audit(tx, c, "access.update", "membership", m.id, {
        role: i.role,
      });
      return result;
    });
  }
  async list(c: RequestContext, type: string, raw: any = {}) {
    const permission =
      type === "materials"
        ? "mes.material.read"
        : type === "boms"
          ? "mes.bom.read"
          : type === "reports"
            ? "mes.report.read"
            : "mes.production.read";
    const a = await this.guard(c, permission),
      q = parse(paging, raw);
    const names: any = {
      materials: "mesMaterial",
      boms: "mesBom",
      plans: "mesPlan",
      orders: "mesWorkOrder",
      reports: "mesReport",
    };
    if (!names[type]) fail("NOT_FOUND", "未知列表", 404);
    const where: any = { tenantId: c.tenantId };
    if (q.status && type !== "materials") where.status = q.status;
    if (q.q) {
      const fields =
        type === "materials"
          ? ["sku", "name"]
          : type === "boms"
            ? ["productSku", "productName"]
            : type === "plans"
              ? ["code", "productName"]
              : type === "orders"
                ? ["code", "operation"]
                : ["note"];
      where.OR = fields.map((f) => ({
        [f]: { contains: q.q, mode: "insensitive" },
      }));
    }
    if (type === "materials" && raw.active === "true") where.active = true;
    if (type === "materials" && raw.kind === "production")
      where.kind = { in: ["finished", "semi"] };
    if (a.ownOnly) {
      if (type === "orders") where.assigneeId = c.membershipId;
      if (type === "reports") where.reporterId = c.membershipId;
      if (type === "plans") {
        const orders = await this.db.mesWorkOrder.findMany({
          where: { tenantId: c.tenantId, assigneeId: c.membershipId },
          select: { planId: true },
        });
        where.id = { in: orders.map((o) => o.planId) };
      }
    }
    const [items, total] = await Promise.all([
      (this.db as any)[names[type]].findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.page_size,
        skip: (q.page - 1) * q.page_size,
      }),
      (this.db as any)[names[type]].count({ where }),
    ]);
    // Operators see only their assigned slice, never complete-plan material requirements.
    return {
      items:
        a.ownOnly && type === "plans"
          ? items.map((p: any) => this.operatorPlan(p))
          : items,
      total,
      page: q.page,
      page_size: q.page_size,
    };
  }
  operatorPlan(p: any) {
    return {
      id: p.id,
      code: p.code,
      productName: p.productName,
      productSku: p.productSku,
      dueAt: p.dueAt,
      status: p.status,
      version: p.version,
    };
  }
  async get(c: RequestContext, type: string, id: string, tx: Db = this.db) {
    parse(z.uuid(), id);
    const p =
      type === "material"
        ? "mes.material.read"
        : type === "bom"
          ? "mes.bom.read"
          : type === "report"
            ? "mes.report.read"
            : "mes.production.read";
    const a = await this.guard(c, p, tx);
    const name: any = {
      material: "mesMaterial",
      bom: "mesBom",
      plan: "mesPlan",
      order: "mesWorkOrder",
      report: "mesReport",
    };
    if (!name[type]) fail("NOT_FOUND", "对象类型不存在", 404);
    const where: any = { id, tenantId: c.tenantId };
    if (a.ownOnly && type === "order") where.assigneeId = c.membershipId;
    if (a.ownOnly && type === "report") where.reporterId = c.membershipId;
    const r = await tx[name[type]].findFirst({ where });
    if (!r) fail("NOT_FOUND", "记录不存在或不可见", 404);
    if (type === "plan") {
      const orders = await tx.mesWorkOrder.findMany({
        where: {
          tenantId: c.tenantId,
          planId: id,
          ...(a.ownOnly ? { assigneeId: c.membershipId } : {}),
        },
        orderBy: { createdAt: "asc" },
      });
      if (a.ownOnly && !orders.length)
        fail("NOT_FOUND", "记录不存在或不可见", 404);
      return { ...(a.ownOnly ? this.operatorPlan(r) : r), orders };
    }
    if (type === "order") {
      const plan = await tx.mesPlan.findFirst({
        where: { id: r.planId, tenantId: c.tenantId },
      });
      return {
        ...r,
        plan: this.operatorPlan(plan),
        reports: await tx.mesReport.findMany({
          where: {
            tenantId: c.tenantId,
            orderId: id,
            ...(a.ownOnly ? { reporterId: c.membershipId } : {}),
          },
          orderBy: { createdAt: "desc" },
        }),
      };
    }
    if (type === "bom")
      return {
        ...r,
        review: await tx.mesBomReview.findFirst({
          where: {
            tenantId: c.tenantId,
            bomId: id,
            ...(r.status === "draft" ? { bomVersion: r.version } : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
      };
    return r;
  }
  async saveMaterial(c: RequestContext, id: string | undefined, raw: unknown) {
    const i = parse(
      keyInput
        .extend({
          version: version.optional(),
          sku: text,
          name: text,
          kind: z.enum(["finished", "semi", "raw", "packaging", "auxiliary"]),
          unit: z.string().trim().min(1).max(20),
          active: z.boolean().default(true),
        })
        .strict(),
      raw,
    );
    return this.write(
      c,
      "mes.material.write",
      "material." + (id ?? "create"),
      i,
      async (tx) => {
        if (["finished", "semi"].includes(i.kind) && i.unit !== "件")
          fail("UNIT_INVALID", "成品和半成品的基础单位必须为件");
        const old = id
          ? await tx.mesMaterial.findFirst({
              where: { id, tenantId: c.tenantId },
            })
          : null;
        if (id) {
          assertVersion(old, i.version ?? 0);
          if (old.sku !== i.sku || old.unit !== i.unit || old.kind !== i.kind)
            fail("IMMUTABLE_FIELD", "SKU、类型和基础单位不能修改");
          if (!i.active) {
            const boms = await tx.mesBom.findMany({
                where: { tenantId: c.tenantId, status: "published" },
              }),
              plans = await tx.mesPlan.findMany({
                where: {
                  tenantId: c.tenantId,
                  status: { in: ["draft", "released"] },
                },
              });
            if (
              boms.some(
                (b: any) =>
                  b.productId === id ||
                  b.lines.some((l: any) => l.materialId === id),
              ) ||
              plans.some(
                (p: any) =>
                  p.productId === id ||
                  p.requirements.some((l: any) => l.materialId === id),
              )
            )
              fail("MATERIAL_IN_USE", "已发布BOM或未完成计划正在使用此物料");
          }
        }
        if (
          await tx.mesMaterial.findFirst({
            where: {
              tenantId: c.tenantId,
              sku: i.sku,
              ...(id ? { id: { not: id } } : {}),
            },
          })
        )
          fail("DUPLICATE_SKU", "SKU已存在");
        const data = {
          sku: i.sku,
          name: i.name,
          kind: i.kind,
          unit: i.unit,
          active: i.active,
        };
        const r = id
          ? await tx.mesMaterial.update({
              where: { id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.mesMaterial.create({
              data: { ...data, tenantId: c.tenantId },
            });
        await this.audit(tx, c, "material.save", "material", r.id);
        return r;
      },
    );
  }
  async saveBom(
    c: RequestContext,
    id: string | undefined,
    raw: unknown,
    external?: Db,
  ) {
    const i = parse(
      z
        .object({ requestKey, version: version.optional(), draft: bomDraft })
        .strict(),
      raw,
    );
    return this.write(
      c,
      "mes.bom.write",
      "bom." + (id ?? "create"),
      i,
      async (tx) => {
        const d = i.draft,
          materials = await tx.mesMaterial.findMany({
            where: {
              tenantId: c.tenantId,
              active: true,
              id: { in: [d.productId, ...d.lines.map((l) => l.materialId)] },
            },
          });
        const product = materials.find((m: any) => m.id === d.productId);
        if (
          !product ||
          !["finished", "semi"].includes(product.kind) ||
          materials.length !== d.lines.length + 1
        )
          fail("MATERIAL_INVALID", "请选择有效产品和组件，产品不能引用自身");
        const old = id
          ? await tx.mesBom.findFirst({ where: { id, tenantId: c.tenantId } })
          : null;
        if (id) {
          assertVersion(old, i.version ?? 0);
          if (old.status !== "draft" || old.productId !== d.productId)
            fail("BOM_STATE", "只能修改同一产品的BOM草稿");
        }
        const previous = await tx.mesBom.findFirst({
          where: { tenantId: c.tenantId, productId: d.productId },
          orderBy: { revision: "desc" },
        });
        const lines = d.lines.map((l) => {
          const m = materials.find((v: any) => v.id === l.materialId);
          return {
            ...l,
            id:
              old?.lines.find((x: any) => x.materialId === l.materialId)?.id ??
              randomUUID(),
            sku: m.sku,
            name: m.name,
            unit: m.unit,
            kind: m.kind,
          };
        });
        const data = {
          productId: product.id,
          productSku: product.sku,
          productName: product.name,
          note: d.note,
          lines: json(lines),
        };
        const r = id
          ? await tx.mesBom.update({
              where: { id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.mesBom.create({
              data: {
                ...data,
                tenantId: c.tenantId,
                revision: (previous?.revision ?? 0) + 1,
                createdBy: c.membershipId,
              },
            });
        await this.audit(tx, c, "bom.save", "bom", r.id, {
          version: r.version,
        });
        return r;
      },
      external,
    );
  }
  async explode(c: RequestContext, root: any, count: number, tx: Db = this.db) {
    const all = await tx.mesBom.findMany({
      where: { tenantId: c.tenantId, status: "published" },
    });
    const map = new Map<string, any>(all.map((b: any) => [b.productId, b]));
    map.set(root.productId, root);
    const ids = new Set<string>(),
      totals = new Map<string, any>(),
      versions = new Map<string, any>();
    let visits = 0;
    const visit = (
      b: any,
      n: Prisma.Decimal,
      path: Set<string>,
      depth: number,
    ) => {
      if (++visits > 5000) fail("BOM_TOO_LARGE", "BOM展开节点过多");
      if (depth > 10 || path.has(b.productId))
        fail("BOM_CYCLE", "BOM存在循环或超过10级");
      versions.set(b.id, {
        id: b.id,
        revision: b.revision,
        version: b.version,
      });
      ids.add(b.productId);
      const next = new Set(path);
      next.add(b.productId);
      for (const l of b.lines) {
        ids.add(l.materialId);
        if (next.has(l.materialId)) fail("BOM_CYCLE", "BOM存在循环引用");
        const q = n
            .mul(l.quantity)
            .mul(
              new MesDecimal(1).add(new MesDecimal(l.wastePercent).div(100)),
            ),
          child = map.get(l.materialId);
        if (child) visit(child, q, next, depth + 1);
        else {
          if (["semi", "finished"].includes(l.kind))
            fail("SUB_BOM_MISSING", "半成品或成品组件缺少已发布BOM：" + l.sku);
          const old = totals.get(l.materialId);
          if (old && old.unit !== l.unit)
            fail("UNIT_CONFLICT", "相同物料单位不一致");
          totals.set(l.materialId, {
            materialId: l.materialId,
            sku: l.sku,
            name: l.name,
            unit: l.unit,
            quantity: (old?.quantity ?? new MesDecimal(0)).add(q),
          });
          if (totals.size > 1000) fail("BOM_TOO_LARGE", "展开物料超过1000种");
        }
      }
    };
    visit(root, new MesDecimal(count), new Set(), 1);
    if (
      (await tx.mesMaterial.count({
        where: { tenantId: c.tenantId, active: true, id: { in: [...ids] } },
      })) !== ids.size
    )
      fail("MATERIAL_INACTIVE", "BOM包含已停用或无效物料");
    return {
      requirements: [...totals.values()].map((l) => ({
        ...l,
        quantity: l.quantity
          .toDecimalPlaces(3, Prisma.Decimal.ROUND_UP)
          .toFixed(3),
      })),
      bomVersions: [...versions.values()],
    };
  }
  async publishBom(c: RequestContext, id: string, raw: unknown) {
    const i = parse(mutation.strict(), raw);
    return this.write(
      c,
      "mes.bom.publish",
      "bom.publish." + id,
      i,
      async (tx) => {
        const b = await this.get(c, "bom", id, tx);
        assertVersion(b, i.version);
        if (b.status !== "draft") fail("BOM_STATE", "只能发布BOM草稿");
        const review = b.review;
        if (
          review &&
          review.findings.some(
            (f: any) =>
              !review.decisions.some((d: any) => d.findingId === f.id),
          )
        )
          fail("BOM_REVIEW_PENDING", "请逐项处理当前审查问题");
        await this.explode(c, b, 1, tx);
        await tx.mesBom.updateMany({
          where: {
            tenantId: c.tenantId,
            productId: b.productId,
            status: "published",
          },
          data: { status: "archived", version: { increment: 1 } },
        });
        const r = await tx.mesBom.update({
          where: { id },
          data: {
            status: "published",
            publishedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await this.audit(tx, c, "bom.publish", "bom", id, {
          revision: r.revision,
        });
        return r;
      },
    );
  }
  async saveReview(c: RequestContext, id: string, raw: unknown, external?: Db) {
    const i = parse(
      mutation.extend({ findings: findingsSchema }).strict(),
      raw,
    );
    return this.write(
      c,
      "mes.bom.write",
      "bom.review." + id,
      i,
      async (tx) => {
        const b = await this.get(c, "bom", id, tx);
        assertVersion(b, i.version);
        if (b.status !== "draft") fail("BOM_STATE", "仅审查BOM草稿");
        if (
          i.findings.some(
            (f) => f.lineId && !b.lines.some((l: any) => l.id === f.lineId),
          )
        )
          fail("INVALID_FINDING", "审查引用了不存在的BOM行");
        const r = await tx.mesBomReview.create({
          data: {
            tenantId: c.tenantId,
            bomId: id,
            bomVersion: b.version,
            createdBy: c.membershipId,
            findings: json(i.findings.map((f) => ({ ...f, id: randomUUID() }))),
            decisions: [],
          },
        });
        await this.audit(tx, c, "bom.review", "bom", id, {
          reviewId: r.id,
          findings: i.findings.length,
        });
        return r;
      },
      external,
    );
  }
  async resolveReview(c: RequestContext, id: string, raw: unknown) {
    const i = parse(
      mutation
        .extend({
          reviewId: z.uuid(),
          reviewVersion: version,
          decisions: z
            .array(
              z
                .object({
                  findingId: z.uuid(),
                  decision: z.enum(["verified_retain", "false_positive"]),
                  reason: z.string().trim().min(4).max(1000),
                })
                .strict(),
            )
            .max(30),
        })
        .strict(),
      raw,
    );
    return this.write(
      c,
      "mes.bom.write",
      "bom.resolve." + id,
      i,
      async (tx) => {
        const b = await this.get(c, "bom", id, tx);
        assertVersion(b, i.version);
        if (b.status !== "draft" || b.review?.id !== i.reviewId)
          fail("STALE_REVIEW", "审查已过时，请重新核对");
        assertVersion(b.review, i.reviewVersion);
        const findings = b.review.findings;
        if (
          new Set(i.decisions.map((d) => d.findingId)).size !==
            findings.length ||
          i.decisions.length !== findings.length ||
          i.decisions.some(
            (d) => !findings.some((f: any) => f.id === d.findingId),
          )
        )
          fail("INCOMPLETE_DECISIONS", "请逐项填写处理结论及依据");
        const r = await tx.mesBomReview.update({
          where: { id: i.reviewId },
          data: { decisions: json(i.decisions), version: { increment: 1 } },
        });
        await this.audit(tx, c, "bom.review.resolve", "bom", id, {
          reviewId: r.id,
          decisions: i.decisions,
        });
        return r;
      },
    );
  }
  async planPreview(c: RequestContext, raw: unknown, tx: Db = this.db) {
    await this.guard(c, "mes.plan.write", tx);
    const d = parse(planDraft, raw);
    if (new Date(d.dueAt) <= new Date())
      fail("DUE_DATE", "截止时间必须晚于当前时间");
    const b = await tx.mesBom.findFirst({
      where: {
        id: d.bomId,
        tenantId: c.tenantId,
        productId: d.productId,
        status: "published",
      },
    });
    if (!b) fail("BOM_INVALID", "请选择同一产品当前已发布的BOM");
    const snapshot = await this.explode(c, b, d.targetQty, tx);
    return {
      ...d,
      productSku: b.productSku,
      productName: b.productName,
      bomRevision: b.revision,
      ...snapshot,
    };
  }
  async savePlan(
    c: RequestContext,
    id: string | undefined,
    raw: unknown,
    external?: Db,
  ) {
    const i = parse(
      z
        .object({ requestKey, version: version.optional(), draft: planDraft })
        .strict(),
      raw,
    );
    return this.write(
      c,
      "mes.plan.write",
      "plan." + (id ?? "create"),
      i,
      async (tx) => {
        const old = id
          ? await tx.mesPlan.findFirst({ where: { id, tenantId: c.tenantId } })
          : null;
        if (id) {
          assertVersion(old, i.version ?? 0);
          if (old.status !== "draft") fail("PLAN_STATE", "仅能编辑未发布计划");
        }
        if (
          await tx.mesPlan.findFirst({
            where: {
              tenantId: c.tenantId,
              code: i.draft.code,
              ...(id ? { id: { not: id } } : {}),
            },
          })
        )
          fail("DUPLICATE_CODE", "计划编号已存在");
        const data = await this.planPreview(c, i.draft, tx);
        const r = id
          ? await tx.mesPlan.update({
              where: { id },
              data: {
                ...data,
                requirements: json(data.requirements),
                bomVersions: json(data.bomVersions),
                version: { increment: 1 },
              },
            })
          : await tx.mesPlan.create({
              data: {
                ...data,
                requirements: json(data.requirements),
                bomVersions: json(data.bomVersions),
                tenantId: c.tenantId,
                createdBy: c.membershipId,
              },
            });
        await this.audit(tx, c, "plan.save", "plan", r.id, {
          bomVersions: data.bomVersions,
        });
        return r;
      },
      external,
    );
  }
  async planAction(c: RequestContext, id: string, raw: unknown) {
    const i = parse(
      mutation.extend({ action: z.enum(["release", "cancel"]) }).strict(),
      raw,
    );
    return this.write(
      c,
      "mes.plan.publish",
      "plan.action." + id,
      i,
      async (tx) => {
        const p = await this.get(c, "plan", id, tx);
        assertVersion(p, i.version);
        if (i.action === "release" && p.status !== "draft")
          fail("PLAN_STATE", "只能发布草稿计划");
        if (i.action === "cancel" && !["draft", "released"].includes(p.status))
          fail("PLAN_STATE", "当前计划不能取消");
        if (
          i.action === "cancel" &&
          p.orders.some((o: any) => o.status !== "cancelled")
        )
          fail("PLAN_IN_USE", "请先处理计划下的工单");
        if (i.action === "release") {
          const ids = [
            p.productId,
            ...p.requirements.map((l: any) => l.materialId),
          ];
          if (
            (await tx.mesMaterial.count({
              where: { tenantId: c.tenantId, active: true, id: { in: ids } },
            })) !== new Set(ids).size
          )
            fail("MATERIAL_INACTIVE", "计划物料已停用");
        }
        const r = await tx.mesPlan.update({
          where: { id },
          data: {
            status: i.action === "release" ? "released" : "cancelled",
            version: { increment: 1 },
          },
        });
        await this.audit(tx, c, "plan." + i.action, "plan", id);
        return r;
      },
    );
  }
  async createOrder(c: RequestContext, id: string, raw: unknown) {
    const i = parse(
      mutation
        .extend({
          code: text,
          operation: text,
          targetQty: quantity,
          assigneeId: z.uuid(),
        })
        .strict(),
      raw,
    );
    return this.write(
      c,
      "mes.order.write",
      "order.create." + id,
      i,
      async (tx) => {
        const p = await this.get(c, "plan", id, tx);
        assertVersion(p, i.version);
        if (p.status !== "released") fail("PLAN_STATE", "计划尚未发布或已结束");
        const m = await tx.membership.findFirst({
          where: {
            tenantId: c.tenantId,
            id: i.assigneeId,
            active: true,
            user: { active: true },
          },
        });
        const grant = await tx.mesMemberGrant.findUnique({
          where: {
            tenantId_membershipId: {
              tenantId: c.tenantId,
              membershipId: i.assigneeId,
            },
          },
        });
        if (
          !m ||
          !(
            m.role === "admin" ||
            MES_ROLE_PERMISSIONS[grant?.role]?.includes("mes.report.write")
          )
        )
          fail("ASSIGNEE_INVALID", "请选择具有报工权限的有效成员");
        if (
          p.orders
            .filter((o: any) => o.status !== "cancelled")
            .reduce((n: number, o: any) => n + o.targetQty, 0) +
            i.targetQty >
          p.targetQty
        )
          fail("PLAN_OVERALLOCATED", "工单总量超过计划数量");
        if (
          await tx.mesWorkOrder.findFirst({
            where: { tenantId: c.tenantId, code: i.code },
          })
        )
          fail("DUPLICATE_CODE", "工单编号已存在");
        const r = await tx.mesWorkOrder.create({
          data: {
            tenantId: c.tenantId,
            planId: id,
            code: i.code,
            operation: i.operation,
            targetQty: i.targetQty,
            assigneeId: i.assigneeId,
          },
        });
        await tx.mesPlan.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        await this.audit(tx, c, "order.create", "order", r.id, { planId: id });
        return r;
      },
    );
  }
  async orderAction(c: RequestContext, id: string, raw: unknown) {
    const i = parse(
      mutation.extend({ action: z.enum(["start", "cancel"]) }).strict(),
      raw,
    );
    return this.write(
      c,
      i.action === "start" ? "mes.report.write" : "mes.order.write",
      "order.action." + id,
      i,
      async (tx) => {
        const o = await this.get(c, "order", id, tx);
        assertVersion(o, i.version);
        if (!["ready", "in_progress"].includes(o.status))
          fail("ORDER_STATE", "工单已结束");
        if (i.action === "start" && o.assigneeId !== c.membershipId)
          fail("FORBIDDEN", "仅受派人可以开工", 403);
        if (
          i.action === "cancel" &&
          (o.reports.length || o.goodQty || o.defectQty)
        )
          fail("ORDER_IN_USE", "已有报工，不能取消工单");
        const r = await tx.mesWorkOrder.update({
          where: { id },
          data: {
            status: i.action === "start" ? "in_progress" : "cancelled",
            version: { increment: 1 },
          },
        });
        await tx.mesPlan.update({
          where: { id: o.planId },
          data: { version: { increment: 1 } },
        });
        await this.audit(tx, c, "order." + i.action, "order", id);
        return r;
      },
    );
  }
  async report(c: RequestContext, id: string, raw: unknown) {
    const i = parse(
      mutation
        .extend({
          goodQty: z.int().min(0).max(10000000),
          defectQty: z.int().min(0).max(10000000),
          note: z.string().trim().max(2000).default(""),
        })
        .strict()
        .refine((v) => v.goodQty + v.defectQty > 0, "报工总量必须大于零"),
      raw,
    );
    return this.write(
      c,
      "mes.report.write",
      "report.create." + id,
      i,
      async (tx) => {
        const o = await this.get(c, "order", id, tx);
        assertVersion(o, i.version);
        if (o.assigneeId !== c.membershipId)
          fail("FORBIDDEN", "只能提交本人受派工单", 403);
        if (o.status !== "in_progress") fail("ORDER_STATE", "请先开工");
        const pending = o.reports
          .filter((r: any) => r.status === "pending")
          .reduce((n: number, r: any) => n + r.goodQty + r.defectQty, 0);
        if (
          o.goodQty + o.defectQty + pending + i.goodQty + i.defectQty >
          o.targetQty
        )
          fail("ORDER_OVERREPORTED", "已审核与待审核数量合计超过工单计划量");
        const r = await tx.mesReport.create({
          data: {
            tenantId: c.tenantId,
            orderId: id,
            reporterId: c.membershipId,
            goodQty: i.goodQty,
            defectQty: i.defectQty,
            note: i.note,
          },
        });
        await tx.mesWorkOrder.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        await this.audit(tx, c, "report.create", "report", r.id, {
          orderId: id,
        });
        return r;
      },
    );
  }
  async review(c: RequestContext, id: string, raw: unknown) {
    const i = parse(
      mutation
        .extend({
          decision: z.enum(["approve", "reject"]),
          reason: z.string().trim().max(1000).default(""),
        })
        .strict(),
      raw,
    );
    return this.write(
      c,
      "mes.report.review",
      "report.review." + id,
      i,
      async (tx) => {
        const r = await this.get(c, "report", id, tx);
        assertVersion(r, i.version);
        if (r.status !== "pending") fail("REPORT_STATE", "报工已审核");
        if (r.reporterId === c.membershipId)
          fail("SELF_REVIEW", "不能审核自己的报工", 403);
        if (i.decision === "reject" && i.reason.length < 2)
          fail("REASON_REQUIRED", "请填写拒绝原因");
        const o = await tx.mesWorkOrder.findFirst({
          where: { id: r.orderId, tenantId: c.tenantId },
        });
        if (!o || o.status !== "in_progress")
          fail("ORDER_STATE", "工单当前不可审核");
        if (i.decision === "approve") {
          const total = o.goodQty + o.defectQty + r.goodQty + r.defectQty;
          if (total > o.targetQty)
            fail("ORDER_OVERREPORTED", "审核数量将超过工单计划量");
          await tx.mesWorkOrder.update({
            where: { id: o.id },
            data: {
              goodQty: { increment: r.goodQty },
              defectQty: { increment: r.defectQty },
              status: total === o.targetQty ? "completed" : "in_progress",
              version: { increment: 1 },
            },
          });
          const orders = await tx.mesWorkOrder.findMany({
            where: {
              tenantId: c.tenantId,
              planId: o.planId,
              status: { not: "cancelled" },
            },
          });
          const plan = await tx.mesPlan.findUnique({ where: { id: o.planId } });
          if (
            orders.every((x: any) => x.status === "completed") &&
            orders.reduce((n: number, x: any) => n + x.targetQty, 0) ===
              plan.targetQty
          )
            await tx.mesPlan.update({
              where: { id: plan.id },
              data: { status: "completed", version: { increment: 1 } },
            });
        }
        const result = await tx.mesReport.update({
          where: { id },
          data: {
            status: i.decision === "approve" ? "approved" : "rejected",
            reason: i.reason,
            reviewerId: c.membershipId,
            reviewedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await this.audit(tx, c, "report." + i.decision, "report", id, {
          orderId: o.id,
          goodQty: r.goodQty,
          defectQty: r.defectQty,
          reason: i.reason,
        });
        return result;
      },
    );
  }
  async dashboard(c: RequestContext) {
    const a = await this.guard(c, "mes.production.read");
    const where: any = {
      tenantId: c.tenantId,
      status: { not: "cancelled" },
      ...(a.ownOnly ? { assigneeId: c.membershipId } : {}),
    };
    const planWhere: any = {
      tenantId: c.tenantId,
      status: { not: "cancelled" },
    };
    if (a.ownOnly) {
      const ids = await this.db.mesWorkOrder.groupBy({ by: ["planId"], where });
      planWhere.id = { in: ids.map((x) => x.planId) };
    }
    const [totals, activeOrders, activePlans, pendingReports, plans] =
      await Promise.all([
        this.db.mesWorkOrder.aggregate({
          where,
          _sum: { targetQty: true, goodQty: true, defectQty: true },
        }),
        this.db.mesWorkOrder.count({
          where: { ...where, status: { in: ["ready", "in_progress"] } },
        }),
        this.db.mesPlan.count({ where: { ...planWhere, status: "released" } }),
        this.db.mesReport.count({
          where: {
            tenantId: c.tenantId,
            status: "pending",
            ...(a.ownOnly ? { reporterId: c.membershipId } : {}),
          },
        }),
        this.db.mesPlan.findMany({
          where: planWhere,
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          take: 20,
        }),
      ]);
    const grouped = await this.db.mesWorkOrder.groupBy({
      by: ["planId"],
      where: { ...where, planId: { in: plans.map((p) => p.id) } },
      _sum: { targetQty: true, goodQty: true },
    });
    const target = totals._sum.targetQty ?? 0,
      good = totals._sum.goodQty ?? 0;
    return {
      target,
      good,
      defect: totals._sum.defectQty ?? 0,
      pendingReports,
      activeOrders,
      activePlans,
      progress: target ? Number(((good / target) * 100).toFixed(2)) : 0,
      asOf: new Date().toISOString(),
      scope: a.ownOnly ? "assigned" : "tenant",
      plans: plans.map((p) => {
        const g = grouped.find((g) => g.planId === p.id),
          good = g?._sum.goodQty ?? 0,
          target = a.ownOnly ? (g?._sum.targetQty ?? 0) : p.targetQty;
        return {
          id: p.id,
          code: p.code,
          productName: p.productName,
          status: p.status,
          dueAt: p.dueAt,
          goodQty: good,
          targetQty: target,
          progress: target ? Number(((good / target) * 100).toFixed(2)) : 0,
          overdue: p.status === "released" && p.dueAt < new Date(),
        };
      }),
    };
  }
  async auditList(c: RequestContext) {
    await this.guard(c, "mes.audit.read");
    return this.db.auditEvent.findMany({
      where: { tenantId: c.tenantId, appId: "mes" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
