import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../platform/auth.service';
import { ModelGateway } from './model.gateway';
import { InfrastructureService } from '../platform/infrastructure.service';
import { PlatformService } from '../platform/platform.service';
import { ManagedRuntimeService } from './managed-runtime.service';
import { AiService } from './ai.service';
import { AiMemoryService } from './ai-memory.service';

@Controller(['api/v1/operator/ai','api/v1/tenants/:tenantKey/management-ai','api/v1/tenants/:tenantKey/ai','api/v1/tenants/:tenantKey/apps/:appId/ai'])
export class AiController {
  constructor(private readonly auth: AuthService, private readonly gateway: ModelGateway, private readonly ai: AiService, private readonly infra: InfrastructureService, private readonly managed:ManagedRuntimeService, private readonly platformService:PlatformService, private readonly memory:AiMemoryService) {}
  private platform(req: Request, key: string) { if(!key) throw new ForbiddenException('此入口不提供企业服务配置'); return this.auth.context(req, key, 'platform'); }
  private erp(req: Request, key: string) {
    if (req.originalUrl.startsWith('/api/v1/operator/ai')) return this.auth.operatorAiContext(req);
    if (req.originalUrl.includes('/management-ai/')) return this.auth.managementContext(req, key);
    return this.auth.context(req, key, req.params.appId as string || 'erp');
  }
  @Get('status') async assistantStatus(@Req() req: Request, @Param('tenantKey') key: string) {
    const ctx = await this.erp(req,key); const status = await this.platformService.serviceStatus(ctx);
    return {...status, ai:{...status.ai,enabled:['crm','mes'].includes(ctx.app.appId)?(status.ai.enabled&&ctx.permissions.includes(ctx.app.appId+'.ai.use')):(ctx.permissions.includes('platform.ai.use') || (status.ai.enabled&&ctx.permissions.includes(ctx.app.appId+'.ai.use')))},serviceTenantKey:ctx.tenantKey};
  }

  @Get('runtime-status') runtimeStatus(@Req() r: Request, @Param('tenantKey') key: string) { return this.platform(r, key).then(async ctx => { this.auth.require(ctx, 'platform.manage'); const configs = await this.infra.list(ctx.tenantId); return { provider: 'openclaw', members: await Promise.all((await this.platformService.members(ctx)).map(async m=>({membershipId:m.id,...await this.managed.status({tenantId:ctx.tenantId,membershipId:m.id}).catch(()=>({state:'unavailable',managed:true,available:false})),enabled:configs.some(c=>c.kind==='runtime'&&c.scopeKey===m.id&&c.enabled)}))), knowledgeConfigured: configs.some(c => c.kind === 'knowledge' && c.enabled) }; }); }
  @Get('settings') status(@Req() r: Request, @Param('tenantKey') key: string) { return this.platform(r, key).then(ctx => { this.auth.require(ctx, 'platform.manage'); return this.gateway.status(ctx); }); }
  @Put('settings') save(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.platform(r, key).then(ctx => this.gateway.save(ctx, b)); }
  @Post('settings/test') test(@Req() r: Request, @Param('tenantKey') key: string) { return this.platform(r, key).then(ctx => this.gateway.test(ctx)); }
  @Delete('settings') clear(@Req() r: Request, @Param('tenantKey') key: string) { return this.platform(r, key).then(ctx => this.gateway.clear(ctx)); }

