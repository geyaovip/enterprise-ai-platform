import { identityInput, identityWhere } from './account-input';
import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Put, Req, ConflictException } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { hashPassword, readBody } from './security';
import { ManagedRuntimeService } from '../ai/managed-runtime.service';
import { InfrastructureService } from './infrastructure.service';

@Controller('api/v1/operator')
export class OperatorController {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly infra: InfrastructureService, private readonly managed:ManagedRuntimeService) {}
  private async operator(req: Request) {
    const user = await this.auth.user(req);
    if (user.platformRole !== 'operator') throw new ForbiddenException('需要平台运营权限');
    return user;
  }
  @Get('backup-status') async backupStatus(@Req() req:Request){
    await this.operator(req);
    try{const raw=JSON.parse(await readFile(join(resolve(process.env.KNOWLEDGE_STORAGE_DIR??'var/knowledge'),'.backup-status.json'),'utf8'));const data=readBody(z.object({checkedAt:z.iso.datetime(),status:z.enum(['success','failed'])}),raw);return{...data,stale:Date.now()-new Date(data.checkedAt).getTime()>36*3600000};}catch{return{status:'unknown',checkedAt:null,stale:true};}
  }
  @Get('adapters') async adapters(@Req() req: Request) { await this.operator(req); return this.infra.adapters(); }
  @Get('tenants') async tenants(@Req() req: Request) {
    await this.operator(req);
    return this.db.tenant.findMany({ select: { id: true, slug: true, name: true, active: true, createdAt: true, apps: { select: { appId: true, granted: true, enabled: true } }, _count: { select: { members: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
  @Post('tenants') async create(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.operator(req);
    const input = readBody(z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/), name: z.string().trim().min(1).max(100), email: identityInput, adminName: z.string().trim().min(1).max(100), password: z.string().min(12).max(200) }), body);
    return this.db.$transaction(async tx => {
      if (await tx.tenant.findUnique({ where: { slug: input.slug } }) || await tx.user.findUnique({ where: identityWhere(input.email) })) throw new ConflictException('企业标识或账号已存在');
      const tenant = await tx.tenant.create({ data: { slug: input.slug, name: input.name } });
      const user = await tx.user.create({ data: { ...identityWhere(input.email), name: input.adminName, passwordHash: hashPassword(input.password) } });
      const member = await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'admin' } });
      const root = await tx.orgUnit.create({ data: { tenantId: tenant.id, name: tenant.name } });
      await tx.membershipOrg.create({ data: { tenantId: tenant.id, membershipId: member.id, orgUnitId: root.id, primary: true } });
      await tx.tenantApp.create({ data: { tenantId: tenant.id, appId: 'erp', granted: true, enabled: true } });
      await tx.tenantCapability.createMany({ data: ['ai', 'knowledge'].map(capability => ({ tenantId: tenant.id, capability, delivered: true, enabled: true })) });
      await tx.operatorAudit.create({ data: { userId: actor.id, tenantId: tenant.id, action: 'platform.tenant.create', resourceId: tenant.id, detail: { slug: tenant.slug } } });
      return { id: tenant.id, slug: tenant.slug, name: tenant.name };
    });
  }
  @Patch('tenants/:id') async state(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.operator(req); const input = readBody(z.object({ active: z.boolean() }), body);
    return this.db.$transaction(async tx => {
      const tenant = await tx.tenant.update({ where: { id }, data: input });
      await tx.operatorAudit.create({ data: { userId: actor.id, tenantId: id, action: 'platform.tenant.state', resourceId: id, detail: input } });
      return { id, active: tenant.active };
    });
  }
  @Get('tenants/:id/configuration') async configuration(@Req() req: Request, @Param('id') id: string) {
    await this.operator(req);
    const [capabilities, bindings, members, knowledgeProfiles] = await Promise.all([this.db.tenantCapability.findMany({ where: { tenantId: id } }), this.infra.list(id), this.db.membership.findMany({ where: { tenantId: id }, select: { id: true, role: true, active: true, user: { select: { name: true } } } }), this.infra.profiles(id)]);
    const managedMembers=await Promise.all(members.map(async m=>({...m,runtime:await this.managed.status({tenantId:id,membershipId:m.id}).catch(()=>({managed:true,available:false,state:'unavailable'}))})));
    return { capabilities, bindings, members:managedMembers, knowledgeProfiles };
  }
  @Put('tenants/:id/capabilities/:capability') async capability(@Req() req: Request, @Param('id') id: string, @Param('capability') capability: string, @Body() body: unknown) {
    const actor = await this.operator(req);
    readBody(z.enum(['ai', 'knowledge', 'erp']), capability);
    const input = readBody(z.object({ delivered: z.boolean() }), body);
    return this.db.$transaction(async tx => {
      if (!await tx.tenant.findUnique({ where: { id } })) throw new ConflictException('企业不存在');
      const result = capability === 'erp'
        ? await tx.tenantApp.update({ where: { tenantId_appId: { tenantId: id, appId: 'erp' } }, data: { granted: input.delivered, ...(!input.delivered ? { enabled: false } : {}) } })
        : await tx.tenantCapability.upsert({ where: { tenantId_capability: { tenantId: id, capability } }, create: { tenantId: id, capability, delivered: input.delivered }, update: { delivered: input.delivered, ...(!input.delivered ? { enabled: false } : {}), version: { increment: 1 } } });
      await tx.operatorAudit.create({ data: { userId: actor.id, tenantId: id, action: 'platform.capability.deliver', resourceId: capability, detail: input } });
      return result;
    });
  }
  @Put('tenants/:id/infrastructure/:kind/:scopeKey') async binding(@Req() req: Request, @Param('id') id: string, @Param('kind') kind: string, @Param('scopeKey') scope: string, @Body() body: unknown) {
    const actor = await this.operator(req); return this.infra.save(actor.id, id, kind, scope, body);
  }
  @Put('tenants/:id/knowledge-profiles/:provider') async profile(@Req() req: Request, @Param('id') id: string, @Param('provider') provider: string, @Body() body: unknown) {
    const actor = await this.operator(req); return this.infra.saveProfile(actor.id, id, provider, body);
  }
  @Get('tenants/:id/infrastructure/:bindingId/health') async health(@Req() req: Request, @Param('id') id: string, @Param('bindingId') bindingId: string) {
    await this.operator(req); return this.infra.health(id, bindingId);
  }
  @Get('audit') async audit(@Req() req: Request) {
    await this.operator(req); return this.db.operatorAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Get('usage') async usage(@Req() req: Request) {
    await this.operator(req);
    const [executions, documents, failedIndexes] = await Promise.all([this.db.aiExecution.groupBy({ by: ['tenantId', 'provider', 'status'], _count: true }), this.db.knowledgeDocument.groupBy({ by: ['tenantId', 'status'], _count: true }), this.db.knowledgeIndex.count({ where: { status: 'failed' } })]);
    return { executions, documents, failedIndexes, requestId: randomUUID() };
  }
}
