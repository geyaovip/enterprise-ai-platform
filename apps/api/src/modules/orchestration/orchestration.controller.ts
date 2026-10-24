import { Body, Controller, Get, Param, Post, Put, Req, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../platform/auth.service';
import { ApplicationRegistry } from '../platform/application-registry';
import { PrismaService } from '../prisma.service';
import { CommandBus } from './command-bus';
import { TaskService } from './task.service';
import { ApplicationCollaborationService } from './collaboration.service';
import { CommercialService } from './commercial.service';
import { QuotaService } from './quota.service';
import { ReplenishmentService } from '../erp/replenishment.service';
import { OperatingEventService } from '../erp/operating-event.service';
import { z } from 'zod';
import { readBody } from '../platform/security';
import { AiService } from '../ai/ai.service';
@Controller('api/v1/tenants/:tenantKey')
export class OrchestrationController{
 constructor(private readonly auth:AuthService,private readonly apps:ApplicationRegistry,private readonly db:PrismaService,private readonly bus:CommandBus,private readonly tasks:TaskService,private readonly collaboration:ApplicationCollaborationService,private readonly commercial:CommercialService,private readonly quotas:QuotaService,private readonly replenishment:ReplenishmentService,private readonly events:OperatingEventService,private readonly ai:AiService){}
 @Get('application-catalog')async applicationCatalog(@Req()r:Request,@Param('tenantKey')key:string){const ctx=await this.auth.context(r,key,'platform');const installed=await this.db.tenantApp.findMany({where:{tenantId:ctx.tenantId}});return this.apps.list().filter(a=>installed.some(i=>i.appId===a.appId&&i.granted)).map(a=>({...a,enabled:installed.find(i=>i.appId===a.appId)?.enabled??false}));}
 @Get('applications')async applications(@Req()r:Request,@Param('tenantKey')key:string){const ctx=await this.auth.context(r,key,'platform');const installed=await this.db.tenantApp.findMany({where:{tenantId:ctx.tenantId,enabled:true,granted:true}});return this.apps.list().filter(a=>installed.some(i=>i.appId===a.appId)).map(a=>({...a,permissions:a.permissions.filter(p=>ctx.permissions.includes(p)),contractVersion:1}));}
 @Get('tasks')async list(@Req()r:Request,@Param('tenantKey')key:string){return this.tasks.list(await this.auth.context(r,key,'platform'));}
 @Get('tasks/:id')async task(@Req()r:Request,@Param('tenantKey')key:string,@Param('id')id:string){return this.tasks.get(await this.auth.context(r,key,'platform'),id);}
 @Post('tasks/:id/actions')async action(@Req()r:Request,@Param('tenantKey')key:string,@Param('id')id:string,@Body()body:unknown){return this.tasks.action(await this.auth.context(r,key,'platform'),id,body);}
 @Post('apps/:appId/tasks')async create(@Req()r:Request,@Param('tenantKey')key:string,@Param('appId')appId:string,@Body()body:unknown){return this.tasks.create(await this.auth.context(r,key,appId),body);}
 @Get('apps/:appId/commands')async commands(@Req()r:Request,@Param('tenantKey')key:string,@Param('appId')appId:string){return this.bus.registry.catalog(await this.auth.context(r,key,appId));}
 @Get('apps/:appId/events')async appEvents(@Req()r:Request,@Param('tenantKey')key:string,@Param('appId')appId:string){return this.collaboration.list(await this.auth.context(r,key,appId));}
 @Post('apps/:appId/events')async emit(@Req()r:Request,@Param('tenantKey')key:string,@Param('appId')appId:string,@Body()body:unknown){return this.collaboration.emit(await this.auth.context(r,key,appId),body);}
 @Post('apps/:appId/events/:id/retry')async retry(@Req()r:Request,@Param('tenantKey')key:string,@Param('appId')appId:string,@Param('id')id:string){return this.collaboration.retry(await this.auth.context(r,key,appId),id);}
 @Post('apps/:appId/object-links')async link(@Req()r:Request,@Param('tenantKey')key:string,@Param('appId')appId:string,@Body()body:unknown){return this.collaboration.link(await this.auth.context(r,key,appId),body);}
 @Get('apps/:appId/object-links/:type/:id')async links(@Req()r:Request,@Param('tenantKey')key:string,@Param('appId')appId:string,@Param('type')type:string,@Param('id')id:string){return this.collaboration.links(await this.auth.context(r,key,appId),type,id);}
 @Get('erp/replenishment')async facts(@Req()r:Request,@Param('tenantKey')key:string){return this.replenishment.facts(await this.auth.context(r,key,'erp'));}
 @Post('erp/replenishment/plans')async plan(@Req()r:Request,@Param('tenantKey')key:string,@Body()body:unknown){return this.replenishment.plan(await this.auth.context(r,key,'erp'),body);}
 @Post('erp/metrics/query')async metric(@Req()r:Request,@Param('tenantKey')key:string,@Body()body:unknown){return this.replenishment.metric(await this.auth.context(r,key,'erp'),body);}
 @Get('erp/operating-events')async operating(@Req()r:Request,@Param('tenantKey')key:string){return this.events.list(await this.auth.context(r,key,'erp'));}
 @Post('erp/operating-events/:id/actions')async operatingAction(@Req()r:Request,@Param('tenantKey')key:string,@Param('id')id:string,@Body()body:unknown){return this.events.action(await this.auth.context(r,key,'erp'),id,body);}
 @Get('commercial')async commercialSummary(@Req()r:Request,@Param('tenantKey')key:string){const ctx=await this.auth.context(r,key,'platform');this.auth.require(ctx,'platform.manage');return this.quotas.summary(ctx.tenantId);}
 @Get('support-grants')async support(@Req()r:Request,@Param('tenantKey')key:string){return this.commercial.supportList(await this.auth.context(r,key,'platform'));}
 @Post('support-grants/:id/actions')async supportDecision(@Req()r:Request,@Param('tenantKey')key:string,@Param('id')id:string,@Body()body:unknown){return this.commercial.decide(await this.auth.context(r,key,'platform'),id,body);}
}
@Controller('api/v1/operator/operations')
export class OperationsController{
 constructor(private readonly auth:AuthService,private readonly commercial:CommercialService,private readonly quotas:QuotaService,private readonly apps:ApplicationRegistry,private readonly db:PrismaService){}
 private async operator(req:Request){const user=await this.auth.user(req);if(user.platformRole!=='operator')throw new ForbiddenException('需要平台运营权限');return user.id;}
 @Get('applications')async applications(@Req()r:Request){await this.operator(r);return this.apps.list();}
 @Put('tenants/:id/apps/:appId')async deliver(@Req()r:Request,@Param('id')id:string,@Param('appId')appId:string,@Body()b:unknown){const operator=await this.operator(r);this.apps.get(appId);const input=readBody(z.object({granted:z.boolean()}),b);if(input.granted)await this.quotas.checkApp(id,appId);return this.db.$transaction(async tx=>{if(!await tx.tenant.findUnique({where:{id}}))throw new ForbiddenException('企业不存在');const result=await tx.tenantApp.upsert({where:{tenantId_appId:{tenantId:id,appId}},create:{tenantId:id,appId,granted:input.granted,enabled:false},update:{granted:input.granted,...(!input.granted?{enabled:false}:{})}});await tx.operatorAudit.create({data:{userId:operator,tenantId:id,action:'platform.application.deliver',resourceId:appId,detail:input}});return result;});}
 @Get('plans')async plans(@Req()r:Request){await this.operator(r);return this.commercial.plans();}
 @Put('plans')async plan(@Req()r:Request,@Body()b:unknown){return this.commercial.savePlan(await this.operator(r),b);}
 @Get('tenants/:id')async summary(@Req()r:Request,@Param('id')id:string){await this.operator(r);return this.quotas.summary(id);}
 @Put('tenants/:id/subscription')async subscription(@Req()r:Request,@Param('id')id:string,@Body()b:unknown){return this.commercial.subscribe(await this.operator(r),id,b);}
 @Post('tenants/:id/bills')async bill(@Req()r:Request,@Param('id')id:string,@Body()b:unknown){return this.commercial.bill(await this.operator(r),id,b);}
 @Post('tenants/:id/bills/:billId/actions')async billState(@Req()r:Request,@Param('id')id:string,@Param('billId')billId:string,@Body()b:unknown){return this.commercial.billState(await this.operator(r),id,billId,b);}
 @Get('tenants/:id/support')async supportList(@Req()r:Request,@Param('id')id:string){return this.commercial.operatorSupport(await this.operator(r),id);}
 @Post('tenants/:id/support')async requestSupport(@Req()r:Request,@Param('id')id:string,@Body()b:unknown){return this.commercial.requestSupport(await this.operator(r),id,b);}
 @Get('tenants/:id/support/:grantId/:scope')async inspect(@Req()r:Request,@Param('id')id:string,@Param('grantId')grantId:string,@Param('scope')scope:string){return this.commercial.inspect(await this.operator(r),id,grantId,scope);}
}
