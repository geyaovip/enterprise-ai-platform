import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SeedanceProvider, videoRatios } from "./seedance.provider";
import {
  imageCapabilities,
  imageDimensions,
  referenceIds,
} from "./content-image-options";
import { ContentCanvasService, canvasBinding } from "./content-canvas.service";
import { EnterpriseModelService } from "../platform/enterprise-model.service";
import { ContentDeliveryService } from "./content-delivery.service";
import { ContentArtworkService } from "./content-artwork.service";
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../prisma.service";
import { AuthService } from "../platform/auth.service";
import type { RequestContext } from "../platform/context";
import { readBody } from "../platform/security";
import { CONTENT_ROLES } from "./content-permissions";
import {
  artwork,
  compose,
  documentInput,
  generation,
  editRegion,
  hash,
  id,
  json,
  projectInput,
  sizes,
  colorDescription,
} from "./content.rules";
import {
  getFile,
  filePath,
  putFile,
  mediaOperation,
  removeFile,
} from "./content-storage";
import { SeedreamProvider, MediaError } from "./seedream.provider";
const J = json;
const videoMetric = "content.video";
const imageMetric = "content.image";
const contentMediaMetrics = { in: [imageMetric, videoMetric] };
const metricFor = (mode: string) =>
  mode === "video" ? videoMetric : imageMetric;
const uuid = (v: string) => readBody(id, v);
const pageInput = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().max(100).default(""),
});
const assetRefs = (d: any): string[] =>
  [
    d.backgroundId,
    ...(d.layers ?? [])
      .filter((l: any) => l.type === "image")
      .map((l: any) => l.assetId),
  ].filter(Boolean);
