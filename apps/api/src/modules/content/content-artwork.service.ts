import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import type { RequestContext } from "../platform/context";
import { readBody } from "../platform/security";
import {
  artwork,
  compose,
  hash,
  id,
  json as J,
  syncArtworkCopy,
  layer,
} from "./content.rules";
import type { ContentService } from "./content.service";
import { mediaOperation } from "./content-storage";
const uuid = (v: string) => readBody(id, v);
const assetRefs = (d: any): string[] =>
  [
    d.backgroundId,
    ...d.layers
      .filter((l: any) => l.type === "image")
      .map((l: any) => l.assetId),
  ].filter(Boolean);
export const copySuggestionInput = z
  .object({
    artifactId: id,
    baseVersion: z.int().positive(),
    projectVersion: z.int().positive(),
    snapshotHash: z.string().length(64),
    requestKey: z.string().min(8).max(120),
    candidates: z
      .array(
        z
          .object({
            label: z.string().min(1).max(80),
            changes: z
              .object({
                title: z.string().min(1).max(120).optional(),
                body: z.string().min(1).max(2000).optional(),
                cta: z.string().min(1).max(120).optional(),
              })
              .strict()
              .refine((x) => Object.keys(x).length > 0),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export class ContentArtworkService {
  constructor(readonly host: ContentService) {}
  get db() {
    return this.host.db;
  }
  guard(...args: Parameters<ContentService["guard"]>) {
    return this.host.guard(...args);
  }
  project(...args: Parameters<ContentService["project"]>) {
    return this.host.project(...args);
  }
  document(...args: Parameters<ContentService["document"]>) {
    return this.host.document(...args);
  }
  asset(...args: Parameters<ContentService["asset"]>) {
    return this.host.asset(...args);
  }
  audit(...args: Parameters<ContentService["audit"]>) {
    return this.host.audit(...args);
  }
  async validateArtwork(c: RequestContext, p: any, data: any) {
    for (const assetId of assetRefs(data)) {
      const a = await this.asset(c, assetId);
      if (!a.shared && a.projectId !== p.id)
        throw new BadRequestException("不能引用其他项目的私有素材");
    }
    const b = p.brief as any;
    const brand =
      b.workflow === "studio" && !b.brandId
        ? { data: { forbiddenWords: [] } }
        : await this.document(c, b.brandId, b.brandVersion, "brand");
    for (const word of brand.data.forbiddenWords ?? [])
      if (
        JSON.stringify(data.layers.map((x: any) => x.text ?? "")).includes(
          word,
        ) ||
        JSON.stringify(data.copy).includes(word)
      )
        throw new BadRequestException("包含品牌禁用词：" + word);
  }
  async applyTemplate(c: RequestContext, brief: any, data: any) {
    if (!brief.templateId) return data;
    const template = await this.document(
      c,
      brief.templateId,
      brief.templateVersion,
      "template",
    );
    return {
      ...data,
      layers: data.layers.map((l: any) => {
        const style = template.data.layout?.find((x: any) => x.role === l.role);
        return style ? { ...l, ...style } : l;
      }),
      source: {
        ...data.source,
        templateId: template.id,
        templateVersion: template.version,
      },
    };
  }
  async createArtwork(c: RequestContext, projectId: string, raw: unknown) {
    const p = await this.project(c, projectId, true);
    const v = readBody(
      z
        .object({
          name: z.string().min(1).max(120),
          size: z.enum(["square", "portrait", "story"]),
          productId: id,
        })
        .strict(),
      raw,
    );
    const brief = p.brief as any;
    if (!brief.productIds.includes(v.productId))
      throw new BadRequestException("产品不在当前项目中");
    const brand = await this.document(
        c,
        brief.brandId,
        brief.brandVersion,
        "brand",
      ),
      product = await this.document(
        c,
        v.productId,
        brief.productVersions[v.productId],
        "product",
      );
    let data = compose(brief, brand, product, v.size, {
      brandId: brand.id,
      brandVersion: brand.version,
      productId: product.id,
      productVersion: product.version,
      projectVersion: p.version,
    });
    data = await this.applyTemplate(c, brief, data);
    await this.validateArtwork(c, p, data);
    return this.db.$transaction(async (tx) => {
      const a = await tx.contentArtifact.create({
        data: { tenantId: c.tenantId, projectId: p.id, name: v.name },
      });
      await tx.contentArtifactVersion.create({
        data: {
          tenantId: c.tenantId,
          artifactId: a.id,
          version: 1,
          data: J(data),
          createdBy: c.membershipId,
        },
      });
      await this.audit(tx, c, "artifact.create", a.id);
      return { ...a, data, status: "draft" };
    });
  }
  async artifact(c: RequestContext, artifactId: string) {
    await this.guard(c);
    const a = await this.db.contentArtifact.findFirst({
      where: { id: uuid(artifactId), tenantId: c.tenantId },
    });
    if (!a) throw new NotFoundException();
    await this.project(c, a.projectId);
    return a;
  }
  async artworks(c: RequestContext, projectId: string, query?: unknown) {
    const ctx = await this.guard(c);
    await this.project(ctx, projectId);
    const editable =
      ctx.permissions.includes("content.create") ||
      ctx.permissions.includes("content.review");
    const q = readBody(
      z.object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        q: z.string().max(100).default(""),
      }),
      query ?? {},
    );
    const paged = query !== undefined;
    const visible = editable
      ? undefined
      : (
          await this.db.contentArtifactVersion.findMany({
            where: {
              tenantId: c.tenantId,
              status: { in: ["approved", "exempt"] },
            },
            select: { artifactId: true },
            distinct: ["artifactId"],
          })
        ).map((v) => v.artifactId);
    const where = {
      tenantId: c.tenantId,
      projectId,
      name: { contains: q.q, mode: "insensitive" as const },
      ...(visible ? { id: { in: visible } } : {}),
    };
    const [arts, total] = await Promise.all([
      this.db.contentArtifact.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: paged ? 20 : 200,
        skip: paged ? (q.page - 1) * 20 : 0,
      }),
      this.db.contentArtifact.count({ where }),
    ]);
    const versions = await this.db.contentArtifactVersion.findMany({
      where: {
        tenantId: c.tenantId,
        artifactId: { in: arts.map((a) => a.id) },
        ...(editable ? {} : { status: { in: ["approved", "exempt"] } }),
      },
      orderBy: { version: "desc" },
      ...(paged ? { distinct: ["artifactId"] } : {}),
    });
    const items = arts
      .map((a) => ({
        ...a,
        versions: versions.filter((v) => v.artifactId === a.id),
      }))
      .filter((a) => a.versions.length);
    return paged ? { items, total, page: q.page, pageSize: 20 } : items;
  }
  async versions(c: RequestContext, artifactId: string, query: unknown) {
    c = await this.guard(c);
    const a = await this.artifact(c, artifactId);
    const q = readBody(
      z.object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        q: z.string().max(100).default(""),
      }),
      query,
    );
    const editable =
      c.permissions.includes("content.create") ||
      c.permissions.includes("content.review");
    const where = {
      tenantId: c.tenantId,
      artifactId: a.id,
      ...(editable ? {} : { status: { in: ["approved", "exempt"] } }),
      ...(q.q
        ? {
            version: Number.isSafeInteger(Number(q.q.replace(/^v/i, "")))
              ? Number(q.q.replace(/^v/i, ""))
              : -1,
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.contentArtifactVersion.findMany({
        where,
        orderBy: { version: "desc" },
        take: 20,
        skip: (q.page - 1) * 20,
      }),
      this.db.contentArtifactVersion.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: 20 };
  }
  async version(c: RequestContext, artifactId: string, version: string) {
    c = await this.guard(c);
    const a = await this.artifact(c, artifactId),
      n = readBody(z.coerce.number().int().positive(), version);
    const v = await this.db.contentArtifactVersion.findUnique({
      where: {
        tenantId_artifactId_version: {
          tenantId: c.tenantId,
          artifactId: a.id,
          version: n,
        },
      },
    });
    if (
      !v ||
      (!c.permissions.includes("content.create") &&
        !c.permissions.includes("content.review") &&
        !["approved", "exempt"].includes(v.status))
    )
      throw new NotFoundException();
    return v;
  }
  async saveArtwork(c: RequestContext, artifactId: string, raw: unknown) {
    c = await this.guard(c, "content.create");
    const a = await this.artifact(c, artifactId);
    const p = await this.project(c, a.projectId, true);
    const v = readBody(
      z
        .object({
          version: z.int().positive(),
          data: artwork,
          draftRevision: z.int().nonnegative().optional(),
          projectVersion: z.int().positive().optional(),
        })
        .strict(),
      raw,
    );
    v.data = syncArtworkCopy(v.data);
    await this.validateArtwork(c, p, v.data);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":content-artifact:" + a.id}))`;
      const project = await tx.contentProject.findFirst({
        where: {
          id: p.id,
          tenantId: c.tenantId,
          version: v.projectVersion ?? p.version,
          deletedAt: null,
        },
      });
      if (!project)
        throw new ConflictException(
          "项目资料已更新，当前编辑已保留，请重新核对",
        );
      if (v.draftRevision !== undefined) {
        const draft = await tx.contentWorkDraft.findUnique({
          where: {
            tenantId_artifactId_membershipId: {
              tenantId: c.tenantId,
              artifactId: a.id,
              membershipId: c.membershipId,
            },
          },
        });
        if (
          (draft?.revision ?? 0) !== v.draftRevision ||
          (draft && hash(draft.data) !== hash(v.data))
        )
          throw new ConflictException("工作草稿已变化，请同步后再保存正式版本");
      }
      const old = await tx.contentArtifactVersion.findUnique({
        where: {
          tenantId_artifactId_version: {
            tenantId: c.tenantId,
            artifactId: a.id,
            version: v.version,
          },
        },
      });
      if (!old) throw new NotFoundException();
      const before = old.data as any;
      if (!c.permissions.includes("content.manage"))
        for (const l of before.layers.filter((l: any) => l.locked)) {
          if (hash(l) !== hash(v.data.layers.find((x) => x.id === l.id)))
            throw new ForbiddenException("锁定图层只能由内容管理员修改");
        }
      if (hash(before.source) !== hash(v.data.source))
        throw new BadRequestException("不可修改作品来源");
      const changed = await tx.contentArtifact.updateMany({
        where: { id: a.id, tenantId: c.tenantId, version: v.version },
        data: { version: { increment: 1 } },
      });
      if (!changed.count)
        throw new ConflictException("作品已修改，请刷新后保存");
      const r = await tx.contentArtifactVersion.create({
        data: {
          tenantId: c.tenantId,
          artifactId: a.id,
          version: v.version + 1,
          data: J(v.data),
          createdBy: c.membershipId,
        },
      });
      await this.audit(tx, c, "artifact.save", a.id, { version: r.version });
      await tx.contentWorkDraft.deleteMany({
        where: {
          tenantId: c.tenantId,
          artifactId: a.id,
          membershipId: c.membershipId,
        },
      });
      return r;
    });
  }
  async snapshot(c: RequestContext, artifactId: string) {
    c = await this.guard(c, "content.create");
    const a = await this.artifact(c, artifactId),
      p = await this.project(c, a.projectId, true);
    const current = await this.db.contentArtifactVersion.findUniqueOrThrow({
      where: {
        tenantId_artifactId_version: {
          tenantId: c.tenantId,
          artifactId: a.id,
          version: a.version,
        },
      },
    });
    const draft = await this.db.contentWorkDraft.findUnique({
      where: {
        tenantId_artifactId_membershipId: {
          tenantId: c.tenantId,
          artifactId: a.id,
          membershipId: c.membershipId,
        },
      },
    });
    return {
      artifactId: a.id,
      currentVersion: a.version,
      projectVersion: p.version,
      current,
      draft,
      conflict: Boolean(
        draft &&
          (draft.baseVersion !== a.version ||
            draft.projectVersion !== p.version),
      ),
    };
  }
  async saveDraft(c: RequestContext, artifactId: string, raw: unknown) {
    c = await this.guard(c, "content.create");
    const a = await this.artifact(c, artifactId),
      p = await this.project(c, a.projectId, true);
    const v = readBody(
      z
        .object({
          baseVersion: z.int().positive(),
          projectVersion: z.int().positive(),
          revision: z.int().nonnegative(),
          requestKey: z.string().min(8).max(120),
          data: artwork,
        })
        .strict(),
      raw,
    );
    v.data = syncArtworkCopy(v.data);
    await this.validateArtwork(c, p, v.data);
    const fingerprint = hash({ ...v, requestKey: undefined });
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":content-artifact:" + a.id}))`;
      const where = {
        tenantId_artifactId_membershipId: {
          tenantId: c.tenantId,
          artifactId: a.id,
          membershipId: c.membershipId,
        },
      };
      const old = await tx.contentWorkDraft.findUnique({ where });
      if (old?.requestKey === v.requestKey) {
        if (old.fingerprint !== fingerprint)
          throw new ConflictException("同一草稿请求参数不同");
        return old;
      }
      const latest = await tx.contentArtifact.findFirst({
        where: { id: a.id, tenantId: c.tenantId },
      });
      const latestProject = await tx.contentProject.findFirst({
        where: {
          id: p.id,
          tenantId: c.tenantId,
          version: v.projectVersion,
          deletedAt: null,
        },
      });
      if (
        latest?.version !== v.baseVersion ||
        !latestProject ||
        (old?.revision ?? 0) !== v.revision ||
        (old &&
          (old.baseVersion !== v.baseVersion ||
            old.projectVersion !== v.projectVersion))
      )
        throw new ConflictException(
          "草稿或正式版本已更新；当前输入保留，请查看最新版本",
        );
      const before = await tx.contentArtifactVersion.findUniqueOrThrow({
        where: {
          tenantId_artifactId_version: {
            tenantId: c.tenantId,
            artifactId: a.id,
            version: v.baseVersion,
          },
        },
      });
      this.checkEdit(c, before.data, v.data);
      const data = {
        baseVersion: v.baseVersion,
        projectVersion: v.projectVersion,
        requestKey: v.requestKey,
        fingerprint,
        data: J(v.data),
        revision: v.revision + 1,
      };
      return tx.contentWorkDraft.upsert({
        where,
        create: {
          tenantId: c.tenantId,
          artifactId: a.id,
          membershipId: c.membershipId,
          ...data,
        },
        update: data,
      });
    });
  }
  checkEdit(c: RequestContext, before: any, data: any) {
    if (hash(before.source) !== hash(data.source))
      throw new BadRequestException("不可修改作品来源");
    if (!c.permissions.includes("content.manage"))
      for (const l of before.layers.filter((l: any) => l.locked)) {
        if (hash(l) !== hash(data.layers.find((x: any) => x.id === l.id)))
          throw new ForbiddenException("锁定图层只能由内容管理员修改");
      }
  }
  async discardDraft(c: RequestContext, artifactId: string, raw: unknown) {
    c = await this.guard(c, "content.create");
    const a = await this.artifact(c, artifactId);
    await this.project(c, a.projectId, true);
    const v = readBody(
      z.object({ revision: z.int().positive() }).strict(),
      raw,
    );
    const removed = await this.db.contentWorkDraft.deleteMany({
      where: {
        tenantId: c.tenantId,
        artifactId: a.id,
        membershipId: c.membershipId,
        revision: v.revision,
      },
    });
    if (!removed.count) throw new ConflictException("草稿已更新，请重新读取");
    return { ok: true };
  }
  async rebaseDraft(c: RequestContext, artifactId: string, raw: unknown) {
    c = await this.guard(c, "content.create");
    const a = await this.artifact(c, artifactId),
      p = await this.project(c, a.projectId, true);
    const v = readBody(
      z
        .object({
          revision: z.int().nonnegative(),
          targetVersion: z.int().positive(),
          projectVersion: z.int().positive(),
          targetHash: z.string().length(64),
          requestKey: z.string().min(8).max(120),
          changes: z
            .array(
              z
                .object({
                  layerId: z.string().min(1).max(80),
                  changes: z
                    .record(z.string(), z.unknown())
                    .refine((patch) =>
                      Object.keys(patch).every((key) =>
                        [
                          "text",
                          "assetId",
                          "x",
                          "y",
                          "w",
                          "h",
                          "fontSize",
                          "color",
                          "crop",
                          "locked",
                        ].includes(key),
                      ),
                    ),
                })
                .strict(),
            )
            .min(1)
            .max(30),
        })
        .strict(),
      raw,
    );
    const target = await this.version(c, a.id, String(v.targetVersion));
    const prior = await this.db.contentWorkDraft.findUnique({
      where: {
        tenantId_artifactId_membershipId: {
          tenantId: c.tenantId,
          artifactId: a.id,
          membershipId: c.membershipId,
        },
      },
    });
    const targetData =
      prior?.baseVersion === a.version && prior.projectVersion === p.version
        ? prior.data
        : target.data;
    if (
      a.version !== v.targetVersion ||
      p.version !== v.projectVersion ||
      hash(targetData) !== v.targetHash
    )
      throw new ConflictException("比较目标已更新，请重新核对");
    const data = structuredClone(targetData) as any;
    for (const change of v.changes) {
      const index = data.layers.findIndex((l: any) => l.id === change.layerId);
      if (index < 0) throw new BadRequestException("最新版本已删除该图层");
      data.layers[index] = readBody(layer, {
        ...data.layers[index],
        ...change.changes,
      });
    }
    this.checkEdit(c, target.data, data);
    const next = syncArtworkCopy(readBody(artwork, data));
    await this.validateArtwork(c, p, next);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":content-artifact:" + a.id}))`;
      const latest = await tx.contentArtifact.findFirst({
        where: { id: a.id, tenantId: c.tenantId, version: v.targetVersion },
      });
      const project = await tx.contentProject.findFirst({
        where: {
          id: p.id,
          tenantId: c.tenantId,
          version: v.projectVersion,
          deletedAt: null,
        },
      });
      if (!latest || !project)
        throw new ConflictException("目标已更新，请重新比较");
      const where = {
        tenantId_artifactId_membershipId: {
          tenantId: c.tenantId,
          artifactId: a.id,
          membershipId: c.membershipId,
        },
      };
      const old = await tx.contentWorkDraft.findUnique({ where });
      if ((old?.revision ?? 0) !== v.revision)
        throw new ConflictException("草稿已更新，请重新比较");
      await tx.contentWorkDraft.upsert({
        where,
        create: {
          tenantId: c.tenantId,
          artifactId: a.id,
          membershipId: c.membershipId,
          baseVersion: a.version,
          projectVersion: p.version,
          data: J(next),
          revision: 1,
          requestKey: v.requestKey,
          fingerprint: hash(v),
        },
        update: {
          baseVersion: a.version,
          projectVersion: p.version,
          data: J(next),
          revision: { increment: 1 },
          requestKey: v.requestKey,
          fingerprint: hash(v),
        },
      });
      await this.audit(tx, c, "draft.rebase", a.id, {
        targetVersion: a.version,
        layerIds: v.changes.map((x) => x.layerId),
      });
      return tx.contentWorkDraft.findUniqueOrThrow({
        where: {
          tenantId_artifactId_membershipId: {
            tenantId: c.tenantId,
            artifactId: a.id,
            membershipId: c.membershipId,
          },
        },
      });
    });
  }
  async layout(c: RequestContext, artifactId: string, raw: unknown) {
    await this.artifact(c, artifactId);
    const v = readBody(z.object({ data: artwork }).strict(), raw);
    return mediaOperation({ op: "layout", data: v.data });
  }
  async copyContext(c: RequestContext, artifactId: string) {
    await this.guard(c, "content.ai.use");
    const snapshot = await this.snapshot(c, artifactId);
    if (snapshot.conflict)
      throw new ConflictException("请先处理过时草稿，再生成文案建议");
    const a = await this.artifact(c, artifactId),
      p = await this.project(c, a.projectId, true),
      brief = p.brief as any;
    const data = (snapshot.draft?.data ?? snapshot.current.data) as any;
    return {
      artifactId,
      baseVersion: snapshot.currentVersion,
      projectVersion: p.version,
      snapshotHash: hash(data),
      data,
      brand: await this.document(c, brief.brandId, brief.brandVersion, "brand"),
      products: await Promise.all(
        brief.productIds.map((id: string) =>
          this.document(c, id, brief.productVersions[id], "product"),
        ),
      ),
      instructions:
        "只建议标题、卖点或行动语；不能改价格、日期、规格、型号和声明。用stage_copy保存最多5个候选，不直接改作品。",
    };
  }
  async stageCopy(c: RequestContext, raw: unknown) {
    c = await this.guard(c, "content.ai.use");
    const v = readBody(copySuggestionInput, raw),
      ctx = await this.copyContext(c, v.artifactId);
    const fingerprint = hash(v);
    const existing = await this.db.contentCopySuggestion.findUnique({
      where: {
        tenantId_requestKey: { tenantId: c.tenantId, requestKey: v.requestKey },
      },
    });
    if (existing) {
      if (
        existing.membershipId !== c.membershipId ||
        existing.fingerprint !== fingerprint
      )
        throw new ConflictException("文案请求编号已使用");
      return existing;
    }
    if (
      ctx.baseVersion !== v.baseVersion ||
      ctx.projectVersion !== v.projectVersion ||
      ctx.snapshotHash !== v.snapshotHash
    )
      throw new ConflictException("文案来源已变化，请重新读取");
    for (const candidate of v.candidates)
      await this.copyChanges(c, v.artifactId, ctx.data, candidate.changes);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":content-copy:" + v.requestKey}))`;
      const duplicate = await tx.contentCopySuggestion.findUnique({
        where: {
          tenantId_requestKey: {
            tenantId: c.tenantId,
            requestKey: v.requestKey,
          },
        },
      });
      if (duplicate) {
        if (
          duplicate.membershipId !== c.membershipId ||
          duplicate.fingerprint !== fingerprint
        )
          throw new ConflictException("文案请求编号已使用");
        return duplicate;
      }
      const suggestion = await tx.contentCopySuggestion.create({
        data: {
          tenantId: c.tenantId,
          membershipId: c.membershipId,
          artifactId: v.artifactId,
          baseVersion: v.baseVersion,
          projectVersion: v.projectVersion,
          snapshotHash: v.snapshotHash,
          requestKey: v.requestKey,
          fingerprint,
          candidates: J(v.candidates),
        },
      });
      await this.audit(tx, c, "copy.stage", v.artifactId, {
        suggestionId: suggestion.id,
        candidateCount: v.candidates.length,
      });
      return suggestion;
    });
  }
  async copyChanges(
    c: RequestContext,
    artifactId: string,
    data: any,
    changes: Record<string, string | undefined>,
  ) {
    const a = await this.artifact(c, artifactId),
      p = await this.project(c, a.projectId, true),
      brief = p.brief as any;
    const product = data.source.productId
      ? await this.document(
          c,
          data.source.productId,
          data.source.productVersion,
          "product",
        )
      : null;
    const protectedLines = (product?.data.parameters ?? "")
      .split("\n")
      .filter((s: string) => s.trim());
    const next = structuredClone(data);
    for (const [role, text] of Object.entries(changes)) {
      if (text === undefined) continue;
      const layer = next.layers.find(
        (l: any) => l.type === "text" && l.role === role,
      );
      if (!layer) throw new BadRequestException("作品没有对应的文案图层");
      if (layer.locked && !c.permissions.includes("content.manage"))
        throw new ForbiddenException("建议不能改动锁定图层");
      if (
        role === "body" &&
        protectedLines.some((line: string) => !text.includes(line))
      )
        throw new BadRequestException("建议必须保留产品规格和参数原文");
      const known = [
        JSON.stringify(product?.data ?? {}),
        JSON.stringify(data.copy),
        brief.prompt,
      ].join(" ");
      const numbers = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
      const allowedNumbers = new Set(known.match(/\d+(?:[.,]\d+)*/g) ?? []);
      if (numbers.some((n) => !allowedNumbers.has(n)))
        throw new BadRequestException(
          "建议包含资料中没有的数字，请先核对产品事实",
        );
      layer.text = text;
    }
    const result = syncArtworkCopy(next);
    await this.validateArtwork(c, p, result);
    return result;
  }
  async suggestions(c: RequestContext, artifactId: string) {
    await this.snapshot(c, artifactId);
    return this.db.contentCopySuggestion.findMany({
      where: { tenantId: c.tenantId, artifactId, membershipId: c.membershipId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }
  async adoptCopy(c: RequestContext, artifactId: string, raw: unknown) {
    c = await this.guard(c, "content.create");
    const v = readBody(
      z
        .object({
          suggestionId: id,
          candidate: z.int().nonnegative().max(4),
          revision: z.int().nonnegative(),
          requestKey: z.string().min(8).max(120),
        })
        .strict(),
      raw,
    );
    const suggestion = await this.db.contentCopySuggestion.findFirst({
      where: {
        id: v.suggestionId,
        tenantId: c.tenantId,
        artifactId: uuid(artifactId),
        membershipId: c.membershipId,
      },
    });
    if (!suggestion) throw new NotFoundException();
    const snapshot = await this.snapshot(c, artifactId),
      data = snapshot.draft?.data ?? snapshot.current.data;
    if (
      snapshot.conflict ||
      snapshot.currentVersion !== suggestion.baseVersion ||
      snapshot.projectVersion !== suggestion.projectVersion ||
      hash(data) !== suggestion.snapshotHash
    )
      throw new ConflictException(
        "采用目标已变化，保留当前编辑，请重新生成建议",
      );
    const candidate = (suggestion.candidates as any[])[v.candidate];
    if (!candidate) throw new BadRequestException();
    return this.saveDraft(c, artifactId, {
      baseVersion: snapshot.currentVersion,
      projectVersion: snapshot.projectVersion,
      revision: v.revision,
      requestKey: v.requestKey,
      data: await this.copyChanges(c, artifactId, data, candidate.changes),
    });
  }
}
