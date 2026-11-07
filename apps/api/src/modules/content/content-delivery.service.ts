import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { z } from "zod";
import type { RequestContext } from "../platform/context";
import { readBody } from "../platform/security";
import { hash, id, json as J, syncArtworkCopy } from "./content.rules";
import {
  filePath,
  getFile,
  mediaOperation,
  removeFile,
} from "./content-storage";
import type { ContentService } from "./content.service";
const uuid = (v: string) => readBody(id, v);
const assetRefs = (d: any): string[] =>
  [
    d.backgroundId,
    ...d.layers
      .filter((l: any) => l.type === "image")
      .map((l: any) => l.assetId),
  ].filter(Boolean);
export class ContentDeliveryService {
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
  artifact(...args: Parameters<ContentService["artifact"]>) {
    return this.host.artifact(...args);
  }
  asset(...args: Parameters<ContentService["asset"]>) {
    return this.host.asset(...args);
  }
  audit(...args: Parameters<ContentService["audit"]>) {
    return this.host.audit(...args);
  }
  async exports(c: RequestContext, projectId: string, query?: unknown) {
    await this.guard(c, "content.export");
    await this.project(c, projectId);
    const q = readBody(
      z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }),
      query ?? {},
    );
    const where = {
      tenantId: c.tenantId,
      projectId,
      membershipId: c.membershipId,
    };
    const [items, total] = await Promise.all([
      this.db.contentExport.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query ? 20 : 100,
        skip: query ? (q.page - 1) * 20 : 0,
      }),
      this.db.contentExport.count({ where }),
    ]);
    return query ? { items, total, page: q.page, pageSize: 20 } : items;
  }
  async createExport(c: RequestContext, projectId: string, raw: unknown) {
    await this.guard(c, "content.export");
    const p = await this.project(c, projectId);
    const v = readBody(
      z
        .object({
          requestKey: z.string().min(8).max(120),
          items: z
            .array(
              z
                .object({ artifactId: id, version: z.int().positive() })
                .strict(),
            )
            .min(1)
            .max(60),
          format: z.enum(["png", "jpeg", "transparent"]).default("png"),
          draft: z.boolean().default(false),
        })
        .strict(),
      raw,
    );
    if (v.draft) await this.guard(c, "content.create");
    const fingerprint = hash({
      items: v.items,
      format: v.format,
      draft: v.draft,
    });
    const old = await this.db.contentExport.findUnique({
      where: {
        tenantId_requestKey: { tenantId: c.tenantId, requestKey: v.requestKey },
      },
    });
    if (old) {
      if (
        old.membershipId !== c.membershipId ||
        old.projectId !== p.id ||
        old.fingerprint !== fingerprint
      )
        throw new ConflictException();
      return old;
    }
    const items: any[] = [];
    const assets: Record<string, any> = {};
    for (const ref of v.items) {
      const a = await this.artifact(c, ref.artifactId);
      if (a.projectId !== p.id)
        throw new BadRequestException("作品不属于当前项目");
      const r = await this.db.contentArtifactVersion.findUnique({
        where: {
          tenantId_artifactId_version: {
            tenantId: c.tenantId,
            artifactId: a.id,
            version: ref.version,
          },
        },
      });
      if (!r) throw new NotFoundException();
      if (!v.draft && !["approved", "exempt"].includes(r.status))
        throw new ForbiddenException("正式交付仅包含已批准或免审版本");
      items.push({ ...r, data: r.data, name: a.name });
      for (const assetId of assetRefs(r.data)) {
        await this.asset(c, assetId);
        assets[assetId] = { path: filePath(c.tenantId, assetId) };
      }
    }
    const manifest = {
      projectId: p.id,
      projectName: p.name,
      format: v.format,
      draft: v.draft,
      items: items.map((r) => ({
        artifactId: r.artifactId,
        version: r.version,
        name: r.name,
        status: r.status,
        reviewedBy: r.reviewedBy,
        source: r.data.source,
      })),
      createdAt: new Date().toISOString(),
    };
    const exportId = randomUUID();
    const record = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId + ":content-export:" + v.requestKey}))`;
      const duplicate = await tx.contentExport.findUnique({
        where: {
          tenantId_requestKey: {
            tenantId: c.tenantId,
            requestKey: v.requestKey,
          },
        },
      });
      if (duplicate) {
        if (
          duplicate.fingerprint !== fingerprint ||
          duplicate.membershipId !== c.membershipId ||
          duplicate.projectId !== p.id
        )
          throw new ConflictException("同一导出请求参数不同");
        return duplicate;
      }
      return tx.contentExport.create({
        data: {
          id: exportId,
          tenantId: c.tenantId,
          projectId: p.id,
          membershipId: c.membershipId,
          userId: c.userId,
          status: "queued",
          requestKey: v.requestKey,
          fingerprint,
          manifest: J(manifest),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
    });
    return record;
  }
  async exportItems(c: RequestContext, e: any, checkLayout = true) {
    await this.guard(c, "content.export");
    await this.project(c, e.projectId);
    const manifest = e.manifest as any;
    if (manifest.draft) await this.guard(c, "content.create");
    const items: any[] = [],
      assets: Record<string, any> = {};
    for (const ref of manifest.items) {
      const a = await this.artifact(c, ref.artifactId);
      if (a.projectId !== e.projectId) throw new ForbiddenException();
      const r = await this.db.contentArtifactVersion.findUnique({
        where: {
          tenantId_artifactId_version: {
            tenantId: c.tenantId,
            artifactId: a.id,
            version: ref.version,
          },
        },
      });
      if (!r || (!manifest.draft && !["approved", "exempt"].includes(r.status)))
        throw new ForbiddenException("作品交付权限已变化");
      if (
        hash((r.data as any).copy) !== hash(syncArtworkCopy(r.data as any).copy)
      )
        throw new BadRequestException("CONTENT_COPY_MISMATCH");
      if (
        checkLayout &&
        (await mediaOperation({ op: "layout", data: r.data })).issues.length
      )
        throw new BadRequestException("CONTENT_LAYOUT_OVERFLOW");
      items.push({ ...r, name: a.name });
      for (const assetId of assetRefs(r.data)) {
        await this.asset(c, assetId);
        assets[assetId] = { path: filePath(c.tenantId, assetId) };
      }
    }
    return { items, assets, manifest };
  }
  async tick() {
    const stale = new Date(Date.now() - 180000);
    const candidate = await this.db.contentExport.findFirst({
      where: {
        OR: [
          { status: "queued" },
          {
            status: "preparing",
            OR: [
              { heartbeatAt: { lt: stale } },
              { heartbeatAt: null, createdAt: { lt: stale } },
            ],
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;
    const lease = randomUUID();
    const claimed = await this.db.contentExport.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        lease: candidate.lease,
        heartbeatAt: candidate.heartbeatAt,
      },
      data: {
        status: "preparing",
        lease,
        heartbeatAt: new Date(),
        errorCode: null,
      },
    });
    if (!claimed.count) return true;
    const owns = { id: candidate.id, lease, status: "preparing" };
    const heartbeat = setInterval(
      () =>
        void this.db.contentExport
          .updateMany({ where: owns, data: { heartbeatAt: new Date() } })
          .catch(() => {}),
      10000,
    );
    try {
      const member = await this.db.membership.findFirstOrThrow({
        where: { id: candidate.membershipId, tenantId: candidate.tenantId },
      });
      const c = await this.host.auth.taskContext({
        tenantId: candidate.tenantId,
        membershipId: candidate.membershipId,
        userId: candidate.userId ?? member.userId,
        appId: "content",
        taskId: candidate.id,
      });
      const input = await this.exportItems(c, candidate);
      const output = await mediaOperation({
        op: "export",
        ...input,
        format: input.manifest.format,
        draft: input.manifest.draft,
        output: filePath(c.tenantId, lease, "zip"),
      });
      await this.exportItems(c, candidate, false);
      await this.db.$transaction(async (tx) => {
        const updated = await tx.contentExport.updateMany({
          where: owns,
          data: {
            status: "ready",
            bytes: output.bytes,
            expiresAt: new Date(Date.now() + 86400000),
            heartbeatAt: new Date(),
          },
        });
        if (!updated.count)
          throw new ConflictException("CONTENT_EXPORT_LEASE_LOST");
        await rename(
          filePath(c.tenantId, lease, "zip"),
          filePath(c.tenantId, candidate.id, "zip"),
        );
        await this.audit(tx, c, "export", candidate.id, {
          items: input.manifest.items,
          draft: input.manifest.draft,
        });
        await tx.personalNotification.upsert({
          where: {
            tenantId_recipientMembershipId_dedupeKey: {
              tenantId: c.tenantId,
              recipientMembershipId: c.membershipId,
              dedupeKey: "content-export:" + candidate.id,
            },
          },
          create: {
            tenantId: c.tenantId,
            recipientMembershipId: c.membershipId,
            dedupeKey: "content-export:" + candidate.id,
            appId: "content",
            kind: "content-export",
            resourceId: candidate.projectId,
            title: "素材包已可下载",
            body: "打开项目交付页取件",
          },
          update: {},
        });
      });
    } catch (e) {
      const code =
        e instanceof BadRequestException &&
        e.message === "CONTENT_LAYOUT_OVERFLOW"
          ? "layout_overflow"
          : e instanceof BadRequestException &&
              e.message === "CONTENT_COPY_MISMATCH"
            ? "copy_mismatch"
            : e instanceof ForbiddenException || e instanceof NotFoundException
              ? "access_changed"
              : "packaging_failed";
      await this.db.contentExport.updateMany({
        where: owns,
        data: { status: "failed", errorCode: code, heartbeatAt: new Date() },
      });
    } finally {
      clearInterval(heartbeat);
      await removeFile(candidate.tenantId, lease, "zip");
    }
    return true;
  }
  async retry(c: RequestContext, exportId: string) {
    await this.guard(c, "content.export");
    const e = await this.db.contentExport.findFirst({
      where: {
        id: uuid(exportId),
        tenantId: c.tenantId,
        membershipId: c.membershipId,
      },
    });
    if (!e) throw new NotFoundException();
    await this.exportItems(c, e);
    await this.db.contentExport.updateMany({
      where: { id: e.id, status: { in: ["failed", "expired"] } },
      data: {
        status: "queued",
        errorCode: null,
        lease: null,
        heartbeatAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    return this.db.contentExport.findUniqueOrThrow({ where: { id: e.id } });
  }
  async download(c: RequestContext, exportId: string) {
    await this.guard(c, "content.export");
    const e = await this.db.contentExport.findFirst({
      where: {
        id: uuid(exportId),
        tenantId: c.tenantId,
        membershipId: c.membershipId,
        status: "ready",
        expiresAt: { gt: new Date() },
      },
    });
    if (!e) throw new NotFoundException("导出包不存在或已过期，请重新打包");
    await this.project(c, e.projectId);
    const manifest = e.manifest as any;
    await this.exportItems(c, e, false);
    if (manifest.draft) await this.guard(c, "content.create");
    for (const ref of manifest.items) {
      const a = await this.artifact(c, ref.artifactId);
      if (a.projectId !== e.projectId) throw new ForbiddenException();
      const r = await this.db.contentArtifactVersion.findUnique({
        where: {
          tenantId_artifactId_version: {
            tenantId: c.tenantId,
            artifactId: a.id,
            version: ref.version,
          },
        },
      });
      if (!r || (!manifest.draft && !["approved", "exempt"].includes(r.status)))
        throw new ForbiddenException("作品交付权限已变化");
    }
    const bytes = await getFile(c.tenantId, e.id, "zip");
    await this.guard(c, "content.export");
    return bytes;
  }
  async downloadImage(c: RequestContext, exportId: string, index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= 60)
      throw new BadRequestException();
    const bytes = await this.download(c, exportId);
    const extracted = await mediaOperation({
      op: "extract",
      data: bytes.toString("base64"),
      index,
    }).catch(() => {
      throw new NotFoundException("图片不存在");
    });
    await this.guard(c, "content.export");
    return {
      bytes: Buffer.from(extracted.data, "base64"),
      mime: extracted.mime,
    };
  }
}
