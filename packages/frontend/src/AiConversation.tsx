import { AiMemoryPanel } from './AiMemoryPanel';
import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, aiApi, errorText, ApiError } from './api';
import { ConfirmDialog, Empty, Loading, Notice, Status, AiDialog } from './components';
import { ServiceNotice, useServices } from '@suite/frontend/services';
import { useApiData } from './hooks';
import { actionName } from '@suite/frontend/labels';
import { safeReturn } from './safe-return';
import type { AiAction, Conversation, AiProcess } from './types';
import { AiProcessView } from './AiProcessView';
import { Sparkles, Send, X, ClipboardList, Boxes, ChartNoAxesCombined, FileText } from '@suite/frontend/components';

type Summary = { id: string; title: string; resourceType?: string; resourceId?: string; updatedAt: string };
type Shortage = { productId: string; sku: string; name: string; unit:string;quantity: number; reorderPoint: number; incomingQty: number; status: string; suggestedMinimum: number };
type ActionSummary = { id: string; toolId: string; status: string; createdAt: string };
type AiProgress = AiProcess & {actionRequested:boolean;stage:string};
const progressLabels: Record<string, string> = {
  preparing_context: '核对业务上下文', searching_knowledge: '检索企业知识', waiting_runtime: '连接 AI 助手', model_processing: 'AI 正在处理',
  generating_answer: '生成回答', validating_result: '核对结果与权限', preparing_action: '核对操作参数',
  executing_action: '执行业务操作', saving_reply: '保存回复',
};

