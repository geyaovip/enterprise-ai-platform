import {Injectable} from '@nestjs/common';
import type {RequestContext} from '../platform/context';
import {CrmCore} from './crm-core.service';
import {CrmMetricsService} from './metrics.service';
import {CrmEngagementService} from './engagement.service';
import {SEGMENT_TEMPLATES,defaultRule,normalizeRule,matches} from './crm-rules';
import {currency,parse} from './crm.common';

export const OPERATION_SCENARIOS = [
 {id:'T-01',title:'高价值客户唤醒',goal:'核对沉睡原因，记录客户需求与下一步跟进安排。',planText:'先查看历史购买与服务记录，确认客户当前需求，再由负责人逐一联系。\n沟通参考：近期使用体验如何？是否有需要协助解决的问题？\n根据客户反馈安排后续服务；本方案不承诺优惠或自动发送消息。',checklist:[{stableId:'review',text:'核对历史购买、服务记录与联系资格'},{stableId:'contact',text:'人工沟通，了解沉睡原因与当前需求'},{stableId:'record',text:'逐客户记录处理结果和下一步安排'}]},
 {id:'T-02',title:'首购客户回访',goal:'了解首次购买体验，识别复购意向与服务问题。',planText:'先核对首次订单与售后，再进行人工回访。\n沟通参考：首次使用是否顺利？目前还有哪些需求？\n存在售后问题时先处理服务，再讨论后续购买，不自动发券。',checklist:[{stableId:'review',text:'核对首次订单及售后情况'},{stableId:'contact',text:'了解使用体验和后续需求'},{stableId:'record',text:'记录回访结果；需要跟进的客户设置下次时间'}]},
 {id:'T-03',title:'活跃客户需求维护',goal:'收集近期购买客户的需求与服务反馈。',planText:'根据近期订单检查服务情况，人工收集反馈和后续需求。\n沟通参考：近期使用体验和服务是否符合预期？\n按客户反馈安排后续联系，不将意向记为已成交。',checklist:[{stableId:'review',text:'核对近期订单与服务记录'},{stableId:'contact',text:'人工了解使用反馈和新需求'},{stableId:'record',text:'记录客户结果和下一步安排'}]},
 {id:'T-04',title:'新客需求引导',goal:'了解尚未购买客户的需求，安排适合的后续沟通。',planText:'先核对来源和客户需求，选择适合的人工沟通方式。\n沟通参考：您关注哪些产品或服务？有哪些选型问题需要协助？\n未能联系或暂不需要的客户如实记录，不自动触达。',checklist:[{stableId:'review',text:'核对客户来源及需求'},{stableId:'contact',text:'人工了解选型问题与购买意向'},{stableId:'record',text:'记录结果及后续跟进时间'}]}
];
@Injectable()
export class CrmGrowthService {
 constructor(readonly core:CrmCore,readonly metrics:CrmMetricsService,readonly engagement:CrmEngagementService){}
 async board(ctx:RequestContext,q:any={}){
  const a=await this.core.guard(ctx,'crm.customer.read'),settings=await this.core.settings(ctx),unit=parse(currency,q.currency??settings.currency),result:any={asOf:this.core.now(),currency:unit,scenarios:[],signals:[],notice:'规则筛选提示可跟进的机会；方案由负责人核对，处理反馈与订单观察分别记录。'};
  if(a.permissions.includes('crm.segment.read')){
   const r=await this.metrics.read(ctx,{...defaultRule(),currency:unit},'crm.segment.read');result.metadata=r.metadata;
   result.scenarios=SEGMENT_TEMPLATES.map(t=>{const rule={...t.rule,currency:unit},normalized=normalizeRule({...rule,windowStart:r.normalizedRule.windowStart,windowEnd:r.normalizedRule.windowEnd},new Date(r.metadata.asOf));return {...t,rule,memberCount:r.records.filter((row:any)=>matches(row,normalized)).length,plan:OPERATION_SCENARIOS.find(s=>s.id===t.id),canCreate:a.permissions.includes('crm.task.write')};});
  }
  if(a.permissions.includes('crm.sales.read')){const r=await this.engagement.opportunities(ctx,{overdue:'true',page_size:1});result.signals.push({id:'overdue-opportunities',title:'商机行动已到期',count:r.total,path:'/opportunities?overdue=true',description:'未赢单、未丢单且下一行动时间已到的商机'});}
  if(a.permissions.includes('crm.service.read')){const [plans,risks]=await Promise.all([this.engagement.plans(ctx,{endingWithinDays:'30',page_size:1}),this.engagement.risks(ctx,{status:'open',page_size:1})]);result.signals.push({id:'renewals',title:'30天内服务到期',count:plans.total,path:'/service?endingWithinDays=30',description:'当前有效且未来30天内结束的服务计划'},{id:'service-risks',title:'未关闭服务风险',count:risks.total,path:'/service?tab=risks&status=open',description:'当前岗位可见的未关闭客户服务风险'});}
  return result;
 }
}
