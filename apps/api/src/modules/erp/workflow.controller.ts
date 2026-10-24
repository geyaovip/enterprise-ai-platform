import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../platform/auth.service';
import { readBody } from '../platform/security';
import { WorkflowService } from './workflow.service';
import { workflowKinds, type WorkflowKind } from './workflow.rules';
import { PurchaseService } from './purchase.service';
import { SalesService } from './sales.service';
import { CorrectionService } from './correction.service';
import { InvoiceService } from './invoice.service';
import { ReceiptService } from './receipt.service';
import { PrismaService } from '../prisma.service';
import { conflict, money } from './erp.common';

@Controller('api/v1/tenants/:tenantKey/erp')
export class WorkflowController {
 constructor(private readonly auth:AuthService,private readonly flows:WorkflowService,private readonly db:PrismaService,private readonly purchase:PurchaseService,private readonly sales:SalesService,private readonly correction:CorrectionService,private readonly invoice:InvoiceService,private readonly receipt:ReceiptService){}
 @Get('workflow-config')config(@Req()r:Request,@Param('tenantKey')k:string){return this.auth.context(r,k,'erp').then(c=>this.flows.config(c));}
 @Post('workflow-config')save(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.auth.context(r,k,'erp').then(c=>this.flows.saveConfig(c,b));}
 @Get('workflow-preview')preview(@Req()r:Request,@Param('tenantKey')k:string,@Query()q:unknown){const i=readBody(z.object({kind:z.enum(workflowKinds),amount:money}),q);return this.auth.context(r,k,'erp').then(c=>this.flows.preview(c,i.kind,i.amount));}
 @Get('workflows')list(@Req()r:Request,@Param('tenantKey')k:string,@Query()q:unknown){return this.auth.context(r,k,'erp').then(c=>this.flows.list(c,q));}
 @Get('workflows/by-source/:kind/:id')async source(@Req()r:Request,@Param('tenantKey')k:string,@Param('kind')kind:WorkflowKind,@Param('id')id:string){const c=await this.auth.context(r,k,'erp');const f=await this.db.erpWorkflow.findUnique({where:{tenantId_kind_resourceId:{tenantId:c.tenantId,kind:readBody(z.enum(workflowKinds),kind),resourceId:readBody(z.uuid(),id)}}});return{flow:f?await this.flows.get(c,f.id):null};}
 @Get('workflows/:id')get(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string){return this.auth.context(r,k,'erp').then(c=>this.flows.get(c,id));}
 @Post('workflows/:id/control')control(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){return this.auth.context(r,k,'erp').then(c=>this.flows.control(c,id,b));}
 @Post('workflows/:id/review')async review(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){
  const input=readBody(z.object({version:z.int().positive(),decision:z.enum(['approve','reject']),reason:z.string().trim().min(1).max(500).optional(),invoiceNumber:z.string().trim().min(1).max(100).optional()}),b);
  const ctx=await this.auth.context(r,k,'erp');const f=await this.flows.get(ctx,id);if(f.version!==input.version||!f.canProcess)conflict('流转已变化或当前不由你处理');if(input.decision==='reject'&&!input.reason)conflict('退回需要填写原因');
  const c={...ctx,workflowVersion:input.version};const approved=input.decision==='approve';
  if(f.kind==='purchase'){const s=await this.purchase.get(c,f.resourceId);return approved?this.purchase.confirm(c,s.id,{version:s.version}):this.purchase.reject(c,s.id,{version:s.version,reason:input.reason});}
  if(f.kind==='sales'){const s=await this.sales.get(c,f.resourceId);return approved?this.sales.confirm(c,s.id,{version:s.version}):this.sales.reject(c,s.id,{version:s.version,reason:input.reason});}
  if(f.kind==='purchase_change'){const s=await this.purchase.get(c,f.parentResourceId!);return this.purchase.reviewChange(c,s.id,f.resourceId,input.decision,{version:s.version,reason:input.reason});}
  if(f.kind.startsWith('return_')){const s=await this.correction.getReturn(c,f.resourceId);return this.correction.reviewReturn(c,s.id,{version:s.version,decision:input.decision,reason:input.reason});}
  if(f.kind==='invoice'){if(approved&&!input.invoiceNumber)conflict('登记开票需填写内部编号');return approved?this.invoice.register(c,f.resourceId,{invoiceNumber:input.invoiceNumber}):this.invoice.reject(c,f.resourceId,{reason:input.reason});}
  const s=await this.db.erpIncomingReceipt.findFirstOrThrow({where:{id:f.parentResourceId!,tenantId:c.tenantId}});return this.receipt.review(c,s.id,f.resourceId,input.decision,{version:s.version,reason:input.reason});
 }
}