export function AiConversation({ tenantKey, entry = 'enterprise', knowledgeEnabled = false, inventoryReadable=false, open = true, onClose, scope = 'erp', apiBase }: { tenantKey: string; entry?: 'enterprise' | 'erp'; knowledgeEnabled?: boolean; inventoryReadable?:boolean; open?:boolean; onClose?:()=>void; scope?:'erp'|'crm'|'mes'|'tenant_admin'|'platform_admin'; apiBase?:string }) {
  const services = useServices(); const { aiAvailable } = services; const management = scope==='tenant_admin'||scope==='platform_admin';
  const location = useLocation();
  const draftInputs = useRef(new Map<string,string>());
  const freshConversation = useRef<Conversation|null>(null);
  const autoSend = useRef<string|null>(null);
  const wasOpen = useRef(false);
  const resourceNames: Record<string, string> = {bom:'BOM',plan:'生产计划',order:'工单',production:'生产概览',segment:'客户分群',operation_task:'运营任务',dashboard:'客户经营概览', purchase: '采购订单', contract: '销售合同', customer: '客户', inventory: '库存' };
  const [params, setParams] = useSearchParams();
  const returnTo=safeReturn(params.get('returnTo'),tenantKey);
  const deepLink = management || /\/ai$/.test(location.pathname);
  const type = deepLink ? params.get('type') : null;
  const id = deepLink ? params.get('id') : null;
  const linkedConversation = deepLink ? params.get('conversation') : null;
  const linkedAction = deepLink ? params.get('action') : null;
  const validResource = !management && type && (scope==='mes'?['bom','plan','order','production']:scope==='crm'?['customer','segment','operation_task','dashboard']:['purchase','contract','customer','inventory']).includes(type) && (['inventory','dashboard','production'].includes(type) || id);
  const base = apiBase ?? aiApi(tenantKey, '');
  const [memoryOpen,setMemoryOpen]=useState(false);
  useEffect(()=>setMemoryOpen(false),[base]);
  const memoryPreferences=useApiData<{enabled:boolean}>(services.data?.ai.enabled?base+'/memory/preferences':null);
  const list = useApiData<Summary[]>(services.data?.ai.enabled ? `${base}/conversations` : null);
  const shortages = useApiData<Shortage[]>(inventoryReadable?`${base}/shortages`:null);
  const [selected, setSelected] = useState<string | null>(linkedConversation);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [recentActions, setRecentActions] = useState<ActionSummary[]>([]);
  const [content, setContent] = useState('');
  const allowAction = !management;
  const useKnowledge = !management && knowledgeEnabled && services.knowledgeAvailable;
  const [thinkingMode, setThinkingMode] = useState<'auto'|'fast'|'deep'>('auto');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [activeTask,setActiveTask]=useState<string|null>(null);
  const [runStage,setRunStage]=useState('queued');
  const [partialText,setPartialText]=useState('');
  const [progress,setProgress]=useState<AiProgress|null>(null);
  const messagesRef=useRef<HTMLDivElement|null>(null);
  const keepLatestVisible=useRef(true);
  const [completedTask,setCompletedTask]=useState<string|null>(null);
  const firstCharacter=useRef<{startedAt:number;conversationId:string;startingMessageCount:number;taskId:string|null;feedbackRecorded?:boolean;executionRecorded?:boolean;runtimeRecorded?:boolean}|null>(null);
  const pendingSend=useRef<{key:string;content:string;version:number;thinkingMode:string}|null>(null);
  const choose=(value:string|null)=>{draftInputs.current.set(selected??'new',content);keepLatestVisible.current=true;setRemoving(false);setSelected(value);setContent(value?draftInputs.current.get(value)??'':'');setAction(null);if(deepLink){const next=new URLSearchParams(params);if(value)next.set('conversation',value);else next.delete('conversation');next.delete('action');setParams(next,{replace:true});}};
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<AiAction | null>(null);
  const [removing, setRemoving] = useState(false);
  const composer=useRef({version:0,ready:false,signature:'',tail:Promise.resolve()});
  const draftLatest=useRef({content:'',selected:null as string|null});draftLatest.current={content,selected};
  const [draftState,setDraftState]=useState('');
  const [draftReload,setDraftReload]=useState(0);
  const queueDraft=(text:string,conversationId:string|null)=>{
    const state=composer.current,signature=JSON.stringify([text,conversationId]);
    state.tail=state.tail.then(async()=>{if(!state.ready||state.signature===signature)return;if(composer.current===state)setDraftState('草稿保存中…');try{const r=await api.put<any>(base+'/draft',{version:state.version,content:text,conversationId,requestKey:crypto.randomUUID()});state.version=r.version;state.signature=signature;if(composer.current===state)setDraftState(text?'草稿已保存':'');}catch(e){state.ready=false;if(composer.current===state){setDraftState('草稿保存失败');setError(errorText(e)+'；请重新载入服务器草稿后核对。');}}});
    return state.tail;
  };
  useEffect(()=>{if(scope!=='crm')return;let alive=true;composer.current={version:0,ready:false,signature:'',tail:Promise.resolve()};api.get<any>(base+'/draft').then(v=>{if(!alive)return;setContent(v.content??'');if(!linkedConversation&&v.conversationId)setSelected(v.conversationId);composer.current={version:v.version,ready:true,signature:JSON.stringify([v.content??'',v.conversationId??null]),tail:Promise.resolve()};setDraftState(v.content?'已恢复服务器草稿':'');if(v.scopeChanged)setError('授权范围已变化，问题草稿已恢复，请重新选择业务上下文。');}).catch(e=>{if(alive){setDraftState('草稿读取失败');setError(errorText(e));}});return()=>{alive=false;};},[base,scope,draftReload]);
  useEffect(()=>{if(scope!=='crm'||!composer.current.ready)return;const signature=JSON.stringify([content,selected]);if(signature===composer.current.signature)return;setDraftState('草稿待保存…');const timer=setTimeout(()=>void queueDraft(content,selected),700);return()=>clearTimeout(timer);},[base,scope,content,selected,draftReload]);
  useEffect(()=>()=>{if(scope==='crm'&&composer.current.ready)void queueDraft(draftLatest.current.content,draftLatest.current.selected);},[base,scope]);

  useLayoutEffect(() => { if(action?.id && keepLatestVisible.current) messagesRef.current?.querySelector('.chat-workspace')?.scrollIntoView({block:'nearest'}); }, [action?.id]);
  useEffect(() => { let alive = true; pendingSend.current=null;firstCharacter.current=null;setCompletedTask(null);setConversation(null); setAction(null); setActiveTask(null);setSending(false);setActiveRun(null);setPartialText('');setProgress(null);setError(null); if (!selected) { setConversation(null); setRecentActions([]); return; } if(freshConversation.current?.id===selected){setConversation(freshConversation.current);freshConversation.current=null;setRecentActions([]);return;} api.get<Conversation>(`${base}/conversations/${selected}`).then(c => { if (alive) {setConversation(c);setActiveTask(c.activeTask?.id??null);setSending(Boolean(c.activeTask));} }).catch(e => { if (alive) setError(errorText(e)); }); api.get<ActionSummary[]>(`${base}/conversations/${selected}/actions`).then(a => { if (alive) setRecentActions(a); }).catch(e => { if (alive) setError(errorText(e)); }); return () => { alive = false; }; }, [base, selected]);
  useLayoutEffect(() => {
    const pending=firstCharacter.current;
    if(!pending || pending.conversationId!==selected || !sending) return;
    let afterPaint:number|undefined;
    const frame=requestAnimationFrame(()=>{afterPaint=requestAnimationFrame(()=>{
      const visible=messagesRef.current?.querySelector('.ai-progress');
      const rect=visible?.getBoundingClientRect();
      if(firstCharacter.current!==pending || document.visibilityState!=='visible' || !rect?.height || rect.bottom<=0 || rect.top>=window.innerHeight) return;
      const record=(name:string)=>performance.measure(name,{start:pending.startedAt,end:performance.now(),detail:{taskId:pending.taskId,stage:progress?.stage??runStage}});
      if(!pending.feedbackRecorded){record('suite.ai.feedbackVisible');pending.feedbackRecorded=true;}
      if(progress?.steps.length && !pending.executionRecorded){record('suite.ai.executionVisible');pending.executionRecorded=true;}
      if(progress?.steps.some(step=>step.stage==='model_processing') && !pending.runtimeRecorded){record('suite.ai.runtimeVisible');pending.runtimeRecorded=true;}
    });});
    return()=>{cancelAnimationFrame(frame);if(afterPaint)cancelAnimationFrame(afterPaint);};
  },[selected,sending,progress,runStage]);
  useLayoutEffect(() => {
    const pending=firstCharacter.current;
    if (!pending || pending.conversationId!==selected || document.visibilityState!=='visible') return;
    const showingPartial=sending && Boolean(partialText.trim());
    const showingFinal=!sending && completedTask===pending.taskId && (conversation?.messages?.length??0)>pending.startingMessageCount+1 && conversation?.messages?.at(-1)?.role==='assistant';
    if (!showingPartial && !showingFinal) return;
    let afterPaint: number | undefined;
    const frame=requestAnimationFrame(() => { afterPaint=requestAnimationFrame(() => {
      const visible=showingPartial ? document.querySelector('.ai-progress .ai-answer-content') : document.querySelector('.messages .message.assistant:last-child p');
      if (firstCharacter.current!==pending || document.visibilityState!=='visible' || !visible?.textContent?.trim()) return;
      const elapsedMs=performance.now()-pending.startedAt;
      performance.measure('suite.ai.firstVisibleCharacter', {start:pending.startedAt,end:performance.now(),detail:{taskId:pending.taskId}});
      window.dispatchEvent(new CustomEvent('suite:ai-first-visible-character',{detail:{taskId:pending.taskId,elapsedMs}}));
      firstCharacter.current=null;
    }); });
    return () => { cancelAnimationFrame(frame); if(afterPaint)cancelAnimationFrame(afterPaint); };
  },[selected,sending,partialText,conversation,completedTask]);
  useLayoutEffect(()=>{const area=messagesRef.current;if(area&&keepLatestVisible.current)area.scrollTop=area.scrollHeight;},[selected,conversation?.messages,partialText,sending]);
  useEffect(() => { if (linkedConversation) setSelected(linkedConversation); }, [linkedConversation]);
  useEffect(()=>{if(open&&!wasOpen.current&&!linkedConversation&&!busy)choose(null);wasOpen.current=open;},[open]);
  useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(content.trim()||[...draftInputs.current.values()].some(value=>value.trim())){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[content]);
  useEffect(() => { if (linkedAction) void api.get<AiAction>(`${base}/actions/${linkedAction}`).then(setAction).catch(e => setError(errorText(e))); }, [base, linkedAction]);
  const latestActionId=conversation?.messages.at(-1)?.actionId;
  useEffect(()=>{
    if(management||sending||!latestActionId)return;
    let alive=true;
    api.get<AiAction>(`${base}/actions/${latestActionId}`).then(value=>{if(alive&&value.status==='pending')setAction(value);}).catch(e=>{if(alive)setError(errorText(e));});
    return()=>{alive=false;};
  },[base,management,sending,latestActionId]);
  useEffect(() => {
    if (!selected || !activeTask) return;
    type FinalTurn={message?:Conversation['messages'][number];version?:number};
    let alive=true,polling=false,settled=false;
    const events=new EventSource(`/api/v1${base}/tasks/${activeTask}/events`);
    const finish=async(status:string,result?:FinalTurn)=>{
      if(!alive||settled)return;
      settled=true;
      try{
        if(result?.message?.role==='assistant'&&Number.isInteger(result.version)){
          const message=result.message,version=result.version!;
          setConversation(current=>current?.id===selected&&current.version<version?{...current,version,activeTask:null,messages:[...current.messages,message]}:current);
          const tools=message.process?.tools?.filter(tool=>tool.actionId)??[];
          setRecentActions(current=>[...current.filter(item=>!tools.some(tool=>tool.actionId===item.id)),...tools.map(tool=>({id:tool.actionId!,toolId:tool.toolId,status:tool.status,createdAt:tool.startedAt}))]);
        }else{
          // Older servers and cancelled turns without a stored result still
          // hydrate immediately on the terminal event, without waiting a poll.
          const c=await api.get<Conversation>(`${base}/conversations/${selected}`);
          if(!alive)return;
          setConversation(c);
        }
        if(status==='completed')setCompletedTask(activeTask);else firstCharacter.current=null;
        setSending(false);setActiveTask(null);setActiveRun(null);setPartialText('');setProgress(null);
        events.close();void list.reload();window.dispatchEvent(new Event('suite:notifications-changed'));
      }catch(e){settled=false;if(alive){setError(errorText(e));if(e instanceof ApiError&&[401,403,404].includes(e.status)){setConversation(null);setRecentActions([]);setAction(null);setActiveTask(null);setPartialText('');setProgress(null);setSending(false);events.close();}}}
    };
    events.addEventListener('progress',(event:MessageEvent)=>{
      try{const value=JSON.parse(event.data) as {status:string;text:string;progress?:AiProgress|null;result?:FinalTurn};
        if(!alive||settled)return;
        if(['queued','running'].includes(value.status)){setPartialText(value.text);setProgress(value.progress??null);}
        else void finish(value.status,value.result);
      }catch{events.close();}
    });
    events.addEventListener('denied',()=>{setPartialText('');setProgress(null);events.close();});
    const refresh = async () => {
      if(polling||settled)return;polling=true;
      try {
        const [job,runs]=await Promise.all([api.get<{status:string;result?:FinalTurn&{partialText?:string;progress?:AiProgress}}>(`${base}/tasks/${activeTask}`),api.get<Array<{id:string;status:string}>>(`${base}/conversations/${selected}/runs`)]);
        if(!alive||settled)return;
        const active=runs.find(r=>['queued','preparing','running'].includes(r.status));
        setActiveRun(active?.id??null);setRunStage(active?.status??job.status);
        if(job.status==='queued')setPartialText('');
        if(job.status==='running'){if(typeof job.result?.partialText==='string')setPartialText(job.result.partialText);setProgress(job.result?.progress??null);}
        if(!['queued','running'].includes(job.status)){
          await finish(job.status,job.result);
        }
      }catch(e){if(alive){setError(errorText(e));if(e instanceof ApiError&&[401,403,404].includes(e.status)){setConversation(null);setAction(null);setRecentActions([]);setActiveTask(null);setPartialText('');setProgress(null);setSending(false);}}}finally{polling=false;}
    };
    void refresh(); const timer=window.setInterval(refresh,1500);
    return()=>{alive=false;events.close();window.clearInterval(timer);};
  },[base,selected,activeTask,list.reload]);
  const cancelRun=async()=>{if(!activeTask)return;try{await api.post(`${base}/tasks/${activeTask}/cancel`,{});}catch(e){setError(errorText(e));}};
  const create = async () => {
    if (!aiAvailable) return null;
    setBusy(true); setError(null);
    try {
      const created = await api.post<Conversation>(`${base}/conversations`, { title: validResource ? `${resourceNames[type!] ?? '业务'}分析` : content.trim().slice(0,60) || '新对话', ...(validResource ? { resource: { type, ...(id ? { id } : {}) } } : {}) });
      freshConversation.current=created;choose(created.id);setConversation(created);void list.reload();return created;
    } catch (e) { setError(errorText(e)); return null; }
    finally { setBusy(false); }
  };
  const sendTurn = async (current:Conversation,submitted:string) => {
    firstCharacter.current={startedAt:performance.now(),conversationId:current.id,startingMessageCount:current.messages.length,taskId:null};
    const requestKey=pendingSend.current?.content===submitted&&pendingSend.current.version===current.version&&pendingSend.current.thinkingMode===thinkingMode?pendingSend.current.key:crypto.randomUUID();
    pendingSend.current={key:requestKey,content:submitted,version:current.version,thinkingMode};
    keepLatestVisible.current=true;setCompletedTask(null);setSending(true);setBusy(true);setError(null);setRunStage('submitting');setPartialText('');setProgress(null);setContent('');draftInputs.current.delete(current.id);draftInputs.current.delete('new');
    setConversation({...current,version:current.version+1,messages:[...current.messages,{role:'user',content:submitted}]});
    try{
      const job=await api.post<{id:string;status:string;version:number}>(`${base}/conversations/${current.id}/turns`,{content:submitted,version:current.version,allowAction,requireConfirmation:allowAction,useKnowledge:useKnowledge&&thinkingMode!=='fast',thinkingMode,requestKey});
      if(firstCharacter.current?.conversationId===current.id)firstCharacter.current.taskId=job.id;
      setActiveTask(job.id);setRunStage('queued');pendingSend.current=null;void list.reload();
    }catch(error){
      firstCharacter.current=null;
      setError(errorText(error));
      try{const restored=await api.get<Conversation>(`${base}/conversations/${current.id}`);setConversation(restored);setActiveTask(restored.activeTask?.id??null);setSending(Boolean(restored.activeTask));if(!restored.activeTask||restored.messages.at(-1)?.content!==submitted)setContent(submitted);}catch{setSending(false);setConversation(current);setContent(submitted);}
    }finally{setBusy(false);}
  };
  const send = async (event:FormEvent) => {
    event.preventDefault();if(!aiAvailable||!content.trim()||sending||busy)return;
    if(!conversation){autoSend.current=content.trim();if(!await create())autoSend.current=null;return;}
    await sendTurn(conversation,content.trim());
  };
  useEffect(()=>{if(conversation&&autoSend.current){const value=autoSend.current;autoSend.current=null;void sendTurn(conversation,value);}},[conversation?.id]);
  const closePanel=()=>{if(scope==='crm')void queueDraft(content,selected);draftInputs.current.set(selected??'new',content);if(management&&params.has('conversation')){const next=new URLSearchParams(params);next.delete('conversation');setParams(next,{replace:true});}onClose?.();};
  const inspect = async (actionId: string) => { try { setAction(await api.get<AiAction>(`${base}/actions/${actionId}`)); } catch (e) { setError(errorText(e)); } };

  const confirm = async () => {
    if (!action) return;
    setBusy(true); setError(null);
    try { await api.post(`${base}/actions/${action.id}/confirm`, { previewHash: action.previewHash }); setAction(await api.get<AiAction>(`${base}/actions/${action.id}`)); if (conversation) setRecentActions(await api.get<ActionSummary[]>(`${base}/conversations/${conversation.id}/actions`)); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const cancelAction = async () => {
    if (!action) return;
    setBusy(true); setError(null);
    try { await api.post(`${base}/actions/${action.id}/cancel`, {}); setAction(await api.get<AiAction>(`${base}/actions/${action.id}`)); if (conversation) setRecentActions(await api.get<ActionSummary[]>(`${base}/conversations/${conversation.id}/actions`)); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const removeConversation = async () => {
    if (!conversation) return;
    setBusy(true); setError(null);
    try { await api.del(`${base}/conversations/${conversation.id}`); setRemoving(false); choose(null); setConversation(null); setAction(null); await list.reload(); }
    catch (e) { setError(errorText(e)); setRemoving(false); }
    finally { setBusy(false); }
  };
  const draftPreview = action?.preview && typeof action.preview === 'object' ? action.preview as { supplier: { code: string; name: string }; lines: Array<{ sku: string; name: string; unit?:string;quantity: number; unitPrice: string; amount: string }>; estimatedTotal: string } : null;
  const result = action?.result && typeof action.result === 'object' ? action.result as Record<string, unknown> : null;
  const resultId = typeof result?.id === 'string' ? result.id : null;
  const inputId = typeof action?.input.id === 'string' ? action.input.id : null;
  const actionTargetId = resultId ?? inputId;
  const actionHref = action?.presentation?.destination ? `/t/${tenantKey}${action.presentation.destination}${action.presentation.destination.includes('?')?'&':'?'}returnTo=${encodeURIComponent(`/t/${tenantKey}/${scope==='mes'?'mes':scope==='crm'?'crm':'erp'}/ai?conversation=${selected}${returnTo?'&returnTo='+encodeURIComponent(returnTo):''}`)}` : action?.toolId.startsWith('erp.purchase.') && actionTargetId ? `/t/${tenantKey}/erp/purchases/${actionTargetId}`
    : action?.toolId === 'erp.contract.ship' && actionTargetId ? `/t/${tenantKey}/erp/contracts/${actionTargetId}`
      : action?.toolId === 'erp.finance.record_payment' ? `/t/${tenantKey}/erp/finance`
        : action?.toolId === 'erp.customer.create' ? `/t/${tenantKey}/erp/customers`
          : action?.toolId === 'erp.opportunity.create' ? `/t/${tenantKey}/erp/opportunities` : null;
  const shortcuts=scope==='mes'?[['生产分析','分析当前授权的生产进度、逾期和待审核报工',ChartNoAxesCombined],['BOM核查','查找需要核查的BOM草稿，按真实行给出用量和损耗风险',Boxes],['计划草稿','帮我整理生产计划草稿，先查询产品BOM并预览物料需求',ClipboardList],['工单协作','梳理我有权查看的工单进展和下一步操作',FileText]] as const:scope==='crm'?[['经营分析','分析当前授权客户的经营情况，说明窗口和退款口径',ChartNoAxesCombined],['客户分群','帮我预览高价值沉睡客户，说明筛选条件和真实人数',Boxes],['运营方案','基于真实人群整理一份唤回方案与执行清单，先保留为草稿',ClipboardList],['效果观察','解释运营任务的基准窗口、观察窗口和结果边界',FileText]] as const:management ? (scope==='tenant_admin' ? [['成员与权限','说明当前企业的成员角色分布和权限管理注意事项',ClipboardList],['开通检查','检查当前企业的应用与能力开通情况',Boxes],['知识库','如何管理企业知识库和资料可见范围？',FileText],['配置指引','当前管理员使用 AI 还需要检查哪些配置？',ChartNoAxesCombined]] as const : [['平台概况','汇总当前平台企业和账号运行概况',ChartNoAxesCombined],['失败排查','当前平台有哪些 AI 或知识处理失败情况，应该如何排查？',Boxes],['企业开通','说明开通新企业和分配权限的操作步骤',ClipboardList],['运营指引','如何查看运行用量、运营审计和套餐支持？',FileText]] as const) : [['业务分析','分析当前有权范围内的经营情况',ChartNoAxesCombined],['库存核对','核对低库存和待入库商品',Boxes],['采购草稿','帮我整理一份采购草稿，先核对供应商和商品',ClipboardList],['单据进展','梳理需要处理的采购和销售单据',FileText]] as const;
  const history=[...(draftInputs.current.get('new')?.trim()?[{id:'local-draft',title:'未发送的草稿',updatedAt:new Date().toISOString()}]:[]),...list.data??[]];
  return <AiDialog busy={busy} open={open} title={conversation?.title??'新对话'} history={history} selected={selected} onSelect={value=>{if(value==='local-draft'){const draft=draftInputs.current.get('new')??'';choose(null);setContent(draft);}else choose(value);}} onNew={()=>choose(null)} onClose={closePanel} composer={<form className="ai-composer-form" onSubmit={send}>
    <div className="ai-memory-control"><span className="memory-help" style={{margin:0}}>{memoryPreferences.error?'记忆状态暂不可用':memoryPreferences.loading?'正在读取记忆状态…':memoryPreferences.data?.enabled===false?'记忆已暂停':'记忆自动使用'}</span><button type="button" onClick={()=>setMemoryOpen(true)}>管理记忆</button></div>
    <div className="ai-shortcuts">{shortcuts.map(([label,prompt,Icon])=><button type="button" key={label} disabled={sending||busy} onClick={()=>{setContent(prompt);document.getElementById('chat-prompt')?.focus();}}><Icon size={16} aria-hidden="true"/>{label}</button>)}</div>
    {scope==='crm'&&draftState&&<span className="muted" role="status">{draftState}</span>}<div className="ai-input-wrap"><label className="sr-only" htmlFor="chat-prompt">给 AI 助手发送消息</label><textarea id="chat-prompt" maxLength={scope==='crm'?600:4000} value={content} onChange={event=>setContent(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} placeholder="描述需求，或继续补充信息"/><button type="submit" className="primary ai-send" aria-label="发送问题" disabled={busy||sending||!aiAvailable||!content.trim()}><Send size={18} aria-hidden="true"/></button></div>
    <div className="ai-compose-toolbar"><label className="sr-only" htmlFor="thinking-mode">回答方式</label><select id="thinking-mode" value={thinkingMode} disabled={sending||busy} onChange={event=>setThinkingMode(event.target.value as typeof thinkingMode)}><option value="auto">自动选择</option><option value="fast">快速回答</option><option value="deep">深入分析</option></select>{useKnowledge&&thinkingMode!=='fast'&&<span className="ai-auto-context">自动参考企业知识</span>}{conversation&&<button type="button" className="ai-delete-conversation" disabled={busy||sending} onClick={()=>setRemoving(true)}>删除会话</button>}</div>
    {sending&&<button type="button" className="ai-stop" disabled={!activeTask} onClick={()=>void cancelRun()}>停止本次执行</button>}
  </form>}>
    <ServiceNotice kind="ai"/>{management&&<Notice tone="info" text={scope==='tenant_admin'?'企业管理助手 · 只读诊断与操作指引':`平台运营助手 · 只读聚合统计${services.data?.serviceTenantKey?` · 服务企业：${services.data.serviceTenantKey}`:''}`}/>}<Notice text={error}/>{scope==='crm'&&!composer.current.ready&&error&&<button onClick={()=>setDraftReload(v=>v+1)}>重新载入服务器草稿</button>}<Notice text={list.error}/>{validResource&&<Notice text={`当前引用：${resourceNames[type!]??'业务'}`} tone="info"/>}
    <div className="messages ai-panel-messages" ref={messagesRef} onScroll={event=>{const area=event.currentTarget;keepLatestVisible.current=area.scrollHeight-area.scrollTop-area.clientHeight<36;}} role="log" aria-label="对话记录" aria-live="polite" aria-busy={sending}>
      {!conversation?.messages?.length&&<div className="ai-welcome"><Sparkles size={42} aria-hidden="true"/><h2>你好，有什么可以帮你？</h2><div className="ai-starters">{((management||scope==='crm'||scope==='mes') ? shortcuts.slice(0,3).map(item=>item[1]) : ['本周有哪些业务需要处理？','帮我核对采购与库存','如何查看客户的业务往来？']).map(question=><button type="button" key={question} onClick={()=>{setContent(question);document.getElementById('chat-prompt')?.focus();}}><Sparkles size={18} aria-hidden="true"/>{question}</button>)}</div></div>}
      {conversation?.messages?.map((message,index)=><article className={`message ${message.role}`} key={index}><p>{message.content}</p>{message.context?.notice&&<small className="ai-context-note">{message.context.notice}</small>}{message.sources?.map(source=><small key={`${source.type}-${source.id}`}>依据：{source.title??resourceNames[source.type]??'相关业务记录'}{source.version?` · 版本 ${source.version}`:''}</small>)}{message.citations?.map(citation=><Link key={citation.id} to={`/t/${tenantKey}/knowledge?citation=${citation.id}`}>参考资料：{citation.title} · 版本 {citation.version}</Link>)}{message.process?.steps?.length?<AiProcessView process={message.process} actions={recentActions} onInspect={id=>void inspect(id)}/>:null}{message.actionId&&!message.process?.tools?.some(tool=>tool.actionId===message.actionId)&&<button type="button" onClick={()=>void inspect(message.actionId!)}>查看业务操作<Status value={recentActions.find(item=>item.id===message.actionId)?.status??'pending'}/></button>}</article>)}
      {sending&&<div className="message assistant ai-progress" role="status"><strong>{progress?`${progress.mode==='fast'?'快速回答':'深入分析'} · ${progressLabels[progress.stage]??'正在处理'}`:'正在处理'}</strong>{progress?.steps?.length?<AiProcessView process={progress} live actions={recentActions} onInspect={id=>void inspect(id)}/>:null}<p className={partialText?'ai-answer-content':'ai-answer-pending'} aria-label={partialText?undefined:'等待回答'}>{partialText||'•••'}</p></div>}
      {action && <section className="chat-workspace" aria-label="业务操作工作单"><div className="chat-work-heading"><h3>业务操作</h3><button type="button" className="icon-button" aria-label="收起业务操作" onClick={()=>setAction(null)}><X size={18} aria-hidden="true"/></button></div><Notice text={error} /><section className="action-review"><dl className="facts"><dt>操作</dt><dd>{actionName(action.toolId)}</dd><dt>状态</dt><dd><Status value={action.status} /></dd>{action.status === 'result_unknown' && <><dt>处理建议</dt><dd>业务结果正在核实，请勿重复提交。刷新操作详情后查看审计回执；仍未确认时联系管理员。</dd></>}{draftPreview && action.status === 'pending' && <><dt>采购草稿预览</dt><dd><p>供应商：{draftPreview.supplier.code} · {draftPreview.supplier.name}</p><ul>{draftPreview.lines.map(line => <li key={line.sku}>{line.sku} · {line.name} · {line.quantity} {line.unit??''} × {line.unitPrice} 元 = {line.amount} 元</li>)}</ul><strong>当前预估合计：{draftPreview.estimatedTotal} 元</strong><p>最终金额以创建时的商品价格计算。</p></dd></>}{action.previewError && <><dt>预览状态</dt><dd><Notice text={action.previewError} /></dd></>}<dt>操作内容</dt><dd><BusinessParameters input={action.presentation?.parameters??action.input} /></dd>{action.status === 'completed' && action.result != null && <><dt>业务回执</dt><dd><BusinessParameters input={action.presentation?.receipt??{结果:'操作已完成'}} />{actionHref && <Link className="button" to={actionHref}>{action.toolId==='erp.workflow.create_replenishment_plan'?'查看采购计划':'查看相关业务'}</Link>}</dd></>}{action.status === 'pending' && actionHref && <><dt>执行前核对</dt><dd><Link className="button" to={actionHref}>查看当前业务对象</Link></dd></>}</dl>{action.status === 'pending' && <><p className="ai-action-consequence">确认后将写入业务数据，请核对以上内容。</p><button type="button" className="primary" disabled={Boolean(action.previewError) || busy || sending} onClick={() => void confirm()}>{busy?'正在执行…':'确认执行'}</button> <button type="button" disabled={busy} onClick={() => void cancelAction()}>不执行此操作</button></>}{action.status === 'result_unknown' && <button type="button" onClick={() => void inspect(action.id)}>重新核实结果</button>}</section></section>}
      {shortages.data&&shortages.data.length>0&&!conversation?.messages?.length&&<section className="ai-stock-suggestions" aria-label="当前低库存建议"><h3>当前低库存建议</h3>{shortages.data.slice(0,5).map(item=><p key={item.productId}>{item.name}：现存{item.quantity}{item.unit}，待入库{item.incomingQty}{item.unit}，建议采购{item.suggestedMinimum}{item.unit}</p>)}{shortages.data.length>5&&<Link to={`/t/${tenantKey}/erp/inventory`}>查看全部 {shortages.data.length} 项库存建议</Link>}</section>}
    </div>
    <AiMemoryPanel open={memoryOpen} base={base} onClose={()=>setMemoryOpen(false)} onChanged={()=>void memoryPreferences.reload()}/>
    <ConfirmDialog error={error} open={removing} title="删除会话" description={<p>将删除这段聊天记录。已完成业务操作及审计记录仍会保留；有待确认操作时无法删除。</p>} busy={busy} onCancel={() => setRemoving(false)} onConfirm={() => void removeConversation()} />
  </AiDialog>;
}

function BusinessParameters({ input }: { input: Record<string, unknown> }) {
  const labels: Record<string, string> = { '当前状态':'回执状态',id: '业务记录', version: '记录版本', number: '单号', supplierId: '供应商', customerId: '客户', name: '名称', code: '编号', estimatedAmount: '预计金额（元）', kind: '账款类型', amount: '金额（元）', reference: '收付款凭证', note: '备注', lines: '商品与数量', productId: '商品', lineId: '明细记录', quantity: '数量（件）' };
  const show = (value: unknown): string => value === 'committed' ? '已提交' : value === 'receivable' ? '应收款' : value === 'payable' ? '应付款' : value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return <><dl className="facts">{Object.entries(input).map(([key, value]) => <div className="parameter-row" key={key}><dt>{labels[key] ?? key}</dt><dd>{Array.isArray(value) ? value.map((row, index) => <p key={index}>第 {index + 1} 行：{typeof row === 'object' && row ? Object.entries(row).map(([field, val]) => `${labels[field] ?? field}：${show(val)}`).join('；') : show(row)}</p>) : show(value)}</dd></div>)}</dl></>;
}
