import { ManufacturingService } from '../manufacturing/manufacturing.service';
import {ConnectorBusinessQueries} from './business-queries.service';
import {CrmConnectorQueries} from './crm-queries.service';
import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Request } from 'express';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestContext } from '../platform/context';
import { PrismaService } from '../prisma.service';
import { MasterService } from '../erp/master.service';
import { PurchaseService } from '../erp/purchase.service';
import { ReplenishmentService } from '../erp/replenishment.service';
import { CrmMetricsService } from '../crm/metrics.service';
import { CrmSegmentService } from '../crm/segment.service';
import { MesService } from '../mes/mes.service';
import { ContentService } from '../content/content.service';
import { GeoService } from '../geo/geo.service';
import type { reportFor } from '../geo/geo.metrics';
import { CommandBus } from '../orchestration/command-bus';
import { fingerprint } from '../orchestration/command-registry';
import { RULE_TOOL_SCHEMA } from '../crm/crm-rules';
import { taskDraftSchema } from '../crm/operation-task.service';
import { planDraft } from '../mes/mes.rules';
import { positiveQty, money } from '../erp/erp.common';
import { readBody } from '../platform/security';
import { ConnectorAuthService } from './connector-auth.service';
import { ConnectorExecutionService, contentQuoteInput, geoQuoteInput } from './connector-execution.service';
import { canExecute, publicOrigin, supportsDraft, type ConnectorApp, type DraftConnectorApp } from './connector-policy';

const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const paging=z.object({page:z.int().min(1).max(10000).default(1),page_size:z.int().min(1).max(100).default(20),q:z.string().max(100).default('')}).strict();
const contentPaging=paging.omit({page_size:true});
const purchaseDraft=z.object({number:z.string().trim().min(1).max(80).optional(),supplierId:z.uuid(),lines:z.array(z.object({productId:z.uuid(),quantity:positiveQty,unitPrice:money.optional()}).strict()).min(1).max(100)}).strict();
const COMMANDS={erp:'erp.purchase.create_draft',crm:'crm.task.create_draft',mes:'mes.plan.create_draft'};
type Tool={name:string;description:string;schema:z.ZodObject<any>;permission?:string;roles?:string[];draft?:boolean;scope?:string;readOnly:boolean;run:(input:any)=>Promise<unknown>};
const quoteIdInput=z.object({quoteId:z.uuid()}).strict();

@Injectable()
export class ConnectorBusinessService {
  constructor(readonly db:PrismaService,readonly access:ConnectorAuthService,readonly master:MasterService,readonly purchase:PurchaseService,readonly inventory:ReplenishmentService,readonly metrics:CrmMetricsService,readonly segments:CrmSegmentService,readonly mes:MesService,readonly bus:CommandBus,readonly crmQueries:CrmConnectorQueries,readonly queries:ConnectorBusinessQueries,readonly content:ContentService,readonly geo:GeoService,readonly execution:ConnectorExecutionService,readonly manufacturing:ManufacturingService){}

