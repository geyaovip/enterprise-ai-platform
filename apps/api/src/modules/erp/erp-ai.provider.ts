import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AppAiProvider, AiResourceFacts } from '../ai/app-ai-provider';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { PurchaseService } from './purchase.service';
import { SalesService } from './sales.service';
import { FinanceService } from './finance.service';
import { MasterService } from './master.service';
import { InventoryService } from './inventory.service';
import { ReplenishmentService, replenishmentFacts } from './replenishment.service';
import { ERP_ASSISTANT } from './erp-agent.definition';
import { ERP_AI_TOOLS } from './erp-ai.tools';
import { ErpDraftSkill } from './erp-draft.skill';
import { ownerFilter } from './erp.common';
import { createHash } from 'node:crypto';

@Injectable()
export class ErpAiProvider implements AppAiProvider {
  readonly appId = 'erp';
  readonly agentId=ERP_ASSISTANT.id;
  readonly instructions=ERP_ASSISTANT.instructions;
  readonly usePermission = 'erp.ai.use';
  readonly analysisSystemPrompt = '你是 ERP 业务分析助手。只依据给定 JSON 事实回答，明确区分事实与建议；不得编造 SKU、库存、金额或交期。不要声称执行了业务操作。';
  readonly tools = ERP_AI_TOOLS;

  async authorizationStamp(ctx:RequestContext){
    const fresh=await this.auth.taskContext({tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:this.appId,taskId:'erp-ai-scope'});
    return createHash('sha256').update(JSON.stringify({member:fresh.membershipId,roles:[...fresh.roles].sort(),permissions:[...fresh.permissions].sort()})).digest('hex');
  }

  allowWriteIntent(question:string):boolean {
    if(/(?:不要|不需要|无需|禁止|别|不(?:创建|新建|新增|生成|登记|办理|确认|执行|入库|出库|收货|发货|收款|付款)|仅分析|只分析|只查看|只看)/.test(question))return false;
    if(/(?:如何|怎么|怎样|能否|是否|可以).{0,12}(?:创建|新增|生成|登记|办理|确认|入库|出库|收货|发货|收款|付款)/.test(question))return false;
    return /创建|新建|新增|生成|建立|登记|办理|确认|审批|审核|批准|执行|安排|建个|建一个|建一张|建一份|添加|录入|下单|入库|出库|收货|发货|收款|付款/.test(question);
  }

