import { ServiceUnavailableException } from '@nestjs/common';

/** Consume the OpenResponses SSE protocol and return only its terminal, validated result. */
export async function readOpenClawStream(response: Response, onTextDelta: (delta: string) => Promise<void>, onItem?: (item: Record<string,unknown>) => Promise<void>, onTerminal?: (payload: unknown) => Promise<void>): Promise<unknown> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new ServiceUnavailableException('OpenClaw 未返回增量响应');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: unknown;
  let sawDone = false;
  let bytes = 0;
  const event = async (raw: string) => {
    let name = '';
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const body = data.join('\n');
    if (body === '[DONE]') { sawDone = true; return; }
    let value: Record<string, unknown>;
    try { value = JSON.parse(body) as Record<string, unknown>; }
    catch { throw new ServiceUnavailableException('OpenClaw 增量响应格式无效'); }
    const kind = name || value.type;
    if (kind === 'response.output_text.delta' && typeof value.delta === 'string') {
      await onTextDelta(value.delta);
    } else if (kind === 'response.output_item.added' && value.item && typeof value.item==='object') {
      await onItem?.(value.item as Record<string,unknown>);
    } else if (kind === 'response.completed') {
      completed = value.response ?? value;
      await onTerminal?.(completed);
    } else if (kind === 'response.failed' || kind === 'response.incomplete') {
      await onTerminal?.(value.response ?? value);
      throw new ServiceUnavailableException('OpenClaw 未完成本次生成');
    }
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2_000_000) throw new ServiceUnavailableException('OpenClaw 增量响应过大');
      buffer += decoder.decode(next.value, { stream: true });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const marker = buffer.slice(boundary).match(/^\r?\n\r?\n/)![0];
        await event(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + marker.length);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (buffer.length > 1_000_000) throw new ServiceUnavailableException('OpenClaw 增量事件过大');
    }
    if (buffer.trim()) await event(buffer);
    if (!sawDone || !completed) throw new ServiceUnavailableException('OpenClaw 增量响应未正常结束');
    return completed;
  } finally { reader.releaseLock(); }
}
