import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { ChannelService } from "./channel.service";
import { readBody } from "./security";

@Controller("api/v1/tenants/:tenantKey/channels")
export class ChannelController {
  constructor(
    private readonly auth: AuthService,
    private readonly channels: ChannelService,
  ) {}
  private context(req: Request, key: string) {
    return this.auth.context(req, key, "platform");
  }
  @Get()
  list(@Req() req: Request, @Param("tenantKey") key: string) {
    return this.context(req, key).then((c) => this.channels.list(c));
  }
  @Post(":provider/connect")
  connect(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
  ) {
    return this.context(req, key).then((c) => this.channels.start(c, provider));
  }
  @Get(":provider/attempts/:id")
  attempt(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
    @Param("id") id: string,
  ) {
    return this.context(req, key).then((c) =>
      this.channels.attempt(c, id, provider),
    );
  }
  @Post(":provider/attempts/:id/verify")
  verify(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const value = readBody(
      z.object({ code: z.string().min(4).max(12) }).strict(),
      body,
    );
    return this.context(req, key).then((c) =>
      this.channels.verifyAttempt(c, provider, id, value),
    );
  }
  @Delete(":provider/attempts/:id")
  cancel(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
    @Param("id") id: string,
  ) {
    return this.context(req, key).then((c) =>
      this.channels.cancelAttempt(c, provider, id),
    );
  }
  @Post(":provider/pair-code")
  pair(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
  ) {
    return this.context(req, key).then((c) =>
      this.channels.pairCode(c, provider),
    );
  }
  @Get(":provider/me")
  me(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
  ) {
    return this.context(req, key).then((c) =>
      this.channels.myIdentity(c, provider),
    );
  }
  @Delete(":provider/me")
  unlink(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
  ) {
    return this.context(req, key).then((c) =>
      this.channels.unlink(c, provider),
    );
  }
  @Post(":provider/assistant")
  assistant(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
    @Body() body: unknown,
  ) {
    const value = readBody(
      z.object({ appId: z.enum(["erp", "crm", "mes", "content"]) }).strict(),
      body,
    );
    return this.context(req, key).then((c) =>
      this.channels.setApp(c, provider, value.appId),
    );
  }
  @Post(":provider/disconnect")
  disconnect(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
  ) {
    return this.context(req, key).then((c) =>
      this.channels.disconnect(c, provider),
    );
  }
  @Post(":provider/test")
  test(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("provider") provider: string,
  ) {
    return this.context(req, key).then((c) =>
      this.channels.testDelivery(c, provider),
    );
  }
  @Get("deliveries/:id")
  delivery(
    @Req() req: Request,
    @Param("tenantKey") key: string,
    @Param("id") id: string,
  ) {
    return this.context(req, key).then((c) => this.channels.delivery(c, id));
  }
}