  selectTools(question:string,resourceType?:string):string[] {
    if(!this.allowWriteIntent(question))return [];
    const ids:string[]=[];
    if(/补货/.test(question))ids.push('erp.workflow.create_replenishment_plan');
    if(/采购|订货|下单/.test(question)&&!/补货/.test(question)){
      if(/创建|新建|新增|生成|建个|建一个|建一张|建一份|添加|草稿|下单/.test(question))ids.push('erp.purchase.create_draft');
      if(/确认|审批|审核|批准/.test(question))ids.push('erp.purchase.confirm');
    }
    if(/入库|收货/.test(question))ids.push('erp.purchase.receive');
    if(/出库|发货/.test(question))ids.push('erp.contract.ship');
    if(/收款|付款|收付|回款/.test(question))ids.push('erp.finance.record_payment');
    if(/客户/.test(question)&&/创建|新建|新增|建立|建个|建一个|添加|录入/.test(question))ids.push('erp.customer.create');
    if(/商机/.test(question)&&/创建|新建|新增|建立|建个|建一个|添加|录入/.test(question))ids.push('erp.opportunity.create');
    if(resourceType==='purchase'&&/确认|审批|审核|批准/.test(question))ids.push('erp.purchase.confirm');
    return [...new Set(ids)];
  }

  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly draftSkill: ErpDraftSkill,
    private readonly purchases: PurchaseService,
    private readonly sales: SalesService,
    private readonly finance: FinanceService,
    private readonly master: MasterService,
    private readonly inventory: InventoryService,
    private readonly replenishment: ReplenishmentService,
  ) {}

  async resourceFacts(ctx: RequestContext, type: string, id?: string): Promise<AiResourceFacts> {
    if(type.startsWith('scope_')){
      if(id!==ctx.membershipId||type!=='scope_'+(await this.authorizationStamp(ctx)).slice(0,32))throw new NotFoundException('业务授权范围已变化，请重新发送');
      return {text:'当前ERP授权范围'};
    }
    if (type === 'purchase' && id) {
      const p = await this.purchases.get(ctx, id);
      const facts = p.lines.map(l => ({ lineId: l.id, sku: l.sku, unit:l.baseUnit, ordered: l.quantity, received: l.receivedQty, remaining: Math.max(0, l.quantity - l.receivedQty) }));
      return { displayName:p.number,text: JSON.stringify({ type, id, number: p.number, status: p.status, version: p.version, total: p.total, facts }), facts, source: { appId: this.appId, type, id, version: p.version,title:p.number } };
    }
    if (type === 'contract' && id) {
      const c = await this.sales.get(ctx, id);
      const canReadInventory=ctx.permissions.includes('erp.inventory.read');
      const balances = canReadInventory ? await this.db.erpInventoryBalance.findMany({ where: { tenantId: ctx.tenantId, productId: { in: c.lines.map(l => l.productId) } } }) : [];
      const facts = c.lines.map(l => {
        const pending = Math.max(0, l.quantity - l.shippedQty);
        const balance = balances.find(b => b.productId === l.productId);
        const available = balance?.quantity ?? 0;
        return { lineId: l.id, sku: l.sku, unit:l.baseUnit, pending, ...(canReadInventory?{available,currentShortfall:Math.max(0,pending-available),balanceVersion:balance?.version??0}:{inventoryStatus:'无库存查看权限，不能判断缺货'}) };
      });
      return { displayName:c.number,text: JSON.stringify({ type, id, number: c.number, status: c.status, version: c.version, total: c.total, facts }), facts, source: { appId: this.appId, type, id, version: c.version,title:c.number } };
    }
    if (type === 'customer' && id) {
      const c = await this.master.customer(ctx, id);
      return { displayName:c.name,text: JSON.stringify({ type, id, code: c.code, name: c.name, active: c.active, opportunities: c.opportunities.slice(0,50).map(x => ({ id: x.id, name: x.name, stage: x.stage })),opportunityCount:c.opportunities.length,opportunitiesTruncated:c.opportunities.length>50 }), source: { appId: this.appId, type, id,title:c.name } };
    }
    if (type === 'inventory') {
      this.auth.require(ctx, 'erp.inventory.read');
      const replenishment=await this.db.$transaction(tx=>replenishmentFacts(tx,ctx.tenantId),{isolationLevel:'RepeatableRead'});
      return {text:JSON.stringify({type,scope:'全企业库存明细，超过100项时仅提供部分',total:replenishment.length,truncated:replenishment.length>100,items:replenishment.slice(0,100)})};

    }
    return { text: '' };
  }

  async options(ctx: RequestContext,question='',selection?:{toolIds:readonly string[];resourceType?:string}): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    const tools=(selection?.toolIds??this.selectTools(question)).filter(id=>this.canUse(ctx,id));
    const purchase=tools.includes('erp.purchase.create_draft'),plan=tools.includes('erp.workflow.create_replenishment_plan');
    const bounded=(rows:unknown[],key:string)=>{result[key]=rows.slice(0,50);result[key+'Truncated']=rows.length>50;};
    if (purchase||plan) {
      bounded(await this.db.erpSupplier.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, code: true, name: true }, orderBy:{code:'asc'},take:51 }),'suppliers');
    }
    if (purchase&&ctx.permissions.includes('erp.master.read')) {
      bounded(await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, sku: true, name: true },orderBy:{sku:'asc'}, take:51 }),'products');
    }
    if(tools.includes('erp.opportunity.create')){
      this.auth.require(ctx,'erp.master.read');
      bounded(await this.db.erpCustomer.findMany({where:{tenantId:ctx.tenantId,active:true,...ownerFilter(ctx)},select:{id:true,code:true,name:true},orderBy:{code:'asc'},take:51}),'customers');
    }
    if(selection?.resourceType!=='inventory'&&/补货|库存|缺货|在库|在途/.test(question)&&ctx.permissions.includes('erp.inventory.read')){
      const rows=(await this.replenishment.facts(ctx)).items;
      bounded(rows,'replenishment');result.replenishmentTotal=rows.length;
    }
    if(Object.keys(result).length)result.scopeNotice='仅使用本轮提供的已授权对象；Truncated为true表示部分结果，不代表全部。对象缺失时请用户指定编号或在业务页选择，不得猜测ID。';
    return result;
  }

  canUse(ctx: RequestContext, tool: string): boolean {
    const definition = this.tools[tool];
    return Boolean(definition && definition.appId === ctx.app.appId && ctx.permissions.includes(definition.permission) && (tool!=='erp.workflow.create_replenishment_plan'||ctx.permissions.includes('erp.inventory.read')));
  }

  async execute(ctx: RequestContext, tool: string, input: Record<string, unknown>): Promise<unknown> {
    if (!this.canUse(ctx, tool)) throw new ConflictException('当前无权执行此工具');
    if (tool === 'erp.workflow.create_replenishment_plan') return this.replenishment.plan(ctx,{...input,requestKey:ctx.requestId});
    if (tool === 'erp.purchase.create_draft') return this.purchases.create(ctx, { ...input, number: input.number ?? `AI-PO-${ctx.requestId.replace(/^ai-action:/, '')}` });
    if (tool === 'erp.purchase.confirm') return this.purchases.confirm(ctx, String(input.id), { version: input.version });
    if (tool === 'erp.purchase.receive') return this.purchases.receive(ctx, String(input.id), input);
    if (tool === 'erp.contract.ship') return this.sales.ship(ctx, String(input.id), input);
    if (tool === 'erp.finance.record_payment') return this.finance.payment(ctx, input.kind === 'receivable' ? 'receivable' : 'payable', String(input.id), input);
    if (tool === 'erp.customer.create') return this.master.createCustomer(ctx, input);
    if (tool === 'erp.opportunity.create') return this.master.createOpportunity(ctx, input);
    throw new ConflictException('工具不存在');
  }

  async preview(ctx: RequestContext, tool: string, input: Record<string, unknown>): Promise<unknown> {
    if (!this.canUse(ctx, tool)) throw new ConflictException('当前无权预览此工具');
    if (tool === 'erp.workflow.create_replenishment_plan') return this.master.purchaseDraftPreview(ctx,String(input.supplierId),input.lines as Array<{productId:string;quantity:number}>);
    if (tool === 'erp.purchase.create_draft') return this.master.purchaseDraftPreview(ctx, String(input.supplierId), input.lines as Array<{ productId: string; quantity: number }>);
    return null;
  }

  async shortages(ctx: RequestContext) {
    const result=await this.replenishment.facts(ctx);
    return result.items.map(x=>({...x,quantity:x.onHand,reorderPoint:x.target>0?x.target-1:0,suggestedMinimum:x.suggestedQty,status:'needs_purchase',source:{appId:this.appId,type:'inventory',id:x.productId,version:x.balanceVersion}}));
  }

  async extract(ctx: RequestContext, body: unknown) {
    return this.draftSkill.extract(ctx, body);
  }

  async actionPresentation(ctx:RequestContext, tool:string, input:Record<string,unknown>, raw:unknown) {
    if(!this.canUse(ctx,tool))throw new ConflictException('当前无权查看此操作');
    const result=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
    const labels:Record<string,string>={number:'单号',name:'名称',code:'编号',estimatedAmount:'预计金额（元）',kind:'账款类型',amount:'金额（元）',reference:'收付款凭证',note:'备注',quantity:'数量',version:'记录版本'};
    const parameters:Record<string,unknown>={};
    for(const [key,value]of Object.entries(input))if(labels[key])parameters[labels[key]]=value==='receivable'?'应收款':value==='payable'?'应付款':value;
    if(typeof input.supplierId==='string'){
      const supplier=await this.db.erpSupplier.findFirst({where:{id:input.supplierId,tenantId:ctx.tenantId},select:{name:true,code:true}});
      if(!supplier)throw new ConflictException('供应商不可访问');parameters['供应商']=supplier.code+' · '+supplier.name;
    }
    if(typeof input.customerId==='string'){const customer=await this.master.customer(ctx,input.customerId);parameters['客户']=customer.code+' · '+customer.name;}
    let order:any=null;
    if(typeof input.id==='string'&&tool.startsWith('erp.purchase.'))order=await this.purchases.get(ctx,input.id);
    if(typeof input.id==='string'&&tool==='erp.contract.ship')order=await this.sales.get(ctx,input.id);
    if(tool==='erp.finance.record_payment'&&typeof input.id==='string'){
      this.auth.require(ctx,'erp.finance.read');const rows=input.kind==='receivable'?await this.finance.receivables(ctx,{id:input.id}):await this.finance.payables(ctx,{id:input.id});const account=rows.items[0];if(!account)throw new ConflictException('账款不可访问');
      parameters['关联单据']=('contract'in account?account.contract?.number:'order'in account?account.order?.number:null)??account.openingReference??'期初账款';parameters['往来单位']=account.partyName;
    }
    if(order){parameters['单号']=order.number;parameters[order.supplier?'供应商':'客户']=(order.supplier??order.customer)?.name??'—';}
    if(Array.isArray(input.lines)){
      const lines=[];
      for(const row of input.lines as any[]){
        const line=order?.lines.find((l:any)=>l.id===row.lineId);
        const product=line??(typeof row.productId==='string'?await this.db.erpProduct.findFirst({where:{id:row.productId,tenantId:ctx.tenantId},select:{sku:true,name:true,unit:true}}):null);
        if(!product)throw new ConflictException('商品或明细不可访问');
        lines.push(`${product.sku} · ${product.name} · ${row.quantity} ${product.baseUnit??product.unit}`);
      }
      parameters['商品与数量']=lines;
    }
    const receipt:Record<string,unknown>={};
    if(typeof result.number==='string')receipt['单号']=result.number;
    if(typeof result.title==='string')receipt['任务']=result.title;
    const states:Record<string,string>={draft:'草稿',ordered:'待入库',received:'已入库',partial_received:'部分入库',confirmed:'待出库',shipped:'已出库',partial_shipped:'部分出库',awaiting_confirmation:'待确认计划',queued:'待执行',completed:'已完成',running:'执行中',waiting:'等待业务办理',pending_approval:'待审批'};
    if(typeof result.status==='string')receipt['当前状态']=states[result.status]??result.status;
    for(const [key,label]of Object.entries({total:'合计（元）',amount:'金额（元）',reference:'凭证',receivedQty:'入库数量',shippedQty:'出库数量'}))if(result[key]!=null)receipt[label]=result[key];
    if(!Object.keys(receipt).length)receipt['结果']='操作已完成';
    const target=typeof result.id==='string'?result.id:typeof input.id==='string'?input.id:null;
    const destination=tool==='erp.workflow.create_replenishment_plan'&&target?`/tasks?task=${target}`:tool.startsWith('erp.purchase.')&&target?`/erp/purchases/${target}`:tool==='erp.contract.ship'&&target?`/erp/contracts/${target}`:tool==='erp.finance.record_payment'?`/erp/finance?kind=${input.kind==='receivable'?'receivables':'payables'}&focus=${input.id}`:tool==='erp.customer.create'&&target?`/erp/customers?focus=${target}`:tool==='erp.opportunity.create'&&target?`/erp/opportunities?focus=${target}`:undefined;
    return {parameters,receipt,destination};
  }
}
