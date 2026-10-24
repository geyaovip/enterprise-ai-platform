import { ContextLink as Link, useViewState, safeReturn } from '../business-context';
import { FlowPreview, OrderWorkflow, type Workflow } from './WorkflowsPage';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { aiApi, api, erpApi, errorText } from '../api';
import { ServiceNotice, useServices } from '@suite/frontend/services';
import { runAiTask } from '../ai-task';
import { ConfirmDialog, Empty, Field, Loading, Money, Notice, PageTitle, Pager, Status, ActionPanel, DialogAction } from '../components';
import { ForwardIcon } from '@suite/frontend/components';
import { useApiData } from '../hooks';
import type { Contract, Customer, Opportunity, Page, Product, Purchase, Supplier } from '../types';
import { TradePrint, TradeActions } from './BusinessDocuments';
import type { BusinessSettings, Warehouse } from './BusinessDocuments';
import { BusinessFilters, filterQuery, downloadCsv, CsvExport } from './BusinessPrimitives';

type Props = { tenantKey: string; role?: string; membershipId?: string };
type Kind = 'purchase' | 'contract';
type Order = Purchase | Contract;
type RiskReview = { summary: string; actions: string[]; missing_data: string[]; facts: Array<{ sku: string; unit?: string; ordered?: number; received?: number; remaining?: number; pending?: number; available?: number; currentShortfall?: number }> };
type ReviewEnvelope = { review: RiskReview | null; reviewedAt: string | null };
const partyName = (order: Order) => (order as Contract).customer?.name ?? (order as Purchase).supplier?.name;
const config = {
  purchase: { route: 'purchases', title: '采购单', party: '供应商', partyRoute: 'suppliers', batch: 'receive', batchLabel: '分批入库', resourceType: 'purchase' },
  contract: { route: 'contracts', title: '销售合同', party: '客户', partyRoute: 'customers', batch: 'ship', batchLabel: '分批出库', resourceType: 'contract' },
} as const;

export function PurchasePage(props: Props) { return <OrderList kind="purchase" {...props} />; }
export function ContractPage(props: Props) { return <OrderList kind="contract" {...props} />; }
export function PurchaseDetailPage(props: Props) { return <OrderDetail kind="purchase" {...props} />; }
export function ContractDetailPage(props: Props) { return <OrderDetail kind="contract" {...props} />; }

