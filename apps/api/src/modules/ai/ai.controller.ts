import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../platform/auth.service';
import { ModelGateway } from './model.gateway';
import { AiService } from './ai.service';

@Controller('api/v1/tenants/:tenantKey/ai')
export class AiController {
  constructor(private readonly auth: AuthService, private readonly gateway: ModelGateway, private readonly ai: AiService) {}
  private platform(req: Request, key: string) { return this.auth.context(req, key, 'platform'); }
  private erp(req: Request, key: string) { return this.auth.context(req, key, 'erp'); }

  @Get('settings') status(@Req() r: Request, @Param('tenantKey') key: string) { return this.platform(r, key).then(ctx => { this.auth.require(ctx, 'platform.manage'); return this.gateway.status(ctx); }); }
  @Put('settings') save(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.platform(r, key).then(ctx => this.gateway.save(ctx, b)); }
  @Post('settings/test') test(@Req() r: Request, @Param('tenantKey') key: string) { return this.platform(r, key).then(ctx => this.gateway.test(ctx)); }
  @Delete('settings') clear(@Req() r: Request, @Param('tenantKey') key: string) { return this.platform(r, key).then(ctx => this.gateway.clear(ctx)); }

  @Get('conversations') list(@Req() r: Request, @Param('tenantKey') key: string) { return this.erp(r, key).then(ctx => this.ai.list(ctx)); }
  @Post('conversations') create(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.create(ctx, b)); }
  @Get('conversations/:id') get(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.get(ctx, id)); }
  @Delete('conversations/:id') remove(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.remove(ctx, id)); }
  @Post('conversations/:id/messages') send(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.send(ctx, id, b)); }
  @Get('actions/:id') action(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.action(ctx, id)); }
  @Post('actions/:id/confirm') confirm(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.confirm(ctx, id)); }
  @Get('shortages') shortages(@Req() r: Request, @Param('tenantKey') key: string) { return this.erp(r, key).then(ctx => this.ai.shortages(ctx)); }
  @Post('tasks') enqueue(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.enqueue(ctx, b)); }
  @Get('tasks/:id') task(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.task(ctx, id)); }
  @Post('analyze') analyze(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.analyze(ctx, b)); }
  @Get('risk-reviews/:type/:id') latestReview(@Req() r: Request, @Param('tenantKey') key: string, @Param('type') type: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.latestReview(ctx, type, id)); }
  @Post('risk-reviews') review(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.review(ctx, b)); }
  @Post('extract') extract(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.extract(ctx, b)); }
}
