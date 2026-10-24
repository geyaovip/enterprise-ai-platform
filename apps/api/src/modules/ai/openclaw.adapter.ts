import { ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { infrastructureEndpoint, infrastructureSecret, type Binding } from '../platform/infrastructure-contract';
import type { AgentRuntime, RuntimeRequest, RuntimeResult } from './agent.runtime';
import { readOpenClawStream } from './openclaw-stream';
import { responseReceipt } from './runtime-usage';

const responseSchema = z.object({ id: z.string(), status: z.string().optional(), output: z.array(z.object({ type: z.string(), name: z.string().optional(), arguments: z.string().optional(), call_id: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })), usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional() });

export class OpenClawAdapter implements AgentRuntime {
  readonly provider = 'openclaw';
  readonly capabilities = { streaming: true, clientTools: true, cancellation: true };
  constructor(private readonly binding: Binding) {}
  async health() {
    try {
      const endpoint = infrastructureEndpoint(this.binding.baseUrl);
      const headers = { authorization: `Bearer ${infrastructureSecret(this.binding.secretCiphertext, true)}` };
      const ready = await fetch(`${endpoint}/readyz`, { headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (ready.status === 401 || ready.status === 403) throw new ServiceUnavailableException({ code: 'RUNTIME_CREDENTIALS_REJECTED', message: 'AI 执行环境拒绝访问凭据，请检查网关令牌' });
      if (!ready.ok) throw new ServiceUnavailableException({ code: 'RUNTIME_NOT_READY', message: 'AI 执行环境尚未就绪，请检查实例启动状态与运行资源' });
      const response = await fetch(`${endpoint}/v1/models`, { headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (response.status === 401 || response.status === 403) throw new ServiceUnavailableException({ code: 'RUNTIME_CREDENTIALS_REJECTED', message: 'AI 执行环境拒绝访问凭据，请检查网关令牌' });
      if (!response.ok) throw new ServiceUnavailableException({ code: 'RUNTIME_MODELS_UNAVAILABLE', message: 'AI 执行环境无法提供助手列表，请检查实例配置' });
      const value = await response.json() as { data?: Array<{ id?: string }> };
      const agentId = (this.binding.options as { agentId?: string }).agentId ?? 'erp-assistant';
      if (!value.data?.some(m => m.id === `openclaw/${agentId}`)) throw new ServiceUnavailableException({ code: 'RUNTIME_ASSISTANT_MISSING', message: 'AI 执行环境中不存在指定助手，请核对助手标识' });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({ code: 'RUNTIME_UNREACHABLE', message: '无法连接 AI 执行环境，请检查服务地址、网络和实例状态' });
    }
  }
  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    const aliases = new Map((request.tools ?? []).map(tool => [tool.id.replace(/\./g, '__'), tool.id]));
    // Pinned OpenClaw rejects an explicit allowlist with no registered tool.
    // Managed fast agents have only the read-only session_status tool; request
    // tool_choice none so the model produces text directly and can stream it.
    const textOnly = !request.tools?.length;
    const options = this.binding.options as { agentId?: string; fastAgentId?: string; readAgentId?: string; ephemeralTurns?: boolean };
    const fastText = textOnly && request.thinkingMode === 'fast' && Boolean(options.fastAgentId);
    const readText = textOnly && !fastText && Boolean(options.readAgentId);
    const directText = fastText || readText;
    const wireTools = directText ? [] : textOnly ? [{type:'function',name:'suite__return_answer',description:'Return the requested answer as text only. For JSON extraction, put the complete JSON in text. This function does not execute any operation.',parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}] : request.tools!.map(tool => ({ type: 'function', name: tool.id.replace(/\./g, '__'), description: tool.description, parameters: tool.parameters }));
    const endpoint = infrastructureEndpoint(this.binding.baseUrl);
    // Each turn gets a fresh Gateway session. Only platform-authorized history is supplied;
    // Gateway memory must never reintroduce a document/object after permission revocation.
    const agentId = fastText ? options.fastAgentId! : ['crm','mes'].includes(request.context.request.app.appId)?request.context.request.app.appId+'-assistant':readText ? options.readAgentId! : options.agentId ?? 'erp-assistant';
    const sessionKey = options.ephemeralTurns ? `agent:${agentId}:dashboard:incognito-${request.runId}`
      : `agent:${agentId}:suite:${request.context.request.membershipId}:${request.runId}`;
    const startedAt = Date.now();
    let firstDeltaAt: number | undefined;
    try {
      const response = await fetch(`${endpoint}/v1/responses`, { method: 'POST', redirect: 'error', signal: request.signal,
        headers: { authorization: `Bearer ${infrastructureSecret(this.binding.secretCiphertext, true)}`, 'content-type': 'application/json', 'x-openclaw-agent-id': agentId, 'x-openclaw-session-key': sessionKey },
        body: JSON.stringify({ model: `openclaw/${agentId}`, user: request.context.request.membershipId,
          instructions: request.messages.filter(x => x.role === 'system').map(x => x.content).join('\n'),
          input: request.messages.filter(x => x.role !== 'system').flatMap(x => x.items??[{ type: 'message', role: x.role, content: [{ type: 'input_text', text: x.content }] }]),
          tools:wireTools, tool_choice:directText?'none':'auto', stream: Boolean(request.onTextDelta), max_output_tokens: request.purpose==='context_summary'?1000:fastText ? 180 : 4000 }) });
      const headersAt = Date.now();
      if (!response.ok) throw new ServiceUnavailableException({code:'RUNTIME_HTTP_ERROR',upstreamStatus:response.status,message:`OpenClaw 返回 ${response.status}`});
      const payload = request.onTextDelta ? await readOpenClawStream(response, async delta => {
        if (!firstDeltaAt && delta.trim()) firstDeltaAt = Date.now();
        await request.onTextDelta!(delta);
      },async item=>{
        if(item.type!=='function_call'||typeof item.name!=='string'||typeof item.call_id!=='string')return;
        const toolId=aliases.get(item.name);
        // Only declared platform tools can create a public progress event. No raw arguments.
        if(toolId)await request.onEvent?.({type:'tool_request',toolId,callId:item.call_id});
      },async payload=>request.onUsage?.(responseReceipt(payload,`openclaw/${agentId}`))) : await response.json();
      const receipt=responseReceipt(payload,`openclaw/${agentId}`);
      if(!request.onTextDelta)await request.onUsage?.(receipt);
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.status === 'failed' || parsed.data.status === 'incomplete') throw new ServiceUnavailableException('OpenClaw 返回无效或未完成结果');
      const textReplies:string[]=[];
      const toolRequests = parsed.data.output.filter(x => x.type === 'function_call').flatMap(item => {
        if(textOnly&&item.name==='suite__return_answer'){
          try{const answer=z.object({text:z.string().min(1).max(20000)}).strict().parse(JSON.parse(item.arguments??''));textReplies.push(answer.text);return [];}catch{throw new ServiceUnavailableException('OpenClaw 文本回复结构无效');}
        }
        const id = aliases.get(item.name ?? '');
        if (!id || !item.call_id) throw new ServiceUnavailableException('OpenClaw 请求了未声明工具');
        let input: unknown; try { input = JSON.parse(item.arguments ?? ''); } catch { throw new ServiceUnavailableException('OpenClaw 工具参数无效'); }
        return [{ toolId: id, callId: item.call_id, input }];
      });
      const text = [...parsed.data.output.flatMap(item => item.type === 'message' ? (item.content ?? []).filter(c => c.type === 'output_text').map(c => c.text ?? '') : []),...textReplies].join('\n');
      if (!text && !toolRequests.length) throw new ServiceUnavailableException('OpenClaw 未返回回答或工具请求');
      return { text, toolRequests, model:receipt.model,requestedModel:receipt.requestedModel,outputItems:(payload as any).output, externalId: parsed.data.id, usage: {
        ...receipt.usage,
        transportTiming: { gatewayHeadersMs: headersAt - startedAt, gatewayFirstDeltaMs: firstDeltaAt ? firstDeltaAt - startedAt : null, gatewayTotalMs: Date.now() - startedAt },
      } };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(request.signal.aborted ? 'AI 执行已取消或超时' : 'OpenClaw 连接失败');
    }
  }
}
