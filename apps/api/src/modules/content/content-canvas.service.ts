import { imageRatios, referenceIds } from "./content-image-options";
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import type { RequestContext } from "../platform/context";
import { readBody } from "../platform/security";
import { videoOptions } from "./seedance.provider";
import { editRegion, id, json } from "./content.rules";
import type { ContentService } from "./content.service";

const coordinate = z.number().min(-20000).max(20000);
const geometry = {
  id,
  x: coordinate,
  y: coordinate,
  width: z.number().min(80).max(2000),
  height: z.number().min(60).max(2000),
};
export const canvasData = z
  .object({
    nodes: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              ...geometry,
              type: z.enum(["image", "video"]),
              assetId: id,
            })
            .strict(),
          z
            .object({
              ...geometry,
              type: z.literal("note"),
              text: z.string().max(2000),
            })
            .strict(),
        ]),
      )
      .max(100)
      .refine(
        (nodes) => new Set(nodes.map((n) => n.id)).size === nodes.length,
        "节点编号重复",
      ),
    recipe: z
      .object({
        mode: z.enum(["image", "video"]),
        picture: z.object({
          prompt: z.string().max(2000),
          ratio: z.enum(imageRatios),
          resolution: z.enum(["2K", "4K"]),
          candidates: z.int().min(1).max(3),
          nodes: z.array(id).max(4),
          region: editRegion.optional(),
          brand: z.object({ id, version: z.int().positive() }).optional(),
        }),
        video: z.object({
          prompt: z.string().max(2000),
          options: videoOptions,
          node: id.optional(),
        }),
      })
      .strict()
      .optional(),
    viewport: z
      .object({
        x: coordinate,
        y: coordinate,
        zoom: z.number().min(0.15).max(3),
      })
      .strict(),
  })
  .strict();
export const canvasBinding = z
  .object({
    id,
    version: z.int().positive(),
    originNodeId: id.optional(),
    anchor: z.object({ x: coordinate, y: coordinate }).strict(),
  })
  .strict();
const blank = { nodes: [], viewport: { x: 40, y: 40, zoom: 1 } };
const activeStatuses = [
  "queued",
  "submitting",
  "storing",
  "rendering",
  "needs_reconciliation",
];

