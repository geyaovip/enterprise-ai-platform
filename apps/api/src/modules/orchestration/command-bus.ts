import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { APPLICATION_COMMANDS, CommandRegistry, fingerprint, type CommandResult } from './command-registry';
@Injectable()
export class CommandBus {
  constructor(private readonly db:PrismaService,private readonly auth:AuthService,@Inject(APPLICATION_COMMANDS)readonly registry:CommandRegistry){}
  async context(actor:RequestContext,appId:string,key:string){return this.auth.taskContext({tenantId:actor.tenantId,userId:actor.userId,membershipId:actor.membershipId,appId,taskId:key});}
  async execute(actor:RequestContext,appId:string,command:string,input:unknown,key:string,confirmed=false,fence?:{taskId:string;token:string}):Promise<CommandResult>{
    const ctx=await this.context(actor,appId,key),prepared=this.registry.prepare(ctx,command,input),hash=fingerprint({command,input:prepared.input});
    if(prepared.cmd.confirmation&&!confirmed)throw new ConflictException('此业务操作需要用户确认');
    return this.db.$transaction(async tx=>{
      if(fence){
        const rows=await tx.$queryRaw<Array<{status:string;leaseToken:string;leasedUntil:Date}>>`SELECT "status","leaseToken","leasedUntil" FROM "BusinessTask" WHERE id=${fence.taskId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
        if(!rows.length||rows[0].status!=='running'||rows[0].leaseToken!==fence.token||rows[0].leasedUntil<=new Date())throw new ConflictException('任务已取消或执行租约失效');
      }
      const member=await tx.membership.findFirst({where:{id:ctx.membershipId,tenantId:ctx.tenantId,userId:ctx.userId,active:true,user:{active:true},tenant:{active:true}}});
      const app=await tx.tenantApp.findUnique({where:{tenantId_appId:{tenantId:ctx.tenantId,appId}}});
      if(!member||member.role!==ctx.roles[0]||!app?.granted||!app.enabled)throw new ConflictException('执行权限已变化');
      // Serializes the same command identity across workers and processes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId+':'+appId+':'+key},0))`;
      const existing=await tx.applicationCommandReceipt.findUnique({where:{tenantId_appId_requestKey:{tenantId:ctx.tenantId,appId,requestKey:key}}});
      if(existing){if(existing.fingerprint!==hash||existing.command!==command)throw new ConflictException('幂等标识对应的参数不一致');return{state:'completed',result:existing.result as Prisma.InputJsonValue};}
      const result=await prepared.cmd.execute(tx,{...ctx,requestId:`command:${key}`},prepared.input);
      if(result.state==='completed'){
        await tx.applicationCommandReceipt.create({data:{tenantId:ctx.tenantId,appId,command,requestKey:key,fingerprint:hash,result:result.result}});
        await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId,requestId:`command:${key}`,action:`${appId}.public_command`,resourceType:'ApplicationCommandReceipt',resourceId:key,detail:{command}}});
      }
      return result;
    },{isolationLevel:'Serializable',timeout:15000});
  }
}