function OrderList({ tenantKey, role, kind }: Props & { kind: Kind }) {
  const { aiAvailable } = useServices();
  const c = config[kind];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const sourceCustomerId = kind === 'contract' ? searchParams.get('customerId') ?? '' : '';
  const sourceOpportunityId = kind === 'contract' ? searchParams.get('opportunityId') ?? '' : '';
  const [sourceLoading, setSourceLoading] = useState(false);
  const alertProductId = kind === 'purchase' ? searchParams.get('productId') ?? '' : '';
  const alertSku = kind === 'purchase' ? searchParams.get('sku') ?? '' : '';
  const alertQuantity = Math.min(1_000_000_000, Math.max(0.000001, Number(searchParams.get('quantity')) || 1));
  const alertSource = kind === 'purchase' && alertProductId && searchParams.has('balanceVersion') ? {
    productId: alertProductId,
    balanceVersion: Number(searchParams.get('balanceVersion')),
    reorderPoint: Number(searchParams.get('reorderPoint')),
    incomingQty: Number(searchParams.get('incomingQty')),
    suggestedOrderQty: alertQuantity,
  } : null;
  const [page, setPage] = useViewState('page', 1);
  const [filter, setFilter] = useViewState('filter', '');
  const { data, loading, error, reload } = useApiData<Page<Order>>(erpApi(tenantKey, `/${c.route}?page=${page}&${filter}`));
  const canCreate = kind === 'purchase' ? ['admin', 'purchasing'].includes(role ?? '') : ['admin', 'sales'].includes(role ?? '');
  const [partySearch, setPartySearch] = useState('');
  const [productSearch, setProductSearch] = useState(alertSku);
  const [opportunitySearch, setOpportunitySearch] = useState('');
  const [partyPage, setPartyPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [opportunityPage, setOpportunityPage] = useState(1);
  const parties = useApiData<Page<Customer | Supplier>>(canCreate ? erpApi(tenantKey, `/${c.partyRoute}?page=${partyPage}&page_size=20&q=${encodeURIComponent(partySearch)}`) : erpApi(tenantKey, '/products?page_size=1'));
  const products = useApiData<Page<Product>>(canCreate ? erpApi(tenantKey, `/products?page=${productPage}&page_size=20&q=${encodeURIComponent(productSearch)}`) : erpApi(tenantKey, '/products?page_size=1'));
  const [number, setNumber] = useState('');
  const [dueAt,setDueAt]=useState(''),[deliveryAt,setDeliveryAt]=useState(''),[deliveryAddress,setDeliveryAddress]=useState(''),[paymentTerms,setPaymentTerms]=useState('');
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [partyId, setPartyId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const opportunities = useApiData<Page<Opportunity>>(kind === 'contract' && canCreate && partyId ? erpApi(tenantKey, `/opportunities?customerId=${encodeURIComponent(partyId)}&page=${opportunityPage}&page_size=20&q=${encodeURIComponent(opportunitySearch)}`) : erpApi(tenantKey, '/products?page_size=1'));
  const [note, setNote] = useState(alertSource ? `库存预警来源：${alertSku}；库存版本 ${alertSource.balanceVersion}。` : '');
  const [lines, setLines] = useState<Array<{ productId: string; quantity: number; unitPrice?:string; discountPercent?:number; taxRate?:number; taxIncluded?:boolean; unit?:string; unitFactor?:number }>>([{ productId: alertProductId, quantity: alertQuantity }]);
  const [selectedParties, setSelectedParties] = useState<Record<string, { id: string; code: string; name: string; active?: boolean }>>({});
  const [selectedProducts, setSelectedProducts] = useState<Record<string, { id: string; sku: string; name: string; active?: boolean }>>({});
  const [text, setText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (editId || !canCreate || !sourceCustomerId || !sourceOpportunityId) { setSourceLoading(false); return; }
    let active = true;
    setSourceLoading(true);
    setPartyId(''); setOpportunityId(''); setSelectedOpportunity(null);
    api.get<Customer & { opportunities: Opportunity[] }>(erpApi(tenantKey, `/customers/${encodeURIComponent(sourceCustomerId)}`)).then(customer => {
      if (!active) return;
      const opportunity = customer.opportunities.find(item => item.id === sourceOpportunityId && item.customerId === customer.id);
      if (!customer.active || !opportunity || opportunity.stage === 'lost') throw new Error('来源客户已停用或商机不可用，请手动选择客户和商机。');
      setPartyId(customer.id);
      setSelectedParties(previous => ({ ...previous, [customer.id]: customer }));
      setOpportunityId(opportunity.id); setSelectedOpportunity(opportunity);
      setMessage(`已载入商机“${opportunity.name}”及关联客户；请补充商品和数量，核对后保存草稿。`);
    }).catch(error => { if (active) setMessage(errorText(error)); }).finally(() => { if (active) setSourceLoading(false); });
    return () => { active = false; };
  }, [sourceCustomerId, sourceOpportunityId, editId, canCreate, tenantKey]);
  useEffect(() => {
    if (!editId || !canCreate) return;
    let active = true;
    api.get<Order>(erpApi(tenantKey, `/${c.route}/${editId}`)).then(order => {
      if (!active) return;
      if (order.status !== 'draft') { setMessage('只有草稿可编辑，请返回单据详情查看当前状态。'); return; }
      const party = kind === 'purchase' ? (order as Purchase).supplier : (order as Contract).customer;
      const linkedOpportunity = kind === 'contract' ? (order as Contract).opportunity : null;
      setEditVersion(order.version);
      setNumber(order.number);
      setPartyId(kind === 'purchase' ? (order as Purchase).supplierId : (order as Contract).customerId);
      setSelectedParties(previous => ({ ...previous, [kind === 'purchase' ? (order as Purchase).supplierId : (order as Contract).customerId]: { id: kind === 'purchase' ? (order as Purchase).supplierId : (order as Contract).customerId, code: party?.code ?? '', name: party?.name ?? '' } }));
      setOpportunityId(kind === 'contract' ? (order as Contract).opportunityId ?? '' : '');
      setSelectedOpportunity(linkedOpportunity ? { ...linkedOpportunity, stage: '', estimatedAmount: '' } : null);
      setLines(order.lines.map(line => ({ productId: line.productId, quantity: line.quantity/(line.unitFactor??1), unitPrice:line.basePrice??line.unitPrice, discountPercent:Number(line.discountPercent??0),taxRate:Number(line.taxRate??0),taxIncluded:line.taxIncluded??true,unit:line.unit,unitFactor:line.unitFactor??1 })));
      setDueAt(order.dueAt?.slice(0,10)??'');setDeliveryAt(order.deliveryAt?.slice(0,10)??'');setDeliveryAddress(order.deliveryAddress??'');setPaymentTerms(order.paymentTerms??'');
      setSelectedProducts(previous => ({ ...previous, ...Object.fromEntries(order.lines.map(line => [line.productId, { id: line.productId, sku: line.sku, name: line.name }])) }));
      setNote(order.note ?? '');
      setMessage(`已载入草稿。修改后请核对${c.party}、商品、数量和当前价格，再保存。`);
    }).catch(error => { if (active) setMessage(errorText(error)); });
    return () => { active = false; };
  }, [editId, tenantKey, kind, canCreate, c.route]);
  const partyOptions = [
    ...(partyId && selectedParties[partyId] ? [selectedParties[partyId]] : []),
    ...(parties.data?.items ?? []),
  ].filter((item, index, all) => item.active !== false && all.findIndex(other => other.id === item.id) === index);
  const productOptions = [
    ...lines.map(line => selectedProducts[line.productId]).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ...(products.data?.items ?? []),
  ].filter((item, index, all) => item.active !== false && all.findIndex(other => other.id === item.id) === index);
  const opportunityOptions = [
    ...(selectedOpportunity?.id === opportunityId && selectedOpportunity.customerId === partyId ? [selectedOpportunity] : []),
    ...(kind === 'contract' && partyId ? opportunities.data?.items ?? [] : []),
  ].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  const chooseParty = (id: string) => {
    setPartyId(id);
    setOpportunityId('');
    setSelectedOpportunity(null);
    setOpportunitySearch('');
    setOpportunityPage(1);
    const item = partyOptions.find(option => option.id === id);
    if (item) setSelectedParties(previous => ({ ...previous, [id]: item }));
  };
  const chooseProduct = (index: number, id: string) => {
    setLines(previous => previous.map((line, current) => current === index ? { ...line, productId: id } : line));
    const item = productOptions.find(option => option.id === id);
    if (item) setSelectedProducts(previous => ({ ...previous, [id]: item }));
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (sourceLoading) return; setBusy(true); setMessage(null);
    try {
      const body = { number, [kind === 'purchase' ? 'supplierId' : 'customerId']: partyId, ...(kind === 'contract' && opportunityId ? { opportunityId } : {}), ...(!editId && alertSource ? { sourceInventory: alertSource } : {}), note, dueAt:dueAt?new Date(dueAt+'T23:59:59').toISOString():undefined,deliveryAt:deliveryAt?new Date(deliveryAt+'T00:00:00').toISOString():undefined,deliveryAddress,paymentTerms,lines:lines.map(l=>({...l,unitPrice:l.unitPrice||undefined})) };
      const item = editId && editVersion !== null
        ? await api.put<Order>(erpApi(tenantKey, `/${c.route}/${editId}`), { ...body, version: editVersion })
        : await api.post<Order>(erpApi(tenantKey, `/${c.route}`), body);
      await reload(); navigate(`/t/${tenantKey}/erp/${c.route}/${item.id}`);
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  };
  const extract = async () => {
    setExtracting(true); setMessage(null);
    try {
      const result = await runAiTask<{ draft: { party?: { id: string; code: string; name: string } | null; lines: Array<{ product?: { id: string; sku: string; name: string } | null; quantity: number }>; note?: string }; missingReferences: string[] }>(tenantKey, 'extract', { kind, text });
      if (result.draft.party) setSelectedParties(previous => ({ ...previous, [result.draft.party!.id]: result.draft.party! }));
      setPartyId(result.draft.party?.id ?? '');
      setOpportunityId('');
      setSelectedOpportunity(null);
      setSelectedProducts(previous => ({ ...previous, ...Object.fromEntries(result.draft.lines.filter(line => line.product).map(line => [line.product!.id, line.product!])) }));
      setLines(result.draft.lines.length ? result.draft.lines.map(line => ({ productId: line.product?.id ?? '', quantity: line.quantity })) : [{ productId: '', quantity: 1 }]);
      setNote(result.draft.note ?? '');
      setMessage(result.missingReferences.length ? `草稿待核对，未匹配：${result.missingReferences.join('、')}` : 'AI 草稿已回填，请逐项核对后保存。');
    } catch (e) { setMessage(errorText(e)); }
    finally { setExtracting(false); }
  };
  return <>
    <PageTitle title={editId ? `编辑${c.title}草稿` : kind === 'purchase' ? '采购订单' : '销售合同'}  />
    <BusinessFilters storageKey={`erp-orders:${tenantKey}:${kind}`} statuses={kind==='purchase'?[['draft','草稿'],['pending_approval','待审'],['ordered','已确认'],['partial_received','部分入库'],['received','已入库'],['closed','已关闭'],['cancelled','已取消']]:[['draft','草稿'],['pending_approval','待审'],['confirmed','已确认'],['partial_shipped','部分出库'],['shipped','已出库'],['closed','已关闭'],['cancelled','已取消']]} onApply={v=>{setPage(1);setFilter(filterQuery(v));}}/><Notice text={error} /><Notice text={message} tone={message?.includes('已回填') || message?.startsWith('已载入') ? 'info' : 'error'} />{alertProductId && kind === 'purchase' && <Notice text={`已从库存预警带入 ${alertSku} 的建议数量。保存时会复核库存版本和在途采购量；请核对供应商和数量，草稿不会自动确认。`} tone="info" />}
    <CsvExport<Order> path={erpApi(tenantKey,`/${c.route}?${filter}`)} name={`${c.title}.csv`} headers={['单号','往来单位','状态','金额','到期日','交期','创建时间']} row={o=>[o.number,partyName(o),o.status,o.total,o.dueAt,o.deliveryAt,o.createdAt]}/>
    <div className="panel table-wrap">{loading ? <Loading /> : !data?.items.length ? <Empty text={`还没有${c.title}`}  /> : <ul className="erp-records">{data.items.map(item=><li className="erp-record" key={item.id}><Link className="erp-record-main erp-record-link" to={`/t/${tenantKey}/erp/${c.route}/${item.id}`}><strong>{item.number} · {partyName(item) ?? '—'}</strong><small><Money value={item.total}/> · 版本 {item.version}</small></Link><Status value={item.status}/><Link className="record-forward" aria-label={`查看 ${item.number}`} to={`/t/${tenantKey}/erp/${c.route}/${item.id}`}><ForwardIcon size={17}/></Link></li>)}</ul>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</div>
    {canCreate && <ActionPanel title={editId ? '编辑'+c.title : '新建'+c.title} label={editId ? '继续编辑草稿' : '新建'+c.title} busy={busy || extracting || sourceLoading} openKey={editId || alertProductId || sourceOpportunityId} error={message?.includes('已回填') || message?.startsWith('已载入') ? null : message} size="large"><div className="order-compose"><Notice tone="info" text={message?.includes('已回填') || message?.startsWith('已载入') ? message : null} /><form className="panel form-panel" onSubmit={create}>
      {!parties.loading && !parties.error && !parties.data?.total && <div className="prerequisite">没有可选的{c.party}。请先添加资料，或清空查找条件。 <Link to={`/t/${tenantKey}/erp/${c.partyRoute}`}>管理{c.party}</Link></div>}{!products.loading && !products.error && !products.data?.total && <div className="prerequisite">没有可选商品。请先添加商品，或清空查找条件。 <Link to={`/t/${tenantKey}/erp/products`}>查看商品资料</Link></div>}
      <div className="form-grid"><Field label="单号"><input required value={number} onChange={event => setNumber(event.target.value)} /></Field><Field label={`查找${c.party}`}><input value={partySearch} placeholder="输入名称或编号" onChange={event => { setPartySearch(event.target.value); setPartyPage(1); }} /></Field></div>
      <Field label={c.party}><select required value={partyId} onChange={event => chooseParty(event.target.value)}><option value="">请选择</option>{partyOptions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field>
      {parties.error && <Notice text={parties.error} />}{parties.data && <Pager page={partyPage} total={parties.data.total} size={parties.data.page_size} onPage={setPartyPage} />}
      {kind === 'contract' && <><Field label="查找商机"><input value={opportunitySearch} disabled={!partyId} placeholder="先选择客户，再输入商机名称" onChange={event => { setOpportunitySearch(event.target.value); setOpportunityPage(1); }} /></Field><Field label="关联商机（可选）"><select value={opportunityId} disabled={!partyId} onChange={event => { const id = event.target.value; setOpportunityId(id); setSelectedOpportunity(opportunityOptions.find(item => item.id === id) ?? null); }}><option value="">不关联</option>{opportunityOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{partyId && opportunities.error && <Notice text={opportunities.error} />}{partyId && opportunities.data && <Pager page={opportunityPage} total={opportunities.data.total} size={opportunities.data.page_size} onPage={setOpportunityPage} />}</>}
      <h3>明细</h3>
      <Field label="查找商品"><input value={productSearch} placeholder="输入商品编码或名称" onChange={event => { setProductSearch(event.target.value); setProductPage(1); }} /></Field>
      {products.error && <Notice text={products.error} />}{products.data && <Pager page={productPage} total={products.data.total} size={products.data.page_size} onPage={setProductPage} />}
      {lines.map((line,index)=><div className="business-line-grid" key={index}><Field label={`第 ${index+1} 行商品`}><select required value={line.productId} onChange={event=>chooseProduct(index,event.target.value)}><option value="">选择商品</option>{productOptions.map(item=><option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></Field><Field label="成交单位数量"><input type="number" min="0.000001" step="0.000001" required value={line.quantity} onChange={event=>setLines(previous=>previous.map((item,current)=>current===index?{...item,quantity:Number(event.target.value)}:item))}/></Field><Field label="成交单价（元）" ><input inputMode="decimal" value={line.unitPrice??''} onChange={e=>setLines(lines.map((l,i)=>i===index?{...l,unitPrice:e.target.value}:l))}/></Field><Field label="折扣（%）"><input type="number" min="0" max="100" step="0.001" value={line.discountPercent??0} onChange={e=>setLines(lines.map((l,i)=>i===index?{...l,discountPercent:Number(e.target.value)}:l))}/></Field><Field label="税率（%）"><input type="number" min="0" max="100" step="0.001" value={line.taxRate??0} onChange={e=>setLines(lines.map((l,i)=>i===index?{...l,taxRate:Number(e.target.value)}:l))}/></Field><Field label="价格口径"><select value={String(line.taxIncluded??true)} onChange={e=>setLines(lines.map((l,i)=>i===index?{...l,taxIncluded:e.target.value==='true'}:l))}><option value="true">含税</option><option value="false">未税</option></select></Field><Field label="成交单位" ><input maxLength={20} value={line.unit??''} onChange={e=>setLines(lines.map((l,i)=>i===index?{...l,unit:e.target.value||undefined}:l))}/></Field><Field label="每成交单位含基础单位数"><input type="number" min="0.000001" step="0.000001" value={line.unitFactor??1} onChange={e=>setLines(lines.map((l,i)=>i===index?{...l,unitFactor:Number(e.target.value)}:l))}/></Field><button type="button" disabled={lines.length===1} onClick={()=>setLines(lines.filter((_,i)=>i!==index))}>移除</button></div>)}
      <div className="form-grid"><Field label="交付日期"><input type="date" value={deliveryAt} onChange={e=>setDeliveryAt(e.target.value)}/></Field><Field label="付款到期日"><input type="date" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></Field><Field label="交付地址"><input maxLength={500} value={deliveryAddress} onChange={e=>setDeliveryAddress(e.target.value)}/></Field><Field label="付款条件"><input maxLength={500} value={paymentTerms} onChange={e=>setPaymentTerms(e.target.value)}/></Field></div>
      <button type="button" onClick={() => setLines(previous => [...previous, { productId: '', quantity: 1 }])}>增加一行</button>
      <Field label="备注"><textarea value={note} onChange={event => setNote(event.target.value)} /></Field>
      <DialogAction><button className="primary" disabled={busy || sourceLoading || !number.trim() || !partyId || !lines.length || lines.some(line => !line.productId || !Number.isFinite(line.quantity) || line.quantity <= 0) || Boolean(editId && editVersion === null)}>{busy ? '保存中…' : editId ? '保存草稿修改' : `创建${c.title}草稿`}</button></DialogAction>
    </form><section className="panel form-panel"><h2>从文字生成草稿</h2><ServiceNotice kind="ai" /><Field label="业务文字"><textarea rows={8} value={text} onChange={event => setText(event.target.value)} placeholder="粘贴采购需求或销售合同文字" /></Field><button type="button" disabled={extracting || busy || !aiAvailable || text.trim().length < 10} onClick={() => void extract()}>{extracting ? '提取中…' : 'AI 提取草稿'}</button></section></div></ActionPanel>}
  </>;
}

function OrderDetail({ tenantKey, role, membershipId, kind }: Props & { kind: Kind }) {
  const { id = '' } = useParams();
  const { aiAvailable } = useServices();
  const c = config[kind];
  const { data, loading, error, reload } = useApiData<Order>(erpApi(tenantKey, `/${c.route}/${id}`));
  const priorReview = useApiData<ReviewEnvelope>(aiAvailable&&data?aiApi(tenantKey, `/risk-reviews/${c.resourceType}/${id}?version=${data.version}`):null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [documentNumber, setDocumentNumber] = useState('');
  const [pending, setPending] = useState<'submit' | 'confirm' | 'reject' | 'batch' | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewOverride, setReviewOverride] = useState<ReviewEnvelope | null>(null);
  const settings=useApiData<BusinessSettings>(erpApi(tenantKey,'/business-settings'));
  const warehouses=useApiData<Warehouse[]>(erpApi(tenantKey,'/warehouses'));
  const [warehouseId,setWarehouseId]=useState('');
  const liveFlow=useApiData<{flow:Workflow|null}>(erpApi(tenantKey,`/workflows/by-source/${kind==='purchase'?'purchase':'sales'}/${id}`));
  useEffect(()=>{void liveFlow.reload();},[data?.version]);
  const approvalKind=kind==='purchase'?'purchase':'sales';const approvalConfig=settings.data?.approvalConfig;const high=approvalConfig?.[approvalKind==='sales'?'salesHigh':'purchaseHigh'];const assigned=high&&Number(data?.total??0)>=Number(high.threshold)?high.members:approvalConfig?.[approvalKind]??[];const delegate=approvalConfig?.delegation;const legacyConfirm=(settings.data?.permissions.includes(`erp.${approvalKind}.approve`)??role==='admin')&&(!assigned.length?role==='admin':assigned.includes(membershipId??'')||Boolean(delegate&&delegate.to===membershipId&&assigned.includes(delegate.from)&&new Date(delegate.until)>new Date()));
  const canConfirm=liveFlow.data?.flow?liveFlow.data.flow.canProcess&&liveFlow.data.flow.steps[liveFlow.data.flow.cursor].type==='approval':!liveFlow.loading&&!liveFlow.error&&legacyConfirm;
  const canSubmit = membershipId === (kind==='purchase'?(data as Purchase|null)?.createdByMembershipId:(data as Contract|null)?.ownerMembershipId) && (kind==='purchase'?['admin','purchasing']:['admin','sales']).includes(role??'');
  const canBatch = ['admin', 'warehouse'].includes(role ?? '')&&(!liveFlow.data?.flow||liveFlow.data.flow.canProcess);
  useEffect(() => { if (data) setQuantities(Object.fromEntries(data.lines.map(x => [x.id, 0]))); }, [data?.id, data?.version]);
  useEffect(() => { setReviewOverride(null); }, [id, data?.version]);
  const perform = async () => { if (!data || !pending) return; if (pending === 'batch' && (batchError || !selected.length)) { setMessage(batchError ?? '请填写至少一行本批数量。'); setPending(null); return; } setBusy(true); setMessage(null); try { if (pending === 'submit' || pending === 'confirm' || pending === 'reject') await api.post(erpApi(tenantKey, `/${c.route}/${id}/${pending}`), { version: data.version, ...(pending === 'reject' ? { reason: reviewReason } : {}) }); else await api.post(erpApi(tenantKey, `/${c.route}/${id}/${c.batch}`), { version: data.version, warehouseId:warehouseId||undefined, documentNumber: documentNumber || undefined, lines: data.lines.filter(x => quantities[x.id] > 0).map(x => ({ lineId: x.id, quantity: quantities[x.id] })) }); await reload(); await priorReview.reload(); setPending(null); setDocumentNumber(''); setReviewReason(''); setMessage('业务操作已提交，以最新单据状态为准。'); } catch (e) { setMessage(errorText(e)); setPending(null); } finally { setBusy(false); } };
  const analyze = async () => { setBusy(true); setMessage(null); try { const result = await api.post<ReviewEnvelope>(aiApi(tenantKey, '/risk-reviews'), { type: c.resourceType, id }); setReviewOverride(result); } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); } };
  if (loading) return <Loading />;
  if (!data) return <><Notice text={error} /><Link to={safeReturn(new URLSearchParams(window.location.search).get('returnTo'),tenantKey)??`/t/${tenantKey}/erp/${c.route}`}>返回列表</Link></>;
  const lines = data.lines;
  const progress = (line: typeof lines[number]) => kind === 'purchase' ? (line as Purchase['lines'][number]).receivedQty : (line as Contract['lines'][number]).shippedQty;
  const open = kind === 'purchase' ? ['ordered', 'partial_received'].includes(data.status) : ['confirmed', 'partial_shipped'].includes(data.status);
  const canEdit = data.status === 'draft' && membershipId === (kind === 'purchase' ? (data as Purchase).createdByMembershipId : (data as Contract).ownerMembershipId);
  const selected = lines.filter(x => quantities[x.id] > 0);
  const invalidBatchLines = lines.filter(line => {
    const quantity = quantities[line.id] ?? 0;
    const remaining = Number((line.quantity - progress(line)).toFixed(6));
    return !Number.isFinite(quantity) || quantity < 0 || quantity > remaining || quantity !== Number(quantity.toFixed(6));
  });
  const batchError = invalidBatchLines.length ? `${invalidBatchLines.map(line => line.sku).join('、')}：本批数量必须在 0 和剩余数量之间，最多保留 6 位小数。` : null;
  const shownReview = reviewOverride ?? priorReview.data;
  return <><PageTitle title={`${c.title} ${data.number}`}  action={<>{<button type="button" onClick={() => window.print()}>打印{kind==='purchase'?'采购单':'销售单'}</button>}<Link to={safeReturn(new URLSearchParams(window.location.search).get('returnTo'),tenantKey)??`/t/${tenantKey}/erp/${c.route}`}>返回列表</Link></>} /><TradePrint tenantKey={tenantKey} order={data} kind={kind==='purchase'?'purchase':'sales'}/><Notice text={error} /><Notice text={message} tone={message?.startsWith('业务操作') ? 'success' : 'error'} /><div className="detail-grid"><section className="panel"><h2>单据概览</h2><dl className="facts"><dt>状态</dt><dd><Status value={data.status} /></dd><dt>金额</dt><dd><Money value={data.total} /></dd><dt>{c.party}</dt><dd>{partyName(data) ?? '—'}</dd><dt>备注</dt><dd>{data.note || '—'}</dd></dl>{canEdit && <Link className="button" to={`/t/${tenantKey}/erp/${c.route}?edit=${id}`}>编辑草稿</Link>}{canSubmit && data.status === 'draft' && <DialogAction><button className="primary" onClick={() => setPending('submit')}>提交审核</button></DialogAction>}{canConfirm && data.status === 'pending_approval' && <div className="form-panel"><DialogAction><button className="primary" onClick={() => setPending('confirm')}>审核通过</button></DialogAction><Field label="退回原因"><input maxLength={500} value={reviewReason} onChange={event => setReviewReason(event.target.value)} placeholder="退回时必填" /></Field><button disabled={!reviewReason.trim()} onClick={() => setPending('reject')}>退回草稿</button></div>}</section><section className="panel"><h2>AI 履约分析</h2><ServiceNotice kind="ai" /><button disabled={busy || !aiAvailable} onClick={() => void analyze()}>{busy ? '分析中…' : shownReview?.review ? '重新分析' : '分析当前单据'}</button> <Link to={`/t/${tenantKey}/erp/ai?type=${c.resourceType}&id=${id}`}>在聊天中继续</Link>{priorReview.error && <Notice text={priorReview.error} />}{shownReview?.review && <div className="analysis"><p>{shownReview.review.summary}</p><strong>系统核算依据</strong><ul>{shownReview.review.facts.map(fact => <li key={fact.sku}>{fact.sku} · {kind === 'purchase' ? `订购 ${fact.ordered}、已收 ${fact.received}、未收 ${fact.remaining}` : `待发 ${fact.pending}、当前库存 ${fact.available}、当前差额 ${fact.currentShortfall}`} {fact.unit??lines.find(l=>l.sku===fact.sku)?.baseUnit??'基础单位'}</li>)}</ul>{shownReview.review.actions.length > 0 && <><strong>建议核实</strong><ul>{shownReview.review.actions.map((action, index) => <li key={index}>{action}</li>)}</ul></>}{shownReview.review.missing_data.length > 0 && <><strong>缺少的数据</strong><ul>{shownReview.review.missing_data.map((item, index) => <li key={index}>{item}</li>)}</ul></>}{shownReview.reviewedAt && <small>分析时间：{new Date(shownReview.reviewedAt).toLocaleString('zh-CN')}</small>}</div>}</section></div><section className="panel table-wrap"><h2>明细与进度</h2><table><thead><tr><th>商品</th><th>数量</th><th>已{kind === 'purchase' ? '收' : '发'}</th><th>剩余</th><th>成交单价</th><th>金额</th></tr></thead><tbody>{lines.map(line => <tr key={line.id}><td>{line.sku} · {line.name}</td><td>{line.quantity} {line.baseUnit??'件'}</td><td>{progress(line)} {line.baseUnit??'件'}</td><td>{Number((line.quantity-progress(line)).toFixed(6))} {line.baseUnit??'件'}</td><td><Money value={line.unitPrice} /></td><td><Money value={line.lineTotal} /></td></tr>)}</tbody></table></section>{kind === 'purchase' && (((data as Purchase).changes?.length ?? 0) > 0 || (membershipId === (data as Purchase).createdByMembershipId && ['ordered', 'partial_received'].includes(data.status))) && <PurchaseChangePanel tenantKey={tenantKey} order={data as Purchase} role={role} membershipId={membershipId} reload={reload} />}{canBatch && open && !(kind === 'purchase' && (data as Purchase).changes?.some(change => change.status === 'pending')) && <ActionPanel title={c.batchLabel} label={c.batchLabel} busy={busy} successKey={message?.startsWith('业务操作已提交') ? message : null} error={message?.startsWith('业务操作已提交') ? null : message}><section className="form-panel"><p>填写本批每行数量；确认后会同步更新库存和{kind === 'purchase' ? '应付' : '应收'}账款。请核对本批数量。</p><Field label="出入库仓库"><select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}><option value="">默认仓库</option>{warehouses.data?.filter(w=>w.active&&w.code!=='DEFAULT').map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></Field><Field label="本批单号（可留空自动生成）"><input value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} /></Field><div className="form-grid">{lines.filter(x => x.quantity > progress(x)).map(line => <Field key={line.id} label={`${line.sku} · 剩余 ${Number((line.quantity-progress(line)).toFixed(6))} ${line.baseUnit??'件'}`}><input type="number" min="0" step="0.000001" max={Number((line.quantity - progress(line)).toFixed(6))} aria-invalid={invalidBatchLines.some(x => x.id === line.id)} value={quantities[line.id] ?? 0} onChange={e => setQuantities({ ...quantities, [line.id]: Number(e.target.value) })} /></Field>)}</div><Notice text={batchError} /><DialogAction><button className="primary" disabled={!selected.length || Boolean(batchError) || busy} onClick={() => setPending('batch')}>{c.batchLabel}</button></DialogAction></section></ActionPanel>}{(kind === 'purchase' ? (data as Purchase).payable : (data as Contract).receivable) && <section className="panel"><h2>{kind === 'purchase' ? '应付' : '应收'}账款</h2><p>累计金额：<Money value={(kind === 'purchase' ? (data as Purchase).payable : (data as Contract).receivable)!.amount} /></p><Link className="button" to={`/t/${tenantKey}/erp/finance`}>查看收付款</Link></section>}{kind === 'contract' && (data as Contract).invoiceSummary && <section className="panel table-wrap"><h2>内部开票记录</h2><p>待处理申请：<Money value={(data as Contract).invoiceSummary!.requested} /> · 已登记：<Money value={(data as Contract).invoiceSummary!.registered} /> · 已作废：<Money value={(data as Contract).invoiceSummary!.voided} /></p>{(data as Contract).invoiceRequests?.length ? <table><thead><tr><th>金额</th><th>状态</th><th>内部编号</th><th>登记时间</th></tr></thead><tbody>{(data as Contract).invoiceRequests!.map(row => <tr key={row.id}><td><Money value={row.amount} /></td><td><Status value={row.status} /></td><td>{row.invoiceNumber || '—'}</td><td>{row.registeredAt ? new Date(row.registeredAt).toLocaleString('zh-CN') : '—'}</td></tr>)}</tbody></table> : <Empty text="暂无开票申请。" />}<Link className="button" to={`/t/${tenantKey}/erp/invoices`}>查看开票申请</Link></section>}<OrderWorkflow tenantKey={tenantKey} kind={approvalKind} id={id} version={data.version}/><TradeActions tenantKey={tenantKey} order={data} kind={kind==='purchase'?'purchase':'sales'} role={role} membershipId={membershipId} onChanged={reload}/><ConfirmDialog error={message} open={pending !== null} title={pending === 'submit' ? `提交${c.title}审核` : pending === 'confirm' ? `审核通过${c.title}` : pending === 'reject' ? `退回${c.title}` : c.batchLabel} description={pending === 'submit' ? <><p>提交 {data.number}</p><FlowPreview tenantKey={tenantKey} kind={approvalKind} amount={data.total}/></> : pending === 'confirm' ? `同意 ${data.number} 当前审批节点；全部审核通过后进入履约。${data.status === 'draft' ? '管理员直接确认草稿会留下特殊审计记录。' : '审核人与发起人必须不同。'}` : pending === 'reject' ? `退回 ${data.number}，原因：${reviewReason}` : `将处理 ${data.number} 本批 ${selected.reduce((sum, x) => sum + (quantities[x.id] ?? 0), 0)} 基础单位，并同步更新库存及账款。`} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void perform()} /></>;
}

function PurchaseChangePanel({ tenantKey, order, role, membershipId, reload }: { tenantKey: string; order: Purchase; role?: string; membershipId?: string; reload: () => Promise<void> }) {
  const changes = order.changes ?? [];
  const pendingChange = changes.find(change => change.status === 'pending');
  const canRequest = ['admin', 'purchasing'].includes(role ?? '') && membershipId === order.createdByMembershipId && ['ordered', 'partial_received'].includes(order.status) && !changes.some(change => ['pending', 'approved'].includes(change.status));
  const reviewSettings = useApiData<BusinessSettings>(erpApi(tenantKey, '/business-settings'));
  const reviewConfig = reviewSettings.data?.approvalConfig;
  const high = reviewConfig?.purchaseHigh;
  const assigned = high && Number(pendingChange?.proposed.total ?? 0) >= Number(high.threshold) ? high.members : reviewConfig?.purchase ?? [];
  const delegate = reviewConfig?.delegation;
  const qualified = (reviewSettings.data?.permissions.includes('erp.purchase.approve') ?? role === 'admin') && (!assigned.length ? role === 'admin' : assigned.includes(membershipId ?? '') || Boolean(delegate && delegate.to === membershipId && assigned.includes(delegate.from) && new Date(delegate.until) > new Date()));
  const changeFlow=useApiData<{flow:Workflow|null}>(pendingChange?erpApi(tenantKey,`/workflows/by-source/purchase_change/${pendingChange.id}`):null);
  useEffect(()=>{void changeFlow.reload();},[order.version,pendingChange?.id]);
  const canReview = pendingChange && membershipId !== pendingChange.requestedByMembershipId && (changeFlow.data?.flow?changeFlow.data.flow.canProcess:!changeFlow.loading&&!changeFlow.error&&qualified);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setQuantities(Object.fromEntries(order.lines.map(line => [line.id, line.quantity])));
    setNote(order.note ?? '');
  }, [order.id, order.version]);
  const validQuantities = order.lines.every(line => Number.isFinite(quantities[line.id]) && quantities[line.id] <= 1_000_000_000 && Math.abs(quantities[line.id]*1e6-Math.round(quantities[line.id]*1e6))<0.0001 && quantities[line.id] >= line.receivedQty && quantities[line.id] > 0);
  const requestChange = async () => {
    setBusy(true); setMessage(null);
    try {
      await api.post(erpApi(tenantKey, `/purchases/${order.id}/changes`), { version: order.version, reason, note, lines: order.lines.map(line => ({ lineId: line.id, quantity: quantities[line.id] })) });
      await reload();
      setReason('');
      setMessage('变更申请已提交，审核完成前暂停入库。');
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };
  const review = async () => {
    if (!pendingChange || !decision) return;
    setBusy(true); setMessage(null);
    try {
      await api.post(erpApi(tenantKey, `/purchases/${order.id}/changes/${pendingChange.id}/${decision}`), { version: order.version, ...(decision === 'reject' ? { reason: reviewReason } : {}) });
      await reload();
      setReviewReason('');
      setDecision(null);
      setMessage('采购变更审核已提交，以最新单据为准。');
    } catch (error) { setMessage(errorText(error)); setDecision(null); }
    finally { setBusy(false); }
  };
  return <section className="panel form-panel">
    <h2>采购变更</h2>

    <Notice text={message} tone={message?.startsWith('变更申请已') || message?.startsWith('采购变更审核已') ? 'success' : 'error'} />
    {pendingChange && <Notice text="本单有待审核变更，审核前暂停入库。" tone="info" />}
    {canRequest && <ActionPanel title="申请采购变更" label="申请变更" placement="inline" busy={busy} successKey={message?.startsWith('变更申请已') ? message : null} error={message?.startsWith('变更申请已') ? null : message}><div className="form-panel">

      <div className="form-grid">{order.lines.map(line => <Field key={line.id} label={`${line.sku} · 当前 ${line.quantity} ${line.baseUnit??'基础单位'} · 已收 ${line.receivedQty} ${line.baseUnit??'基础单位'}`}><input type="number" min={Math.max(0.000001, line.receivedQty)} step="0.000001" value={quantities[line.id] ?? line.quantity} onChange={event => setQuantities(previous => ({ ...previous, [line.id]: Number(event.target.value) }))} /></Field>)}</div>
      <Field label="变更原因"><textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="说明为什么需要调整采购数量" /></Field>
      <Field label="变更后备注"><textarea maxLength={2000} value={note} onChange={event => setNote(event.target.value)} /></Field>
      <DialogAction><button className="primary" disabled={busy || !validQuantities || !reason.trim()} onClick={() => void requestChange()}>提交变更审核</button></DialogAction>
    </div></ActionPanel>}
    {changes.length > 0 && <div>
      <h3>变更记录</h3>
      {changes.map(change => <div className="panel" key={change.id}>
        <p><Status value={change.status} /> · {new Date(change.createdAt).toLocaleString('zh-CN')} · {change.reason}</p>
        <p>原订单总额 <Money value={change.before.total} /> → 申请总额 <Money value={change.proposed.total} /></p>
        <ul>{change.proposed.lines.map(line => <li key={line.lineId}>{line.sku}：{change.before.lines.find(old => old.lineId === line.lineId)?.quantity ?? '—'} → {line.quantity} {order.lines.find(l=>l.id===line.lineId)?.baseUnit??'基础单位'}；已收 {line.receivedQty} {order.lines.find(l=>l.id===line.lineId)?.baseUnit??'基础单位'}</li>)}</ul>
        {change.reviewReason && <p>审核意见：{change.reviewReason}</p>}
      </div>)}
    </div>}
    {canReview && <div className="form-panel">
      <h3>审核待处理变更</h3>

      <DialogAction><button className="primary" disabled={busy} onClick={() => setDecision('approve')}>批准变更</button></DialogAction>
      <Field label="退回原因"><input maxLength={500} value={reviewReason} onChange={event => setReviewReason(event.target.value)} /></Field>
      <button disabled={busy || !reviewReason.trim()} onClick={() => setDecision('reject')}>退回变更</button>
    </div>}
    <ConfirmDialog error={message} open={decision !== null} title={decision === 'approve' ? '批准采购变更' : '退回采购变更'} description={decision === 'approve' ? `批准后订单总额变为 ${pendingChange?.proposed.total ?? '—'} 元，已收数量和应付不回退。` : `退回原因：${reviewReason}`} busy={busy} onCancel={() => setDecision(null)} onConfirm={() => void review()} />
  </section>;
}
