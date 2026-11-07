import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SourceExtractionService, uncertainties } from '../ai/source-extraction.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { CrmCore } from './crm-core.service';
import { CrmSegmentService } from './segment.service';
import { CrmImportService } from './import.service';
import { RULE_TOOL_SCHEMA, RULE_WIRE_SCHEMA } from './crm-rules';
import { IMPORT_FIELDS } from './import-mapping';
import { problem, subtractDays } from './crm.common';

@Injectable()
export class CrmIntakeSkill {
  constructor(private readonly sources:SourceExtractionService,private readonly core:CrmCore,private readonly segments:CrmSegmentService,private readonly imports:CrmImportService){}
  async intake(ctx:RequestContext,raw:unknown){
    await this.core.guard(ctx,'crm.ai.use');
    const i=readBody(z.discriminatedUnion('kind',[
      z.object({kind:z.literal('segment'),source:z.object({text:z.string().trim().min(1).max(2000)}).strict()}).strict(),
      z.object({kind:z.literal('import_mapping'),batchId:z.uuid(),version:z.int().positive(),role:z.enum(['customer','order','item'])}).strict(),
    ]),raw);
    if(i.kind==='segment'){
      await this.core.guard(ctx,'crm.segment.read');
      const settings=await this.core.settings(ctx),now=this.core.now();
      const defaults={currency:settings.currency,windowStart:subtractDays(now,settings.windowDays).toISOString(),windowEnd:now.toISOString()};
      const result=await this.sources.extract(ctx,i.source,
        `把经营要求整理为客户筛选规则，不保存分群。格式：{"name":"简短名称","rule":规则或null,"windowDays":明确统计窗口天数或null,"uncertainties":[]}。统计最近N天的购买次数/净消费时用windowDays=N，由系统计算日期，不自行计算windowStart/windowEnd；“N天未购买”只用recencyDays条件，不改变统计窗口。只有用户明确起止日期才在rule给出日期。无法用支持字段表达或语义不明时rule=null并说明，不能删除难以表达的条件后扩大人群。只支持：${JSON.stringify(RULE_WIRE_SCHEMA)}。默认窗口及币种：${JSON.stringify(defaults)}。“超过/大于”用gt，“不少于/至少”用gte，“不超过”用lte，不改写边界。frequency/monetary为窗口内订单数/净消费；lifetimeOrderCount/lifetimeNetAmount为历史；recencyDays为距最近购买天数，无购买为null，不当0天。明确的金额阈值来自用户；“高价值”但无金额阈值时不得自设阈值。不猜渠道/标签UUID，未提供真实UUID时说明待人工选择。`,
        z.object({name:z.string().trim().min(1).max(100),rule:RULE_TOOL_SCHEMA.extend({currency:z.string().regex(/^[A-Z]{3}$/).optional()}).nullable(),windowDays:z.int().min(1).max(730).nullable().default(null),uncertainties}).strict());
      await this.core.guard(ctx,'crm.ai.use');
      if(!result.rule)return {kind:i.kind,...result,preview:null,requiresReview:true};
      const rule={...defaults,...result.rule,...(result.windowDays===null?{}:{windowStart:subtractDays(now,result.windowDays).toISOString(),windowEnd:now.toISOString()})};
      const preview=await this.segments.preview(ctx,{rule});
      await this.core.guard(ctx,'crm.ai.use');
      return {kind:i.kind,...result,rule:preview.normalizedRule,preview,requiresReview:true};
    }
    const batch=await this.imports.get(ctx,i.batchId,'crm.import.write');
    if(batch.version!==i.version)problem('VERSION_CONFLICT','导入批次已变化，请刷新后重试');
    const detail=await this.imports.detail(ctx,i.batchId),file=detail.files.find((f:any)=>f.role===i.role);
    if(!file?.headers?.length)problem('INVALID_STATE','请先上传此类文件');
    const result=await this.sources.extract(ctx,{text:JSON.stringify({headers:file.headers,targets:IMPORT_FIELDS[i.role]})},
      '只根据表头建议字段映射，不读取数据行。格式：{"fields":{"目标字段":"已有来源列名"},"uncertainties":[]}。不得把订单总金额/应付金额当成实付金额，不推断日期、币种、退款、状态值或组织。无法确定的字段不返回。一个来源列只能映射到一个目标字段。',
      z.object({fields:z.record(z.string(),z.string()),uncertainties}).strict());
    const used=new Set<string>();
    for(const [target,header]of Object.entries(result.fields)){
      if(!Object.hasOwn(IMPORT_FIELDS[i.role],target)||!file.headers.includes(header)||used.has(header))problem('INVALID_MAPPING','AI字段映射存在无效或重复列，请手动映射',400);
      used.add(header);
    }
    await this.core.guard(ctx,'crm.ai.use');
    const fresh=await this.imports.get(ctx,i.batchId,'crm.import.write');
    if(fresh.version!==i.version)problem('VERSION_CONFLICT','生成期间文件或映射已变化，请重新整理');
    return {kind:i.kind,...result,requiresReview:true};
  }
}
