import { Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ChannelService } from './channel.service';

@Controller('api/v1/tenants/:tenantKey/channels')
export class ChannelController {
  constructor(private readonly auth: AuthService, private readonly channels: ChannelService) {}

  @Get()
  list(@Req() req: Request, @Param('tenantKey') key: string) { return this.auth.context(req, key, 'platform').then(ctx => this.channels.list(ctx)); }

  @Post('feishu/connect')
  connect(@Req() req: Request, @Param('tenantKey') key: string) { return this.auth.context(req, key, 'platform').then(ctx => this.channels.startFeishu(ctx)); }

  @Get('feishu/attempts/:id')
  attempt(@Req() req: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.auth.context(req, key, 'platform').then(ctx => this.channels.attempt(ctx, id)); }

  @Post('feishu/pair-code')
  pairCode(@Req() req: Request, @Param('tenantKey') key: string) { return this.auth.context(req, key, 'platform').then(ctx => this.channels.pairCode(ctx)); }

  @Get('feishu/me')
  me(@Req() req: Request, @Param('tenantKey') key: string) { return this.auth.context(req, key, 'platform').then(ctx => this.channels.myIdentity(ctx)); }

  @Delete('feishu/me')
  unlink(@Req() req: Request, @Param('tenantKey') key: string) { return this.auth.context(req, key, 'platform').then(ctx => this.channels.unlink(ctx)); }

  @Post('feishu/test')
  test(@Req() req: Request, @Param('tenantKey') key: string) { return this.auth.context(req, key, 'platform').then(ctx => this.channels.testDelivery(ctx)); }

  @Get('deliveries/:id')
  delivery(@Req() req: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.auth.context(req, key, 'platform').then(ctx => this.channels.delivery(ctx, id)); }
}
