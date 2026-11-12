import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma.service";
import { AuthService } from "../platform/auth.service";
import type { RequestContext } from "../platform/context";
import { readBody } from "../platform/security";
import { infrastructureSecret } from "../platform/infrastructure-contract";
import { GEO_PARSER_VERSION, reportFor } from "./geo.metrics";
import { SCORE_VERSION } from "./reused/score-v1";
import { nextMonitoringAt } from "./reused/schedule";
import {
  projectInput,
  questionInput,
  modelInput,
  selection,
  submitInput,
  scheduleInput,
  optimizationInput,
  pageInput,
  GEO_ROLES,
  hash,
  json,
  runCost,
  promptText,
  OUTPUT_LIMIT,
  PROTOCOL_VERSION,
  type FrozenInput,
  type FrozenModel,
} from "./geo.rules";
@Injectable()
export class GeoService {
  async reconcile(ctx: RequestContext, id: string, raw: unknown) {
    this.require(ctx, "geo.settings.manage");
    const v = readBody(
      z
        .object({
          runId: z.uuid(),
          version: z.int().positive(),
          actualCostMicros: z.int().nonnegative().max(1000000000),
          evidence: z.string().trim().min(8).max(2000),
        })
        .strict(),
      raw,
    );
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":geo:budget"}))`;
      const job = await tx.geoAnalysis.findFirst({
        where: {
          id,
          tenantId: ctx.tenantId,
          status: "needs_review",
          version: v.version,
        },
      });
      if (!job) throw new ConflictException("分析已变化或无需核对");
      const changed = await tx.geoRun.updateMany({
        where: {
          id: v.runId,
          analysisId: id,
          tenantId: ctx.tenantId,
          status: "outcome_unknown",
        },
        data: {
          status: "failed",
          actualCostMicros: v.actualCostMicros,
          errorCode: "MANUALLY_RECONCILED",
          finishedAt: new Date(),
        },
      });
      if (!changed.count)
        throw new ConflictException("该调用已核对或状态已变化");
      const runs = await tx.geoRun.findMany({ where: { analysisId: id } }),
        unresolved = runs.some((r) => r.status === "outcome_unknown");
      const status = unresolved
        ? "needs_review"
        : runs.some((r) => r.status === "succeeded")
          ? "partially_completed"
          : "failed";
      await tx.geoAnalysis.update({
        where: { id },
        data: {
          status,
          version: { increment: 1 },
          actualCostMicros: unresolved
            ? null
            : runs.reduce((n, r) => n + (r.actualCostMicros ?? 0), 0),
          report: json(reportFor(job.snapshot as unknown as FrozenInput, runs)),
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          membershipId: ctx.membershipId,
          appId: "geo",
          requestId: ctx.requestId,
          action: "geo.analysis.reconcile",
          resourceType: "GeoRun",
          resourceId: v.runId,
          detail: {
            evidence: v.evidence,
            actualCostMicros: v.actualCostMicros,
            previousStatus: "outcome_unknown",
          },
        },
      });
      return { ok: true };
    });
  }
  constructor(
    readonly db: PrismaService,
    readonly auth: AuthService,
  ) {}
  require(ctx: RequestContext, p = "geo.read") {
    if (ctx.app.appId !== "geo")
      throw new ForbiddenException("应用上下文不匹配");
    this.auth.require(ctx, p);
  }
  async fresh(
    job: {
      tenantId: string;
      userId: string;
      createdByMembershipId: string;
      id: string;
    },
    permission = "geo.analysis.run",
  ) {
    const c = await this.auth.taskContext({
      tenantId: job.tenantId,
      userId: job.userId,
      membershipId: job.createdByMembershipId,
      appId: "geo",
      taskId: job.id,
    });
    this.require(c, permission);
    return c;
  }
  async audit(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    action: string,
    id: string,
  ) {
    await tx.auditEvent.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        membershipId: ctx.membershipId,
        appId: "geo",
        requestId: ctx.requestId,
        action: "geo." + action,
        resourceType: "Geo",
        resourceId: id,
      },
    });
  }
  async project(ctx: RequestContext, id: string) {
    this.require(ctx);
    const p = await this.db.geoProject.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!p) throw new NotFoundException("项目不存在");
    return p;
  }
  async metadata(ctx: RequestContext) {
    this.require(ctx);
    return {
      permissions: ctx.permissions.filter((p) => p.startsWith("geo.")),
      roles: Object.keys(GEO_ROLES),
      models: await this.models(ctx),
      apiScope: "model_api",
      parserVersion: GEO_PARSER_VERSION,
      scoreVersion: SCORE_VERSION,
    };
  }
  async projects(ctx: RequestContext, raw: unknown = {}) {
    this.require(ctx);
    const q = readBody(pageInput, raw),
      where = {
        tenantId: ctx.tenantId,
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: "insensitive" as const } },
                { brandName: { contains: q.q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.geoProject.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (q.page - 1) * q.page_size,
        take: q.page_size,
      }),
      this.db.geoProject.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }
  async saveProject(ctx: RequestContext, raw: unknown, id?: string) {
    this.require(ctx, "geo.project.manage");
    const v = readBody(
      id ? projectInput.extend({ version: z.int().positive() }) : projectInput,
      raw,
    );
    if (id) await this.project(ctx, id);
    return this.db.$transaction(async (tx) => {
      let p;
      if (id) {
        const { version, ...data } = v as z.infer<typeof projectInput> & {
          version: number;
        };
        const changed = await tx.geoProject.updateMany({
          where: { id, tenantId: ctx.tenantId, version },
          data: { ...data, version: { increment: 1 } },
        });
        if (!changed.count) throw new ConflictException("项目已变化，请刷新");
        p = await tx.geoProject.findUniqueOrThrow({ where: { id } });
      } else {
        if (
          (await tx.geoProject.count({ where: { tenantId: ctx.tenantId } })) >=
          100
        )
          throw new BadRequestException("每企业最多100个项目");
        p = await tx.geoProject.create({
          data: {
            ...v,
            tenantId: ctx.tenantId,
            createdByMembershipId: ctx.membershipId,
          },
        });
      }
      await this.audit(tx, ctx, id ? "project.update" : "project.create", p.id);
      return p;
    });
  }
  async questions(ctx: RequestContext, id: string) {
    await this.project(ctx, id);
    return this.db.geoQuestion.findMany({
      where: { tenantId: ctx.tenantId, projectId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }
  async saveQuestion(
    ctx: RequestContext,
    projectId: string,
    raw: unknown,
    id?: string,
  ) {
    this.require(ctx, "geo.project.manage");
    await this.project(ctx, projectId);
    const v = readBody(
      id
        ? questionInput.extend({ version: z.int().positive() })
        : questionInput,
      raw,
    );
    return this.db.$transaction(async (tx) => {
      let row;
      if (id) {
        const { version, ...data } = v as z.infer<typeof questionInput> & {
          version: number;
        };
        const change = await tx.geoQuestion.updateMany({
          where: { id, projectId, tenantId: ctx.tenantId, version },
          data: { ...data, version: { increment: 1 } },
        });
        if (!change.count) throw new ConflictException("问题已变化，请刷新");
        row = await tx.geoQuestion.findUniqueOrThrow({ where: { id } });
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId + ":geo:questions"}))`;
        if (
          (await tx.geoQuestion.count({
            where: { tenantId: ctx.tenantId, projectId },
          })) >= 200
        )
          throw new BadRequestException("每项目最多200个问题");
        row = await tx.geoQuestion.create({
          data: { ...v, tenantId: ctx.tenantId, projectId },
        });
      }
      await this.audit(tx, ctx, "question.save", row.id);
      return row;
    });
  }
  async addQuestions(ctx: RequestContext, projectId: string, raw: unknown) {
    this.require(ctx, "geo.project.manage");
    await this.project(ctx, projectId);
    const items = readBody(z.array(questionInput).min(1).max(32), raw);
    const normalize = (text: string) =>
      text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId + ":geo:questions"}))`;
      const where = { tenantId: ctx.tenantId, projectId };
      const current = await tx.geoQuestion.findMany({
        where,
        select: { text: true },
      });
      const seen = new Set(current.map(({ text }) => normalize(text)));
      const unique = items.filter(({ text }) => {
        const id = normalize(text);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      if (current.length + unique.length > 200)
        throw new BadRequestException("每项目最多200个问题");
      if (unique.length) {
        await tx.geoQuestion.createMany({
          data: unique.map((item) => ({ ...item, ...where })),
        });
        await this.audit(tx, ctx, "question.batch_add", projectId);
      }
      return { added: unique.length, duplicates: items.length - unique.length };
    });
  }
  async models(ctx: RequestContext) {
    this.require(ctx);
    const rows = await this.db.geoModel.findMany({
      where: { tenantId: ctx.tenantId },
      include: {
        versions: {
          orderBy: { revision: "desc" },
          take: 1,
          select: {
            id: true,
            revision: true,
            code: true,
            apiMode: true,
            nativeWebSearch: true,
            inputPriceMicrosPerMillion: true,
            outputPriceMicrosPerMillion: true,
            searchPriceMicros: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(({ versions, ...m }) => ({
      ...m,
      ...versions[0],
      id: m.id,
      versionId: versions[0]?.id,
      configured: versions.length > 0,
    }));
  }
  async saveModel(ctx: RequestContext, raw: unknown, id?: string) {
    this.require(ctx, "geo.settings.manage");
    const v = readBody(
      id ? modelInput.safeExtend({ version: z.int().positive() }) : modelInput,
      raw,
    );
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":geo:models"}))`;
      const old = id
        ? await tx.geoModel.findFirst({
            where: { id, tenantId: ctx.tenantId },
            include: { versions: { orderBy: { revision: "desc" }, take: 1 } },
          })
        : null;
      if (id && (!old || old.version !== (v as any).version))
        throw new ConflictException("模型配置已变化，请刷新");
      if (!old && !v.apiKey) throw new BadRequestException("请填写 API Key");
      if (
        !old &&
        (await tx.geoModel.count({ where: { tenantId: ctx.tenantId } })) >= 8
      )
        throw new BadRequestException("每企业最多8个模型");
      const { apiKey, name, family, enabled, ...settings } = v;
      delete (settings as any).version;
      const m = old
        ? await tx.geoModel.update({
            where: { id: old.id },
            data: { name, family, enabled, version: { increment: 1 } },
          })
        : await tx.geoModel.create({
            data: { tenantId: ctx.tenantId, name, family, enabled },
          });
      await tx.geoModelVersion.create({
        data: {
          ...settings,
          tenantId: ctx.tenantId,
          modelId: m.id,
          revision: m.version,
          secretCiphertext: apiKey
            ? infrastructureSecret(apiKey)
            : old!.versions[0].secretCiphertext,
        },
      });
      await this.audit(tx, ctx, "model.save", m.id);
      return { id: m.id, version: m.version };
    });
  }
  async settings(ctx: RequestContext) {
    this.require(ctx, "geo.settings.manage");
    return (
      (await this.db.geoSettings.findUnique({
        where: { tenantId: ctx.tenantId },
      })) ?? { tenantId: ctx.tenantId, dailyBudgetMicros: 20000000, version: 0 }
    );
  }
  async saveSettings(ctx: RequestContext, raw: unknown) {
    this.require(ctx, "geo.settings.manage");
    const v = readBody(
      z
        .object({
          dailyBudgetMicros: z.int().positive().max(1000000000),
          version: z.int().nonnegative(),
        })
        .strict(),
      raw,
    );
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":geo:budget"}))`;
      const old = await tx.geoSettings.findUnique({
        where: { tenantId: ctx.tenantId },
      });
      if ((old?.version ?? 0) !== v.version)
        throw new ConflictException("费用设置已变化");
      const row = await tx.geoSettings.upsert({
        where: { tenantId: ctx.tenantId },
        create: {
          tenantId: ctx.tenantId,
          dailyBudgetMicros: v.dailyBudgetMicros,
        },
        update: {
          dailyBudgetMicros: v.dailyBudgetMicros,
          version: { increment: 1 },
        },
      });
      await this.audit(tx, ctx, "settings.save", ctx.tenantId);
      return row;
    });
  }
  async members(ctx: RequestContext) {
    this.require(ctx);
    const rows = await this.db.membership.findMany({
      where: { tenantId: ctx.tenantId, active: true, user: { active: true } },
      select: { id: true, role: true, user: { select: { name: true } } },
    });
    const grants = await this.db.geoGrant.findMany({
      where: { tenantId: ctx.tenantId },
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.user.name,
      role:
        m.role === "admin"
          ? "admin"
          : (grants.find((g) => g.membershipId === m.id)?.role ?? "none"),
      version: grants.find((g) => g.membershipId === m.id)?.version ?? 0,
    }));
  }
  async grant(ctx: RequestContext, raw: unknown) {
    this.require(ctx, "geo.settings.manage");
    const v = readBody(
      z
        .object({
          membershipId: z.uuid(),
          role: z.enum(["manager", "analyst", "viewer", "none"]),
          version: z.int().nonnegative(),
        })
        .strict(),
      raw,
    );
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":geo:grants"}))`;
      const m = await tx.membership.findFirst({
        where: { id: v.membershipId, tenantId: ctx.tenantId, active: true },
      });
      if (!m || m.role === "admin")
        throw new BadRequestException("成员无效或为企业管理员");
      const old = await tx.geoGrant.findUnique({
        where: {
          tenantId_membershipId: {
            tenantId: ctx.tenantId,
            membershipId: v.membershipId,
          },
        },
      });
      if ((old?.version ?? 0) !== v.version)
        throw new ConflictException("成员权限已变化");
      await tx.geoGrant.upsert({
        where: {
          tenantId_membershipId: {
            tenantId: ctx.tenantId,
            membershipId: v.membershipId,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          membershipId: v.membershipId,
          role: v.role,
        },
        update: { role: v.role, version: { increment: 1 } },
      });
      await this.audit(tx, ctx, "member.grant", m.id);
      return { ok: true };
    });
  }
  async freeze(ctx: RequestContext, projectId: string, raw: unknown) {
    this.require(ctx, "geo.analysis.run");
    const s = readBody(selection, raw);
    s.questionIds = [...new Set(s.questionIds)].sort();
    s.modelIds = [...new Set(s.modelIds)].sort();
    const p = await this.project(ctx, projectId);
    if (!p.active) throw new ConflictException("项目已归档");
    let snapshot: FrozenInput;
    if (s.baselineId) {
      const baseline = await this.db.geoAnalysis.findFirst({
        where: { id: s.baselineId, tenantId: ctx.tenantId, projectId },
      });
      if (!baseline?.report) throw new BadRequestException("基线分析尚无报告");
      snapshot = json(baseline.snapshot);
      if (
        hash(snapshot.questions.map((q) => q.id).sort()) !==
          hash(s.questionIds) ||
        hash(snapshot.models.map((m) => m.id).sort()) !== hash(s.modelIds)
      )
        throw new ConflictException("复测须使用基线问题和模型");
      if (snapshot.protocolVersion !== PROTOCOL_VERSION)
        throw new ConflictException("复测执行协议已变化");
      if (
        snapshot.parserVersion !== GEO_PARSER_VERSION ||
        snapshot.scoreVersion !== SCORE_VERSION
      )
        throw new ConflictException("基线解析或评分版本已失效");
    } else {
      const questions = await this.db.geoQuestion.findMany({
        where: {
          tenantId: ctx.tenantId,
          projectId,
          id: { in: s.questionIds },
          enabled: true,
        },
        orderBy: { id: "asc" },
      });
      if (questions.length !== s.questionIds.length)
        throw new BadRequestException("所选问题不可用");
      const models = await this.db.geoModel.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: s.modelIds },
          enabled: true,
        },
        include: { versions: { orderBy: { revision: "desc" }, take: 1 } },
        orderBy: { id: "asc" },
      });
      if (
        models.length !== s.modelIds.length ||
        models.some((m) => !m.versions[0])
      )
        throw new BadRequestException("所选模型不可用");
      snapshot = {
        protocolVersion: PROTOCOL_VERSION,
        brandName: p.brandName,
        aliases: p.aliases,
        competitors: p.competitors,
        country: p.country,
        language: p.language,
        parserVersion: GEO_PARSER_VERSION,
        scoreVersion: SCORE_VERSION,
        questions: questions.map(
          ({ id, text, category, nativeWebSearch, version }) => ({
            id,
            text,
            category,
            nativeWebSearch,
            version,
          }),
        ),
        models: models.map((m) => {
          const v = m.versions[0];
          return {
            id: m.id,
            versionId: v.id,
            revision: v.revision,
            name: m.name,
            family: m.family,
            code: v.code,
            apiMode: v.apiMode as FrozenModel["apiMode"],
            nativeWebSearch: v.nativeWebSearch,
            inputPriceMicrosPerMillion: v.inputPriceMicrosPerMillion,
            outputPriceMicrosPerMillion: v.outputPriceMicrosPerMillion,
            searchPriceMicros: v.searchPriceMicros,
          };
        }),
      };
    }
    const available = await this.db.geoModelVersion.findMany({
      where: {
        tenantId: ctx.tenantId,
        id: { in: snapshot.models.map((m) => m.versionId) },
        model: { enabled: true },
      },
    });
    if (available.length !== snapshot.models.length)
      throw new ConflictException("基线模型配置不可用");
    if (snapshot.questions.length * snapshot.models.length > 64)
      throw new BadRequestException("单次最多64个问题与模型组合");
    const runs = snapshot.questions.flatMap((q) =>
      snapshot.models.map((m) => ({
        question: q,
        model: m,
        eligible: !q.nativeWebSearch || m.nativeWebSearch,
        estimatedCostMicros: runCost(
          promptText(q, snapshot).length * 3 + 512,
          OUTPUT_LIMIT,
          m,
          q.nativeWebSearch,
        ),
      })),
    );
    const eligible = runs.filter((r) => r.eligible);
    if (!eligible.length)
      throw new BadRequestException("所选模型均不支持需要的原生联网能力");
    const estimatedCostMicros = eligible.reduce(
      (n, r) => n + r.estimatedCostMicros,
      0,
    );
    if (estimatedCostMicros > s.maxCostMicros)
      throw new BadRequestException("预估费用超过单次上限");
    if (s.optimizationId) {
      const task = await this.db.geoOptimization.findFirst({
        where: {
          id: s.optimizationId,
          tenantId: ctx.tenantId,
          projectId,
          baselineId: s.baselineId,
        },
      });
      if (!task || !s.baselineId)
        throw new BadRequestException("复测任务与基线不匹配");
    }
    const comparabilityHash = hash(snapshot);
    return {
      selection: s,
      snapshot,
      runs,
      estimatedCostMicros,
      comparabilityHash,
      estimateHash: hash({ projectId, selection: s, snapshot }),
      eligibleRuns: eligible.length,
      skippedRuns: runs.length - eligible.length,
    };
  }
  async estimate(ctx: RequestContext, projectId: string, raw: unknown) {
    const v = await this.freeze(ctx, projectId, raw);
    return {
      estimateHash: v.estimateHash,
      estimatedCostMicros: v.estimatedCostMicros,
      eligibleRuns: v.eligibleRuns,
      skippedRuns: v.skippedRuns,
      snapshot: v.snapshot,
    };
  }
  async submit(ctx: RequestContext, projectId: string, raw: unknown) {
    const input = readBody(submitInput, raw);
    this.require(ctx, "geo.analysis.run");
    const { requestKey, estimateHash, ...s } = input;
    const requestHash = hash({
      projectId,
      ...s,
      questionIds: [...new Set(s.questionIds)].sort(),
      modelIds: [...new Set(s.modelIds)].sort(),
    });
    const existing = await this.db.geoAnalysis.findUnique({
      where: { tenantId_requestKey: { tenantId: ctx.tenantId, requestKey } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new ConflictException("同一请求标识已用于其他内容");
      return this.analysis(ctx, existing.id);
    }
    const v = await this.freeze(ctx, projectId, s);
    if (v.estimateHash !== estimateHash)
      throw new ConflictException("问题或模型配置已变化，请重新确认费用");
    const job = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":geo:budget"}))`;
      const existing = await tx.geoAnalysis.findUnique({
        where: { tenantId_requestKey: { tenantId: ctx.tenantId, requestKey } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException("请求标识冲突");
        return existing;
      }
      await this.fresh({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        createdByMembershipId: ctx.membershipId,
        id: requestKey,
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const jobs = await tx.geoAnalysis.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [
            { createdAt: { gte: start } },
            { status: { in: ["queued", "running", "needs_review"] } },
          ],
        },
        select: {
          status: true,
          actualCostMicros: true,
          estimatedCostMicros: true,
        },
      });
      const reserved = jobs.reduce(
        (n, j) => n + (j.actualCostMicros ?? j.estimatedCostMicros),
        0,
      );
      const budget =
        (await tx.geoSettings.findUnique({ where: { tenantId: ctx.tenantId } }))
          ?.dailyBudgetMicros ?? 20000000;
      if (reserved + v.estimatedCostMicros > budget)
        throw new ConflictException(
          "当日 GEO 预算不足（含待执行和未知结果预留）",
        );
      if (
        jobs.filter((j) => ["queued", "running"].includes(j.status)).length >= 5
      )
        throw new ConflictException("已有5个分析任务待处理");
      const row = await tx.geoAnalysis.create({
        data: {
          tenantId: ctx.tenantId,
          projectId,
          userId: ctx.userId,
          createdByMembershipId: ctx.membershipId,
          requestKey,
          requestHash,
          status: "queued",
          snapshot: json(v.snapshot),
          comparabilityHash: v.comparabilityHash,
          estimatedCostMicros: v.estimatedCostMicros,
          baselineId: s.baselineId,
          optimizationId: s.optimizationId,
          runs: {
            create: v.runs.map((r) => ({
              questionId: r.question.id,
              modelId: r.model.id,
              modelVersionId: r.model.versionId,
              question: json(r.question),
              model: json(r.model),
              estimatedCostMicros: r.eligible ? r.estimatedCostMicros : 0,
              actualCostMicros: r.eligible ? null : 0,
              status: r.eligible ? "queued" : "skipped",
              errorCode: r.eligible ? null : "NATIVE_SEARCH_UNAVAILABLE",
            })),
          },
        },
      });
      await this.audit(tx, ctx, "analysis.submit", row.id);
      return row;
    });
    return this.analysis(ctx, job.id);
  }
  async analyses(ctx: RequestContext, projectId?: string, raw: unknown = {}) {
    this.require(ctx);
    if (projectId) await this.project(ctx, projectId);
    const q = readBody(pageInput, raw),
      where = {
        tenantId: ctx.tenantId,
        ...(projectId ? { projectId } : {}),
        ...(q.q
          ? {
              project: {
                name: { contains: q.q, mode: "insensitive" as const },
              },
            }
          : {}),
      };
    const [items, total] = await this.db.$transaction([
      this.db.geoAnalysis.findMany({
        where,
        select: {
          id: true,
          projectId: true,
          status: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          estimatedCostMicros: true,
          actualCostMicros: true,
          errorCode: true,
          project: { select: { name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (q.page - 1) * q.page_size,
        take: q.page_size,
      }),
      this.db.geoAnalysis.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }
  async analysisIdForRequest(ctx: RequestContext, projectId: string, requestKey: string) {
    this.require(ctx);
    const row = await this.db.geoAnalysis.findFirst({
      where: {tenantId:ctx.tenantId,projectId,requestKey,userId:ctx.userId,createdByMembershipId:ctx.membershipId},
      select: {id:true},
    });
    return row?.id??null;
  }
  async analysis(ctx: RequestContext, id: string) {
    this.require(ctx);
    const row = await this.db.geoAnalysis.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: { runs: { orderBy: { id: "asc" } } },
    });
    if (!row) throw new NotFoundException("分析不存在");
    const retestVersionCurrent = this.currentRetestVersion(row);
    const retestComparisonBlock = this.comparisonBlock(row);
    let comparison: {
      baselineId: string;
      comparable: boolean;
      delta: number | null;
      reason: string | null;
    } | null = null;
    if (row.baselineId) {
      const base = await this.db.geoAnalysis.findFirst({
        where: {
          id: row.baselineId,
          tenantId: ctx.tenantId,
          projectId: row.projectId,
        },
      });
      const reason =
        !base || base.comparabilityHash !== row.comparabilityHash
          ? "基线与复测的条件不同"
          : (this.comparisonBlock(base) ?? retestComparisonBlock);
      comparison = {
        baselineId: row.baselineId,
        comparable: !reason,
        delta: reason
          ? null
          : Number((row.report as any).score.overallScore) -
            Number((base!.report as any).score.overallScore),
        reason,
      };
    }
    return { ...row, comparison, retestVersionCurrent, retestComparisonBlock };
  }
  private currentRetestVersion(row: { snapshot: unknown }) {
    const snapshot = row.snapshot as FrozenInput;
    return (
      snapshot.protocolVersion === PROTOCOL_VERSION &&
      snapshot.parserVersion === GEO_PARSER_VERSION &&
      snapshot.scoreVersion === SCORE_VERSION
    );
  }
  private comparisonBlock(row: {
    snapshot: unknown;
    status: string;
    report: unknown;
  }) {
    if (!this.currentRetestVersion(row))
      return "指标口径已更新，请用当前口径建立新基线";
    const snapshot = row.snapshot as FrozenInput;
    const report = row.report as ReturnType<typeof reportFor> | null;
    if (
      row.status !== "completed" ||
      !report ||
      report.validSamples !== snapshot.questions.length * snapshot.models.length
    ) {
      return "需取得全部问题与模型组合的有效回答";
    }
    if (!report.score || report.score.diagnosticOnly)
      return "样本覆盖不足，暂不计算分差";
    return null;
  }

  async cancel(ctx: RequestContext, id: string, raw: unknown) {
    this.require(ctx, "geo.analysis.run");
    const v = readBody(z.object({ version: z.int().positive() }).strict(), raw);
    const row = await this.db.geoAnalysis.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!row) throw new NotFoundException("分析不存在");
    return this.db.$transaction(async (tx) => {
      const changed = await tx.geoAnalysis.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          version: v.version,
          status: { in: ["queued", "running"] },
        },
        data: { cancelRequested: true, version: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException("分析已结束或状态已变化");
      await this.audit(tx, ctx, "analysis.cancel", id);
      return { ok: true };
    });
  }
  async schedules(ctx: RequestContext, projectId: string) {
    await this.project(ctx, projectId);
    return this.db.geoSchedule.findMany({
      where: { tenantId: ctx.tenantId, projectId },
      include: { executions: { orderBy: { dueAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "desc" },
    });
  }
  async previewSchedule(ctx: RequestContext, projectId: string, raw: unknown) {
    this.require(ctx, "geo.monitor.manage");
    const v = readBody(scheduleInput, raw);
    const p = await this.project(ctx, projectId);
    const estimate = await this.freeze(ctx, projectId, {
      questionIds: v.questionIds,
      modelIds: v.modelIds,
      maxCostMicros: v.maxCostMicros,
    });
    return {
      estimatedCostMicros: estimate.estimatedCostMicros,
      eligibleRuns: estimate.eligibleRuns,
      skippedRuns: estimate.skippedRuns,
      nextRunAt: nextMonitoringAt({ ...v, timezone: p.timezone }, new Date()),
    };
  }
  async saveSchedule(
    ctx: RequestContext,
    projectId: string,
    raw: unknown,
    id?: string,
  ) {
    this.require(ctx, "geo.monitor.manage");
    this.require(ctx, "geo.analysis.run");
    const v = readBody(
      scheduleInput.extend(
        id
          ? { version: z.int().positive() }
          : { requestKey: z.string().min(8).max(160) },
      ),
      raw,
    );
    const p = await this.project(ctx, projectId);
    const { version, requestKey, ...values } = v as any;
    await this.freeze(ctx, projectId, {
      questionIds: v.questionIds,
      modelIds: v.modelIds,
      maxCostMicros: v.maxCostMicros,
    });
    const requestHash = hash({ projectId, ...values });
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":geo:schedules"}))`;
      if (!id) {
        const old = await tx.geoSchedule.findUnique({
          where: {
            tenantId_requestKey: { tenantId: ctx.tenantId, requestKey },
          },
        });
        if (old) {
          if (old.requestHash !== requestHash)
            throw new ConflictException("请求标识已用于其他计划");
          return old;
        }
        if (
          (await tx.geoSchedule.count({
            where: { tenantId: ctx.tenantId, projectId },
          })) >= 20
        )
          throw new BadRequestException("每项目最多20个监测计划");
      }
      const data = {
        ...values,
        timezone: p.timezone,
        nextRunAt: nextMonitoringAt({ ...v, timezone: p.timezone }, new Date()),
      };
      let row;
      if (id) {
        const changed = await tx.geoSchedule.updateMany({
          where: { id, tenantId: ctx.tenantId, projectId, version },
          data: { ...data, version: { increment: 1 } },
        });
        if (!changed.count) throw new ConflictException("监测计划已变化");
        row = await tx.geoSchedule.findUniqueOrThrow({ where: { id } });
      } else
        row = await tx.geoSchedule.create({
          data: {
            ...data,
            tenantId: ctx.tenantId,
            projectId,
            createdByMembershipId: ctx.membershipId,
            userId: ctx.userId,
            requestKey,
            requestHash,
          },
        });
      await this.audit(tx, ctx, "schedule.save", row.id);
      return row;
    });
  }
  async toggleSchedule(ctx: RequestContext, id: string, raw: unknown) {
    this.require(ctx, "geo.monitor.manage");
    const v = readBody(
      z.object({ active: z.boolean(), version: z.int().positive() }).strict(),
      raw,
    );
    return this.db.$transaction(async (tx) => {
      const old = await tx.geoSchedule.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!old) throw new NotFoundException("计划不存在");
      if (v.active) {
        this.require(ctx, "geo.analysis.run");
        await this.freeze(ctx, old.projectId, {
          questionIds: old.questionIds,
          modelIds: old.modelIds,
          maxCostMicros: old.maxCostMicros,
        });
      }
      const changed = await tx.geoSchedule.updateMany({
        where: { id, tenantId: ctx.tenantId, version: v.version },
        data: {
          active: v.active,
          ...(v.active
            ? { nextRunAt: nextMonitoringAt(old as any, new Date()) }
            : {}),
          version: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException("计划已变化");
      await this.audit(
        tx,
        ctx,
        v.active ? "schedule.resume" : "schedule.pause",
        id,
      );
      return { ok: true };
    });
  }
  async optimizations(ctx: RequestContext, projectId: string) {
    await this.project(ctx, projectId);
    const tasks = await this.db.geoOptimization.findMany({
      where: { tenantId: ctx.tenantId, projectId },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(
      tasks.map(async (t) => ({
        ...t,
        retests: await this.db.geoAnalysis.findMany({
          where: { tenantId: ctx.tenantId, optimizationId: t.id },
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
      })),
    );
  }
  async myOptimizations(ctx: RequestContext) {
    this.require(ctx);
    return this.db.geoOptimization.findMany({
      where: {
        tenantId: ctx.tenantId,
        assigneeMembershipId: ctx.membershipId,
        status: { in: ["open", "in_progress"] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        dueAt: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 50,
    });
  }
  async saveOptimization(
    ctx: RequestContext,
    projectId: string,
    raw: unknown,
    id?: string,
  ) {
    this.require(ctx, "geo.optimization.manage");
    await this.project(ctx, projectId);
    const v = readBody(
      id
        ? optimizationInput.extend({ version: z.int().positive() })
        : optimizationInput,
      raw,
    );
    const base = await this.db.geoAnalysis.findFirst({
      where: { id: v.baselineId, tenantId: ctx.tenantId, projectId },
    });
    if (!base?.report)
      throw new BadRequestException("请选择已有报告的基线分析");
    if (
      v.sourceRunId &&
      !(await this.db.geoRun.findFirst({
        where: {
          id: v.sourceRunId,
          tenantId: ctx.tenantId,
          analysisId: v.baselineId,
          status: "succeeded",
        },
        select: { id: true },
      }))
    )
      throw new BadRequestException("回答证据不属于该基线报告");
    if (v.assigneeMembershipId) {
      const m = await this.db.membership.findFirst({
        where: {
          id: v.assigneeMembershipId,
          tenantId: ctx.tenantId,
          active: true,
          user: { active: true },
        },
      });
      if (!m) throw new BadRequestException("负责人不是本企业活跃成员");
      const grant = await this.db.geoGrant.findUnique({
        where: {
          tenantId_membershipId: { tenantId: ctx.tenantId, membershipId: m.id },
        },
      });
      if (
        m.role !== "admin" &&
        !GEO_ROLES[grant?.role ?? ""]?.includes("geo.optimization.manage")
      ) {
        const existing =
          id &&
          (await this.db.geoOptimization.findFirst({
            where: {
              id,
              tenantId: ctx.tenantId,
              projectId,
              assigneeMembershipId: m.id,
            },
            select: { id: true },
          }));
        if (!existing)
          throw new BadRequestException("请选择有权处理 GEO 优化任务的负责人");
      }
    }
    return this.db.$transaction(async (tx) => {
      const { version, ...data } = v as any;
      let row;
      if (id) {
        const { sourceRunId: _source, ...changes } = data;
        if (_source) throw new BadRequestException("任务来源证据不可更改");
        const changed = await tx.geoOptimization.updateMany({
          where: {
            id,
            tenantId: ctx.tenantId,
            projectId,
            version,
            baselineId: v.baselineId,
          },
          data: {
            ...changes,
            dueAt: changes.dueAt ? new Date(changes.dueAt) : null,
            version: { increment: 1 },
          },
        });
        if (!changed.count) throw new ConflictException("优化任务已变化");
        row = await tx.geoOptimization.findUniqueOrThrow({ where: { id } });
      } else {
        if (
          (await tx.geoOptimization.count({
            where: { tenantId: ctx.tenantId, projectId },
          })) >= 200
        )
          throw new BadRequestException("每项目最多200个优化任务");
        row = await tx.geoOptimization.create({
          data: {
            ...data,
            dueAt: data.dueAt ? new Date(data.dueAt) : null,
            tenantId: ctx.tenantId,
            projectId,
          },
        });
      }
      await this.audit(tx, ctx, "optimization.save", row.id);
      return row;
    });
  }
  async insights(ctx: RequestContext, projectId: string, raw: unknown) {
    await this.project(ctx, projectId);
    const q = readBody(
      z.object({
        days: z.coerce
          .number()
          .refine((v) => [7, 30, 90].includes(v))
          .default(30),
        modelId: z.uuid().optional(),
        questionId: z.uuid().optional(),
        category: z.string().max(50).optional(),
      }),
      raw,
    );
    const where = {
      tenantId: ctx.tenantId,
      projectId,
      createdAt: { gte: new Date(Date.now() - q.days * 86400000) },
      report: { not: null as any },
    };
    if ((await this.db.geoAnalysis.count({ where })) > 500)
      throw new BadRequestException("分析超过500次，请缩小时间范围");
    const jobs = await this.db.geoAnalysis.findMany({
      where,
      include: { runs: true },
      orderBy: { createdAt: "asc" },
    });
    if (jobs.reduce((n, j) => n + j.runs.length, 0) > 20000)
      throw new BadRequestException("回答超过20000条，请缩小范围");
    const groups = new Map<string, any>();
    for (const j of jobs) {
      const snapshot = j.snapshot as unknown as FrozenInput;
      const runs = j.runs.filter(
        (r) =>
          (!q.modelId || r.modelId === q.modelId) &&
          (!q.questionId || r.questionId === q.questionId) &&
          (!q.category || (r.question as any).category === q.category),
      );
      if (!runs.length) continue;
      const group = groups.get(j.comparabilityHash) ?? {
        comparabilityHash: j.comparabilityHash,
        points: [],
      };
      group.points.push({
        id: j.id,
        createdAt: j.createdAt,
        status: j.status,
        ...reportFor(snapshot, runs),
      });
      groups.set(j.comparabilityHash, group);
    }
    return { groups: [...groups.values()], days: q.days };
  }
  async notify(
    tx: Prisma.TransactionClient,
    job: {
      tenantId: string;
      createdByMembershipId: string;
      id: string;
      projectId: string;
    },
    title: string,
    body: string,
    key: string,
    kind = "geo-analysis",
  ) {
    const tenant = await tx.tenant.findUnique({ where: { id: job.tenantId } });
    if (!tenant) return;
    await tx.personalNotification.upsert({
      where: {
        tenantId_recipientMembershipId_dedupeKey: {
          tenantId: job.tenantId,
          recipientMembershipId: job.createdByMembershipId,
          dedupeKey: key,
        },
      },
      create: {
        tenantId: job.tenantId,
        recipientMembershipId: job.createdByMembershipId,
        appId: "geo",
        kind,
        title,
        body,
        resourceId: kind === "geo-monitor" ? job.projectId : job.id,
        dedupeKey: key,
      },
      update: {},
    });
  }
}