/** Optional project surface: no separate identities, storage channel or generation pipeline. */
export class ContentCanvasService {
  constructor(readonly host: ContentService) {}
  get db() {
    return this.host.db;
  }
  async lock(tx: any, canvasId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"content-canvas:" + canvasId}))`;
  }
  async row(c: RequestContext, canvasId: string, write = false) {
    await this.host.guard(c, write ? "content.create" : "content.read");
    const row = await this.db.contentCanvas.findFirst({
      where: { id: readBody(id, canvasId), tenantId: c.tenantId },
    });
    if (!row) throw new NotFoundException("画布不存在");
    const project = await this.host.project(c, row.projectId, write);
    return { ...row, project };
  }
  async list(c: RequestContext, raw: unknown) {
    const ctx = await this.host.guard(c);
    const { page, q, days, sort, visibility } = readBody(
      z.object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        q: z.string().max(100).default(""),
        days: z.enum(["7", "30", "90"]).optional(),
        sort: z.enum(["newest", "oldest", "name"]).default("newest"),
        visibility: z.enum(["private", "tenant"]).optional(),
      }),
      raw,
    );
    const where = {
      tenantId: c.tenantId,
      ...(days
        ? {
            updatedAt: {
              gte: new Date(Date.now() - Number(days) * 86_400_000),
            },
          }
        : {}),
      project: {
        ...this.host.projectWhere(ctx),
        name: { contains: q, mode: "insensitive" as const },
        ...(visibility ? { visibility } : {}),
      },
    };
    const [items, total] = await Promise.all([
      this.db.contentCanvas.findMany({
        where,
        select: {
          id: true,
          version: true,
          updatedAt: true,
          project: { select: { id: true, name: true, visibility: true } },
        },
        orderBy: [
          sort === "name"
            ? { project: { name: "asc" } }
            : { updatedAt: sort === "oldest" ? "asc" : "desc" },
          { id: "desc" },
        ],
        take: 20,
        skip: (page - 1) * 20,
      }),
      this.db.contentCanvas.count({ where }),
    ]);
    return { items, total, page, pageSize: 20 };
  }
  async create(c: RequestContext, raw: unknown) {
    await this.host.guard(c, "content.create");
    const v = readBody(
      z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          projectId: id.optional(),
          sourceCanvasId: id.optional(),
        })
        .strict(),
      raw,
    );
    if (!v.projectId && !v.name)
      throw new BadRequestException("请填写画布名称");
    const existing = v.projectId
      ? await this.host.project(c, v.projectId, true)
      : null;
    const initial = structuredClone(blank) as z.infer<typeof canvasData>;
    if (v.sourceCanvasId) {
      if (existing) throw new BadRequestException("画布设置只能复制到新项目");
      const source = await this.row(c, v.sourceCanvasId);
      const recipe = readBody(canvasData, source.data).recipe;
      if (!recipe) throw new BadRequestException("请先保存画布设置");
      initial.recipe = {
        mode: recipe.mode,
        picture: { ...recipe.picture, nodes: [], region: undefined },
        video: {
          prompt: recipe.video.prompt,
          options: {
            ...recipe.video.options,
            ratio:
              recipe.video.options.ratio === "adaptive"
                ? "16:9"
                : recipe.video.options.ratio,
          },
        },
      };
    }
    if (existing) {
      const assets = await this.db.contentAsset.findMany({
        where: {
          tenantId: c.tenantId,
          projectId: existing.id,
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      for (const [index, a] of assets.entries()) {
        await this.host.asset(c, a.id);
        initial.nodes.push({
          id: a.id,
          type: a.mime === "video/mp4" ? "video" : "image",
          assetId: a.id,
          x: (index % 4) * 352,
          y: Math.floor(index / 4) * 480,
          width: 320,
          height: Math.max(60, Math.min(2000, (320 * a.height) / a.width)),
        });
      }
    }
    return this.db.$transaction(async (tx) => {
      if (existing) {
        await this.lock(tx, existing.id);
        const previous = await tx.contentCanvas.findUnique({
          where: { projectId: existing.id },
        });
        if (previous) return { ...previous, project: existing };
      }
      const project =
        existing ??
        (await tx.contentProject.create({
          data: {
            tenantId: c.tenantId,
            ownerId: c.membershipId,
            name: v.name!,
            visibility: "private",
            participants: [],
            brief: {
              workflow: "studio",
              prompt: v.name!,
              productIds: [],
              productVersions: {},
              sizes: ["square"],
            },
          },
        }));
      const board = await tx.contentCanvas.create({
        data: {
          tenantId: c.tenantId,
          projectId: project.id,
          data: json(initial),
        },
      });
      await this.host.audit(tx, c, "canvas.create", board.id);
      return { ...board, project };
    });
  }
  async pending(
    tx: any,
    board: { id: string; tenantId: string; projectId: string },
  ) {
    const batches = await tx.contentBatch.findMany({
      where: {
        tenantId: board.tenantId,
        projectId: board.projectId,
        snapshot: { path: ["canvas", "id"], equals: board.id },
      },
      select: { id: true },
    });
    return tx.contentGenerationItem.count({
      where: {
        tenantId: board.tenantId,
        batchId: { in: batches.map((b: any) => b.id) },
        status: { in: activeStatuses },
      },
    });
  }
  async get(c: RequestContext, canvasId: string) {
    const row = await this.row(c, canvasId);
    const data = readBody(canvasData, row.data);
    const assets: Record<string, any> = {};
    for (const assetId of new Set(
      data.nodes.filter((n) => n.type !== "note").map((n) => n.assetId),
    )) {
      try {
        const a = await this.host.asset(c, assetId);
        assets[a.id] = {
          id: a.id,
          filename:
            a.filename === "generated-background.png"
              ? `${row.project.name.slice(0, 40)}-${Object.keys(assets).length + 1}.png`
              : a.filename,
          width: a.width,
          height: a.height,
        };
      } catch (e) {
        if (!(e instanceof NotFoundException)) throw e;
      }
    }
    const jobs = await this.db.contentGenerationItem.findMany({
      where: {
        tenantId: c.tenantId,
        projectId: row.projectId,
        id: { in: data.nodes.map((node) => node.id) },
      },
      select: { id: true, batchId: true },
    });
    const batches = await this.db.contentBatch.findMany({
      where: {
        tenantId: c.tenantId,
        projectId: row.projectId,
        id: { in: jobs.map((job) => job.batchId) },
      },
      select: { id: true, snapshot: true },
    });
    const receipts = Object.fromEntries(
      jobs.map((job) => {
        const snapshot = batches.find((batch) => batch.id === job.batchId)
          ?.snapshot as any;
        return [job.id, { model: snapshot?.model, request: snapshot?.request }];
      }),
    );
    return {
      ...row,
      data,
      assets,
      receipts,
      pending: await this.pending(this.db, row),
    };
  }
  async save(c: RequestContext, canvasId: string, raw: unknown) {
    const v = readBody(
      z.object({ version: z.int().positive(), data: canvasData }).strict(),
      raw,
    );
    const board = await this.row(c, canvasId, true);
    const before = readBody(canvasData, board.data);
    for (const n of v.data.nodes) {
      if (n.type === "note") continue;
      const prior = before.nodes.find(
        (p) => p.id === n.id && p.type === n.type && p.assetId === n.assetId,
      );
      if (prior) continue; // Unavailable existing references can still be moved or removed.
      const asset = await this.host.asset(c, n.assetId);
      if (
        asset.projectId !== board.projectId ||
        (asset.mime === "video/mp4") !== (n.type === "video")
      )
        throw new BadRequestException("请通过添加图片导入素材");
    }
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, canvasId);
      if (v.data.nodes.length + (await this.pending(tx, board)) > 100)
        throw new ConflictException("画布最多100项，请移除部分内容后重试");
      const changed = await tx.contentCanvas.updateMany({
        where: { id: canvasId, tenantId: c.tenantId, version: v.version },
        data: { data: json(v.data), version: { increment: 1 } },
      });
      if (!changed.count)
        throw new ConflictException("画布已更新，当前修改仍保留在浏览器中");
      await this.host.audit(tx, c, "canvas.save", canvasId);
      return tx.contentCanvas.findUniqueOrThrow({ where: { id: canvasId } });
    });
  }
  async importImage(c: RequestContext, canvasId: string, raw: unknown) {
    const v = readBody(
      z
        .object({
          version: z.int().positive(),
          nodeId: id,
          assetId: id,
          x: coordinate,
          y: coordinate,
        })
        .strict(),
      raw,
    );
    const board = await this.row(c, canvasId, true);
    // Read source through the normal asset guard. Copy into the destination project so later sharing never grants access to the source project.
    const source = await this.host.assetBytes(c, v.assetId);
    if (source.asset.mime !== "image/png")
      throw new BadRequestException("请选择图片素材");
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, canvasId);
        const latest = await tx.contentCanvas.findUniqueOrThrow({
          where: { id: canvasId },
        });
        const data = readBody(canvasData, latest.data);
        if (data.nodes.some((n) => n.id === v.nodeId)) return latest; // Safe recovery of an unknown import response.
        if (latest.version !== v.version)
          throw new ConflictException("画布已更新，请重试添加图片");
        if (data.nodes.length + (await this.pending(tx, board)) >= 100)
          throw new ConflictException("画布最多100项");
        const asset =
          source.asset.projectId === board.projectId
            ? source.asset
            : await this.host.persistAsset(
                c,
                source.bytes.toString("base64"),
                { filename: source.asset.filename, projectId: board.projectId },
                source.asset.width,
                source.asset.height,
              );
        data.nodes.push({
          id: v.nodeId,
          type: "image",
          assetId: asset.id,
          x: v.x,
          y: v.y,
          width: 320,
          height: Math.max(
            60,
            Math.min(2000, (320 * asset.height) / asset.width),
          ),
        });
        const updated = await tx.contentCanvas.update({
          where: { id: canvasId },
          data: { data: json(data), version: { increment: 1 } },
        });
        await this.host.audit(tx, c, "canvas.import", canvasId, {
          assetId: asset.id,
        });
        return updated;
      },
      { timeout: 15000 },
    );
  }
  async bind(
    tx: any,
    c: RequestContext,
    projectId: string,
    binding: z.infer<typeof canvasBinding>,
    request: any,
    count = 1,
  ) {
    await this.lock(tx, binding.id);
    const row = await tx.contentCanvas.findFirst({
      where: { id: binding.id, tenantId: c.tenantId, projectId },
    });
    if (!row) throw new NotFoundException("画布不存在");
    if (row.version !== binding.version)
      throw new ConflictException("画布已更新，请先同步后生成");
    const data = readBody(canvasData, row.data);
    if (request.mode !== "image" && request.mode !== "video")
      throw new BadRequestException("请选择图片或视频生成");
    if (binding.originNodeId) {
      const origin = data.nodes.find((n) => n.id === binding.originNodeId);
      if (
        !origin ||
        origin.type !== "image" ||
        origin.assetId !== referenceIds(request)[0]
      )
        throw new ConflictException("参考图片已变化，请重新选择");
    } else if (request.referenceAssetId)
      throw new BadRequestException("请选择画布中的参考图片");
    for (const ref of referenceIds(request)) {
      if (!data.nodes.some((n) => n.type === "image" && n.assetId === ref))
        throw new BadRequestException("请选择画布中的参考图片");
    }
    if (data.nodes.length + (await this.pending(tx, row)) + count > 100)
      throw new ConflictException("画布最多100项，请移除部分内容后生成");
  }
  async place(tx: any, batch: any, item: any, asset: any) {
    const binding = (batch.snapshot as any).canvas;
    if (!binding) return;
    await this.lock(tx, binding.id);
    const board = await tx.contentCanvas.findFirst({
      where: {
        id: binding.id,
        tenantId: item.tenantId,
        projectId: item.projectId,
      },
    });
    if (!board) return; // The generated artifact remains in project history even if a project was removed.
    const data = readBody(canvasData, board.data);
    if (data.nodes.length >= 100 || data.nodes.some((n) => n.id === item.id))
      return;
    const origin = data.nodes.find((n) => n.id === binding.originNodeId);
    let x = Math.min(
      19000,
      origin ? origin.x + origin.width + 32 : binding.anchor.x,
    );
    let y = Math.min(19000, origin ? origin.y : binding.anchor.y);
    const height = Math.max(
      60,
      Math.min(2000, (320 * asset.height) / asset.width),
    );
    for (let attempt = 0; attempt < 101; attempt++) {
      const overlap = data.nodes.find(
        (n) =>
          x < n.x + n.width + 20 &&
          x + 340 > n.x &&
          y < n.y + n.height + 20 &&
          y + height + 20 > n.y,
      );
      if (!overlap) break;
      x = overlap.x + overlap.width + 32;
      if (x > 19000) {
        x = -19000;
        y = Math.min(20000, y + height + 32);
      }
    }
    data.nodes.push({
      id: item.id,
      type: asset.mime === "video/mp4" ? "video" : "image",
      assetId: asset.id,
      x: Math.min(20000, x),
      y: Math.min(20000, y),
      width: 320,
      height,
    });
    await tx.contentCanvas.update({
      where: { id: board.id },
      data: { data: json(data), version: { increment: 1 } },
    });
  }
}