@Injectable()
export class ContentService {
  constructor(
    readonly db: PrismaService,
    readonly auth: AuthService,
    readonly provider: SeedreamProvider,
    readonly models: EnterpriseModelService,
  ) {}
  readonly video = new SeedanceProvider();
  async guard(c: RequestContext, p = "content.read") {
    if (c.app.appId !== "content") throw new ForbiddenException("应用范围无效");
    const current = await this.auth.taskContext({
      tenantId: c.tenantId,
      userId: c.userId,
      membershipId: c.membershipId,
      appId: "content",
      taskId: c.requestId,
    });
    this.auth.require(current, p);
    return current;
  }
  async audit(
    tx: any,
    c: RequestContext,
    action: string,
    resourceId: string,
    detail: any = {},
  ) {
    await tx.auditEvent.create({
      data: {
        tenantId: c.tenantId,
        userId: c.userId,
        membershipId: c.membershipId,
        appId: "content",
        requestId: c.requestId,
        action: "content." + action,
        resourceType: "Content",
        resourceId,
        detail: J(detail),
      },
    });
  }
  async settings(c: RequestContext) {
    await this.guard(c);
    return (
      (await this.db.contentSettings.findUnique({
        where: { tenantId: c.tenantId },
      })) ?? {
        tenantId: c.tenantId,
        reviewRequired: true,
        maxBatch: 12,
        monthlyImageLimit: 100,
        version: 0,
      }
    );
  }
  async metadata(c: RequestContext) {
    const ctx = await this.guard(c);
    const [channel, videoChannel] = await Promise.all([
      this.models.customMedia(c.tenantId, "image"),
      this.models.customMedia(c.tenantId, "video"),
    ]);
    return {
      membershipId: c.membershipId,
      permissions: ctx.permissions.filter((p) => p.startsWith("content.")),
      settings: await this.settings(c),
      model: {
        configured: this.provider.configured(channel),
        image: this.provider.model(channel),
        imageOptions: imageCapabilities(this.provider.model(channel)),
        video: this.video.model(videoChannel),
        videoConfigured: this.video.configured(videoChannel),
        videoRatios,
        binding: (() => {
          try {
            return this.provider.binding(channel);
          } catch {
            return null;
          }
        })(),
      },
      templates: ["hero", "split", "minimal"],
      sizes,
    };
  }
  async collaborators(c: RequestContext, query: any) {
    await this.guard(c, "content.create");
    const q = readBody(pageInput, query);
    const where = {
      tenantId: c.tenantId,
      active: true,
      user: { name: { contains: q.q, mode: "insensitive" as const } },
    };
    const [items, total] = await Promise.all([
      this.db.membership.findMany({
        where,
        take: 20,
        skip: (q.page - 1) * 20,
        select: { id: true, user: { select: { name: true } } },
      }),
      this.db.membership.count({ where }),
    ]);
    return {
      items: items.map((m) => ({ id: m.id, name: m.user.name })),
      total,
      page: q.page,
      pageSize: 20,
    };
  }
  async members(c: RequestContext) {
    await this.guard(c, "content.manage");
    const m = await this.db.membership.findMany({
      where: { tenantId: c.tenantId, active: true },
      select: { id: true, role: true, user: { select: { name: true } } },
    });
    const grants = await this.db.contentGrant.findMany({
      where: { tenantId: c.tenantId },
    });
    return m.map((v) => ({
      ...v,
      contentRole:
        v.role === "admin"
          ? "manager"
          : (grants.find((g) => g.membershipId === v.id)?.role ?? ""),
    }));
  }
  async saveSettings(c: RequestContext, raw: unknown) {
    await this.guard(c, "content.manage");
    const v = readBody(
      z
        .object({
          version: z.int().min(0),
          reviewRequired: z.boolean(),
          maxBatch: z.int().min(1).max(60),
          monthlyImageLimit: z.int().min(0).max(100000),
        })
        .strict(),
      raw,
    );
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":content-settings"}))`;
      const old = await tx.contentSettings.findUnique({
        where: { tenantId: c.tenantId },
      });
      if ((old?.version ?? 0) !== v.version)
        throw new ConflictException("设置已更新");
      const data = {
        reviewRequired: v.reviewRequired,
        maxBatch: v.maxBatch,
        monthlyImageLimit: v.monthlyImageLimit,
      };
      const r = await tx.contentSettings.upsert({
        where: { tenantId: c.tenantId },
        create: { tenantId: c.tenantId, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      await this.audit(tx, c, "settings", c.tenantId, {
        ...data,
        version: r.version,
      });
      return r;
    });
  }
  async grant(c: RequestContext, raw: unknown) {
    await this.guard(c, "content.manage");
    const v = readBody(
      z
        .object({
          membershipId: id,
          role: z.enum(["manager", "creator", "reviewer", "viewer", "none"]),
        })
        .strict(),
      raw,
    );
    if (
      !(await this.db.membership.findFirst({
        where: { id: v.membershipId, tenantId: c.tenantId, active: true },
      }))
    )
      throw new NotFoundException("成员不存在");
    await this.db.$transaction(async (tx) => {
      if (v.role === "none")
        await tx.contentGrant.deleteMany({
          where: { tenantId: c.tenantId, membershipId: v.membershipId },
        });
      else
        await tx.contentGrant.upsert({
          where: {
            tenantId_membershipId: {
              tenantId: c.tenantId,
              membershipId: v.membershipId,
            },
          },
          create: { tenantId: c.tenantId, ...v },
          update: { role: v.role },
        });
      await this.audit(tx, c, "grant", v.membershipId, { role: v.role });
    });
    return { ok: true };
  }
  async document(
    c: RequestContext,
    documentId: string,
    version?: number,
    kind?: string,
  ) {
    const ctx = await this.guard(c);
    const d = await this.db.contentDocument.findFirst({
      where: {
        id: uuid(documentId),
        tenantId: c.tenantId,
        deletedAt: null,
        ...(kind ? { kind } : {}),
      },
    });
    if (!d) throw new NotFoundException("资料不存在");
    const v = await this.db.contentDocumentVersion.findUnique({
      where: {
        tenantId_documentId_version: {
          tenantId: c.tenantId,
          documentId: d.id,
          version:
            version ??
            (d.kind === "brand" && !ctx.permissions.includes("content.manage")
              ? (d.publishedVersion ?? 0)
              : d.version),
        },
      },
    });
    if (!v) throw new NotFoundException("资料版本不存在");
    if (
      d.kind === "brand" &&
      !ctx.permissions.includes("content.manage") &&
      !v.publishedAt
    )
      throw new NotFoundException("品牌规范尚未发布");
    return {
      ...d,
      version: v.version,
      name: (v.data as any).name ?? d.name,
      publishedAt: v.publishedAt,
      data: v.data as any,
    };
  }
  async documents(c: RequestContext, kind: string, query: unknown) {
    await this.guard(c);
    if (!["brand", "product", "template"].includes(kind))
      throw new BadRequestException();
    const q = readBody(pageInput, query);
    const where = {
      tenantId: c.tenantId,
      kind,
      deletedAt: null,
      name: { contains: q.q, mode: "insensitive" as const },
    };
    const [rows, total] = await Promise.all([
      this.db.contentDocument.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * 20,
        take: 20,
      }),
      this.db.contentDocument.count({ where }),
    ]);
    const items = (
      await Promise.all(
        rows.map(async (d) => this.document(c, d.id).catch(() => null)),
      )
    ).filter(Boolean);
    return { items, total, page: q.page, pageSize: 20 };
  }
  async saveDocument(
    c: RequestContext,
    kind: string,
    raw: unknown,
    documentId?: string,
  ) {
    await this.guard(
      c,
      kind === "product" ? "content.create" : "content.manage",
    );
    if (!["brand", "product", "template"].includes(kind))
      throw new BadRequestException();
    const v = readBody(documentInput, raw);
    for (const a of [v.data.imageId, v.data.logoId].filter(Boolean)) {
      const asset = await this.asset(c, a!);
      if (!asset.shared)
        throw new BadRequestException("品牌和产品资料请选择企业共享素材");
    }
    return this.db.$transaction(async (tx) => {
      let d;
      if (documentId) {
        d = await tx.contentDocument.findFirst({
          where: {
            id: uuid(documentId),
            tenantId: c.tenantId,
            kind,
            deletedAt: null,
          },
        });
        if (!d) throw new NotFoundException();
        if (v.version !== d.version) throw new ConflictException("资料已修改");
        const changed = await tx.contentDocument.updateMany({
          where: { id: d.id, tenantId: c.tenantId, version: v.version },
          data: { name: v.name, version: { increment: 1 } },
        });
        if (!changed.count) throw new ConflictException();
        d = { ...d, name: v.name, version: d.version + 1 };
      } else
        d = await tx.contentDocument.create({
          data: { tenantId: c.tenantId, kind, name: v.name },
        });
      const data = J({ ...v.data, name: v.name });
      await tx.contentDocumentVersion.create({
        data: {
          tenantId: c.tenantId,
          documentId: d.id,
          version: d.version,
          data,
          createdBy: c.membershipId,
        },
      });
      await this.audit(tx, c, "document.save", d.id, {
        kind,
        version: d.version,
      });
      return { ...d, data };
    });
  }
  async publish(c: RequestContext, documentId: string, raw: unknown) {
    await this.guard(c, "content.manage");
    const v = readBody(z.object({ version: z.int().positive() }).strict(), raw);
    const d = await this.document(c, documentId, v.version, "brand");
    await this.db.$transaction(async (tx) => {
      const changed = await tx.contentDocument.updateMany({
        where: { id: d.id, tenantId: c.tenantId, version: v.version },
        data: { publishedVersion: v.version },
      });
      if (!changed.count) throw new ConflictException("品牌已更新，请重新核对");
      await tx.contentDocumentVersion.update({
        where: {
          tenantId_documentId_version: {
            tenantId: c.tenantId,
            documentId: d.id,
            version: v.version,
          },
        },
        data: { publishedAt: new Date() },
      });
      await this.audit(tx, c, "brand.publish", d.id, { version: v.version });
    });
    return { ok: true };
  }
  projectWhere(c: RequestContext) {
    return {
      tenantId: c.tenantId,
      deletedAt: null,
      OR: c.permissions.includes("content.manage")
        ? undefined
        : [
            { ownerId: c.membershipId },
            { visibility: "tenant" },
            { participants: { has: c.membershipId } },
          ],
    };
  }
  async project(c: RequestContext, projectId: string, write = false) {
    const ctx = await this.guard(c, write ? "content.create" : "content.read");
    const p = await this.db.contentProject.findFirst({
      where: { ...this.projectWhere(ctx), id: uuid(projectId) },
    });
    if (!p) throw new NotFoundException("项目不存在或无权访问");
    return p;
  }
  async projects(c: RequestContext, query: unknown) {
    const ctx = await this.guard(c);
    const q = readBody(pageInput, query);
    const where = {
      ...this.projectWhere(ctx),
      name: { contains: q.q, mode: "insensitive" as const },
    };
    const [items, total] = await Promise.all([
      this.db.contentProject.findMany({
        where,
        take: 20,
        skip: (q.page - 1) * 20,
        orderBy: { updatedAt: "desc" },
      }),
      this.db.contentProject.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: 20 };
  }
  async validateBrief(c: RequestContext, brief: any) {
    const brand =
      brief.workflow === "studio" && !brief.brandId
        ? {
            id: null,
            version: null,
            publishedAt: true,
            data: { forbiddenWords: [], tone: "", color: "#ffffff" },
          }
        : await this.document(c, brief.brandId, brief.brandVersion, "brand");
    if (!brand.publishedAt)
      throw new ConflictException("请选择当前已发布的品牌规范");
    if (brief.templateId) {
      if (!brief.templateVersion) throw new BadRequestException("缺少模板版本");
      await this.document(
        c,
        brief.templateId,
        brief.templateVersion,
        "template",
      );
    }
    const products = await Promise.all(
      brief.productIds.map((p: string) =>
        this.document(c, p, brief.productVersions[p], "product"),
      ),
    );
    if (products.some((p: any) => !brief.productVersions[p.id]))
      throw new BadRequestException("缺少产品版本");
    for (const word of brand.data.forbiddenWords ?? [])
      if (
        [
          brief.prompt,
          brief.title,
          brief.disclaimer,
          brief.cta,
          ...products.map((p: any) => JSON.stringify(p.data)),
        ]
          .join(" ")
          .includes(word)
      )
        throw new BadRequestException("内容包含品牌禁用词：" + word);
    return { brand, products };
  }
  async saveProject(c: RequestContext, raw: unknown, projectId?: string) {
    await this.guard(c, "content.create");
    const v = readBody(projectInput, raw);
    await this.validateBrief(c, v.brief);
    const members = await this.db.membership.count({
      where: {
        tenantId: c.tenantId,
        id: { in: [...new Set(v.participants)] },
        active: true,
      },
    });
    if (members !== new Set(v.participants).size)
      throw new BadRequestException("参与人不属于当前企业");
    if (projectId) {
      const p = await this.project(c, projectId, true);
      if (
        p.ownerId !== c.membershipId &&
        !c.permissions.includes("content.manage") &&
        (p.visibility !== v.visibility ||
          JSON.stringify(p.participants) !== JSON.stringify(v.participants))
      )
        throw new ForbiddenException("仅项目负责人可修改共享范围");
      const changed = await this.db.contentProject.updateMany({
        where: { id: p.id, tenantId: c.tenantId, version: v.version },
        data: {
          name: v.name,
          brief: J(v.brief),
          visibility: v.visibility,
          participants: v.participants,
          version: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException("项目已修改，请刷新");
      await this.audit(this.db, c, "project.save", p.id);
      return this.project(c, p.id);
    }
    const p = await this.db.contentProject.create({
      data: {
        tenantId: c.tenantId,
        ownerId: c.membershipId,
        name: v.name,
        brief: J(v.brief),
        visibility: v.visibility,
        participants: v.participants,
      },
    });
    await this.audit(this.db, c, "project.create", p.id);
    return p;
  }
  async trashProject(c: RequestContext, projectId: string, restore = false) {
    await this.guard(c, "content.create");
    const p = await this.db.contentProject.findFirst({
      where: { id: uuid(projectId), tenantId: c.tenantId },
    });
    if (
      !p ||
      (p.ownerId !== c.membershipId &&
        !c.permissions.includes("content.manage"))
    )
      throw new NotFoundException();
    await this.db.$transaction(async (tx) => {
      await tx.contentProject.update({
        where: { id: p.id },
        data: {
          deletedAt: restore ? null : new Date(),
          version: { increment: 1 },
        },
      });
      if (!restore)
        await tx.contentGenerationItem.updateMany({
          where: {
            tenantId: c.tenantId,
            projectId: p.id,
            status: { in: ["queued", "submitting", "storing", "rendering"] },
          },
          data: { cancelRequested: true },
        });
      await this.audit(
        tx,
        c,
        restore ? "project.restore" : "project.trash",
        p.id,
      );
    });
    return { ok: true };
  }
  async trash(c: RequestContext, query?: unknown) {
    const ctx = await this.guard(c, "content.create");
    const q = readBody(pageInput, query ?? {});
    const where = {
      tenantId: c.tenantId,
      deletedAt: { not: null },
      ...(ctx.permissions.includes("content.manage")
        ? {}
        : { ownerId: c.membershipId }),
    };
    const [items, total] = await Promise.all([
      this.db.contentProject.findMany({
        where,
        take: query ? 20 : 100,
        skip: query ? (q.page - 1) * 20 : 0,
        orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
      }),
      this.db.contentProject.count({ where }),
    ]);
    return query ? { items, total, page: q.page, pageSize: 20 } : items;
  }
  async upload(c: RequestContext, raw: unknown) {
    await this.guard(c, "content.create");
    const v = readBody(
      z
        .object({
          filename: z.string().min(1).max(180),
          data: z.string().max(11 * 1024 * 1024),
          projectId: id.optional(),
          shared: z.boolean().default(false),
          draft: z.boolean().default(false),
        })
        .strict(),
      raw,
    );
    if (v.projectId) await this.project(c, v.projectId, true);
    if (!v.projectId && !v.shared && !v.draft)
      throw new BadRequestException("素材需要所属项目或企业共享范围");
    const normalized = await mediaOperation({
      op: "normalize",
      data: v.data,
    }).catch(() => {
      throw new BadRequestException(
        "请上传有效的PNG/JPEG/WebP静态图片，最大8MiB",
      );
    });
    return this.persistAsset(
      c,
      normalized.data,
      { filename: v.filename, projectId: v.projectId, shared: v.shared },
      normalized.width,
      normalized.height,
    );
  }
  async persistAsset(
    c: RequestContext,
    data: string,
    meta: { filename: string; projectId?: string; shared?: boolean },
    width: number,
    height: number,
  ) {
    const bytes = Buffer.from(data, "base64");
    const assetId = randomUUID();
    await putFile(c.tenantId, assetId, bytes);
    try {
      return await this.db.contentAsset.create({
        data: {
          id: assetId,
          tenantId: c.tenantId,
          ownerId: c.membershipId,
          filename: meta.filename,
          projectId: meta.projectId,
          shared: meta.shared ?? false,
          mime: "image/png",
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          width,
          height,
        },
      });
    } catch (e) {
      await removeFile(c.tenantId, assetId);
      throw e;
    }
  }
  async asset(c: RequestContext, assetId: string) {
    const ctx = await this.guard(c);
    const a = await this.db.contentAsset.findFirst({
      where: { id: uuid(assetId), tenantId: c.tenantId, deletedAt: null },
    });
    if (!a) throw new NotFoundException("素材不存在");
    if (a.projectId) {
      await this.project(c, a.projectId);
      if (
        !ctx.permissions.includes("content.create") &&
        !ctx.permissions.includes("content.review")
      ) {
        const arts = await this.db.contentArtifact.findMany({
          where: { tenantId: c.tenantId, projectId: a.projectId },
          select: { id: true },
        });
        const approved = await this.db.contentArtifactVersion.findMany({
          where: {
            tenantId: c.tenantId,
            artifactId: { in: arts.map((x) => x.id) },
            status: { in: ["approved", "exempt"] },
          },
        });
        if (!approved.some((v) => assetRefs(v.data).includes(a.id)))
          throw new NotFoundException();
      }
    } else if (!a.shared && a.ownerId !== c.membershipId)
      throw new NotFoundException();
    return a;
  }
  async assetBytes(c: RequestContext, assetId: string) {
    const a = await this.asset(c, assetId);
    const bytes = await getFile(c.tenantId, a.id);
    await this.asset(c, assetId);
    return { asset: a, bytes };
  }
  async thumbnail(c: RequestContext, assetId: string) {
    if ((await this.asset(c, assetId)).mime !== "image/png")
      throw new NotFoundException();
    let bytes = await getFile(c.tenantId, assetId, "thumb").catch(
      () => undefined,
    );
    if (!bytes) {
      const original = await this.assetBytes(c!, assetId);
      bytes = Buffer.from(
        (
          await mediaOperation({
            op: "thumbnail",
            large: original.asset.bytes > 20 * 1024 * 1024,
            data: original.bytes.toString("base64"),
          })
        ).data,
        "base64",
      );
      await putFile(c.tenantId, assetId, bytes, "thumb");
    }
    await this.asset(c, assetId);
    return bytes;
  }
  async assets(c: RequestContext, query: any) {
    await this.guard(c);
    const q = readBody(
      z.object({
        projectId: id.optional(),
        media: z.enum(["image", "video"]).optional(),
        days: z.enum(["7", "30", "90"]).optional(),
        q: z.string().trim().max(100).default(""),
        sort: z.enum(["newest", "oldest", "name"]).default("newest"),
        page: z.coerce.number().int().positive().default(1),
      }),
      query,
    );
    if (q.projectId) await this.project(c, q.projectId);
    const where = {
      tenantId: c.tenantId,
      deletedAt: null,
      ...(q.days
        ? {
            createdAt: {
              gte: new Date(Date.now() - Number(q.days) * 86_400_000),
            },
          }
        : {}),
      ...(q.q
        ? { filename: { contains: q.q, mode: "insensitive" as const } }
        : {}),
      ...(q.media
        ? { mime: q.media === "video" ? "video/mp4" : "image/png" }
        : {}),
      ...(q.projectId ? { projectId: q.projectId } : { shared: true }),
    };
    const [rows, total] = await Promise.all([
      this.db.contentAsset.findMany({
        where,
        skip: (q.page - 1) * 20,
        take: 20,
        orderBy: [
          q.sort === "name"
            ? { filename: "asc" }
            : { createdAt: q.sort === "oldest" ? "asc" : "desc" },
          { id: "asc" },
        ],
      }),
      this.db.contentAsset.count({ where }),
    ]);
    const items = [];
    for (const a of rows)
      try {
        await this.asset(c, a.id);
        items.push(a);
      } catch {}
    return { items, total, page: q.page, pageSize: 20 };
  }
  async archiveAssets(c: RequestContext, raw: unknown) {
    const { ids } = readBody(z.object({ ids: z.string().max(800) }), raw);
    const list = readBody(
      z
        .array(id)
        .min(1)
        .max(20)
        .refine((values) => new Set(values).size === values.length),
      ids.split(","),
    );
    const assets = await Promise.all(
      list.map((assetId) => this.asset(c, assetId)),
    );
    if (assets.reduce((sum, asset) => sum + asset.bytes, 0) > 80 * 1024 * 1024)
      throw new BadRequestException("本批文件超过 80 MiB，请分批下载");
    const folder = await mkdtemp(join(tmpdir(), "content-assets-"));
    const path = join(folder, "assets.zip");
    const cleanup = () => rm(folder, { recursive: true, force: true });
    try {
      await mediaOperation({
        op: "asset-archive",
        output: path,
        assets: assets.map((asset, index) => ({
          path: filePath(c.tenantId, asset.id),
          name:
            String(index + 1).padStart(2, "0") +
            "-" +
            asset.filename.replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(-100),
        })),
      });
      for (const assetId of list) await this.asset(c, assetId);
      return { path, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
  async transformAsset(
    c: RequestContext,
    projectId: string,
    assetId: string,
    raw: unknown,
  ) {
    const project = await this.project(c, projectId, true);
    const request = readBody(
      z.discriminatedUnion("operation", [
        z.object({ operation: z.literal("crop"), region: editRegion }).strict(),
        z.object({ operation: z.enum(["rotate", "mirror"]) }).strict(),
      ]),
      raw,
    );
    const source = await this.asset(c, assetId);
    if (
      source.mime !== "image/png" ||
      (source.projectId !== project.id && !source.shared)
    )
      throw new BadRequestException("请选择当前项目图片或企业共享图片");
    const result = await mediaOperation({
      op: "image-transform",
      large: true,
      data: { path: filePath(c.tenantId, source.id) },
      ...request,
    });
    await this.project(c, projectId, true);
    await this.asset(c, assetId);
    const label = { crop: "裁剪", rotate: "顺时针旋转", mirror: "水平镜像" }[
      request.operation
    ];
    const name =
      source.filename.replace(/\.[^.]+$/, "").slice(0, 75) + " · " + label;
    const asset = await this.persistAsset(
      c,
      result.data,
      { filename: name + ".png", projectId },
      result.width,
      result.height,
    );
    try {
      await this.db.$transaction(async (tx) => {
        const art = await tx.contentArtifact.create({
          data: { tenantId: c.tenantId, projectId, name },
        });
        await tx.contentArtifactVersion.create({
          data: {
            tenantId: c.tenantId,
            artifactId: art.id,
            version: 1,
            createdBy: c.membershipId,
            data: J({
              ...sizes.square,
              backgroundColor: "#ffffff",
              layers: [],
              backgroundId: asset.id,
              copy: { title: "", body: "", cta: "" },
              source: {
                workflow: "studio",
                operation: request.operation,
                referenceAssetId: source.id,
                prompt: label,
                outputWidth: asset.width,
                outputHeight: asset.height,
              },
            }),
          },
        });
        await this.audit(tx, c, "asset.transform", asset.id, {
          sourceAssetId: source.id,
          operation: request.operation,
        });
      });
    } catch (error) {
      await this.db.contentAsset.delete({ where: { id: asset.id } });
      await removeFile(c.tenantId, asset.id);
      throw error;
    }
    return asset;
  }
  readonly canvases = new ContentCanvasService(this);
  readonly editing = new ContentArtworkService(this);
  validateArtwork(c: RequestContext, p: any, data: any) {
    return this.editing.validateArtwork(c, p, data);
  }
  applyTemplate(c: RequestContext, brief: any, data: any) {
    return this.editing.applyTemplate(c, brief, data);
  }
  createArtwork(c: RequestContext, projectId: string, raw: unknown) {
    return this.editing.createArtwork(c, projectId, raw);
  }
  artifact(c: RequestContext, artifactId: string) {
    return this.editing.artifact(c, artifactId);
  }
  artworks(c: RequestContext, projectId: string, query?: unknown) {
    return this.editing.artworks(c, projectId, query);
  }
  saveArtwork(c: RequestContext, artifactId: string, raw: unknown) {
    return this.editing.saveArtwork(c, artifactId, raw);
  }
  async review(c: RequestContext, artifactId: string, raw: unknown) {
    const v = readBody(
      z
        .object({
          version: z.int().positive(),
          action: z.enum(["submit", "withdraw", "approve", "reject", "exempt"]),
          note: z.string().max(2000).default(""),
        })
        .strict(),
      raw,
    );
    await this.guard(
      c,
      ["approve", "reject"].includes(v.action)
        ? "content.review"
        : "content.create",
    );
    const a = await this.artifact(c, artifactId);
    await this.project(c, a.projectId);
    const settings = await this.settings(c);
    return this.db.$transaction(async (tx) => {
      const r = await tx.contentArtifactVersion.findUnique({
        where: {
          tenantId_artifactId_version: {
            tenantId: c.tenantId,
            artifactId: a.id,
            version: v.version,
          },
        },
      });
      if (!r) throw new NotFoundException();
      let data: any;
      if (v.action === "submit") {
        if (
          !["draft", "rejected"].includes(r.status) ||
          a.version !== v.version
        )
          throw new ConflictException("请选择最新草稿");
        data = {
          status: "submitted",
          submittedBy: c.membershipId,
          reviewNote: null,
        };
      } else if (v.action === "withdraw") {
        if (r.status !== "submitted" || r.submittedBy !== c.membershipId)
          throw new ForbiddenException("只能撤回本人送审版本");
        data = { status: "draft" };
      } else if (v.action === "exempt") {
        if (settings.reviewRequired)
          throw new ForbiddenException("企业尚未启用免审交付");
        if (r.status !== "draft" || r.createdBy !== c.membershipId)
          throw new ConflictException();
        data = {
          status: "exempt",
          reviewedBy: c.membershipId,
          reviewPolicyVersion: settings.version,
        };
      } else {
        if (r.status !== "submitted")
          throw new ConflictException("该版本不在待审核状态");
        if (r.createdBy === c.membershipId || r.submittedBy === c.membershipId)
          throw new ForbiddenException("创作者或送审人不能自审");
        if (v.action === "reject" && !v.note.trim())
          throw new BadRequestException("请填写退回原因");
        data = {
          status: v.action === "approve" ? "approved" : "rejected",
          reviewedBy: c.membershipId,
          reviewNote: v.note,
          reviewPolicyVersion: settings.version,
        };
      }
      const result = await tx.contentArtifactVersion.updateMany({
        where: { id: r.id, tenantId: c.tenantId, status: r.status },
        data,
      });
      if (!result.count) throw new ConflictException("审核状态已改变");
      await this.audit(tx, c, "review." + v.action, a.id, {
        version: v.version,
        note: v.note,
      });
      await tx.personalNotification.create({
        data: {
          tenantId: c.tenantId,
          recipientMembershipId: r.createdBy,
          appId: "content",
          kind: "content-review",
          resourceId: a.projectId,
          title: "作品审核已更新",
          body: "作品 v" + v.version + "：" + data.status,
          dedupeKey:
            "content-review:" + r.id + ":" + v.action + ":" + randomUUID(),
        },
      });
      return { ok: true, status: data.status };
    });
  }
  async plan(c: RequestContext, projectId: string, raw: unknown) {
    const p = await this.project(c, projectId, true);
    await this.guard(c, "content.ai.use");
    const v = readBody(generation, raw);
    const isVideo = v.mode === "video";
    const channel = await this.models.customMedia(
      c.tenantId,
      isVideo ? "video" : "image",
    );
    if (
      isVideo
        ? !this.video.configured(channel)
        : !this.provider.configured(channel)
    )
      throw new BadRequestException(
        isVideo ? "请配置支持的视频模型" : "图片模型尚未配置",
      );
    if (p.version !== v.projectVersion)
      throw new ConflictException("项目已更新");
    if (
      await this.db.contentGenerationItem.count({
        where: {
          tenantId: c.tenantId,
          projectId: p.id,
          status: "needs_reconciliation",
        },
      })
    )
      throw new ConflictException(
        "本项目存在结果待核实的请求，请先核对原请求，避免重复费用",
      );
    const brief = p.brief as any;
    const refs = referenceIds(v);
    if (v.referenceAssetId && v.referenceAssetIds)
      throw new BadRequestException("请使用一种参考图片格式");
    if (
      v.mode !== "image" &&
      (v.referenceAssetIds ||
        v.ratio ||
        v.resolution ||
        v.candidates ||
        (v.brand && !isVideo))
    )
      throw new BadRequestException("图片规格仅适用于图片生成");
    if ((v.mode === "video") !== Boolean(v.video))
      throw new BadRequestException("请选择与生成方式对应的视频规格");
    if (
      v.region &&
      (v.mode === "image" ? refs.length !== 1 : v.mode !== "local_edit")
    )
      throw new BadRequestException("选区改图仅支持一张参考图片");
    const settings = await this.settings(c);
    let inputs: any[] = [];
    if (v.mode === "video") {
      if (!v.instruction.trim())
        throw new BadRequestException("请描述想生成的视频");
      if (v.video!.ratio === "adaptive" && !refs.length)
        throw new BadRequestException("跟随首帧比例需要先选择图片");
      if (refs.length) {
        const first = await this.asset(c, refs[0]);
        if (
          first.mime !== "image/png" ||
          (first.projectId && first.projectId !== p.id && !first.shared)
        )
          throw new BadRequestException(
            "请选择当前项目或企业共享的图片作为首帧",
          );
        const ratio = first.width / first.height;
        if (ratio < 0.4 || ratio > 2.5)
          throw new BadRequestException("视频首帧的宽高比须在 2:5 至 5:2 之间");
      }
      const { brand, products } = await this.validateBrief(
        c,
        v.brand
          ? {
              ...brief,
              brandId: v.brand.id,
              brandVersion: v.brand.version,
            }
          : brief,
      );
      for (const word of brand.data.forbiddenWords ?? [])
        if (v.instruction.includes(word))
          throw new BadRequestException("内容包含品牌禁用词：" + word);
      inputs = [
        {
          mode: "video",
          referenceAssetId: v.referenceAssetId,
          video: v.video,
          prompt: [
            v.instruction,
            brand.id
              ? "品牌风格：" +
                brand.data.tone +
                "；品牌色：" +
                colorDescription(brand.data.color)
              : "",
            ...products.map(
              (product: any) =>
                "产品资料：" + product.name + "；" + product.data.sellingPoints,
            ),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ];
    } else if (v.mode === "image") {
      if (!v.instruction.trim())
        throw new BadRequestException("请描述想生成的画面");
      const capabilities = imageCapabilities(this.provider.model(channel));
      if (
        (v.ratio && !capabilities.ratios.includes(v.ratio)) ||
        (v.resolution && !capabilities.resolutions.includes(v.resolution)) ||
        refs.length > capabilities.maxReferences ||
        (v.candidates ?? 1) > capabilities.maxCandidates
      )
        throw new BadRequestException("当前模型不支持所选图片规格");
      const { brand, products } = await this.validateBrief(
        c,
        v.brand
          ? {
              ...brief,
              brandId: v.brand.id,
              brandVersion: v.brand.version,
            }
          : brief,
      );
      for (const word of brand.data.forbiddenWords ?? [])
        if (v.instruction.includes(word))
          throw new BadRequestException("内容包含品牌禁用词：" + word);
      for (const refId of refs) {
        const ref = await this.asset(c, refId);
        if (ref.mime !== "image/png")
          throw new BadRequestException("参考素材必须是图片");
        if (ref.projectId && ref.projectId !== p.id && !ref.shared)
          throw new BadRequestException("不能引用其他项目的私有素材");
      }
      const size = v.size ?? "square";
      const ratio =
        v.ratio ??
        ({ square: "1:1", portrait: "3:4", story: "9:16" } as const)[size];
      const dimensions =
        v.ratio || v.resolution
          ? imageDimensions(ratio, v.resolution ?? "2K")
          : undefined;
      const configured = Boolean(
        v.region ||
        v.ratio ||
        v.resolution ||
        v.candidates ||
        v.brand ||
        v.referenceAssetIds,
      );
      inputs = Array.from({ length: v.candidates ?? 1 }, (_, index) => ({
        mode: "image",
        referenceAssetId: v.referenceAssetId,
        ...(v.referenceAssetIds ? { referenceAssetIds: refs } : {}),
        ...(dimensions ? { dimensions } : {}),
        ...(v.region ? { region: v.region } : {}),
        size,
        prompt: [
          v.instruction,
          v.region
            ? "以输入图片构图为准，仅修改这个归一化选区：" +
              JSON.stringify(v.region)
            : "",
          brand.id
            ? "品牌风格：" +
              brand.data.tone +
              "；品牌色：" +
              colorDescription(brand.data.color)
            : "",
          ...products.map(
            (x: any) => "产品资料：" + x.name + "；" + x.data.sellingPoints,
          ),
        ]
          .filter(Boolean)
          .join("\n"),
        outputs: [
          {
            size,
            name:
              v.instruction.slice(0, 60) +
              ((v.candidates ?? 1) > 1 ? " · " + (index + 1) : ""),
            data: {
              ...sizes[size],
              backgroundColor: "#ffffff",
              layers: [],
              copy: { title: "", body: "", cta: "" },
              source: {
                workflow: "studio",
                prompt: v.instruction,
                referenceAssetId: v.referenceAssetId ?? null,
                brandId: brand.id,
                brandVersion: brand.version,
                projectVersion: p.version,
                size,
                ...(configured
                  ? {
                      ratio,
                      ...(v.region ? { region: v.region } : {}),
                      resolution: v.resolution ?? "2K",
                      candidates: v.candidates ?? 1,
                      referenceAssetIds: refs,
                      model: this.provider.model(channel),
                    }
                  : {}),
              },
            },
          },
        ],
      }));
    } else if (v.mode === "local_edit") {
      if (
        !v.artifactId ||
        !v.artifactVersion ||
        !v.region ||
        !v.instruction.trim()
      )
        throw new BadRequestException("局部修改需要作品版本、选区和修改说明");
      const a = await this.artifact(c, v.artifactId);
      if (a.projectId !== p.id || a.version !== v.artifactVersion)
        throw new ConflictException("作品已更新");
      const r = await this.db.contentArtifactVersion.findUnique({
        where: {
          tenantId_artifactId_version: {
            tenantId: c.tenantId,
            artifactId: a.id,
            version: v.artifactVersion,
          },
        },
      });
      const data = r!.data as any;
      if (!data.backgroundId) throw new BadRequestException("请先生成背景");
      await this.asset(c, data.backgroundId);
      inputs = [
        {
          mode: v.mode,
          data,
          artifactId: a.id,
          artifactVersion: a.version,
          region: v.region,
          prompt: v.instruction + "；仅修改选区：" + JSON.stringify(v.region),
          backgroundId: data.backgroundId,
        },
      ];
    } else {
      if (brief.workflow === "studio")
        throw new BadRequestException("请使用图片生成模式");
      const { brand, products } = await this.validateBrief(c, brief);
      for (const product of products)
        for (let i = 0; i < brief.variants; i++) {
          const source = {
            brandId: brand.id,
            brandVersion: brand.version,
            productId: product.id,
            productVersion: product.version,
            projectVersion: p.version,
            variant: i + 1,
          };
          const data = brief.sizes.map((size: keyof typeof sizes) => ({
            size,
            name:
              product.name +
              " · " +
              (
                {
                  square: "方图",
                  portrait: "竖版海报",
                  story: "全屏竖图",
                } as Record<string, string>
              )[size] +
              " · " +
              (i + 1),
            data: compose(brief, brand, product, size, source),
          }));
          for (const d of data) {
            d.data = await this.applyTemplate(c, brief, d.data);
            await this.validateArtwork(c, p, d.data);
          }
          inputs.push({
            mode: "background",
            prompt: [
              "仅生成营销海报的背景和装饰，不要生成文字、Logo、价格或商品本体；保留中央区域用于叠加真实产品图。",
              brief.prompt,
              "画面色调：" + colorDescription(brand.data.color),
              "视觉风格：" + brand.data.tone,
              "受众：" + brief.audience,
              "渠道：" + brief.channel,
              "产品类别参考：" + product.name,
              "变体：" + (i + 1),
            ].join("\n"),
            outputs: data,
          });
        }
    }
    if (inputs.length > settings.maxBatch)
      throw new BadRequestException(
        "本批生成数超过企业上限" + settings.maxBatch,
      );
    const count =
      v.mode === "local_edit" || isVideo
        ? 1
        : inputs.reduce((s, x) => s + x.outputs.length, 0);
    if (count > 60) throw new BadRequestException("一次最多60个交付项");
    const snapshot = {
      projectId: p.id,
      projectVersion: p.version,
      settingsVersion: settings.version,
      model: isVideo ? this.video.model(channel) : this.provider.model(channel),
      bindingVersion: isVideo
        ? this.video.binding(channel)
        : this.provider.binding(channel).version,
      request: v,
      inputs,
      requests: inputs.length,
      deliverables: count,
      estimatedCost: null,
      currency: "CNY",
      costStatus: "provider_usage_pending",
      policy: "生成前核对范围；实际费用以方舟账单为准；提交未知不自动重发",
    };
    return {
      ...snapshot,
      previewHash: hash(snapshot),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    };
  }
  async submit(c: RequestContext, projectId: string, raw: unknown) {
    const v = readBody(
      z
        .object({
          request: generation,
          canvas: canvasBinding.optional(),
          previewHash: z.string().length(64),
          requestKey: z.string().min(8).max(120),
          expiresAt: z.iso.datetime(),
        })
        .strict(),
      raw,
    );
    const fingerprint = hash({
      projectId,
      request: v.request,
      previewHash: v.previewHash,
      ...(v.canvas ? { canvas: v.canvas } : {}),
    });
    const old = await this.db.contentBatch.findUnique({
      where: {
        tenantId_requestKey: { tenantId: c.tenantId, requestKey: v.requestKey },
      },
    });
    if (old) {
      await this.project(c, old.projectId, true);
      if (old.fingerprint !== fingerprint)
        throw new ConflictException("同一请求编号参数不同");
      return old;
    }
    const plan = await this.plan(c, projectId, v.request);
    if (
      plan.previewHash !== v.previewHash ||
      Date.parse(v.expiresAt) < Date.now() ||
      Date.parse(v.expiresAt) > Date.now() + 301000
    )
      throw new ConflictException("生产清单已改变或过期，请重新预览");
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":content-submit"}))`;
      const channelKind = v.request.mode === "video" ? "video" : "image";
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":model:" + channelKind}))`;
      const duplicate = await tx.contentBatch.findUnique({
        where: {
          tenantId_requestKey: {
            tenantId: c.tenantId,
            requestKey: v.requestKey,
          },
        },
      });
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint)
          throw new ConflictException();
        return duplicate;
      }
      const activeChannel = await this.models.customMedia(
        c.tenantId,
        channelKind,
        tx,
      );
      const bindingVersion =
        channelKind === "video"
          ? this.video.binding(activeChannel)
          : this.provider.binding(activeChannel).version;
      if (bindingVersion !== plan.bindingVersion)
        throw new ConflictException("模型配置已更新，请重新预览");
      const p = await tx.contentProject.findFirst({
        where: {
          id: projectId,
          tenantId: c.tenantId,
          version: plan.projectVersion,
          deletedAt: null,
        },
      });
      if (!p) throw new ConflictException("项目已修改");
      for (const refId of ["image", "video"].includes(v.request.mode)
        ? referenceIds(v.request)
        : []) {
        const ref = await tx.contentAsset.findFirst({
          where: {
            id: refId,
            tenantId: c.tenantId,
            deletedAt: null,
          },
        });
        if (
          !ref ||
          (!ref.shared &&
            (ref.projectId
              ? ref.projectId !== p.id
              : ref.ownerId !== c.membershipId))
        )
          throw new ConflictException("参考图授权已变化，请重新选择");
        if (!ref.shared && !ref.projectId)
          await tx.contentAsset.update({
            where: { id: ref.id },
            data: { projectId: p.id },
          });
      }
      const settings = await tx.contentSettings.findUnique({
        where: { tenantId: c.tenantId },
      });
      if ((settings?.version ?? 0) !== plan.settingsVersion)
        throw new ConflictException("设置已更新");
      const month = new Date();
      month.setUTCDate(1);
      month.setUTCHours(0, 0, 0, 0);
      const usage = await tx.usageRecord.aggregate({
        where: {
          tenantId: c.tenantId,
          metric: "content.image",
          createdAt: { gte: month },
          status: { not: "released" },
        },
        _sum: { quantity: true },
      });
      if (
        v.request.mode !== "video" &&
        Number(usage._sum.quantity ?? 0) + plan.requests >
          (settings?.monthlyImageLimit ?? 100)
      )
        throw new ForbiddenException("本月图片用量已达企业上限");
      if (v.canvas)
        await this.canvases.bind(
          tx,
          c,
          projectId,
          v.canvas,
          v.request,
          plan.requests,
        );
      const batch = await tx.contentBatch.create({
        data: {
          tenantId: c.tenantId,
          projectId,
          membershipId: c.membershipId,
          userId: c.userId,
          requestKey: v.requestKey,
          fingerprint,
          snapshot: J({ ...plan, ...(v.canvas ? { canvas: v.canvas } : {}) }),
        },
      });
      for (const input of plan.inputs) {
        const item = await tx.contentGenerationItem.create({
          data: {
            tenantId: c.tenantId,
            projectId,
            batchId: batch.id,
            input: J(input),
          },
        });
        await tx.usageRecord.create({
          data: {
            tenantId: c.tenantId,
            appId: "content",
            membershipId: c.membershipId,
            metric: metricFor(input.mode),
            requestKey: item.id,
            quantity: 1,
            status: "reserved",
            detail: { model: plan.model, currency: "CNY", estimatedCost: null },
          },
        });
      }
      await this.audit(tx, c, "batch.submit", batch.id, {
        requests: plan.requests,
        deliverables: plan.deliverables,
        model: plan.model,
      });
      return batch;
    });
  }
  async generationForRequest(c: RequestContext, projectId: string, requestKey: string) {
    await this.project(c, projectId);
    const batch = await this.db.contentBatch.findFirst({
      where: {tenantId:c.tenantId,projectId,requestKey,userId:c.userId,membershipId:c.membershipId},
      select: {id:true,createdAt:true},
    });
    if (!batch) return null;
    const items = await this.db.contentGenerationItem.findMany({
      where: {tenantId:c.tenantId,batchId:batch.id},
      select: {id:true,status:true,errorCode:true},
      orderBy: [{createdAt:"asc"},{id:"asc"}],
    });
    const attempts = await this.db.contentProviderAttempt.findMany({
      where: {tenantId:c.tenantId,itemId:{in:items.map(item=>item.id)},status:"completed"},
      select: {itemId:true,resultAssetId:true},
    });
    const assets = new Map(attempts.map(attempt=>[attempt.itemId,attempt.resultAssetId]));
    return {...batch,items:await Promise.all(items.map(async item=>{
      const id=assets.get(item.id);
      if(!id)return {...item,assetId:null};
      try { return {...item,assetId:(await this.asset(c,id)).id}; }
      catch(error) {
        if(!(error instanceof NotFoundException))throw error;
        return {...item,assetId:null};
      }
    }))};
  }
  async batches(c: RequestContext, projectId: string, query?: unknown) {
    await this.project(c, projectId);
    const q = readBody(pageInput, query ?? {});
    const where = { tenantId: c.tenantId, projectId };
    const rows = await this.db.contentBatch.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query ? 20 : 100,
      skip: query ? (q.page - 1) * 20 : 0,
    });
    const items = await this.db.contentGenerationItem.findMany({
      where: { tenantId: c.tenantId, batchId: { in: rows.map((r) => r.id) } },
    });
    const usage = await this.db.usageRecord.findMany({
      where: {
        tenantId: c.tenantId,
        metric: contentMediaMetrics,
        requestKey: { in: items.map((x) => x.id) },
      },
    });
    const attempts = await this.db.contentProviderAttempt.findMany({
      where: { tenantId: c.tenantId, itemId: { in: items.map((i) => i.id) } },
      select: {
        id: true,
        itemId: true,
        resultAssetId: true,
        usage: true,
        externalId: true,
        model: true,
        status: true,
      },
    });
    const result = rows.map((r) => ({
      ...r,
      items: items
        .filter((x) => x.batchId === r.id)
        .map((x) => ({
          ...x,
          input: undefined,
          usage: usage.find((u) => u.requestKey === x.id),
          attempt: attempts.find((a) => a.itemId === x.id),
        })),
    }));
    return query
      ? {
          items: result,
          total: await this.db.contentBatch.count({ where }),
          page: q.page,
          pageSize: 20,
        }
      : result;
  }
  async cancel(c: RequestContext, itemId: string) {
    await this.guard(c, "content.create");
    const item = await this.db.contentGenerationItem.findFirst({
      where: { id: uuid(itemId), tenantId: c.tenantId },
    });
    if (!item) throw new NotFoundException();
    await this.project(c, item.projectId, true);
    await this.db.$transaction(async (tx) => {
      const cancelled = await tx.contentGenerationItem.updateMany({
        where: { id: item.id, status: "queued" },
        data: { status: "cancelled", cancelRequested: true },
      });
      if (cancelled.count)
        await tx.usageRecord.updateMany({
          where: {
            tenantId: c.tenantId,
            metric: contentMediaMetrics,
            requestKey: item.id,
            status: "reserved",
          },
          data: { status: "released", quantity: 0 },
        });
      else
        await tx.contentGenerationItem.updateMany({
          where: {
            id: item.id,
            status: {
              in: [
                "submitting",
                "storing",
                "rendering",
                "needs_reconciliation",
              ],
            },
          },
          data: { cancelRequested: true },
        });
      await this.audit(tx, c, "item.cancel", item.id);
    });
    return { ok: true };
  }
  async retry(c: RequestContext, itemId: string, raw: unknown) {
    await this.guard(c, "content.create");
    await this.guard(c, "content.ai.use");
    const v = readBody(
      z.object({ requestKey: z.string().min(8).max(120) }).strict(),
      raw,
    );
    const item = await this.db.contentGenerationItem.findFirst({
      where: { id: uuid(itemId), tenantId: c.tenantId, status: "failed" },
    });
    if (!item)
      throw new ConflictException("仅明确失败项可重新生成，未知请求请先核实");
    const p = await this.project(c, item.projectId, true);
    const batch = await this.db.contentBatch.findUniqueOrThrow({
      where: { id: item.batchId },
    });
    const attempt = await this.db.contentProviderAttempt.findUnique({
      where: { itemId: item.id },
    });
    if (attempt && attempt.status !== "rejected")
      throw new ConflictException("已有消耗或结果未知，不能重新提交");
    const snapshot = batch.snapshot as any;
    if (p.version !== snapshot.projectVersion)
      throw new ConflictException("项目已变化，请重新建立生产清单");
    const request = snapshot.request;
    if (request.mode === "video")
      throw new ConflictException("请从原视频参数建立新任务");
    const plan = await this.plan(c, p.id, request);
    if (
      plan.model !== snapshot.model ||
      (snapshot.bindingVersion &&
        plan.bindingVersion !== snapshot.bindingVersion)
    )
      throw new ConflictException("模型配置已更新，请重新预览生成清单");
    const matching = plan.inputs.find(
      (input: any) => hash(input) === hash(item.input),
    );
    if (!matching) throw new ConflictException("来源已变化");
    // Single failed item only: use a fresh preview with a dedicated request scoped to this item.
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":content-submit"}))`;
      const fp = hash({ retry: item.id });
      const old = await tx.contentBatch.findUnique({
        where: {
          tenantId_requestKey: {
            tenantId: c.tenantId,
            requestKey: v.requestKey,
          },
        },
      });
      if (old) {
        if (old.fingerprint !== fp) throw new ConflictException();
        return old;
      }
      const replacement = await tx.contentBatch.findFirst({
        where: { tenantId: c.tenantId, projectId: p.id, fingerprint: fp },
      });
      if (replacement) return replacement;
      const month = new Date();
      month.setUTCDate(1);
      month.setUTCHours(0, 0, 0, 0);
      const used = await tx.usageRecord.aggregate({
        where: {
          tenantId: c.tenantId,
          metric: "content.image",
          createdAt: { gte: month },
          status: { not: "released" },
        },
        _sum: { quantity: true },
      });
      if (
        Number(used._sum.quantity ?? 0) + 1 >
        (await this.settings(c)).monthlyImageLimit
      )
        throw new ForbiddenException("图片用量已达上限");
      if (snapshot.canvas) {
        const board = await tx.contentCanvas.findFirst({
          where: {
            id: snapshot.canvas.id,
            projectId: p.id,
            tenantId: c.tenantId,
          },
        });
        if (!board) throw new NotFoundException("画布不存在");
        await this.canvases.bind(
          tx,
          c,
          p.id,
          { ...snapshot.canvas, version: board.version },
          request,
          1,
        );
      }
      const b = await tx.contentBatch.create({
        data: {
          tenantId: c.tenantId,
          projectId: p.id,
          membershipId: c.membershipId,
          userId: c.userId,
          requestKey: v.requestKey,
          fingerprint: fp,
          snapshot: J({
            ...snapshot,
            retryOf: item.id,
            requests: 1,
            inputs: [matching],
          }),
        },
      });
      const i = await tx.contentGenerationItem.create({
        data: {
          tenantId: c.tenantId,
          projectId: p.id,
          batchId: b.id,
          input: J(matching),
        },
      });
      await tx.usageRecord.create({
        data: {
          tenantId: c.tenantId,
          appId: "content",
          membershipId: c.membershipId,
          metric: "content.image",
          requestKey: i.id,
          quantity: 1,
          status: "reserved",
          detail: { retryOf: item.id },
        },
      });
      await this.audit(tx, c, "item.retry", i.id, { retryOf: item.id });
      return b;
    });
  }
  async tick() {
    const stale = new Date(Date.now() - 360000);
    const recover = await this.db.contentGenerationItem.findFirst({
      where: {
        status: { in: ["submitting", "storing"] },
        heartbeatAt: { lt: stale },
      },
      orderBy: { createdAt: "asc" },
    });
    const polling = recover
      ? null
      : await this.db.contentGenerationItem.findFirst({
          where: {
            status: "rendering",
            heartbeatAt: { lt: new Date(Date.now() - 10000) },
          },
          orderBy: { heartbeatAt: "asc" },
        });
    const candidate =
      recover ??
      polling ??
      (await this.db.contentGenerationItem.findFirst({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
      }));
    if (!candidate) return false;
    const lease = randomUUID();
    const claimed = await this.db.contentGenerationItem.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        lease: candidate.lease,
        heartbeatAt: candidate.heartbeatAt,
      },
      data: {
        status: recover || polling ? "storing" : "submitting",
        lease,
        heartbeatAt: new Date(),
      },
    });
    if (!claimed.count) return true;
    const item = { ...candidate, lease };
    const batch = await this.db.contentBatch.findUniqueOrThrow({
      where: { id: item.batchId },
    });
    const input = item.input as any;
    let c: RequestContext | undefined;
    let attempted = false;
    const heartbeat = setInterval(
      () =>
        void this.db.contentGenerationItem
          .updateMany({
            where: {
              id: item.id,
              lease,
              status: { in: ["submitting", "storing"] },
            },
            data: { heartbeatAt: new Date() },
          })
          .catch(() => {}),
      10000,
    );
    const owns = async () => {
      const state = await this.db.contentGenerationItem.findFirst({
        where: {
          id: item.id,
          lease,
          status: { in: ["submitting", "storing"] },
        },
      });
      if (!state) throw new MediaError("CONTENT_LEASE_LOST");
      return state;
    };
    try {
      c = await this.auth.taskContext({
        tenantId: batch.tenantId,
        membershipId: batch.membershipId,
        userId: batch.userId,
        appId: "content",
        taskId: item.id,
      });
      await this.project(c, item.projectId, true);
      await this.guard(c, "content.ai.use");
      const state = await owns();
      if (state.cancelRequested && !recover && !polling)
        throw new MediaError("CONTENT_CANCELLED", true);
      let attempt = await this.db.contentProviderAttempt.findUnique({
        where: { itemId: item.id },
      });
      if (input.mode === "video") {
        attempted = Boolean(attempt);
        const channel = await this.models.customMedia(batch.tenantId, "video");
        if (
          !this.video.configured(channel) ||
          this.video.binding(channel) !== (batch.snapshot as any).bindingVersion
        )
          throw new MediaError("CONTENT_MODEL_BINDING_CHANGED", !attempted);
        if (!attempt) {
          const frame = input.referenceAssetId
            ? await this.providerReference(c, input.referenceAssetId, true)
            : undefined;
          await owns();
          attempt = await this.db.contentProviderAttempt.create({
            data: {
              tenantId: item.tenantId,
              itemId: item.id,
              model: this.video.model(channel),
              status: "submitting",
            },
          });
          attempted = true;
          await owns();
          await this.guard(c, "content.ai.use");
          const externalId = await this.video.submit(
            input.prompt,
            input.video,
            frame,
            channel,
          );
          attempt = await this.db.contentProviderAttempt.update({
            where: { id: attempt.id },
            data: { externalId, status: "accepted" },
          });
          await this.deferVideo(item.id, lease);
          return true;
        }
        if (!attempt.externalId)
          throw new MediaError("CONTENT_SUBMISSION_UNKNOWN");
        const timedOut =
          Date.now() - attempt.createdAt.getTime() > 60 * 60 * 1000;
        const result = await this.video
          .poll(attempt.externalId, channel)
          .catch((error) => {
            if (timedOut) throw error;
            return null;
          });
        if (!result || ["queued", "running"].includes(result.status)) {
          if (timedOut) throw new MediaError("CONTENT_VIDEO_TIMEOUT");
          await this.deferVideo(item.id, lease);
          return true;
        }
        if (result.status !== "succeeded")
          throw new MediaError(
            "CONTENT_VIDEO_PROVIDER_" +
              (["failed", "expired", "cancelled"].includes(result.status)
                ? result.status.toUpperCase()
                : "UNKNOWN"),
          );
        const current = await owns();
        if (!current.cancelRequested)
          await this.project(c, item.projectId, true);
        const asset = current.cancelRequested
          ? null
          : await this.persistVideo(c, attempt.id, item.projectId, result);
        await this.guard(c, "content.ai.use");
        await this.project(c, item.projectId, true);
        await this.db.$transaction(async (tx) => {
          const changed = await tx.contentGenerationItem.updateMany({
            where: {
              id: item.id,
              lease,
              status: { in: ["submitting", "storing"] },
              cancelRequested: current.cancelRequested,
            },
            data: {
              status: current.cancelRequested ? "cancelled" : "succeeded",
              heartbeatAt: new Date(),
            },
          });
          if (!changed.count) throw new MediaError("CONTENT_LEASE_LOST");
          if (asset) await this.canvases.place(tx, batch, item, asset);
          await tx.contentProviderAttempt.update({
            where: { id: attempt!.id },
            data: {
              status: "completed",
              resultAssetId: asset?.id,
              usage: J({
                resolution: result.resolution,
                ratio: result.ratio,
                duration: result.duration,
                providerUsage: result.usage ?? null,
              }),
            },
          });
          await tx.usageRecord.updateMany({
            where: {
              tenantId: item.tenantId,
              metric: videoMetric,
              requestKey: item.id,
            },
            data: {
              status: result.usage
                ? "usage_reported_cost_pending"
                : "usage_unknown_cost_pending",
              detail: J({
                attemptId: attempt!.id,
                usage: result.usage ?? null,
                currency: "CNY",
              }),
            },
          });
          await this.audit(tx, c!, "item.complete", item.id, {
            cancelled: current.cancelRequested,
            resultAssetId: asset?.id,
          });
        });
        return true;
      }
      let bytes: Buffer | undefined;
      if (attempt) {
        attempted = true;
        bytes = await getFile(item.tenantId, attempt.id).catch(() => undefined);
        if (!bytes) throw new MediaError("CONTENT_SUBMISSION_UNKNOWN");
      } else {
        const channel = await this.models.customMedia(batch.tenantId, "image");
        if (
          this.provider.model(channel) !== (batch.snapshot as any).model ||
          ((batch.snapshot as any).bindingVersion &&
            this.provider.binding(channel).version !==
              (batch.snapshot as any).bindingVersion)
        )
          throw new MediaError("CONTENT_MODEL_BINDING_CHANGED", true);
        attempt = await this.db.contentProviderAttempt.create({
          data: {
            tenantId: item.tenantId,
            itemId: item.id,
            model: (batch.snapshot as any).model,
            status: "submitting",
          },
        });
        attempted = true;
        // Persist attempt before dispatch; no automatic repeated POST after a crash or timeout.
        await owns();
        await this.guard(c, "content.ai.use");
        const references =
          input.mode === "image"
            ? await Promise.all(
                referenceIds(input).map((assetId) =>
                  this.providerReference(c!, assetId),
                ),
              )
            : [];
        const original =
          input.mode === "local_edit"
            ? await this.assetBytes(c, input.backgroundId)
            : undefined;
        if (original)
          references.push(
            "data:image/png;base64," +
              (
                await mediaOperation({
                  op: "fit",
                  data: original.bytes.toString("base64"),
                  width: input.data.width,
                  height: input.data.height,
                })
              ).data,
          );
        const result = await this.provider.generate(
          input.prompt,
          attempt.id,
          references.length > 1 ? references : references[0],
          (batch.snapshot as any).bindingVersion,
          input.mode === "image"
            ? (input.dimensions ??
                (
                  {
                    square: "2048x2048",
                    portrait: "1728x2304",
                    story: "1440x2560",
                  } as Record<string, string>
                )[input.size])
            : undefined,
          channel,
        );
        bytes = Buffer.from(result.image, "base64");
        await putFile(item.tenantId, attempt.id, bytes);
        await this.db.contentProviderAttempt.update({
          where: { id: attempt.id },
          data: {
            externalId: result.externalId,
            status: "received",
            usage: J(result.usage),
          },
        });
      }
      const normalized = await mediaOperation({
        op: "normalize",
        large: input.outputs?.[0]?.data?.source?.resolution === "4K",
        data: bytes!.toString("base64"),
      });
      let output = normalized;
      if (input.mode === "local_edit") {
        const original = await this.assetBytes(c, input.backgroundId);
        output = await mediaOperation({
          op: "composite",
          original: (
            await mediaOperation({
              op: "fit",
              data: original.bytes.toString("base64"),
              width: input.data.width,
              height: input.data.height,
            })
          ).data,
          generated: normalized.data,
          region: input.region,
        });
      }
      if (input.mode === "image" && input.region) {
        const original = await this.assetBytes(c, referenceIds(input)[0]);
        output = await mediaOperation({
          op: "composite",
          large: true,
          original: { path: filePath(c.tenantId, original.asset.id) },
          generated: normalized.data,
          region: input.region,
        });
      }
      const asset = await this.persistAsset(
        c,
        output.data,
        { filename: "generated-background.png", projectId: item.projectId },
        output.width,
        output.height,
      );
      await this.guard(c, "content.ai.use");
      await this.project(c, item.projectId, true);
      const current = await owns();
      await this.db.$transaction(async (tx) => {
        const persistedAttempt =
          await tx.contentProviderAttempt.findUniqueOrThrow({
            where: { itemId: item.id },
          });
        const owned = await tx.contentGenerationItem.updateMany({
          where: {
            id: item.id,
            lease,
            status: { in: ["submitting", "storing"] },
            cancelRequested: current.cancelRequested,
          },
          data: {
            status: current.cancelRequested ? "cancelled" : "succeeded",
            heartbeatAt: new Date(),
          },
        });
        if (!owned.count) throw new MediaError("CONTENT_LEASE_LOST");
        const receipts: any[] = [];
        if (!current.cancelRequested) {
          if (input.mode === "local_edit") {
            const changed = await tx.contentArtifact.updateMany({
              where: {
                id: input.artifactId,
                tenantId: c!.tenantId,
                version: input.artifactVersion,
              },
              data: { version: { increment: 1 } },
            });
            if (!changed.count)
              throw new ConflictException("作品已更新，生成背景保留在素材库");
            const data = { ...input.data, backgroundId: asset.id };
            const r = await tx.contentArtifactVersion.create({
              data: {
                tenantId: c!.tenantId,
                artifactId: input.artifactId,
                version: input.artifactVersion + 1,
                createdBy: c!.membershipId,
                data: J(data),
              },
            });
            receipts.push({ artifactId: input.artifactId, version: r.version });
          } else
            for (const out of input.outputs) {
              const a = await tx.contentArtifact.create({
                data: {
                  tenantId: c!.tenantId,
                  projectId: item.projectId,
                  name: out.name,
                },
              });
              await tx.contentArtifactVersion.create({
                data: {
                  tenantId: c!.tenantId,
                  artifactId: a.id,
                  version: 1,
                  createdBy: c!.membershipId,
                  data: J({
                    ...out.data,
                    backgroundId: asset.id,
                    ...(input.mode === "image" && out.data.source.ratio
                      ? {
                          source: {
                            ...out.data.source,
                            outputWidth: asset.width,
                            outputHeight: asset.height,
                          },
                        }
                      : {}),
                  }),
                },
              });
              receipts.push({ artifactId: a.id, version: 1 });
            }
        }
        if (!current.cancelRequested)
          await this.canvases.place(tx, batch, item, asset);
        await tx.contentGenerationItem.update({
          where: { id: item.id },
          data: { artifactId: receipts[0]?.artifactId ?? null },
        });
        await tx.contentProviderAttempt.update({
          where: { id: attempt!.id },
          data: { resultAssetId: asset.id, status: "completed" },
        });
        await tx.usageRecord.updateMany({
          where: {
            tenantId: item.tenantId,
            metric: contentMediaMetrics,
            requestKey: item.id,
          },
          data: {
            status: persistedAttempt.usage
              ? "usage_reported_cost_pending"
              : "usage_unknown_cost_pending",
            detail: J({
              attemptId: attempt!.id,
              usage: persistedAttempt.usage ?? null,
              receipts,
              currency: "CNY",
              costStatus: "pending_provider_bill",
            }),
          },
        });
        await this.audit(tx, c!, "item.complete", item.id, {
          receipts,
          cancelled: current.cancelRequested,
        });
        await tx.personalNotification.upsert({
          where: {
            tenantId_recipientMembershipId_dedupeKey: {
              tenantId: item.tenantId,
              recipientMembershipId: batch.membershipId,
              dedupeKey: "content-item:" + item.id,
            },
          },
          create: {
            tenantId: item.tenantId,
            recipientMembershipId: batch.membershipId,
            dedupeKey: "content-item:" + item.id,
            appId: "content",
            kind: "content-generation",
            resourceId: item.projectId,
            title: current.cancelRequested ? "生成已停止" : "图文素材已生成",
            body: "打开项目查看结果与费用状态",
          },
          update: {},
        });
      });
    } catch (e) {
      const definitive = e instanceof MediaError && e.definitive;
      const code =
        e instanceof MediaError
          ? e.code
          : e instanceof ForbiddenException
            ? "CONTENT_ACCESS_REVOKED"
            : e instanceof ConflictException
              ? "CONTENT_VERSION_CONFLICT"
              : "CONTENT_PROCESSING_FAILED";
      const terminalVideo = [
        "CONTENT_VIDEO_PROVIDER_FAILED",
        "CONTENT_VIDEO_PROVIDER_EXPIRED",
        "CONTENT_VIDEO_PROVIDER_CANCELLED",
      ].includes(code);
      let status =
        definitive || !attempted || terminalVideo
          ? "failed"
          : "needs_reconciliation";
      if (code === "CONTENT_CANCELLED") status = "cancelled";
      await this.db.$transaction(async (tx) => {
        const changed = await tx.contentGenerationItem.updateMany({
          where: {
            id: item.id,
            lease,
            status: { in: ["submitting", "storing"] },
          },
          data: { status, errorCode: code, heartbeatAt: new Date() },
        });
        if (!changed.count) return;
        if (e instanceof MediaError && e.externalId)
          await tx.contentProviderAttempt.updateMany({
            where: { itemId: item.id },
            data: { externalId: e.externalId },
          });
        if (definitive)
          await tx.contentProviderAttempt.updateMany({
            where: { itemId: item.id },
            data: { status: "rejected", errorCode: code },
          });
        await tx.usageRecord.updateMany({
          where: {
            tenantId: item.tenantId,
            metric: contentMediaMetrics,
            requestKey: item.id,
          },
          data: {
            status:
              definitive || !attempted
                ? "released"
                : terminalVideo
                  ? "usage_unknown_cost_pending"
                  : "unknown",
            ...(definitive || !attempted ? { quantity: 0 } : {}),
          },
        });
      });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  private async providerReference(
    c: RequestContext,
    assetId: string,
    video = false,
  ) {
    const { asset, bytes } = await this.assetBytes(c, assetId);
    if (
      bytes.length > 8 * 1024 * 1024 ||
      (video &&
        (Math.min(asset.width, asset.height) < 300 ||
          Math.max(asset.width, asset.height) > 6000))
    ) {
      const processed = await mediaOperation({
        op: "provider-reference",
        data: bytes.toString("base64"),
      });
      return "data:image/jpeg;base64," + processed.data;
    }
    return "data:image/png;base64," + bytes.toString("base64");
  }
  private deferVideo(itemId: string, lease: string) {
    return this.db.contentGenerationItem.updateMany({
      where: { id: itemId, lease, status: { in: ["submitting", "storing"] } },
      data: { status: "rendering", heartbeatAt: new Date() },
    });
  }
  private async persistVideo(
    c: RequestContext,
    attemptId: string,
    projectId: string,
    result: any,
  ) {
    const existing = await this.db.contentAsset.findUnique({
      where: { id: attemptId },
    });
    if (existing) return existing;
    const bytes = await this.video.download(result.content?.video_url);
    const [x, y] = (
      typeof result.ratio === "string" && /^\d+:\d+$/.test(result.ratio)
        ? result.ratio
        : "16:9"
    )
      .split(":")
      .map(Number);
    const height = [480, 720, 1080].includes(
      Number.parseInt(result.resolution, 10),
    )
      ? Number.parseInt(result.resolution, 10)
      : 720;
    const width =
      x > 0 && y > 0
        ? Math.max(1, Math.min(4096, Math.round((height * x) / y)))
        : 1280;
    await putFile(c.tenantId, attemptId, bytes);
    return this.db.contentAsset.upsert({
      where: { id: attemptId },
      update: {},
      create: {
        id: attemptId,
        tenantId: c.tenantId,
        ownerId: c.membershipId,
        projectId,
        filename: "生成视频-" + attemptId.slice(0, 8) + ".mp4",
        mime: "video/mp4",
        width,
        height,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
  }
  async reconcileItem(c: RequestContext, itemId: string, raw: unknown) {
    await this.guard(c, "content.manage");
    const v = readBody(
      z
        .object({
          outcome: z.enum(["not_charged", "charged"]),
          billReference: z.string().trim().min(5).max(300),
          note: z.string().trim().min(10).max(2000),
          cost: z.string().regex(/^\d{1,8}(\.\d{1,6})?$/),
        })
        .strict(),
      raw,
    );
    if (v.outcome === "not_charged" && Number(v.cost) !== 0)
      throw new BadRequestException("未计费记录的金额应为0");
    const item = await this.db.contentGenerationItem.findFirst({
      where: {
        id: uuid(itemId),
        tenantId: c.tenantId,
        status: "needs_reconciliation",
      },
    });
    if (!item) throw new NotFoundException();
    await this.project(c, item.projectId);
    const a = await this.db.contentProviderAttempt.findUnique({
      where: { itemId: item.id },
    });
    if (a && (await getFile(c.tenantId, a.id).catch(() => null)))
      throw new ConflictException("已有保存结果，请先恢复结果，无需重新生成");
    return this.db.$transaction(async (tx) => {
      const changed = await tx.contentGenerationItem.updateMany({
        where: { id: item.id, status: "needs_reconciliation" },
        data: {
          status: "failed",
          errorCode:
            v.outcome === "not_charged"
              ? "CONTENT_MANUALLY_NOT_CHARGED"
              : "CONTENT_MANUALLY_CHARGED",
        },
      });
      if (!changed.count) throw new ConflictException();
      await tx.contentProviderAttempt.updateMany({
        where: { itemId: item.id },
        data: {
          status:
            v.outcome === "not_charged" ? "rejected" : "charged_no_result",
        },
      });
      await tx.usageRecord.updateMany({
        where: {
          tenantId: c.tenantId,
          metric: contentMediaMetrics,
          requestKey: item.id,
        },
        data: {
          status: v.outcome === "not_charged" ? "released" : "settled",
          quantity: v.outcome === "not_charged" ? 0 : 1,
          cost: v.cost,
          detail: J({ reconciledBy: c.membershipId, ...v, currency: "CNY" }),
        },
      });
      await this.audit(tx, c, "item.reconcile", item.id, v);
      return { ok: true };
    });
  }
  async reviewQueue(c: RequestContext, query: unknown) {
    const ctx = await this.guard(c, "content.review"),
      q = readBody(pageInput, query);
    const projects = await this.db.contentProject.findMany({
      where: this.projectWhere(ctx),
      select: { id: true, name: true },
    });
    const arts = await this.db.contentArtifact.findMany({
      where: {
        tenantId: c.tenantId,
        projectId: { in: projects.map((p) => p.id) },
      },
      select: { id: true, name: true, projectId: true },
    });
    const where = {
      tenantId: c.tenantId,
      artifactId: { in: arts.map((a) => a.id) },
      status: "submitted",
      createdBy: { not: c.membershipId },
      submittedBy: { not: c.membershipId },
    };
    const [rows, total] = await Promise.all([
      this.db.contentArtifactVersion.findMany({
        where,
        take: 20,
        skip: (q.page - 1) * 20,
        orderBy: { createdAt: "asc" },
      }),
      this.db.contentArtifactVersion.count({ where }),
    ]);
    return {
      items: rows.map((v) => ({
        ...v,
        artifact: arts.find((a) => a.id === v.artifactId),
        project: projects.find(
          (p) => p.id === arts.find((a) => a.id === v.artifactId)?.projectId,
        ),
      })),
      total,
      page: q.page,
      pageSize: 20,
    };
  }
  async recoverItem(c: RequestContext, itemId: string) {
    await this.guard(c, "content.manage");
    const item = await this.db.contentGenerationItem.findFirst({
      where: {
        id: uuid(itemId),
        tenantId: c.tenantId,
        status: "needs_reconciliation",
      },
    });
    if (!item) throw new NotFoundException();
    await this.project(c, item.projectId);
    const a = await this.db.contentProviderAttempt.findUnique({
      where: { itemId: item.id },
    });
    const canPoll = (item.input as any).mode === "video" && a?.externalId;
    if (
      !a ||
      (!canPoll && !(await getFile(c.tenantId, a.id).catch(() => null)))
    )
      throw new ConflictException(
        "没有已保存结果，请核对方舟原请求与账单；不会重新生成",
      );
    await this.db.contentGenerationItem.updateMany({
      where: { id: item.id, status: "needs_reconciliation" },
      data: { status: "storing", heartbeatAt: new Date(0) },
    });
    await this.audit(this.db, c, "item.recover", item.id);
    return { ok: true };
  }
  readonly delivery = new ContentDeliveryService(this);
  exports(c: RequestContext, projectId: string, query?: unknown) {
    return this.delivery.exports(c, projectId, query);
  }
  createExport(c: RequestContext, projectId: string, raw: unknown) {
    return this.delivery.createExport(c, projectId, raw);
  }
  download(c: RequestContext, exportId: string) {
    return this.delivery.download(c, exportId);
  }
  downloadImage(c: RequestContext, exportId: string, index: number) {
    return this.delivery.downloadImage(c, exportId, index);
  }
  async settleUsage(c: RequestContext, usageId: string, raw: unknown) {
    await this.guard(c, "content.manage");
    const v = readBody(
      z
        .object({
          expectedUpdatedAt: z.iso.datetime(),
          cost: z.string().regex(/^\d{1,8}(\.\d{1,6})?$/),
          billReference: z.string().trim().min(5).max(300),
          note: z.string().trim().min(5).max(2000),
        })
        .strict(),
      raw,
    );
    const old = await this.db.usageRecord.findFirst({
      where: {
        id: uuid(usageId),
        tenantId: c.tenantId,
        metric: contentMediaMetrics,
        status: {
          in: [
            "usage_reported_cost_pending",
            "usage_unknown_cost_pending",
            "settled",
          ],
        },
      },
    });
    if (!old) throw new ConflictException("请先核实生成结果，再登记账单");
    return this.db.$transaction(async (tx) => {
      const changed = await tx.usageRecord.updateMany({
        where: {
          id: old.id,
          tenantId: c.tenantId,
          updatedAt: new Date(v.expectedUpdatedAt),
        },
        data: {
          status: "settled",
          cost: v.cost,
          detail: J({
            ...((old.detail ?? {}) as any),
            billReference: v.billReference,
            note: v.note,
            currency: "CNY",
            settledBy: c.membershipId,
          }),
        },
      });
      if (!changed.count)
        throw new ConflictException("账单记录已更新，请刷新后核对");
      await this.audit(tx, c, "usage.settle", old.id, {
        ...v,
        previousCost: old.cost?.toString() ?? null,
      });
      return { ok: true };
    });
  }
  async usage(c: RequestContext, query?: unknown) {
    await this.guard(c, "content.manage");
    const q = readBody(pageInput, query ?? {}),
      where = { tenantId: c.tenantId, metric: contentMediaMetrics };
    const items = await this.db.usageRecord.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query ? 20 : 100,
      skip: query ? (q.page - 1) * 20 : 0,
    });
    return query
      ? {
          items,
          total: await this.db.usageRecord.count({ where }),
          page: q.page,
          pageSize: 20,
        }
      : items;
  }
  async cleanup() {
    const expired = await this.db.contentExport.findMany({
      where: { expiresAt: { lt: new Date() }, status: "ready" },
      take: 100,
    });
    for (const e of expired) {
      await removeFile(e.tenantId, e.id, "zip");
      await this.db.contentExport.updateMany({
        where: { id: e.id, status: "ready" },
        data: { status: "expired" },
      });
    }
    return expired.length;
  }
}
