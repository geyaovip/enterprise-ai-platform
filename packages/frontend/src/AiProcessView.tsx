import { actionName } from '@suite/frontend/labels';
import type { AiProcess } from './types';

const labels:Record<string,string>={preparing_context:'核对上下文',reading_business:'查询业务对象',searching_knowledge:'检索企业知识',waiting_runtime:'连接 AI 助手',model_processing:'处理问题',generating_answer:'生成回答',validating_result:'核对结果',preparing_action:'核对操作参数',executing_action:'执行业务操作',saving_reply:'保存回答'};
const statuses:Record<string,string>={running:'进行中',requested:'生成请求',pending:'待确认',completed:'已完成',failed:'未完成',cancelled:'已取消',result_unknown:'结果待核实',unavailable:'无法查看'};
const operationSummaries:Record<string,string>={running:'正在执行业务操作。',requested:'正在生成操作请求，尚未执行。',pending:'等待你确认，尚未执行。',completed:'业务操作已完成，结果以回执为准。',cancelled:'你已选择不执行此操作。',failed:'操作未完成，请查看详情。',result_unknown:'业务结果待核实，请勿重复提交。',unavailable:'当前无法查看这项操作。'};
const duration=(ms:number)=>ms<1000?`${Math.round(ms)} 毫秒`:`${(ms/1000).toFixed(1)} 秒`;

export function AiProcessView({process,live=false,actions=[],onInspect}:{process:AiProcess;live?:boolean;actions?:Array<{id:string;status:string}>;onInspect:(id:string)=>void}) {
  const visibleSteps=process.steps.slice(-3);
  const elapsed=process.startedAt&&process.finishedAt?Date.parse(process.finishedAt)-Date.parse(process.startedAt):undefined;
  return <section className="ai-process-view" aria-label="处理过程">
    <div className="ai-process-summary">
      <div className="ai-process-heading"><span>{process.mode==='fast'?'快速回答':'深入分析'} · {live?'处理中':`已处理 ${process.steps.length} 个步骤`}</span>{process.status&&process.status!=='completed'&&<span className={`ai-process-state ${process.status}`}>{statuses[process.status]??'处理中'}</span>}{elapsed!==undefined&&<time>{duration(Math.max(0,elapsed))}</time>}</div>
      {(live||process.status==='failed')&&<ol className="ai-process-timeline">{visibleSteps.map((step,index)=><li key={`${step.stage}-${step.at}-${index}`} className={step.status??(live&&index===visibleSteps.length-1?'running':'completed')}><div><strong>{labels[step.stage]??'处理请求'}</strong>{step.durationMs!==undefined&&<time>{duration(step.durationMs)}</time>}</div>{step.summary&&<p>{step.summary}</p>}</li>)}</ol>}
    </div>
    {!!process.tools?.length&&<div className="ai-tool-list">{process.tools.map(tool=>{
      const current=tool.actionId?actions.find(action=>action.id===tool.actionId)?.status:undefined;
      const state=tool.status==='unavailable'?tool.status:current??tool.status;
      const changed=state!==tool.status;
      return <article key={tool.id} className="ai-tool-card" data-tool-status={state}>
        <header><ToolIcon read={tool.kind==='read'}/><strong>{tool.kind==='read'?tool.description:actionName(tool.toolId)}</strong><span className={`ai-process-state ${state}`}>{statuses[state]??'处理中'}</span>{tool.durationMs!==undefined&&!changed&&<time>{tool.status==='pending'?'准备 ':''}{duration(tool.durationMs)}</time>}</header>
        <p>{tool.kind==='operation'&&changed?operationSummaries[state]:tool.summary??operationSummaries[state]??'正在处理。'}</p>
        {(tool.parameters||tool.receipt||tool.actionId)&&state!=='unavailable'&&<div className="ai-tool-result">{tool.parameters&&<RecordFields value={tool.parameters}/>} {tool.receipt&&<><strong className="ai-receipt-title">业务回执</strong><RecordFields value={tool.receipt}/></>}{tool.actionId&&<button type="button" onClick={()=>onInspect(tool.actionId!)}>{state==='pending'?'核对并执行':'查看业务操作'}</button>}</div>}
      </article>;
    })}</div>}
  </section>;
}

function ToolIcon({read}:{read:boolean}){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{read?<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>:<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6m-6 4 2 2 4-4"/></>}</svg>;}

function valueText(value:unknown):string {
  if(value==null)return '—';
  if(Array.isArray(value))return value.map(valueText).join('；');
  if(typeof value==='object')return Object.entries(value).map(([key,item])=>`${key}：${valueText(item)}`).join('，');
  return String(value);
}
function RecordFields({value}:{value:Record<string,unknown>}){return <dl className="ai-tool-fields">{Object.entries(value).map(([key,item])=><div key={key}><dt>{key}</dt><dd>{valueText(item)}</dd></div>)}</dl>;}