  @Get('conversations') list(@Req() r: Request, @Param('tenantKey') key: string) { return this.erp(r, key).then(ctx => this.ai.list(ctx)); }
  @Get('memory') memoryList(@Req() r:Request,@Param('tenantKey') key:string){return this.erp(r,key).then(ctx=>this.memory.list(ctx));}
  @Post('memory') memoryCreate(@Req() r:Request,@Param('tenantKey') key:string,@Body() body:unknown){return this.erp(r,key).then(ctx=>this.memory.create(ctx,body));}
  @Put('memory/preferences') memoryPreferences(@Req() r:Request,@Param('tenantKey') key:string,@Body() body:unknown){return this.erp(r,key).then(ctx=>this.memory.setPreferences(ctx,body));}
  @Get('memory/preferences') memoryReadPreferences(@Req() r:Request,@Param('tenantKey') key:string){return this.erp(r,key).then(ctx=>this.memory.preferences(ctx));}
  @Put('memory/:id') memoryUpdate(@Req() r:Request,@Param('tenantKey') key:string,@Param('id') id:string,@Body() body:unknown){return this.erp(r,key).then(ctx=>this.memory.update(ctx,id,body));}
  @Delete('memory/:id') memoryRemove(@Req() r:Request,@Param('tenantKey') key:string,@Param('id') id:string){return this.erp(r,key).then(ctx=>this.memory.remove(ctx,id));}
  @Post('conversations') create(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.create(ctx, b)); }
  @Get('conversations/:id') get(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.get(ctx, id)); }
  @Get('conversations/:id/runs') runs(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.runs(ctx, id)); }
  @Post('conversations/:id/runs/:runId/cancel') cancelRun(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Param('runId') runId: string) { return this.erp(r, key).then(ctx => this.ai.cancelRun(ctx, id, runId)); }
  @Get('conversations/:id/actions') actions(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.actions(ctx, id)); }
  @Delete('conversations/:id') remove(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.remove(ctx, id)); }
  @Post('conversations/:id/messages') send(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.send(ctx, id, b)); }
  @Post('conversations/:id/turns') turn(@Req() r:Request,@Param('tenantKey') key:string,@Param('id') id:string,@Body() b:unknown){return this.erp(r,key).then(ctx=>this.ai.enqueueMessage(ctx,id,b));}
  @Post('tasks/:id/cancel') cancelTask(@Req() r:Request,@Param('tenantKey') key:string,@Param('id') id:string){return this.erp(r,key).then(ctx=>this.ai.cancelTask(ctx,id));}
  @Get('tasks/:id/events') async taskEvents(@Req() r:Request,@Res() response:Response,@Param('tenantKey') key:string,@Param('id') id:string){
    const context=await this.erp(r,key);
    await this.ai.task(context,id);
    response.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'});
    response.flushHeaders();
    let closed=false,polling=false,last='';
    const close=()=>{closed=true;clearInterval(timer);if(!response.writableEnded)response.end();};
    const publish=async()=>{
      if(closed||polling)return;polling=true;
      try{
        const fresh=await this.erp(r,key);
        const task=await this.ai.task(fresh,id);
        if(closed)return;
        const result=task.result&&typeof task.result==='object'?task.result as {partialText?:unknown;progress?:unknown;message?:{content?:string;process?:unknown};version?:number}:null;
        // task() has revalidated resource, citation and tool access. Deliver its
        // authorized final message before closing; short replies can finish
        // between two progress polls and never have a running text event.
        const terminal=!['queued','running'].includes(task.status);
        const final=terminal&&task.kind==='message'&&result?.message&&Number.isInteger(result.version)?{message:result.message,version:result.version}:undefined;
        const payload={status:task.status,text:terminal?(final?.message.content??''):(typeof result?.partialText==='string'?result.partialText:''),progress:terminal?(final?.message.process??null):(result?.progress??null),...(final?{result:final}:{})};
        const serialized=JSON.stringify(payload);
        if(serialized!==last){response.write(`event: progress\ndata: ${serialized}\n\n`);last=serialized;}
        if(!['queued','running'].includes(task.status))close();
      }catch{if(!closed){response.write('event: denied\ndata: {}\n\n');close();}}
      finally{polling=false;}
    };
    const timer=setInterval(()=>{void publish();},350);
    response.on('close',close);
    void publish();
  }
  @Get('actions/:id') action(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.presentAction(ctx, id)); }
  @Post('actions/:id/confirm') confirm(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.confirm(ctx, id, b)); }
  @Post('actions/:id/cancel') cancel(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.cancel(ctx, id)); }
  @Get('shortages') shortages(@Req() r: Request, @Param('tenantKey') key: string) { return this.erp(r, key).then(ctx => this.ai.shortages(ctx)); }
  @Post('tasks') enqueue(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.enqueue(ctx, b)); }
  @Get('tasks') tasks(@Req() r:Request,@Param('tenantKey') key:string){return this.erp(r,key).then(ctx=>this.ai.tasks(ctx));}
  @Get('tasks/:id') task(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.task(ctx, id)); }
  @Post('analyze') analyze(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.analyze(ctx, b)); }
  @Get('risk-reviews/:type/:id') latestReview(@Req() r: Request, @Param('tenantKey') key: string, @Param('type') type: string, @Param('id') id: string) { return this.erp(r, key).then(ctx => this.ai.latestReview(ctx, type, id)); }
  @Post('risk-reviews') review(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.review(ctx, b)); }
  @Post('extract') extract(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.erp(r, key).then(ctx => this.ai.extract(ctx, b)); }
}
