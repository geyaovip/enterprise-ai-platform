import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { PlatformService } from './platform.service';
import { readBody } from './security';

const roles = z.enum(['admin', 'sales', 'purchasing', 'warehouse', 'finance']);
const memberCreate = z.object({ email: z.email(), name: z.string().trim().min(1).max(100), password: z.string().min(12).max(200), role: roles, orgUnitId: z.uuid().optional() });
const memberPatch = z.object({ role: roles.optional(), active: z.boolean().optional(), orgUnitId: z.uuid().optional() });

@Controller('api/v1')
export class PlatformController {
  constructor(private readonly auth: AuthService, private readonly platform: PlatformService) {}

  @Post('auth/login')
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = readBody(z.object({ email: z.email(), password: z.string().min(1) }), body);
    const result = await this.auth.login(input.email, input.password, req.ip ?? req.socket.remoteAddress ?? 'unknown');
    res.cookie('suite_session', result.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 24 * 3600_000 });
    return { user: result.user };
  }

  @Post('auth/logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req);
    res.clearCookie('suite_session', { path: '/' });
    return { ok: true };
  }

  @Post('auth/change-password')
  async changePassword(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const input = readBody(z.object({ currentPassword: z.string().min(1), nextPassword: z.string().min(12).max(200) }), body);
    const result = await this.auth.changePassword(req, input.currentPassword, input.nextPassword);
    res.clearCookie('suite_session', { path: '/' });
    return result;
  }

  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.auth.user(req);
    return { user: { id: user.id, email: user.email, name: user.name }, tenants: await this.platform.tenants(user.id) };
  }

  @Get('tenants')
  async tenants(@Req() req: Request) { return this.platform.tenants((await this.auth.user(req)).id); }

  @Get('tenants/:tenantKey/apps')
  async apps(@Req() req: Request, @Param('tenantKey') key: string) { return this.platform.apps(await this.auth.context(req, key, 'platform')); }

  @Patch('tenants/:tenantKey/apps/:appId')
  async setApp(@Req() req: Request, @Param('tenantKey') key: string, @Param('appId') appId: string, @Body() body: unknown) {
    return this.platform.setApp(await this.auth.context(req, key, 'platform'), appId, readBody(z.object({ enabled: z.boolean() }), body).enabled);
  }

  @Get('tenants/:tenantKey/members')
  async members(@Req() req: Request, @Param('tenantKey') key: string) { return this.platform.members(await this.auth.context(req, key, 'platform')); }

  @Post('tenants/:tenantKey/members')
  async createMember(@Req() req: Request, @Param('tenantKey') key: string, @Body() body: unknown) {
    return this.platform.createMember(await this.auth.context(req, key, 'platform'), readBody(memberCreate, body));
  }

  @Patch('tenants/:tenantKey/members/:id')
  async updateMember(@Req() req: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() body: unknown) {
    return this.platform.updateMember(await this.auth.context(req, key, 'platform'), id, readBody(memberPatch, body));
  }

  @Get('tenants/:tenantKey/org-units')
  async orgUnits(@Req() req: Request, @Param('tenantKey') key: string) { return this.platform.orgUnits(await this.auth.context(req, key, 'platform')); }

  @Post('tenants/:tenantKey/org-units')
  async createOrg(@Req() req: Request, @Param('tenantKey') key: string, @Body() body: unknown) {
    const input = readBody(z.object({ name: z.string().trim().min(1).max(100), parentId: z.uuid() }), body);
    return this.platform.createOrgUnit(await this.auth.context(req, key, 'platform'), input.name, input.parentId);
  }

  @Patch('tenants/:tenantKey/org-units/:id')
  async updateOrg(@Req() req: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() body: unknown) {
    const input = readBody(z.object({ name: z.string().trim().min(1).max(100).optional(), parentId: z.uuid().optional(), active: z.boolean().optional(), version: z.int().positive() }), body);
    return this.platform.updateOrgUnit(await this.auth.context(req, key, 'platform'), id, input);
  }

  @Get('tenants/:tenantKey/audit-logs')
  async audit(@Req() req: Request, @Param('tenantKey') key: string, @Query('page') rawPage?: string) {
    const page = Math.max(1, Math.min(10000, Number(rawPage ?? 1) || 1));
    return this.platform.auditLogs(await this.auth.context(req, key, 'platform'), page);
  }
}
