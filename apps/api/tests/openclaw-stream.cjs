const assert = require('node:assert/strict');
const { readOpenClawStream } = require('../dist/modules/ai/openclaw-stream');

function response(parts) {
  const bytes = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) { for (const part of parts) controller.enqueue(bytes.encode(part)); controller.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

(async () => {
  const final = { id: 'response-1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '你好，已核对。' }] }] };
  const chunks = [
    'event: response.output_text.delta\ndata: {"delta":"你好，"}\n\n',
    'event: response.output_text.delta\ndata: {"delta":"已核',
    '对。"}\n\n',
    `event: response.completed\ndata: ${JSON.stringify({ response: final })}\n\n`,
    'data: [DONE]\n\n',
  ];
  let shown = '';
  assert.deepEqual(await readOpenClawStream(response(chunks), async delta => { shown += delta; }), final);
  assert.equal(shown, '你好，已核对。');
  const toolFinal = { id: 'response-tool', status: 'completed', output: [{ type: 'function_call', name: 'suite__preview', call_id: 'call-1', arguments: '{"id":"demo"}' }] };
  let preview = '';
  assert.deepEqual(await readOpenClawStream(response([
    'event: response.output_text.delta\ndata: {"delta":"正在核对操作。"}\n\n',
    `event: response.completed\ndata: ${JSON.stringify({ response: toolFinal })}\n\n`,
    'data: [DONE]\n\n',
  ]), async delta => { preview += delta; }), toolFinal);
  assert.equal(preview, '正在核对操作。');
  await assert.rejects(readOpenClawStream(response(['event: response.failed\ndata: {}\n\n', 'data: [DONE]\n\n']), async () => {}));
  await assert.rejects(readOpenClawStream(response(['event: response.output_text.delta\ndata: {"delta":"部分"}\n\n', 'data: [DONE]\n\n']), async () => {}));
  process.stdout.write('OpenClaw SSE split chunks, text and tool terminal results, failure and truncation checks passed.\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
