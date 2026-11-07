import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SourceExtractionService, evidence, uncertainties } from '../ai/source-extraction.service';
import { matchSourceReference } from '../ai/source-matching';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { MesService } from './mes.service';
import { decimal } from './mes.rules';

const ref=z.object({sku:z.string().trim().max(120).default(''),name:z.string().trim().max(120).default(''),evidence}).strict();
const resultSchema=z.object({product:ref,lines:z.array(ref.extend({quantity:z.string().max(40).nullable(),unit:z.string().trim().max(20).default(''),wastePercent:z.string().max(20).nullable(),parent:z.string().trim().max(120).default('')})).max(50),uncertainties}).strict();

@Injectable()
export class MesIntakeSkill {
  constructor(private readonly sources:SourceExtractionService,private readonly mes:MesService){}
  async intake(ctx:RequestContext,raw:unknown){
    const {source}=readBody(z.object({kind:z.literal('bom'),source:z.unknown()}).strict(),raw);
    await this.guard(ctx);
    const extracted=await this.sources.extract(ctx,source,
      '提取图纸明细表或物料文字中的BOM。格式：{"product":{"sku":"产品编号或空串","name":"产品名或空串","evidence":"依据"},"lines":[{"sku":"组件编号或空串","name":"组件名或空串","quantity":"每一件父产品的明确用量或null","unit":"资料单位或空串","wastePercent":"明确损耗百分比或null","parent":"明确父件编号或名称，没有则空串","evidence":"原文短句或图中明细行号"}],"uncertainties":[]}。图号、规格、序号不能当数量；一批总用量不能当单件用量；未标损耗填null。只提取可见的明细，不猜隐藏零件或从形状推断全套BOM。多层装配保持parent信息，不拍平成单层；多层或超过50行须说明待分层核对。',resultSchema);
    await this.guard(ctx);
    const resolve=async(row:{sku:string;name:string},production=false)=>{
      const rows=await this.mes.db.mesMaterial.findMany({where:{tenantId:ctx.tenantId,active:true,...(production?{kind:{in:['finished','semi']}}:{}),...(row.sku?{sku:row.sku}:row.name?{name:row.name}:{id:{in:[]}})},select:{id:true,sku:true,name:true,unit:true,kind:true},take:2});
      return matchSourceReference(rows,row.sku,row.name,(r:any)=>r.sku);
    };
    const product=await resolve(extracted.product,true),lines=[];
    for(const row of extracted.lines){
      const match=await resolve(row),material=match.record as any;
      const unitConflict=Boolean(material&&row.unit&&row.unit!==material.unit);
      const quantity=decimal.safeParse(row.quantity),waste=z.string().regex(/^\d{1,2}(?:\.\d{1,2})?$/).safeParse(row.wastePercent);
      const nested=Boolean(row.parent&&![extracted.product.sku,extracted.product.name].filter(Boolean).includes(row.parent));
      lines.push({...row,material,status:match.status,unitConflict,nested,quantity:quantity.success&&!unitConflict&&!nested&&Boolean(row.unit)?quantity.data:null,wastePercent:waste.success?waste.data:null});
    }
    return {kind:'bom',product:product.record,productStatus:product.status,productEvidence:extracted.product.evidence,lines,uncertainties:extracted.uncertainties,requiresReview:true};
  }
  private async guard(c:RequestContext){for(const p of ['mes.ai.use','mes.bom.write','mes.material.read'])await this.mes.guard(c,p);}
}