  tools(app:ConnectorApp,grant:any,ctx:RequestContext):Tool[]{
    const tools:Tool[]=[{name:'ark_context',description:'查询本次连接的企业、应用与授权范围；权限由服务端确定。',schema:z.object({}).strict(),readOnly:true,run:async()=>({appId:app,tenantKey:ctx.tenantKey,scopes:grant.scopes,permissions:ctx.permissions.filter(p=>p.startsWith(app+'.')),modelInvocation:false})}];
    if(supportsDraft(app))tools.push(
      {name:'ark_action_status',description:'查询本连接准备的操作状态与真实业务回执。结果未知时先查询，不重复提交。',schema:z.object({actionId:z.uuid()}).strict(),readOnly:true,run:i=>this.actionStatus(grant,ctx,i.actionId)}
    );
    if(app==='content')tools.push(
      {name:'content_projects',description:'分页搜索有权品牌内容项目的名称与更新时间。',schema:contentPaging,permission:'content.read',readOnly:true,run:i=>this.contentProjects(ctx,i)},
      {name:'content_assets',description:'按真实项目ID分页读取可见素材的名称、格式与尺寸；省略项目ID时读取企业共享素材。文件需在工作台预览或下载。',schema:contentPaging.extend({projectId:z.uuid().optional()}),permission:'content.read',readOnly:true,run:i=>this.contentAssets(ctx,i)},
      {name:'content_quote_generation',description:'核对图片、参考改图或视频生成参数，返回模型、数量、费用状态与有效期。费用可能未知。向用户展示范围并在对话中确认；预览不提交生成。',schema:contentQuoteInput,permission:'content.create',scope:'content.execute',readOnly:false,run:i=>this.execution.contentQuote(grant.id,ctx,i)},
      {name:'content_submit_generation',description:'仅在用户明确同意本次预览的生成范围和费用状态后提交。使用同一quoteId重试；超时先回查，避免重复付费。返回排队任务。',schema:quoteIdInput,permission:'content.create',scope:'content.execute',readOnly:false,run:i=>this.execution.submit(app,grant.id,ctx,i.quoteId)},
      {name:'content_generation_status',description:'按本连接的quoteId查询生成批次及单项状态、可见素材ID。待处理和结果未知都不表示完成。',schema:quoteIdInput,permission:'content.read',readOnly:true,run:i=>this.execution.status(app,grant.id,ctx,i.quoteId)}
    );
    if(app==='manufacturing')tools.push(
      {name:'manufacturing_orders',description:'按订单号、客户或成品查询制造订单，区分接单、成品入库和发货数量。',schema:paging.omit({page_size:true}).extend({q:z.string().max(80).default('')}),permission:'manufacturing.read',readOnly:true,run:i=>this.manufacturing.orders(ctx,i)},
      {name:'manufacturing_order_status',description:'按真实订单ID查询BOM版本、缺料、锁定、在途、生产审核进度和出入库摘要。',schema:z.object({id:z.uuid()}).strict(),permission:'manufacturing.read',readOnly:true,run:i=>this.manufacturingStatus(ctx,i.id)},
      {name:'manufacturing_stock',description:'按仓库及物料搜索实际库存、锁定、可用量与安全库存预警。',schema:paging.omit({page_size:true}).extend({q:z.string().max(80).default(''),warehouseId:z.uuid().optional(),alerts:z.boolean().default(false)}),permission:'manufacturing.read',readOnly:true,run:i=>this.manufacturingStock(ctx,i)},
      {name:'manufacturing_trace',description:'按精确批次或序列号查询在库位置、出入库和生产耗用关联。相同码可对应不同SKU。',schema:z.object({code:z.string().trim().min(1).max(100)}).strict(),permission:'manufacturing.read',readOnly:true,run:i=>this.manufacturing.scan(ctx,i.code)}
    );
    if(app==='geo')tools.push(
      {name:'geo_projects',description:'分页搜索获授权的GEO项目、品牌、地域和语言。',schema:paging,permission:'geo.read',readOnly:true,run:i=>this.geoProjects(ctx,i)},
      {name:'geo_reports',description:'分页读取指定项目已有分析的状态和报告ID，不启动分析。',schema:paging.extend({projectId:z.uuid()}),permission:'geo.read',readOnly:true,run:i=>this.geo.analyses(ctx,i.projectId,i)},
      {name:'geo_report_summary',description:'按真实分析ID读取已保存报告的样本口径、评分、竞品缺席摘要、引用域名和复测可比性，不启动模型。',schema:z.object({id:z.uuid()}).strict(),permission:'geo.read',readOnly:true,run:i=>this.geoReportSummary(ctx,i.id)},
      {name:'geo_analysis_options',description:'列出指定项目的启用题目、联网要求及已配置的模型，使用真实ID选择分析范围。',schema:contentPaging.omit({q:true}).extend({projectId:z.uuid()}),permission:'geo.analysis.run',scope:'geo.execute',readOnly:true,run:i=>this.geoAnalysisOptions(ctx,i.projectId,i.page)},
      {name:'geo_quote_analysis',description:'核对题组、模型和用户预算上限，返回人民币微元估价、可运行及跳过组合。向用户展示并在对话中确认；预览不启动模型。',schema:geoQuoteInput,permission:'geo.analysis.run',scope:'geo.execute',readOnly:false,run:i=>this.execution.geoQuote(grant.id,ctx,i)},
      {name:'geo_submit_analysis',description:'仅在用户明确同意本次预览的题组、模型与费用后提交。使用同一quoteId重试，超时先回查。返回排队任务。',schema:quoteIdInput,permission:'geo.analysis.run',scope:'geo.execute',readOnly:false,run:i=>this.execution.submit(app,grant.id,ctx,i.quoteId)},
      {name:'geo_analysis_status',description:'按本连接的quoteId查询是否已提交、真实任务状态和已知费用。完成后用geo_report_summary解读报告。',schema:quoteIdInput,permission:'geo.read',readOnly:true,run:i=>this.execution.status(app,grant.id,ctx,i.quoteId)}
    );
    if(app==='erp')tools.push(
      {name:'erp_master_search',description:'分页查询有权商品或供应商的稳定ID、名称、编码及采购字段；不返回联系人或联系方式。',schema:paging.extend({kind:z.enum(['products','suppliers'])}),permission:'erp.purchase.read',readOnly:true,run:async i=>{const r=await (i.kind==='products'?this.master.products(ctx,{page:i.page,page_size:i.page_size,q:i.q}):this.master.suppliers(ctx,{page:i.page,page_size:i.page_size,q:i.q}));return {...r,items:r.items.map((x:any)=>i.kind==='products'?{id:x.id,sku:x.sku,name:x.name,unit:x.unit,purchasePrice:x.purchasePrice,active:x.active}:{id:x.id,code:x.code,name:x.name,active:x.active})};}},
      {name:'erp_inventory_overview',description:'查询有权商品的在库、待发、在途和补货量；仅返回当前页，注明总行数和计算时点。',schema:paging,permission:'erp.inventory.read',readOnly:true,run:async i=>{const r:any=await this.inventory.metric(ctx,{metric:'inventory'});const rows=r.items.filter((x:any)=>!i.q||[x.sku,x.name].some(v=>v.toLowerCase().includes(i.q.toLowerCase())));return {...r,items:rows.slice((i.page-1)*i.page_size,i.page*i.page_size),total:rows.length,page:i.page,page_size:i.page_size};}},
      {name:'erp_purchase_list',description:'分页查询当前企业有权采购单及真实状态，不把审批通过视为入库。',schema:paging.extend({status:z.string().max(40).optional()}),permission:'erp.purchase.read',readOnly:true,run:i=>this.queries.purchaseList(ctx,i)},
      {name:'erp_prepare_purchase_draft',description:'准备采购草稿提案。使用真实供应商和商品ID；不直接创建采购单。把confirmationUrl交给用户确认，再用ark_action_status回查。重试复用requestKey。',schema:z.object({requestKey:z.uuid(),draft:purchaseDraft}).strict(),permission:'erp.purchase.write',draft:true,readOnly:false,run:i=>this.prepare(grant,ctx,app,i.draft,i.requestKey)}
    );
    if(app==='erp')tools.push(
      {name:'erp_customers',description:'分页搜索当前岗位有权ERP客户的编号、名称和归属，无联系方式；ERP与CRM身份独立。',schema:paging.extend({id:z.uuid().optional()}),permission:'erp.master.read',roles:['admin','sales','finance'],readOnly:true,run:i=>this.queries.customers(ctx,i)},
      {name:'erp_opportunities',description:'分页查询ERP商机、客户ID、阶段和预计金额；销售仅限自己的对象，预计金额不是收入。',schema:paging.extend({id:z.uuid().optional(),customerId:z.uuid().optional()}),permission:'erp.master.read',roles:['admin','sales','finance'],readOnly:true,run:i=>this.queries.opportunities(ctx,i)},
      {name:'erp_opportunity_follow_ups',description:'分页查询真实ERP商机的跟进历史和下一行动时间；查询不新增跟进或发送通知。',schema:paging.omit({q:true}).extend({id:z.uuid()}),permission:'erp.master.read',roles:['admin','sales','finance'],readOnly:true,run:i=>this.queries.followUps(ctx,i)},
      {name:'erp_purchase_detail',description:'按真实ID查询采购单状态、商品行、已收数量、期限和版本。确认或审批不等于入库。',schema:z.object({id:z.uuid()}).strict(),permission:'erp.purchase.read',readOnly:true,run:i=>this.queries.document(ctx,'purchase',i.id)},
      {name:'erp_sales_list',description:'分页查询有权销售合同状态、金额与客户，支持状态和客户ID筛选。',schema:paging.extend({status:z.string().max(40).optional(),partyId:z.uuid().optional()}),permission:'erp.sales.read',readOnly:true,run:i=>this.queries.salesList(ctx,i)},
      {name:'erp_sales_detail',description:'按真实ID查询有权销售合同商品行、已发数量和版本，不返回交付地址或联系人。',schema:z.object({id:z.uuid()}).strict(),permission:'erp.sales.read',readOnly:true,run:i=>this.queries.document(ctx,'sales',i.id)},
      {name:'erp_inventory_balances',description:'分页查询商品在库、预留、可用量及可选仓库数量。企业汇总可用量不能当作指定仓库可用量。',schema:paging.extend({warehouseId:z.uuid().optional()}),permission:'erp.inventory.read',readOnly:true,run:i=>this.queries.balances(ctx,i)},
      {name:'erp_stock_movements',description:'分页查询库存出入流水、来源单据和成本依据；q搜索出入库单号，from/to筛选UTC创建时间。',schema:paging.extend({from:z.iso.datetime().optional(),to:z.iso.datetime().optional()}),permission:'erp.inventory.read',readOnly:true,run:i=>this.queries.movements(ctx,i)},
      {name:'erp_accounts',description:'分页查询财务岗位有权应收或应付、已结与未结额；不返回银行/付款凭据，不执行收付款。ERP账款单位CNY。',schema:paging.extend({kind:z.enum(['receivables','payables']),id:z.uuid().optional(),status:z.string().max(40).optional(),partyId:z.uuid().optional()}),permission:'erp.finance.read',readOnly:true,run:i=>this.queries.accounts(ctx,i)}
    );
    if(app==='crm')tools.push(
      {name:'crm_metrics',description:'查询有权客户的购买、净消费与复购指标，明确币种、窗口和分母，不返回联系方式。',schema:z.object({rule:RULE_TOOL_SCHEMA.optional()}).strict(),permission:'crm.analytics.read',readOnly:true,run:i=>this.metrics.overview(ctx,i.rule)},
      {name:'crm_preview_segment',description:'按类型化规则计算并保存不可变人群预览，返回真实人数、evaluationId、previewHash及有效期；不发送消息。',schema:z.object({rule:RULE_TOOL_SCHEMA}).strict(),permission:'crm.segment.read',draft:true,readOnly:false,run:i=>this.segments.preview(ctx,i)},
      {name:'crm_prepare_task_draft',description:'准备客户运营任务草稿提案。目标人群使用真实预览；用户确认后仅保存草稿，不群发、提交或启动运营。',schema:z.object({requestKey:z.uuid(),draft:taskDraftSchema}).strict(),permission:'crm.task.write',draft:true,readOnly:false,run:i=>this.prepare(grant,ctx,app,i.draft,i.requestKey)}
    );
    if(app==='crm')tools.push(
      {name:'crm_growth_opportunities',description:'查询当前岗位可见的规则经营机会、可编辑回访方案、到期商机及服务风险。仅查询，不保存人群或调用模型。',schema:z.object({currency:z.enum(['CNY','USD','EUR','HKD']).optional()}).strict(),permission:'crm.customer.read',readOnly:true,run:i=>this.crmQueries.growth.board(ctx,i)},
      {name:'crm_customers',description:'分页搜索当前有权客户及购买指标。获取真实客户ID；无明文联系方式。',schema:paging,permission:'crm.customer.read',readOnly:true,run:i=>this.crmQueries.customerList(ctx,i)},
      {name:'crm_customer_detail',description:'查询真实客户ID的档案、脱敏联系方式与指定币种购买指标；不合并其他应用或渠道身份。',schema:z.object({id:z.uuid(),currency:z.enum(['CNY','USD','EUR','HKD']).optional()}).strict(),permission:'crm.customer.read',readOnly:true,run:i=>this.crmQueries.customerDetail(ctx,i)},
      {name:'crm_customer_orders',description:'分页查询指定有权客户的CRM订单与商品明细，附状态、退款和币种。金额为主货币单位，不等于收入。',schema:paging.omit({q:true}).extend({customerId:z.uuid()}),permission:'crm.customer.read',readOnly:true,run:i=>this.crmQueries.orders(ctx,i)},
      {name:'crm_segments',description:'分页读取已保存的分群规则；不会重新计算或保存预览。需要真实目标名单时使用crm_preview_segment。',schema:paging.omit({q:true}).extend({status:z.enum(['active','archived']).default('active')}),permission:'crm.segment.read',readOnly:true,run:i=>this.crmQueries.segmentList(ctx,i)},
      {name:'crm_tasks',description:'分页查询运营任务状态、目标人数、期限和负责人。超过当前同步扫描范围会明确标记truncated，不能当全量。',schema:paging.omit({q:true}).extend({status:z.enum(['draft','pending_confirmation','ready','in_progress','completed','cancelled']).optional(),mine:z.enum(['true','false']).default('false')}),permission:'crm.task.read',readOnly:true,run:i=>this.crmQueries.taskList(ctx,i)},
      {name:'crm_task_detail',description:'读取有权任务的方案和最近100条日志；更早逐客户结果使用crm_task_customers。部分客户不可见时隐藏整个方案。',schema:z.object({id:z.uuid()}).strict(),permission:'crm.task.read',readOnly:true,run:i=>this.crmQueries.taskDetail(ctx,i)},
      {name:'crm_task_customers',description:'分页读取任务冻结名单中当前有权客户的人工处理结果、待跟进时间与待处理人数，不代表外部送达或成交。',schema:paging.omit({q:true}).extend({id:z.uuid(),status:z.enum(['pending','contacted','unreachable','interested','declined','follow_up','skipped']).optional()}),permission:'crm.task.read',readOnly:true,run:i=>this.crmQueries.taskCustomers(ctx,i)},
      {name:'crm_task_results',description:'查询任务基准与观察窗口的实际购买变化，币种和窗口明确；不作营销归因。',schema:z.object({id:z.uuid()}).strict(),permission:'crm.analytics.read',readOnly:true,run:i=>this.crmQueries.tasks.results(ctx,i.id)},
      {name:'crm_leads',description:'分页查询授权销售线索。联系方式只脱敏展示，不能把线索意向视为成交。',schema:paging.extend({status:z.string().max(40).optional()}),permission:'crm.sales.read',readOnly:true,run:i=>this.crmQueries.leads(ctx,i)},
      {name:'crm_lead_detail',description:'按真实ID读取有权线索状态、需求及负责人，无明文联系方式或审核内部数据。',schema:z.object({id:z.uuid()}).strict(),permission:'crm.sales.read',readOnly:true,run:i=>this.crmQueries.lead(ctx,i)},
      {name:'crm_opportunities',description:'分页查询销售商机、币种、下一行动及期限。overdue=true只查行动已到期的未结束商机；预计金额不是实收。',schema:paging.extend({customerId:z.uuid().optional(),stage:z.string().max(40).optional(),overdue:z.enum(['true','false']).default('false')}),permission:'crm.sales.read',readOnly:true,run:i=>this.crmQueries.opportunities(ctx,i)},
      {name:'crm_opportunity_detail',description:'读取有权销售商机的阶段、预计金额、行动与客户ID。',schema:z.object({id:z.uuid()}).strict(),permission:'crm.sales.read',readOnly:true,run:i=>this.crmQueries.opportunity(ctx,i)},
      {name:'crm_follow_ups',description:'分页查询指定客户、线索或商机在明确渠道的跟进记录和待办；先获取真实对象与渠道ID。',schema:paging.omit({q:true}).extend({targetType:z.enum(['customer','lead','opportunity']),targetId:z.uuid(),channelId:z.uuid()}),permission:'crm.followup.read',readOnly:true,run:i=>this.crmQueries.followUps(ctx,i)},
      {name:'crm_service_records',description:'分页查询有权服务计划及执行状态，或服务风险。endingWithinDays仅用于plans，status仅用于risks。到期不等于已续约。',schema:paging.omit({q:true}).extend({kind:z.enum(['plans','risks']),customerId:z.uuid().optional(),endingWithinDays:z.int().min(1).max(365).optional(),status:z.enum(['open','closed']).optional()}),permission:'crm.service.read',readOnly:true,run:i=>this.crmQueries.service(ctx,i)}
    );
    if(app==='crm')tools.push(
      {name:'crm_workbench',description:'查询本人线索、商机、跟进和服务待办摘要。complete=false，展示子集有限；不能把展示数量当企业全量。',schema:z.object({}).strict(),permission:'crm.customer.read',readOnly:true,run:()=>this.crmQueries.workbench(ctx)},
      {name:'crm_sales_pools',description:'分页读取CRM销售管理岗位有权的销售池与成员配置，不修改分配或归属。',schema:paging.omit({q:true}),permission:'crm.sales.manage',readOnly:true,run:i=>this.crmQueries.pools(ctx,i)}
    );
    const mesTypes=['materials','boms','plans','orders','reports'].filter(t=>ctx.permissions.includes(t==='materials'?'mes.material.read':t==='boms'?'mes.bom.read':t==='reports'?'mes.report.read':'mes.production.read'));
    const mesInspectTypes=['material','bom','plan','order','report'].filter(t=>ctx.permissions.includes(t==='material'?'mes.material.read':t==='bom'?'mes.bom.read':t==='report'?'mes.report.read':'mes.production.read'));
    if(app==='mes')tools.push(
      {name:'mes_production_overview',description:'查询有权范围的生产进度、逾期、待审核与不良，区分报工和审核。',schema:z.object({}).strict(),permission:'mes.production.read',readOnly:true,run:()=>this.mes.dashboard(ctx)},
      {name:'mes_list_records',description:'分页查询有权物料、BOM、计划、工单或报工，非物料列表支持status；reports可按orderId、orders可按planId筛选。各类对象独立鉴权。',schema:paging.extend({type:z.enum((mesTypes.length?mesTypes:['orders']) as [string,...string[]]),status:z.string().max(40).optional(),orderId:z.uuid().optional(),planId:z.uuid().optional()}).superRefine((i,c)=>{if(i.status&&i.type==='materials'||i.orderId&&i.type!=='reports'||i.planId&&i.type!=='orders')c.addIssue({code:'custom',message:'status用于非materials；orderId仅用于reports，planId仅用于orders'});}),permission:'mes.production.read',readOnly:true,run:i=>this.queries.mesList(ctx,i)},
      {name:'mes_inspect',description:'按真实ID查询有权物料、BOM、计划、工单或报工。关联工单/报工最多50条并注明总数，更多使用mes_list_records分页。',schema:z.object({type:z.enum((mesInspectTypes.length?mesInspectTypes:['order']) as [string,...string[]]),id:z.uuid()}).strict(),permission:'mes.production.read',readOnly:true,run:i=>this.queries.mesInspect(ctx,i)},
      {name:'mes_preview_plan',description:'对当前已发布BOM进行确定性多级需求展开，不查询ERP库存，不保存或派工。',schema:planDraft,permission:'mes.plan.write',draft:true,readOnly:true,run:i=>this.mes.planPreview(ctx,i)},
      {name:'mes_prepare_plan_draft',description:'准备生产计划草稿提案并展示确定性需求。确认后仅保存草稿，不发布、派工或报工。',schema:z.object({requestKey:z.uuid(),draft:planDraft}).strict(),permission:'mes.plan.write',draft:true,readOnly:false,run:i=>this.prepare(grant,ctx,app,i.draft,i.requestKey)}
    );
    const scopes=grant.scopes as string[];
    return tools.filter(t=>(!t.permission||ctx.permissions.includes(t.permission))&&(!t.roles||t.roles.some(role=>ctx.roles.includes(role)))&&(!t.draft||scopes.includes(app+'.draft'))&&(!t.scope||(scopes.includes(t.scope)&&canExecute(app,ctx.permissions))));
  }
  private async manufacturingStock(ctx: RequestContext, input: { page: number; q: string; warehouseId?: string; alerts: boolean }) {
    const { warehouses, warehouseId, items, total, page, page_size } = await this.manufacturing.stock(ctx, { ...input, alerts: String(input.alerts) });
    return { warehouses, warehouseId, items, total, page, page_size, hasMore: page * page_size < total, asOf: new Date() };
  }

