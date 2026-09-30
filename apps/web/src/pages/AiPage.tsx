import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, aiApi, errorText } from '../api';
import { ConfirmDialog, Empty, Loading, Notice, PageTitle, Status } from '../components';
import { useApiData } from '../hooks';
import type { AiAction, Conversation } from '../types';

type Summary = { id: string; title: string; resourceType?: string; resourceId?: string; updatedAt: string };
type Shortage = { productId: string; sku: string; name: string; quantity: number; reorderPoint: number; incomingQty: number; status: string; suggestedMinimum: number };

export function AiPage({ tenantKey }: { tenantKey: string }) {
  const [params] = useSearchParams();
  const type = params.get('type');
  const id = params.get('id');
  const linkedConversation = params.get('conversation');
  const linkedAction = params.get('action');
  const validResource = type && ['purchase', 'contract', 'customer', 'inventory'].includes(type) && (type === 'inventory' || id);
  const base = aiApi(tenantKey, '');
  const list = useApiData<Summary[]>(`${base}/conversations`);
  const shortages = useApiData<Shortage[]>(`${base}/shortages`);
  const [selected, setSelected] = useState<string | null>(linkedConversation);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [content, setContent] = useState('');
  const [allowAction, setAllowAction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<AiAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { if (!selected) { setConversation(null); return; } api.get<Conversation>(`${base}/conversations/${selected}`).then(setConversation).catch(e => setError(errorText(e))); }, [base, selected]);
  useEffect(() => { if (linkedConversation) setSelected(linkedConversation); }, [linkedConversation]);
  useEffect(() => { if (linkedAction) void api.get<AiAction>(`${base}/actions/${linkedAction}`).then(setAction).catch(e => setError(errorText(e))); }, [base, linkedAction]);
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const created = await api.post<Conversation>(`${base}/conversations`, { title: validResource ? `${type} 业务分析` : '新会话', ...(validResource ? { resource: { type, ...(id ? { id } : {}) } } : {}) });
      setSelected(created.id); setConversation(created); await list.reload();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault(); if (!conversation || !content.trim()) return;
    setBusy(true); setError(null);
    try {
      const reply = await api.post<{ message: Conversation['messages'][number]; version: number }>(`${base}/conversations/${conversation.id}/messages`, { content, version: conversation.version, allowAction });
      setConversation(old => old ? { ...old, version: reply.version, messages: [...old.messages, { role: 'user', content }, reply.message] } : old);
      setContent(''); setAllowAction(false); await list.reload();
      if (reply.message.actionId) setAction(await api.get<AiAction>(`${base}/actions/${reply.message.actionId}`));
    } catch (x) { setError(errorText(x)); await api.get<Conversation>(`${base}/conversations/${conversation.id}`).then(setConversation).catch(() => {}); }
    finally { setBusy(false); }
  };
  const inspect = async (actionId: string) => { try { setAction(await api.get<AiAction>(`${base}/actions/${actionId}`)); } catch (e) { setError(errorText(e)); } };
  const confirm = async () => {
    if (!action) return;
    setBusy(true); setError(null);
    try { await api.post(`${base}/actions/${action.id}/confirm`, {}); setAction(await api.get<AiAction>(`${base}/actions/${action.id}`)); setConfirming(false); }
    catch (e) { setError(errorText(e)); setConfirming(false); }
    finally { setBusy(false); }
  };
  const removeConversation = async () => {
    if (!conversation) return;
    setBusy(true); setError(null);
    try { await api.del(`${base}/conversations/${conversation.id}`); setRemoving(false); setSelected(null); setConversation(null); setAction(null); await list.reload(); }
    catch (e) { setError(errorText(e)); setRemoving(false); }
    finally { setBusy(false); }
  };
  const result = action?.result && typeof action.result === 'object' ? action.result as Record<string, unknown> : null;
  const resultId = typeof result?.id === 'string' ? result.id : null;
  const inputId = typeof action?.input.id === 'string' ? action.input.id : null;
  const actionTargetId = resultId ?? inputId;
  const actionHref = action?.toolId.startsWith('erp.purchase.') && actionTargetId ? `/t/${tenantKey}/erp/purchases/${actionTargetId}`
    : action?.toolId === 'erp.contract.ship' && actionTargetId ? `/t/${tenantKey}/erp/contracts/${actionTargetId}`
      : action?.toolId === 'erp.finance.record_payment' ? `/t/${tenantKey}/erp/finance`
        : action?.toolId === 'erp.customer.create' ? `/t/${tenantKey}/erp/customers`
          : action?.toolId === 'erp.opportunity.create' ? `/t/${tenantKey}/erp/opportunities` : null;
  return <><PageTitle title="AI 业务助手" subtitle="可以查询当前企业的业务事实、生成草稿，并在确认后执行获授权的操作。" action={<button className="primary" disabled={busy} onClick={() => void create()}>新建会话</button>} /><Notice text={error} />{validResource && <Notice text={`当前对象：${type} ${id ?? ''}。点击新建会话可带入这份业务上下文。`} tone="info" />}<div className="ai-layout"><aside className="panel ai-conversations"><h2>会话</h2>{list.loading ? <Loading /> : list.data?.length ? list.data.map(x => <button key={x.id} type="button" className={selected === x.id ? 'active' : ''} onClick={() => { setSelected(x.id); setAction(null); }}>{x.title}<small>{new Date(x.updatedAt).toLocaleString('zh-CN')}</small></button>) : <Empty text="暂无会话" />}</aside><section className="panel ai-chat">{conversation ? <><div className="chat-header"><strong>{conversation.title}</strong>{conversation.version > 0 && <small>版本 {conversation.version}</small>}<button type="button" disabled={busy} onClick={() => setRemoving(true)}>删除会话</button></div><div className="messages" aria-live="polite">{conversation.messages?.length ? conversation.messages.map((m, index) => <div className={`message ${m.role}`} key={index}><strong>{m.role === 'user' ? '你' : 'AI 助手'}</strong><p>{m.content}</p>{m.sources?.map(s => <small key={`${s.type}-${s.id}`}>依据：{s.appId}/{s.type}/{s.id}{s.version ? ` · 版本 ${s.version}` : ''}</small>)}{m.actionId && <button type="button" onClick={() => void inspect(m.actionId!)}>查看业务操作</button>}</div>) : <Empty text="描述要处理的业务问题，或明确提出要执行的操作。" />}</div><form className="chat-compose" onSubmit={send}><label htmlFor="chat-prompt">给 AI 助手发送消息</label><textarea id="chat-prompt" maxLength={4000} value={content} onChange={e => setContent(e.target.value)} placeholder="例如：根据当前采购单分析剩余入库，或创建一张采购草稿" /><label className="action-consent"><input type="checkbox" checked={allowAction} onChange={e => setAllowAction(e.target.checked)} />允许本条消息发起业务操作；入库、出库和收付款仍需再次确认</label><button className="primary" disabled={busy || !content.trim()}>{busy ? '处理中…' : '发送'}</button></form></> : <div className="chat-placeholder"><h2>从一段业务对话开始</h2><p>AI 的建议需核对。执行结果以系统业务回执为准。</p><button className="primary" disabled={busy} onClick={() => void create()}>新建会话</button></div>}</section></div>{action && <section className="panel action-review"><h2>业务操作详情</h2><dl className="facts"><dt>工具</dt><dd>{action.toolId}</dd><dt>状态</dt><dd><Status value={action.status} /></dd><dt>待提交参数</dt><dd><pre>{JSON.stringify(action.input, null, 2)}</pre></dd>{action.status === 'completed' && action.result != null && <><dt>业务回执</dt><dd><p>{typeof result?.number === 'string' ? `单号 ${result.number} · ` : ''}{typeof result?.status === 'string' ? `业务状态 ${result.status}` : '操作已完成'}</p>{actionHref && <Link to={actionHref}>查看业务对象</Link>}<details><summary>查看完整回执</summary><pre>{JSON.stringify(action.result, null, 2)}</pre></details></dd></>}{action.status === 'pending' && actionHref && <><dt>执行前核对</dt><dd><Link to={actionHref}>查看当前业务对象</Link></dd></>}</dl>{action.status === 'pending' && <button className="primary" onClick={() => setConfirming(true)}>核对后确认执行</button>}</section>}{shortages.data && <section className="panel"><h2>低库存建议</h2>{shortages.data.length ? <div className="cards">{shortages.data.map(x => <div className="metric" key={x.productId}><strong>{x.sku} · {x.name}</strong><span>现存 {x.quantity} 件，阈值 {x.reorderPoint} 件，已确认待入库 {x.incomingQty} 件；{x.status === 'awaiting_receipt' ? '等待入库' : `建议新增采购 ${x.suggestedMinimum} 件`}</span></div>)}</div> : <Empty text="当前没有低库存商品。" />}</section>}<ConfirmDialog open={confirming} title="确认 AI 业务操作" description={<div><p>请核对工具和全部参数。此操作会写入业务数据。</p><strong>{action?.toolId}</strong><pre>{JSON.stringify(action?.input, null, 2)}</pre></div>} busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void confirm()} /><ConfirmDialog open={removing} title="删除会话" description={<p>将删除这段聊天记录。已完成业务操作及审计记录仍会保留；有待确认操作时无法删除。</p>} busy={busy} onCancel={() => setRemoving(false)} onConfirm={() => void removeConversation()} /></>;
}
