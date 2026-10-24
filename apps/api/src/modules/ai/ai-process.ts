import type { ThinkingMode } from './thinking-mode';

export type ProcessStatus = 'running'|'completed'|'failed'|'cancelled';
export type ProcessStep = { stage:string; at:string; summary?:string; status?:ProcessStatus; durationMs?:number };
export type ProcessTool = {
  id:string; toolId:string; kind:'read'|'operation'; description:string;
  status:'running'|'requested'|'pending'|'completed'|'failed'|'cancelled'|'result_unknown'|'unavailable';
  startedAt:string; finishedAt?:string; durationMs?:number; summary?:string;
  parameters?:Record<string,unknown>; receipt?:Record<string,unknown>; actionId?:string;
};
export type AiProcess = { mode:ThinkingMode; startedAt?:string; finishedAt?:string; status?:ProcessStatus; steps:ProcessStep[]; tools?:ProcessTool[] };

const explanations:Record<string,string> = {
  preparing_context:'我先核对这次问题的业务上下文。', reading_business:'正在核对你有权使用的业务对象。',
  searching_knowledge:'正在检索你有权访问的企业资料。', waiting_runtime:'正在连接你的 AI 助手。',
  model_processing:'AI 正在处理这个问题。', generating_answer:'回答正在生成，内容会陆续显示。',
  preparing_action:'正在核对操作参数和执行权限。', validating_result:'正在核对回答、引用和操作请求。',
  executing_action:'正在执行业务操作，结果以业务回执为准。', saving_reply:'正在保存本次回答和处理记录。',
};
export class ProcessRecord {
  readonly value:AiProcess;
  constructor(mode:ThinkingMode){this.value={mode,startedAt:new Date().toISOString(),status:'running',steps:[],tools:[]};}
  advance(stage:string){
    if(this.value.steps.at(-1)?.stage===stage)return;
    this.closeStep('completed');
    if(this.value.steps.length<40)this.value.steps.push({stage,at:new Date().toISOString(),summary:explanations[stage]??'正在处理这次请求。',status:'running'});
  }
  startTool(tool:Pick<ProcessTool,'id'|'toolId'|'kind'|'description'>,status:ProcessTool['status']='running'):ProcessTool{
    const existing=this.value.tools!.find(t=>t.id===tool.id);
    if(existing)return existing;
    if(this.value.tools!.length>=20)throw new Error('本次处理步骤过多');
    const entry:ProcessTool={...tool,status,startedAt:new Date().toISOString()};this.value.tools!.push(entry);return entry;
  }
  completeTool(id:string,summary:string){const tool=this.value.tools!.find(t=>t.id===id);if(tool){tool.status='completed';tool.summary=summary;this.endTool(tool);}}
  endTool(tool:ProcessTool){tool.finishedAt=new Date().toISOString();tool.durationMs=Math.max(0,Date.now()-Date.parse(tool.startedAt));}
  finish(status:ProcessStatus){
    this.closeStep(status);this.value.status=status;this.value.finishedAt=new Date().toISOString();
    for(const tool of this.value.tools!)if(tool.status==='running'||(tool.status==='requested'&&!tool.actionId)){tool.status=status==='completed'?'failed':status;this.endTool(tool);}
  }
  private closeStep(status:ProcessStatus){const step=this.value.steps.at(-1);if(step?.status==='running'){step.status=status;step.durationMs=Math.max(0,Date.now()-Date.parse(step.at));}}
}