  private async manufacturingStatus(ctx: RequestContext, id: string) {
    const order = await this.manufacturing.order(ctx, id);
    return {
      id: order.id, number: order.number, customer: order.customerName, product: order.productName,
      quantity: order.quantity, completedQty: order.completedQty, shippedQty: order.shippedQty,
      dueDate: order.dueDate, bomRevision: order.bomRevision, warehouse: order.warehouse,
      requirements: order.requirements.slice(0, 100), totalRequirements: order.requirements.length,
      purchases: order.purchases.slice(-50).map(p => ({ number: p.number, status: p.status, supplier: p.supplier.name })),
      plan: order.plan ? { startDate: order.plan.startDate, dueDate: order.plan.dueDate, status: order.plan.status, ...order.production } : null,
      documents: order.documents.slice(-25).map(d => ({ number: d.number, kind: d.kind, createdAt: d.createdAt })),
      totalDocuments: order.documents.length, totalPurchases: order.purchases.length,
      asOf: new Date(), destination: publicOrigin()+'/t/'+encodeURIComponent(ctx.tenantKey)+'/manufacturing/orders/'+id,
    };
  }
  private async contentProjects(ctx:RequestContext,input:z.infer<typeof contentPaging>){
    const result=await this.content.projects(ctx,input);
    return {...result,items:result.items.map(({id,name,version,updatedAt})=>({id,name,version,updatedAt}))};
  }
  private async contentAssets(ctx:RequestContext,input:z.infer<typeof contentPaging>&{projectId?:string}){
    const {items,page,pageSize}=await this.content.assets(ctx,input);
    return {page,pageSize,items:items.map(({id,filename,mime,width,height,createdAt})=>({id,filename,mime,width,height,createdAt}))};
  }
  private async geoProjects(ctx:RequestContext,input:z.infer<typeof paging>){
    const result=await this.geo.projects(ctx,input);
    return {...result,items:result.items.map(({id,name,brandName,country,language,timezone,active})=>({id,name,brandName,country,language,timezone,active}))};
  }
  private async geoAnalysisOptions(ctx:RequestContext,projectId:string,page:number){
    const [questions,models]=await Promise.all([this.geo.questions(ctx,projectId),this.geo.models(ctx)]);
    const enabledQuestions=questions.filter(q=>q.enabled),enabledModels=models.filter(m=>m.enabled);
    const start=(page-1)*20,end=page*20;
    return {page,pageSize:20,questionCount:enabledQuestions.length,modelCount:enabledModels.length,
      questions:enabledQuestions.slice(start,end).map(({id,text,category,nativeWebSearch})=>({id,text,category,nativeWebSearch})),
      models:enabledModels.slice(start,end).map(({id,name,family,nativeWebSearch})=>({id,name,family,nativeWebSearch}))};
  }
  private async geoReportSummary(ctx:RequestContext,id:string){
    const row=await this.geo.analysis(ctx,id);
    const report=row.report as unknown as ReturnType<typeof reportFor>|null;
    return {
      id:row.id,projectId:row.projectId,status:row.status,createdAt:row.createdAt,finishedAt:row.finishedAt,
      comparison:row.comparison,comparisonBlock:row.retestComparisonBlock,
      destination:publicOrigin()+'/t/'+encodeURIComponent(ctx.tenantKey)+'/geo/projects/'+row.projectId+'/analyses/'+row.id,
      report:report?{
        parserVersion:report.parserVersion,scoreVersion:report.scoreVersion,
        validSamples:report.validSamples,plannedSamples:report.plannedSamples,
        mentionRate:report.mentionRate,recommendationRate:report.recommendationRate,
        averageRank:report.averageRank,rankSamples:report.rankSamples,
        overallScore:report.score?.overallScore??null,diagnosticOnly:report.score?.diagnosticOnly??null,
        limitation:report.limitation,competitors:report.competitors,
        topCitationDomains:report.domains?.slice(0,10)??[],
        topOpportunities:report.opportunities?.slice(0,5).map(({question,count,competitors})=>({question,count,competitors}))??[],
      }:null,
    };
  }
  private async preview(ctx:RequestContext,app:DraftConnectorApp,input:any,tx:Prisma.TransactionClient){
    if(app==='erp')return this.master.purchaseDraftPreview(ctx,input.supplierId,input.lines,tx);
    if(app==='mes')return this.mes.planPreview(ctx,input,tx);
    const target=input.evaluationId?await this.segments.fresh(ctx,input.evaluationId,input.previewHash,tx,false):null;
    return {title:input.title,goal:input.goal,planText:input.planText,checklist:input.checklist,hypotheses:input.hypotheses,target:target?{evaluationId:target.evaluation.id,previewHash:target.evaluation.previewHash,memberCount:target.memberIds.length,memberFingerprint:fingerprint(target.memberIds.slice().sort())}:null};
  }
  private presentation(app:ConnectorApp,input:any,p:any):Record<string,unknown>{
    if(app==='erp')return {操作:'创建采购草稿',采购单号:input.number,供应商:p.supplier.name,明细:p.lines.map((l:any)=>({商品:l.sku+' · '+l.name,数量:String(l.quantity)+' '+l.unit,单价:l.unitPrice,金额:l.amount})),预估合计:p.estimatedTotal+' CNY',结果范围:'仅保存草稿，不提交审批或办理入库'};
    if(app==='crm')return {操作:'创建运营任务草稿',标题:input.title,逐客户反馈:input.trackCustomers?'完成前逐客户记录处理结果':'沿用任务级记录',运营目标:input.goal,方案:input.planText,执行清单:input.checklist?.map((x:any)=>x.text),假设:input.hypotheses,目标人数:p.target?.memberCount??'未指定，保存后补充',结果范围:'仅保存草稿，不群发、不提交或启动运营'};
    return {操作:'创建生产计划草稿',计划编号:input.code,产品:p.productSku+' · '+p.productName,目标数量:input.targetQty,截止时间:input.dueAt,BOM版本:p.bomRevision,需求预览:p.requirements.map((l:any)=>({物料:l.sku+' · '+l.name,需求数量:l.quantity+' '+l.unit})),备注:input.note,结果范围:'仅保存草稿，不发布或派工；物料需求不等于缺料'};
  }
  private view(a:any){return {actionId:a.id,appId:a.appId,status:a.status,version:a.version,fingerprint:a.fingerprint,expiresAt:a.expiresAt,parameters:this.presentation(a.appId,a.input,a.preview),confirmationUrl:publicOrigin()+'/connect/actions/'+a.id,...(a.result?{receipt:a.result}:{})};}
  private async lockedGrant(tx:Prisma.TransactionClient,id:string){
    await tx.$queryRaw`SELECT id FROM "ConnectorGrant" WHERE id=${id} FOR UPDATE`;
    const g=await tx.connectorGrant.findUnique({where:{id}});if(!g||g.revokedAt||g.expiresAt<=new Date())throw new ForbiddenException('连接授权已失效');return g;
  }
  private async lockActor(tx:Prisma.TransactionClient,ctx:RequestContext){
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${ctx.membershipId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "TenantApp" WHERE "tenantId"=${ctx.tenantId} AND "appId"=${ctx.app.appId} FOR SHARE`;
    const m=await tx.membership.findFirst({where:{id:ctx.membershipId,userId:ctx.userId,tenantId:ctx.tenantId,active:true,user:{active:true},tenant:{active:true}}}),app=await tx.tenantApp.findUnique({where:{tenantId_appId:{tenantId:ctx.tenantId,appId:ctx.app.appId}}});
    if(!m||m.role!==ctx.roles[0]||!app?.granted||!app.enabled)throw new ForbiddenException('成员或应用权限已变化');
  }
  async prepare(grant:any,ctx:RequestContext,app:DraftConnectorApp,draft:any,key:string){
    const requestFingerprint=fingerprint({command:COMMANDS[app],draft});
    const a=await this.db.$transaction(async tx=>{
      const g=await this.lockedGrant(tx,grant.id);if(!(g.scopes as string[]).includes(app+'.draft'))throw new ForbiddenException('未授权准备草稿');
      const existing=await tx.connectorAction.findUnique({where:{grantId_requestKey:{grantId:g.id,requestKey:key}}});
      if(existing){if(existing.requestFingerprint!==requestFingerprint)throw new ConflictException('相同请求标识的参数不一致');return existing;}
      await this.lockActor(tx,ctx);
      const raw=app==='erp'?{...draft,number:draft.number??'WB-'+randomUUID().slice(0,12)}:draft;
      const prepared=this.bus.registry.prepare(ctx,COMMANDS[app],raw),input=json(prepared.input),preview=json(await this.preview(ctx,app,input,tx));
      const action=await tx.connectorAction.create({data:{grantId:g.id,tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:app,command:COMMANDS[app],requestKey:key,input,preview,requestFingerprint,fingerprint:fingerprint({input,preview}),expiresAt:new Date(Date.now()+20*60000)}});
      await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:app,requestId:ctx.requestId,action:app+'.connector.prepare',resourceType:'ConnectorAction',resourceId:action.id,detail:{command:action.command,grantId:g.id,channel:'workbuddy'}}});return action;
    },{timeout:15000});
    return this.view(a);
  }
  private async webAction(req:Request,id:string){
    const user=await this.access.auth.user(req),a=await this.db.connectorAction.findFirst({where:{id,userId:user.id}});if(!a)throw new NotFoundException('操作不存在或不可见');
    if(a.appId!=='erp'&&a.appId!=='crm'&&a.appId!=='mes')throw new NotFoundException('操作不存在或不可见');
    const t=await this.db.tenant.findUnique({where:{id:a.tenantId}});if(!t)throw new NotFoundException('企业不存在');
    const ctx=await this.access.auth.context(req,t.slug,a.appId);if(ctx.membershipId!==a.membershipId)throw new ForbiddenException('操作不属于当前成员');
    this.bus.registry.prepare(ctx,a.command,a.input);return {a,ctx};
  }
  async actionDetails(req:Request,id:string){const {a,ctx}=await this.webAction(req,id),g=await this.db.connectorGrant.findUnique({where:{id:a.grantId}});return {...this.view(a),tenantKey:ctx.tenantKey,connectionActive:!!g&&!g.revokedAt&&g.expiresAt>new Date()};}
  private async serializable<T>(run:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
    for(let attempt=0;;attempt++){
      try{return await this.db.$transaction(run,{isolationLevel:'Serializable',timeout:20000});}
      catch(e:any){const cause=e?.meta?.driverAdapterError?.cause;const conflict=e?.code==='P2034'||(e?.code==='P2010'&&cause?.kind==='TransactionWriteConflict');if(!conflict)throw e;if(attempt>=2)throw new ConflictException('并发操作尚未完成，请回查状态后重试');}
    }
  }
  async decide(req:Request,id:string,raw:unknown){
    const {a,ctx}=await this.webAction(req,id),p=readBody(z.object({decision:z.enum(['confirm','cancel']),version:z.int().positive(),fingerprint:z.string().length(64)}).strict(),raw);
    return this.serializable(async tx=>{
      const g=await this.lockedGrant(tx,a.grantId);await tx.$queryRaw`SELECT id FROM "ConnectorAction" WHERE id=${id} FOR UPDATE`;
      const current=await tx.connectorAction.findUniqueOrThrow({where:{id}});
      if(current.fingerprint!==p.fingerprint)throw new ConflictException('参数已变化，请重新核对');
      await this.lockActor(tx,ctx);
      if(current.status==='completed')return this.view(current);
      if(current.status!=='pending'||current.version!==p.version||current.expiresAt<=new Date())throw new ConflictException('操作已处理或过期，请重新准备');
      if(p.decision==='cancel')return this.view(await tx.connectorAction.update({where:{id},data:{status:'cancelled',version:{increment:1}}}));
      if(!(g.scopes as string[]).includes(a.appId+'.draft'))throw new ForbiddenException('草稿授权已失效');
      const prepared=this.bus.registry.prepare(ctx,current.command,current.input),fresh=json(await this.preview(ctx,a.appId as DraftConnectorApp,prepared.input,tx));
      if(fingerprint({input:current.input,preview:fresh})!==current.fingerprint)throw new ConflictException('业务依据已变化，请返回WorkBuddy重新准备');
      const key='connector:'+id,result=await prepared.cmd.execute(tx,{...ctx,requestId:key},prepared.input);
      if(result.state!=='completed')throw new ConflictException('业务未完成，未保存操作结果');
      const r=result.result as any,receipt=this.receipt(ctx,a.appId as ConnectorApp,r);
      await tx.applicationCommandReceipt.create({data:{tenantId:ctx.tenantId,appId:a.appId,command:current.command,requestKey:key,fingerprint:fingerprint({command:current.command,input:current.input}),result:json(receipt)}});
      const saved=await tx.connectorAction.update({where:{id},data:{status:'completed',result:json(receipt),confirmedAt:new Date(),version:{increment:1}}});
      await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:a.appId,requestId:key,action:a.appId+'.connector.confirm',resourceType:'ConnectorAction',resourceId:id,detail:{grantId:g.id,command:a.command,channel:'workbuddy',businessId:r.id}}});return this.view(saved);
    });
  }
  private receipt(ctx:RequestContext,app:ConnectorApp,r:any){
    const path=app==='erp'?'/erp/purchases/'+r.id:app==='crm'?'/crm/tasks/'+r.id:'/mes/plans/'+r.id;
    return {id:r.id,number:r.number??r.code??null,title:r.title??null,status:r.status,version:r.version,appId:app,destination:publicOrigin()+'/t/'+encodeURIComponent(ctx.tenantKey)+path};
  }
  async actionStatus(grant:any,ctx:RequestContext,id:string){
    const a=await this.db.connectorAction.findFirst({where:{id,grantId:grant.id,tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:ctx.app.appId}});if(!a)throw new NotFoundException('操作不存在或不可见');
    this.bus.registry.prepare(ctx,a.command,a.input);
    const v=this.view(a);
    if(a.status==='completed'&&a.result){const r=a.result as any;const current:any=await this.bus.registry.resource(ctx,a.appId==='erp'?'purchase':a.appId==='crm'?'operation_task':'plan',r.id);return {...v,currentBusiness:this.receipt(ctx,a.appId as ConnectorApp,current)};}
    return v;
  }
}
