// Run inside the owning Gateway container, against its loopback control socket.
// Only generated per-turn Incognito keys are accepted; durable sessions are excluded.
const { readFileSync } = require('node:fs');
const keys = process.argv.slice(1);
if (!keys.length || keys.length > 3 || keys.some(key => !/^agent:[a-z0-9_-]+:dashboard:incognito-[a-f0-9-]{36}$/.test(key))) {
  throw new Error('Invalid ephemeral session key');
}
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH || '/state/openclaw.json', 'utf8'));
const ws = new WebSocket('ws://127.0.0.1:' + (config.gateway.port || 18789));
const timer = setTimeout(() => finish(false), 10000);
let index = 0, finished = false;
function finish(ok, code = 'TIMEOUT') {
  if (finished) return;
  finished = true; clearTimeout(timer); ws.close();
  process.stdout.write(JSON.stringify({ ok, code }) + '\n');
  process.exitCode = ok ? 0 : 1;
}
function remove() {
  ws.send(JSON.stringify({ type: 'req', id: 'remove-' + index, method: 'sessions.delete', params: {
    key: keys[index], deleteTranscript: true, emitLifecycleHooks: false,
  } }));
}
ws.addEventListener('error', () => finish(false));
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.type === 'event' && message.event === 'connect.challenge') {
    ws.send(JSON.stringify({ type: 'req', id: 'hello', method: 'connect', params: {
      minProtocol: 4, maxProtocol: 4,
      client: { id: 'cli', version: 'suite-ephemeral-1', platform: 'node', mode: 'cli' },
      role: 'operator', scopes: ['operator.admin'], auth: { token: config.gateway.auth.token },
    } }));
  }
  if (message.type !== 'res') return;
  if (!message.ok) return finish(false, message.id + ':' + (message.error?.code || 'ERROR'));
  if (message.id === 'hello') return remove();
  if (message.id === 'remove-' + index) {
    if (++index === keys.length) return finish(true, 'CLEANED');
    remove();
  }
});
