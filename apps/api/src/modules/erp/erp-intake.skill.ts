import { ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SourceExtractionService, evidence, uncertainties } from '../ai/source-extraction.service';
import { matchSourceReference } from '../ai/source-matching';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { ownerFilter, positiveQty, money } from './erp.common';

const ref=z.object({code:z.string().trim().max(100).default(''),name:z.string().trim().max(160).default(''),evidence}).strict();
const resultSchema=z.object({party:ref,lines:z.array(z.object({sku:z.string().trim().max(100).default(''),name:z.string().trim().max(160).default(''),quantity:z.string().max(40).nullable(),unit:z.string().trim().max(20).default(''),unitPrice:z.string().max(40).nullable().default(null),currency:z.string().max(10).nullable().default(null),evidence}).strict()).max(50),note:z.string().max(2000).default(''),uncertainties}).strict();

@Injectable()
export class ErpIntakeSkill {
  constructor(private readonly sources:SourceExtractionService,private readonly db:PrismaService,private readonly auth:AuthService){}
  async intake(ctx:RequestContext,raw:unknown){
    const {kind,source}=readBody(z.object({kind:z.enum(['purchase','contract']),source:z.unknown()}).strict(),raw);
    const permission=kind==='purchase'?'erp.purchase.write':'erp.sales.write';
    await this.guard(ctx,permission);
    const extracted=await this.sources.extract(ctx,source,
      `从${kind==='purchase'?'采购需求/供应商报价':'销售需求/合同'}提取待核对明细。只提取实际订购数量，不以金额、规格数字、最小起订量代替。禁止默认用量为1。格式：{"party":{"code":"明确提供的往来编号或空串","name":"名称或空串","evidence":"依据"},"lines":[{"sku":"商品编号或空串","name":"名称或空串","quantity":"明确数量的十进制字符串或null","unit":"原始单位或空串","unitPrice":"明确含税人民币单价的十进制字符串或null","currency":"明确币种，如CNY，缺少填null","evidence":"依据"}],"note":"备注","uncertainties":[]}。总价不能当单价，不计算推导价格。只有资料明确含税的人民币单价才提取unitPrice，未税价/折扣后口径不明/其他币种填null并说明。超过50行或存在冲突时在uncertainties说明，不声称完整。`,resultSchema);
    // No master-data dump is sent to the model. Match only after extraction.
    const fresh=await this.guard(ctx,permission);
    const where={tenantId:ctx.tenantId,active:true,...(extracted.party.code?{code:extracted.party.code}:extracted.party.name?{name:extracted.party.name}:{id:{in:[]}})};
    const parties=kind==='purchase'?await this.db.erpSupplier.findMany({where,select:{id:true,code:true,name:true},take:2}):await this.db.erpCustomer.findMany({where:{...where,...ownerFilter(fresh)},select:{id:true,code:true,name:true},take:2});
    const p=matchSourceReference(parties,extracted.party.code,extracted.party.name,r=>r.code);
    const lines=[];
    for(const row of extracted.lines){
      const candidates=await this.db.erpProduct.findMany({where:{tenantId:ctx.tenantId,active:true,...(row.sku?{sku:row.sku}:row.name?{name:row.name}:{id:{in:[]}})},select:{id:true,sku:true,name:true,unit:true},take:2});
      const match=matchSourceReference(candidates,row.sku,row.name,r=>r.sku);
      const unitConflict=Boolean(match.record&&row.unit&&row.unit!==match.record.unit);
      const parsed=positiveQty.safeParse(row.quantity===null?NaN:Number(row.quantity));
      const price=money.safeParse(row.unitPrice);
      lines.push({...row,product:match.record,status:match.status,unitConflict,quantity:parsed.success&&!unitConflict&&Boolean(row.unit)?parsed.data:null,unitPrice:price.success&&row.currency==='CNY'&&row.unit&&!unitConflict?price.data:null});
    }
    return {kind,party:p.record,partyStatus:p.status,partyEvidence:extracted.party.evidence,lines,note:extracted.note,uncertainties:extracted.uncertainties,requiresReview:true};
  }
  private async guard(ctx:RequestContext,permission:string){
    const [fresh,cap]=await Promise.all([
      this.auth.taskContext({tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:'erp',taskId:ctx.requestId}),
      this.db.tenantCapability.findUnique({where:{tenantId_capability:{tenantId:ctx.tenantId,capability:'ai'}}}),
    ]);
    this.auth.require(fresh,permission);this.auth.require(fresh,'erp.ai.use');
    if(!cap?.enabled||!cap.delivered)throw new ConflictException('AI能力未启用');
    return fresh;
  }
}
