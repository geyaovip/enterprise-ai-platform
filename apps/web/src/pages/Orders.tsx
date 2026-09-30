import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { aiApi, api, erpApi, errorText } from '../api';
import { runAiTask } from '../ai-task';
import { ConfirmDialog, Empty, Field, Loading, Money, Notice, PageTitle, Pager, Status } from '../components';
import { useApiData } from '../hooks';
import type { Contract, Customer, Opportunity, Page, Product, Purchase, Supplier } from '../types';
import { PurchasePrint } from './PurchasePrint';

type Props = { tenantKey: string; role?: string };
type Kind = 'purchase' | 'contract';
type Order = Purchase | Contract;
type RiskReview = { summary: string; actions: string[]; missing_data: string[]; facts: Array<{ sku: string; ordered?: number; received?: number; remaining?: number; pending?: number; available?: number; currentShortfall?: number }> };
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
  const c = config[kind];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const alertProductId = kind === 'purchase' ? searchParams.get('productId') ?? '' : '';
  const alertSku = kind === 'purchase' ? searchParams.get('sku') ?? '' : '';
  const alertQuantity = Math.min(1_000_000_000, Math.max(1, Number(searchParams.get('quantity')) || 1));
  const alertSource = kind === 'purchase' && alertProductId && searchParams.has('balanceVersion') ? {
    productId: alertProductId,
    balanceVersion: Number(searchParams.get('balanceVersion')),
    reorderPoint: Number(searchParams.get('reorderPoint')),
    incomingQty: Number(searchParams.get('incomingQty')),
    suggestedOrderQty: alertQuantity,
  } : null;
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApiData<Page<Order>>(erpApi(tenantKey, `/${c.route}?page=${page}`));
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
  const [partyId, setPartyId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const opportunities = useApiData<Page<Opportunity>>(kind === 'contract' && canCreate && partyId ? erpApi(tenantKey, `/opportunities?customerId=${encodeURIComponent(partyId)}&page=${opportunityPage}&page_size=20&q=${encodeURIComponent(opportunitySearch)}`) : erpApi(tenantKey, '/products?page_size=1'));
  const [note, setNote] = useState(alertSource ? `库存预警来源：${alertSku}；库存版本 ${alertSource.balanceVersion}。` : '');
  const [lines, setLines] = useState<Array<{ productId: string; quantity: number }>>([{ productId: alertProductId, quantity: alertQuantity }]);
  const [selectedParties, setSelectedParties] = useState<Record<string, { id: string; code: string; name: string; active?: boolean }>>({});
  const [selectedProducts, setSelectedProducts] = useState<Record<string, { id: string; sku: string; name: string; active?: boolean }>>({});
  const [text, setText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const body = { number, [kind === 'purchase' ? 'supplierId' : 'customerId']: partyId, ...(kind === 'contract' && opportunityId ? { opportunityId } : {}), ...(alertSource ? { sourceInventory: alertSource } : {}), note, lines };
      const item = await api.post<Order>(erpApi(tenantKey, `/${c.route}`), body);
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
    <PageTitle title={kind === 'purchase' ? '采购' : '销售合同'} subtitle="单据金额由服务端计算，明细单价在创建时形成快照。" />
    <Notice text={error} /><Notice text={message} tone={message?.includes('已回填') ? 'info' : 'error'} />{alertProductId && kind === 'purchase' && <Notice text={`已从库存预警带入 ${alertSku} 的建议数量。保存时会复核库存版本和在途采购量；请核对供应商和数量，草稿不会自动确认。`} tone="info" />}
    <div className="panel table-wrap">{loading ? <Loading /> : !data?.items.length ? <Empty text={`暂无${c.title}。`} /> : <table><thead><tr><th>单号</th><th>{c.party}</th><th>状态</th><th>总额</th><th>版本</th><th>操作</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td><Link to={`/t/${tenantKey}/erp/${c.route}/${item.id}`}>{item.number}</Link></td><td>{partyName(item) ?? '—'}</td><td><Status value={item.status} /></td><td><Money value={item.total} /></td><td>{item.version}</td><td><Link to={`/t/${tenantKey}/erp/${c.route}/${item.id}`}>详情</Link></td></tr>)}</tbody></table>}{data && <Pager page={page} total={data.total} size={data.page_size} onPage={setPage} />}</div>
    {canCreate && <div className="two-column"><form className="panel form-panel" onSubmit={create}>
      <h2>新建{c.title}</h2>
      <div className="form-grid"><Field label="单号"><input required value={number} onChange={event => setNumber(event.target.value)} /></Field><Field label={`查找${c.party}`}><input value={partySearch} placeholder="输入名称或编号" onChange={event => { setPartySearch(event.target.value); setPartyPage(1); }} /></Field></div>
      <Field label={c.party}><select required value={partyId} onChange={event => chooseParty(event.target.value)}><option value="">请选择</option>{partyOptions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field>
      {parties.error && <Notice text={parties.error} />}{parties.data && <Pager page={partyPage} total={parties.data.total} size={parties.data.page_size} onPage={setPartyPage} />}
      {kind === 'contract' && <><Field label="查找商机"><input value={opportunitySearch} disabled={!partyId} placeholder="先选择客户，再输入商机名称" onChange={event => { setOpportunitySearch(event.target.value); setOpportunityPage(1); }} /></Field><Field label="关联商机（可选）"><select value={opportunityId} disabled={!partyId} onChange={event => { const id = event.target.value; setOpportunityId(id); setSelectedOpportunity(opportunityOptions.find(item => item.id === id) ?? null); }}><option value="">不关联</option>{opportunityOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{partyId && opportunities.error && <Notice text={opportunities.error} />}{partyId && opportunities.data && <Pager page={opportunityPage} total={opportunities.data.total} size={opportunities.data.page_size} onPage={setOpportunityPage} />}</>}
      <h3>明细</h3>
      <Field label="查找商品"><input value={productSearch} placeholder="输入 SKU 或名称" onChange={event => { setProductSearch(event.target.value); setProductPage(1); }} /></Field>
      {products.error && <Notice text={products.error} />}{products.data && <Pager page={productPage} total={products.data.total} size={products.data.page_size} onPage={setProductPage} />}
      {lines.map((line, index) => <div className="line-editor" key={index}><select aria-label={`第 ${index + 1} 行商品`} required value={line.productId} onChange={event => chooseProduct(index, event.target.value)}><option value="">选择商品</option>{productOptions.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select><input aria-label={`第 ${index + 1} 行数量`} type="number" min="1" required value={line.quantity} onChange={event => setLines(previous => previous.map((item, current) => current === index ? { ...item, quantity: Number(event.target.value) } : item))} /><button type="button" disabled={lines.length === 1} onClick={() => setLines(previous => previous.filter((_, current) => current !== index))}>移除</button></div>)}
      <button type="button" onClick={() => setLines(previous => [...previous, { productId: '', quantity: 1 }])}>增加一行</button>
      <Field label="备注"><textarea value={note} onChange={event => setNote(event.target.value)} /></Field>
      <button className="primary" disabled={busy}>{busy ? '保存中…' : `创建${c.title}草稿`}</button>
    </form><section className="panel form-panel"><h2>AI 文字提单</h2><p>只处理粘贴文本，提取结果会回填左侧草稿；保存前请核对编号、商品和数量。</p><Field label="业务文字"><textarea rows={8} value={text} onChange={event => setText(event.target.value)} placeholder="粘贴采购需求或销售合同文字" /></Field><button type="button" disabled={extracting || text.trim().length < 10} onClick={() => void extract()}>{extracting ? '提取中…' : 'AI 提取草稿'}</button></section></div>}
  </>;
}

function OrderDetail({ tenantKey, role, kind }: Props & { kind: Kind }) {
  const { id = '' } = useParams();
  const c = config[kind];
  const { data, loading, error, reload } = useApiData<Order>(erpApi(tenantKey, `/${c.route}/${id}`));
  const priorReview = useApiData<ReviewEnvelope>(aiApi(tenantKey, `/risk-reviews/${c.resourceType}/${id}?version=${data?.version ?? 0}`));
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [documentNumber, setDocumentNumber] = useState('');
  const [pending, setPending] = useState<'submit' | 'confirm' | 'reject' | 'batch' | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewOverride, setReviewOverride] = useState<ReviewEnvelope | null>(null);
  const canConfirm = role === 'admin';
  const canSubmit = kind === 'purchase' ? role === 'purchasing' : role === 'sales';
  const canBatch = ['admin', 'warehouse'].includes(role ?? '');
  useEffect(() => { if (data) setQuantities(Object.fromEntries(data.lines.map(x => [x.id, 0]))); }, [data?.id, data?.version]);
  useEffect(() => { setReviewOverride(null); }, [id, data?.version]);
  const perform = async () => { if (!data || !pending) return; setBusy(true); setMessage(null); try { if (pending === 'submit' || pending === 'confirm' || pending === 'reject') await api.post(erpApi(tenantKey, `/${c.route}/${id}/${pending}`), { version: data.version, ...(pending === 'reject' ? { reason: reviewReason } : {}) }); else await api.post(erpApi(tenantKey, `/${c.route}/${id}/${c.batch}`), { version: data.version, documentNumber: documentNumber || undefined, lines: data.lines.filter(x => quantities[x.id] > 0).map(x => ({ lineId: x.id, quantity: quantities[x.id] })) }); await reload(); await priorReview.reload(); setPending(null); setDocumentNumber(''); setReviewReason(''); setMessage('业务操作已提交，以最新单据状态为准。'); } catch (e) { setMessage(errorText(e)); setPending(null); } finally { setBusy(false); } };
  const analyze = async () => { setBusy(true); setMessage(null); try { const result = await api.post<ReviewEnvelope>(aiApi(tenantKey, '/risk-reviews'), { type: c.resourceType, id }); setReviewOverride(result); } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); } };
  if (loading) return <Loading />;
  if (!data) return <><Notice text={error} /><Link to={`/t/${tenantKey}/erp/${c.route}`}>返回列表</Link></>;
  const lines = data.lines;
  const progress = (line: typeof lines[number]) => kind === 'purchase' ? (line as Purchase['lines'][number]).receivedQty : (line as Contract['lines'][number]).shippedQty;
  const open = kind === 'purchase' ? ['ordered', 'partial_received'].includes(data.status) : ['confirmed', 'partial_shipped'].includes(data.status);
  const selected = lines.filter(x => quantities[x.id] > 0);
  const shownReview = reviewOverride ?? priorReview.data;
  return <><PageTitle title={`${c.title} ${data.number}`} subtitle={`版本 ${data.version} · ${kind === 'purchase' ? '入库' : '出库'}与账款保持同一业务事务`} action={<>{kind === 'purchase' && <button type="button" onClick={() => window.print()}>打印采购单</button>}<Link to={`/t/${tenantKey}/erp/${c.route}`}>返回列表</Link></>} />{kind === 'purchase' && <PurchasePrint order={data as Purchase} />}<Notice text={error} /><Notice text={message} tone={message?.startsWith('业务操作') ? 'success' : 'error'} /><div className="detail-grid"><section className="panel"><h2>单据概览</h2><dl className="facts"><dt>状态</dt><dd><Status value={data.status} /></dd><dt>金额</dt><dd><Money value={data.total} /></dd><dt>{c.party}</dt><dd>{partyName(data) ?? '—'}</dd><dt>备注</dt><dd>{data.note || '—'}</dd></dl>{canSubmit && data.status === 'draft' && <button className="primary" onClick={() => setPending('submit')}>提交审核</button>}{canConfirm && data.status === 'draft' && <button className="primary" onClick={() => setPending('confirm')}>管理员直接确认</button>}{canConfirm && data.status === 'pending_approval' && <div className="form-panel"><button className="primary" onClick={() => setPending('confirm')}>审核通过</button><Field label="退回原因"><input maxLength={500} value={reviewReason} onChange={event => setReviewReason(event.target.value)} placeholder="退回时必填" /></Field><button disabled={!reviewReason.trim()} onClick={() => setPending('reject')}>退回草稿</button></div>}</section><section className="panel"><h2>AI 履约分析</h2><p>数量和库存差额由系统核算；AI 只解释风险并提出待核实事项。</p><button disabled={busy} onClick={() => void analyze()}>{busy ? '分析中…' : shownReview?.review ? '重新分析' : '分析当前单据'}</button> <Link to={`/t/${tenantKey}/ai?type=${c.resourceType}&id=${id}`}>在聊天中继续</Link>{priorReview.error && <Notice text={priorReview.error} />}{shownReview?.review && <div className="analysis"><p>{shownReview.review.summary}</p><strong>系统核算依据</strong><ul>{shownReview.review.facts.map(fact => <li key={fact.sku}>{fact.sku} · {kind === 'purchase' ? `订购 ${fact.ordered}、已收 ${fact.received}、未收 ${fact.remaining}` : `待发 ${fact.pending}、当前库存 ${fact.available}、当前差额 ${fact.currentShortfall}`} 件</li>)}</ul>{shownReview.review.actions.length > 0 && <><strong>建议核实</strong><ul>{shownReview.review.actions.map((action, index) => <li key={index}>{action}</li>)}</ul></>}{shownReview.review.missing_data.length > 0 && <><strong>缺少的数据</strong><ul>{shownReview.review.missing_data.map((item, index) => <li key={index}>{item}</li>)}</ul></>}{shownReview.reviewedAt && <small>分析时间：{new Date(shownReview.reviewedAt).toLocaleString('zh-CN')}</small>}</div>}</section></div><section className="panel table-wrap"><h2>明细与进度</h2><table><thead><tr><th>商品</th><th>数量</th><th>已{kind === 'purchase' ? '收' : '发'}</th><th>剩余</th><th>快照单价</th><th>金额</th></tr></thead><tbody>{lines.map(line => <tr key={line.id}><td>{line.sku} · {line.name}</td><td>{line.quantity} 件</td><td>{progress(line)} 件</td><td>{line.quantity - progress(line)} 件</td><td><Money value={line.unitPrice} /></td><td><Money value={line.lineTotal} /></td></tr>)}</tbody></table></section>{canBatch && open && <section className="panel form-panel"><h2>{c.batchLabel}</h2><p>填写本批每行数量；库存、流水和{kind === 'purchase' ? '应付' : '应收'}会一起提交。失败则整批回滚。</p><Field label="本批单号（可留空自动生成）"><input value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} /></Field><div className="form-grid">{lines.filter(x => x.quantity > progress(x)).map(line => <Field key={line.id} label={`${line.sku} · 剩余 ${line.quantity - progress(line)} 件`}><input type="number" min="0" max={line.quantity - progress(line)} value={quantities[line.id] ?? 0} onChange={e => setQuantities({ ...quantities, [line.id]: Number(e.target.value) })} /></Field>)}</div><button className="primary" disabled={!selected.length || busy} onClick={() => setPending('batch')}>{c.batchLabel}</button></section>}{(kind === 'purchase' ? (data as Purchase).payable : (data as Contract).receivable) && <section className="panel"><h2>{kind === 'purchase' ? '应付' : '应收'}账款</h2><p>累计金额：<Money value={(kind === 'purchase' ? (data as Purchase).payable : (data as Contract).receivable)!.amount} /></p><Link to={`/t/${tenantKey}/erp/finance`}>查看收付款</Link></section>}<ConfirmDialog open={pending !== null} title={pending === 'submit' ? `提交${c.title}审核` : pending === 'confirm' ? `审核通过${c.title}` : pending === 'reject' ? `退回${c.title}` : c.batchLabel} description={pending === 'submit' ? `提交 ${data.number} 给管理员审核；审核通过后才可${kind === 'purchase' ? '入库' : '出库'}。` : pending === 'confirm' ? `将 ${data.number} 确认为可履约单据。${data.status === 'draft' ? '管理员直接确认草稿会留下特殊审计记录。' : '审核人与发起人必须不同。'}` : pending === 'reject' ? `退回 ${data.number}，原因：${reviewReason}` : `将处理 ${data.number} 本批 ${selected.reduce((sum, x) => sum + (quantities[x.id] ?? 0), 0)} 件，并同步更新库存及账款。`} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void perform()} /></>;
}
