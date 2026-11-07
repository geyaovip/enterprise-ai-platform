import { AuthProtectionService } from './auth-protection.service';
import { ForbiddenException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { EmailAuthService } from './email-auth.service';
import { setSessionCookie } from './auth-session';
import { InvitationService } from './invitation.service';
import { AuthService } from './auth.service';
import { PlatformService } from './platform.service';
import { readBody } from './security';
import { PersonalNotificationsService } from './personal-notifications.service';

import { identityInput, accountInput } from './account-input';

const roles = z.enum(['admin', 'sales', 'purchasing', 'warehouse', 'finance']);
const memberCreate = z.object({ email: identityInput, name: z.string().trim().min(1).max(100), password: z.string().min(12).max(200), role: roles, orgUnitId: z.uuid().optional() });
const memberPatch = z.object({ role: roles.optional(), active: z.boolean().optional(), orgUnitId: z.uuid().optional() });

@Controller('api/v1')
export class PlatformController {
  constructor(private readonly auth: AuthService, private readonly protection: AuthProtectionService, private readonly emailAuth: EmailAuthService, private readonly platform: PlatformService, private readonly invitations:InvitationService, private readonly notifications:PersonalNotificationsService) {}

  @Get('tenants/:tenantKey/notifications')
  async notificationsFeed(@Req() req:Request,@Param('tenantKey') key:string,@Query() q:unknown){return this.notifications.feed(await this.auth.context(req,key,'platform'),q);}
  @Post('tenants/:tenantKey/notifications/read-all')
  async readAllPersonalNotifications(@Req() req:Request,@Param('tenantKey') key:string,@Body() body:unknown){return this.notifications.readAll(await this.auth.context(req,key,'platform'),body);}
  @Post('tenants/:tenantKey/notifications/:id/read')
  async readPersonalNotification(@Req() req:Request,@Param('tenantKey') key:string,@Param('id') id:string){return this.notifications.read(await this.auth.context(req,key,'platform'),id);}

  @Post('auth/invitation/inspect')
  inspectInvitation(@Body() body:unknown){return this.invitations.inspect(body);}
  @Post('auth/invitation/accept')
  acceptInvitation(@Req() req:Request,@Body() body:unknown){return this.invitations.accept(req,body);}
  @Get('tenants/:tenantKey/invitations')
  async invitationsList(@Req() req:Request,@Param('tenantKey') key:string){return this.invitations.list(await this.auth.context(req,key,'platform'),req.query);}
  @Post('tenants/:tenantKey/invitations')
  async invite(@Req() req:Request,@Param('tenantKey') key:string,@Body() body:unknown){return this.invitations.create(await this.auth.context(req,key,'platform'),body);}
  @Post('tenants/:tenantKey/invitations/:id/revoke')
  async revokeInvitation(@Req() req:Request,@Param('tenantKey') key:string,@Param('id') id:string){return this.invitations.revoke(await this.auth.context(req,key,'platform'),id);}

  @Post('auth/login')
  legacyLogin() { throw new ForbiddenException('请使用邮箱验证码登录'); }

  @Post('auth/register')
  legacyRegister() { throw new ForbiddenException('无需注册，请使用邮箱验证码登录'); }

  @Get('auth/email/config')
  emailConfiguration(@Res({ passthrough: true }) res: Response) { res.setHeader('Cache-Control', 'no-store'); return { turnstile: this.protection.publicConfiguration() }; }

  @Post('auth/email/request')
  requestEmailCode(@Body() body: unknown, @Req() req: Request) {
    const input = readBody(z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()), humanToken: z.string().min(1).max(2048).optional() }).strict(), body);
    return this.emailAuth.request(input.email, req.ip ?? req.socket.remoteAddress ?? 'unknown', input.humanToken);
  }

  @Post('auth/email/verify')
  async verifyEmailCode(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = readBody(z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()), challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict(), body);
    const result = await this.emailAuth.verify(input, req.ip ?? req.socket.remoteAddress ?? 'unknown');
    setSessionCookie(res, result.token, result.expiresAt);
    res.setHeader('Cache-Control', 'no-store');
    return { user: result.user };
  }

  @Post('auth/email/bind')
  async bindEmail(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const actor = await this.auth.user(req);
    const input = readBody(z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()), challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict(), body);
    const result = await this.emailAuth.verify(input, req.ip ?? req.socket.remoteAddress ?? 'unknown', actor.id);
    setSessionCookie(res, result.token, result.expiresAt);
    res.setHeader('Cache-Control', 'no-store');
    return { user: result.user };
  }

  @Post('auth/logout-all')
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(req);
    res.clearCookie('suite_session', { path: '/' });
    return { ok: true };
  }

  @Post('onboarding/enterprise')
  createEnterprise(@Req() req: Request, @Body() body: unknown) {
    const input = readBody(z.object({ name: z.string().trim().min(2).max(100) }).strict(), body);
    return this.auth.createEnterprise(req, input.name);
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
    return { user: { id: user.id, email: user.email ?? '', account: user.account, name: user.name }, platformRole: user.platformRole, tenants: await this.platform.tenants(user.id) };
  }

  @Get('tenants')
  async tenants(@Req() req: Request) { return this.platform.tenants((await this.auth.user(req)).id); }

  @Get('tenants/:tenantKey/capabilities')
  async capabilities(@Req() req: Request, @Param('tenantKey') key: string) { const ctx = await this.auth.context(req, key, 'platform'); return this.platform.capabilities(ctx); }

  @Get('tenants/:tenantKey/service-status')
  async serviceStatus(@Req() req: Request, @Param('tenantKey') key: string) { return this.platform.serviceStatus(await this.auth.context(req, key, 'platform')); }

  @Patch('tenants/:tenantKey/capabilities/:capability')
  async setCapability(@Req() req: Request, @Param('tenantKey') key: string, @Param('capability') capability: string, @Body() body: unknown) { const ctx = await this.auth.context(req, key, 'platform'); return this.platform.setCapability(ctx, capability, readBody(z.object({ enabled: z.boolean() }), body).enabled); }

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
