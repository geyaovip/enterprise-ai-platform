import { Body, Controller, Get, Param, Post, Req, UnsupportedMediaTypeException } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../platform/auth.service";
import { ContentMediaToolsService } from "./content-media-tools.service";

@Controller("api/v1/tenants/:tenantKey/apps/content/media-tools")
export class ContentMediaToolsController {
  constructor(readonly auth: AuthService, readonly media: ContentMediaToolsService) {}

  private ctx(req: Request) {
    return this.auth.context(req, req.params.tenantKey as string, "content");
  }

  @Get("availability/:kind")
  async availability(@Req() req: Request, @Param("kind") kind: string) {
    return this.media.availability(await this.ctx(req), kind);
  }

  @Get("jobs/:kind")
  async jobs(@Req() req: Request, @Param("kind") kind: string) {
    return this.media.list(await this.ctx(req), kind);
  }

  @Post("jobs")
  async submit(@Req() req: Request, @Body() body: unknown) {
    return this.media.submit(await this.ctx(req), body);
  }

  @Post("inputs/:slot")
  async upload(@Req() req: Request, @Param("slot") slot: string) {
    const ctx = await this.ctx(req);
    if (req.header("content-type") !== "application/octet-stream" || req.header("content-encoding"))
      throw new UnsupportedMediaTypeException("请上传原始文件");
    const length = req.header("content-length");
    return this.media.upload(ctx, slot, req.iterator({ destroyOnReturn: false }), length === undefined ? undefined : Number(length));
  }
}
