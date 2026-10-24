import { Body, Controller, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../platform/auth.service';
import { KnowledgeEngineControlService } from './engine-control.service';
import { KnowledgeService } from './knowledge.service';
import { readBody } from '../platform/security';

@Controller('api/v1/tenants/:tenantKey/knowledge')
export class KnowledgeController {
  constructor(private readonly auth: AuthService, private readonly knowledge: KnowledgeService, private readonly engines: KnowledgeEngineControlService) {}
  private context(req: Request, key: string) { return this.auth.context(req, key, 'platform'); }
  @Get('engine') engine(@Req() r: Request, @Param('tenantKey') k: string) { return this.context(r, k).then(ctx => this.engines.status(ctx)); }
  @Post('engine/select') selectEngine(@Req() r: Request, @Param('tenantKey') k: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.engines.select(ctx, body)); }
  @Post('engine/rollback') rollbackEngine(@Req() r: Request, @Param('tenantKey') k: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.engines.select(ctx, body, true)); }
  @Post('engine/cancel') cancelEngine(@Req() r: Request, @Param('tenantKey') k: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.engines.cancel(ctx, body)); }
  @Get('spaces') spaces(@Req() r: Request, @Param('tenantKey') k: string) { return this.context(r, k).then(ctx => this.knowledge.spaces(ctx)); }
  @Post('spaces') create(@Req() r: Request, @Param('tenantKey') k: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.knowledge.createSpace(ctx, body)); }
  @Get('spaces/:id') space(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string) { return this.context(r, k).then(ctx => this.knowledge.spaceDetails(ctx, id)); }
  @Get('spaces/:id/access-options') options(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string) { return this.context(r, k).then(ctx => this.knowledge.accessOptions(ctx, id)); }
  @Patch('spaces/:id') update(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.knowledge.updateSpace(ctx, id, body)); }
  @Get('spaces/:id/documents') docs(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string) { return this.context(r, k).then(ctx => this.knowledge.documents(ctx, id, r.query)); }
  @Post('spaces/:id/documents') upload(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.knowledge.upload(ctx, id, body)); }
  @Post('spaces/:id/documents/:docId/versions') version(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string, @Param('docId') doc: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.knowledge.upload(ctx, id, body, doc)); }
  @Patch('documents/:id') state(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.knowledge.state(ctx, id, body)); }
  @Post('documents/:id/reindex') reindex(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string) { return this.context(r, k).then(ctx => this.knowledge.reindex(ctx, id)); }
  @Post('search') search(@Req() r: Request, @Param('tenantKey') k: string, @Body() body: unknown) { return this.context(r, k).then(ctx => this.knowledge.search(ctx, body)); }
  @Get('citations/:id') citation(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string) { return this.context(r, k).then(ctx => this.knowledge.citation(ctx, id)); }
  @Get('documents/:id/versions/:version/original') async original(@Req() r: Request, @Param('tenantKey') k: string, @Param('id') id: string, @Param('version') raw: string, @Res() res: Response) {
    const version = readBody(z.coerce.number().int().positive(), raw); const file = await this.knowledge.original(await this.context(r, k), id, version);
    res.setHeader('content-type', file.mimeType); res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('cache-control', 'no-store'); res.send(file.bytes);
  }
}
