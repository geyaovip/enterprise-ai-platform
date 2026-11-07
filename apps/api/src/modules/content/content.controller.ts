import { filePath } from "./content-storage";
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Req,
  Res,
  Body,
  Query,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "../platform/auth.service";
import { ContentService } from "./content.service";
@Controller("api/v1/tenants/:tenantKey/apps/content")
export class ContentController {
  constructor(
    readonly auth: AuthService,
    readonly content: ContentService,
  ) {}
  ctx(r: Request) {
    return this.auth.context(r, r.params.tenantKey as string, "content");
  }
  @Get("metadata") meta(@Req() r: Request) {
    return this.ctx(r).then((c) => this.content.metadata(c));
  }
  @Get("settings") settings(@Req() r: Request) {
    return this.ctx(r).then((c) => this.content.settings(c));
  }
  @Put("settings") saveSettings(@Req() r: Request, @Body() b: unknown) {
    return this.ctx(r).then((c) => this.content.saveSettings(c, b));
  }
  @Get("collaborators") collaborators(@Req() r: Request, @Query() q: unknown) {
    return this.ctx(r).then((c) => this.content.collaborators(c, q));
  }
  @Get("members") members(@Req() r: Request) {
    return this.ctx(r).then((c) => this.content.members(c));
  }
  @Put("members") grant(@Req() r: Request, @Body() b: unknown) {
    return this.ctx(r).then((c) => this.content.grant(c, b));
  }
  @Get("reviews") reviews(@Req() r: Request, @Query() q: unknown) {
    return this.ctx(r).then((c) => this.content.reviewQueue(c, q));
  }
  @Post("items/:id/reconcile") reconcile(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.reconcileItem(c, id, b));
  }
  @Put("usage/:id") settleUsage(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.settleUsage(c, id, b));
  }
  @Get("usage") usage(@Req() r: Request, @Query() q: unknown) {
    return this.ctx(r).then((c) => this.content.usage(c, q));
  }
  @Get("documents/:kind") documents(
    @Req() r: Request,
    @Param("kind") kind: string,
    @Query() q: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.documents(c, kind, q));
  }
  @Post("documents/:kind") createDocument(
    @Req() r: Request,
    @Param("kind") kind: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.saveDocument(c, kind, b));
  }
  @Put("documents/:kind/:id") saveDocument(
    @Req() r: Request,
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.saveDocument(c, kind, b, id));
  }
  @Get("document/:id") document(
    @Req() r: Request,
    @Param("id") id: string,
    @Query("version") version: string,
  ) {
    return this.ctx(r).then((c) =>
      this.content.document(c, id, version ? Number(version) : undefined),
    );
  }
  @Post("document/:id/publish") publish(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.publish(c, id, b));
  }
  @Get("canvases") canvases(@Req() r: Request, @Query() q: unknown) {
    return this.ctx(r).then((c) => this.content.canvases.list(c, q));
  }
  @Post("canvases") createCanvas(@Req() r: Request, @Body() b: unknown) {
    return this.ctx(r).then((c) => this.content.canvases.create(c, b));
  }
  @Get("canvases/:id") canvas(@Req() r: Request, @Param("id") id: string) {
    return this.ctx(r).then((c) => this.content.canvases.get(c, id));
  }
  @Put("canvases/:id") saveCanvas(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.canvases.save(c, id, b));
  }
  @Post("canvases/:id/images") importCanvasImage(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.canvases.importImage(c, id, b));
  }
  @Get("projects") projects(@Req() r: Request, @Query() q: unknown) {
    return this.ctx(r).then((c) => this.content.projects(c, q));
  }
  @Post("projects") createProject(@Req() r: Request, @Body() b: unknown) {
    return this.ctx(r).then((c) => this.content.saveProject(c, b));
  }
  @Get("projects/:id") project(@Req() r: Request, @Param("id") id: string) {
    return this.ctx(r).then((c) => this.content.project(c, id));
  }
  @Put("projects/:id") saveProject(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.saveProject(c, b, id));
  }
  @Delete("projects/:id") trashProject(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.ctx(r).then((c) => this.content.trashProject(c, id));
  }
  @Post("projects/:id/restore") restoreProject(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.ctx(r).then((c) => this.content.trashProject(c, id, true));
  }
  @Get("trash") trash(@Req() r: Request, @Query() q: Record<string, unknown>) {
    return this.ctx(r).then((c) =>
      this.content.trash(c, q.page !== undefined ? q : undefined),
    );
  }
  @Post("assets") upload(@Req() r: Request, @Body() b: unknown) {
    return this.ctx(r).then((c) => this.content.upload(c, b));
  }
  @Get("assets") assets(@Req() r: Request, @Query() q: unknown) {
    return this.ctx(r).then((c) => this.content.assets(c, q));
  }
  @Get("assets/archive") async assetArchive(
    @Req() r: Request,
    @Query() q: unknown,
    @Res() res: Response,
  ) {
    const archive = await this.content.archiveAssets(await this.ctx(r), q);
    try {
      res.set("Cache-Control", "private, no-store");
      await new Promise<void>((resolve, reject) =>
        res.download(archive.path, "内容资产.zip", (error) => {
          if (error && !res.headersSent) reject(error);
          else resolve();
        }),
      );
    } finally {
      await archive.cleanup();
    }
  }
  @Post("projects/:projectId/assets/:assetId/transform") async transformAsset(
    @Req() r: Request,
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ) {
    return this.content.transformAsset(
      await this.ctx(r),
      projectId,
      assetId,
      body,
    );
  }
  @Get("assets/:id/file") async assetFile(
    @Req() r: Request,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const ctx = await this.ctx(r);
    const asset = await this.content.asset(ctx, id);
    if (asset.mime === "video/mp4") {
      res.set({
        "Content-Type": asset.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.sendFile(filePath(ctx.tenantId, asset.id), { cacheControl: false });
      return;
    }
    const x = await this.content.assetBytes(ctx, id);
    res
      .set({
        "Content-Type": x.asset.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(x.bytes);
  }
  @Get("assets/:id/thumbnail") async thumbnail(
    @Req() r: Request,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const bytes = await this.content.thumbnail(await this.ctx(r), id);
    res
      .set({
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(bytes);
  }
  @Get("projects/:id/artifacts") artworks(
    @Req() r: Request,
    @Param("id") id: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.ctx(r).then((c) =>
      this.content.artworks(c, id, q.page !== undefined ? q : undefined),
    );
  }
  @Get("artifacts/:id/draft") workDraft(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.ctx(r).then((c) => this.content.editing.snapshot(c, id));
  }
  @Get("artifacts/:id") async artworkDetail(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    const c = await this.ctx(r),
      a = await this.content.artifact(c, id),
      versions = await this.content.editing.versions(c, id, {});
    if (!versions.items.length) return this.content.editing.version(c, id, "0");
    return { ...a, versions: versions.items.slice(0, 1) };
  }
  @Get("artifacts/:id/versions") versions(
    @Req() r: Request,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.editing.versions(c, id, q));
  }
  @Get("artifacts/:id/versions/:version") version(
    @Req() r: Request,
    @Param("id") id: string,
    @Param("version") v: string,
  ) {
    return this.ctx(r).then((c) => this.content.editing.version(c, id, v));
  }
  @Put("artifacts/:id/draft") saveDraft(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.editing.saveDraft(c, id, b));
  }
  @Post("artifacts/:id/draft/discard") discardDraft(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.editing.discardDraft(c, id, b));
  }
  @Post("artifacts/:id/draft/rebase") rebaseDraft(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.editing.rebaseDraft(c, id, b));
  }
  @Post("artifacts/:id/layout") layout(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.editing.layout(c, id, b));
  }
  @Get("artifacts/:id/copy-suggestions") suggestions(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.ctx(r).then((c) => this.content.editing.suggestions(c, id));
  }
  @Post("artifacts/:id/adopt-copy") adoptCopy(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.editing.adoptCopy(c, id, b));
  }
  @Post("projects/:id/artifacts") createArtwork(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.createArtwork(c, id, b));
  }
  @Put("artifacts/:id") saveArtwork(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.saveArtwork(c, id, b));
  }
  @Post("artifacts/:id/review") review(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.review(c, id, b));
  }
  @Post("projects/:id/preview") preview(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.plan(c, id, b));
  }
  @Post("projects/:id/batches") submit(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.submit(c, id, b));
  }
  @Get("projects/:id/batches") batches(
    @Req() r: Request,
    @Param("id") id: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.ctx(r).then((c) =>
      this.content.batches(c, id, q.page !== undefined ? q : undefined),
    );
  }
  @Post("items/:id/cancel") cancel(@Req() r: Request, @Param("id") id: string) {
    return this.ctx(r).then((c) => this.content.cancel(c, id));
  }
  @Post("items/:id/retry") retry(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.retry(c, id, b));
  }
  @Post("items/:id/recover") recover(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.ctx(r).then((c) => this.content.recoverItem(c, id));
  }
  @Post("projects/:id/exports") createExport(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.ctx(r).then((c) => this.content.createExport(c, id, b));
  }
  @Get("projects/:id/exports") exports(
    @Req() r: Request,
    @Param("id") id: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.ctx(r).then((c) =>
      this.content.exports(c, id, q.page !== undefined ? q : undefined),
    );
  }
  @Post("exports/:id/retry") retryExport(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.ctx(r).then((c) => this.content.delivery.retry(c, id));
  }
  @Get("exports/:id/images/:index") async image(
    @Req() r: Request,
    @Param("id") id: string,
    @Param("index") index: string,
    @Res() res: Response,
  ) {
    const data = await this.content.downloadImage(
      await this.ctx(r),
      id,
      Number(index),
    );
    res
      .set({
        "Content-Type": data.mime,
        "Content-Disposition":
          "attachment; filename=content-image." +
          (data.mime === "image/jpeg" ? "jpg" : "png"),
        "Cache-Control": "private, no-store",
      })
      .send(data.bytes);
  }
  @Get("exports/:id/file") async download(
    @Req() r: Request,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const bytes = await this.content.download(await this.ctx(r), id);
    res
      .set({
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="brand-content.zip"',
        "Cache-Control": "private, no-store",
      })
      .send(bytes);
  }
}
