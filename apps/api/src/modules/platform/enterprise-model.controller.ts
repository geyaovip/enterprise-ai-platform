import { Body, Controller, Get, Post, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { EnterpriseModelService } from './enterprise-model.service';

@Controller('api/v1/tenants/:tenantKey/model-settings')
export class EnterpriseModelController {
  constructor(private readonly auth: AuthService, private readonly models: EnterpriseModelService) {}
  @Get() async list(@Req() req: Request, @Param('tenantKey') key: string) { return this.models.list(await this.auth.context(req, key, 'platform')); }
  @Put(':kind') async save(@Req() req: Request, @Param('tenantKey') key: string, @Param('kind') kind: string, @Body() body: unknown) { return this.models.save(await this.auth.context(req, key, 'platform'), kind, body); }
  @Post(':kind/reset') async reset(@Req() req: Request, @Param('tenantKey') key: string, @Param('kind') kind: string, @Body() body: unknown) { return this.models.reset(await this.auth.context(req, key, 'platform'), kind, body); }
}
