import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// One state directory and loopback Gateway per platform member. No global OpenClaw changes.
const [command, memberId] = process.argv.slice(2);
if (!['init', 'validate', 'start'].includes(command) || !/^[a-f0-9-]{36}$/.test(memberId ?? '')) throw Error('Usage: node infrastructure/openclaw-member.mjs init|validate|start MEMBERSHIP_UUID');
const root = resolve('var/openclaw-members', memberId);
const configPath = join(root, 'openclaw.json');
const binary = resolve('var/openclaw-runtime/node_modules/openclaw/openclaw.mjs');
await access(binary);
if (command === 'init') {
  const modelUrl = process.env.OPENCLAW_MODEL_BASE_URL;
  const modelId = process.env.OPENCLAW_MODEL_ID;
  const modelKey = process.env.OPENCLAW_MODEL_API_KEY;
  const port = Number(process.env.OPENCLAW_PORT);
  if (!modelUrl || !modelId || !modelKey || !Number.isInteger(port) || port < 1024 || port > 65535) throw Error('OPENCLAW_MODEL_BASE_URL, OPENCLAW_MODEL_ID, OPENCLAW_MODEL_API_KEY, OPENCLAW_PORT are required');
  const endpoint = new URL(modelUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('Invalid model URL');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'workspace'), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('base64url');
  const config = {
    gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token }, controlUi: { enabled: false }, terminal: { enabled: false }, cliAgents: { enabled: false }, http: { endpoints: { responses: { enabled: true, files: { allowUrl: false }, images: { allowUrl: false } } } } },
    agents: { defaults: { skipBootstrap: true, model: { primary: `suite-model/${modelId}`, fallbacks: [] }, heartbeat: { every: '0m' }, timeoutSeconds: 55 }, entries: { 'erp-assistant': { workspace: join(root, 'workspace'), agentDir: join(root, 'agent'), skills: [], tools: { allow: ['erp__*'] } } } },
    models: { mode: 'replace', providers: { 'suite-model': { baseUrl: modelUrl, apiKey: modelKey, api: process.env.OPENCLAW_MODEL_API ?? 'openai-completions', models: [{ id: modelId, name: modelId, reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 4096 }] } } },
    tools: { toolSearch: false, codeMode: { enabled: false }, allow: ['erp__*'], elevated: { enabled: false } },
    plugins: { allow: ['openai'] }, cron: { enabled: false }, hooks: { enabled: false }, update: { checkOnStart: false }, discovery: { mdns: { mode: 'off' } },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(join(root, 'binding.json'), JSON.stringify({ provider: 'openclaw', baseUrl: `http://127.0.0.1:${port}`, secret: token, version: 0, options: { agentId: 'erp-assistant' } }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  for(const directory of [join(root,'agent'),join(root,'agents','erp-assistant'),join(root,'agents','erp-assistant','agent')]){await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,'settings.json'),JSON.stringify({retry:{provider:{maxRetries:0}}}),{mode:0o600,flag:'wx'});}
  process.stdout.write(`Member Gateway prepared at ${root}. Import binding.json through the Platform Admin API; it contains a credential.\n`);
} else {
  const config=JSON.parse(await readFile(configPath,'utf8'));
  if(command==='start')for(const [id,entry] of Object.entries(config.agents?.entries??{})){
    const directories=new Set([join(root,'agents',id),join(root,'agents',id,'agent')]);
    if(entry.agentDir&&resolve(entry.agentDir).startsWith(root+'/'))directories.add(resolve(entry.agentDir));
    for(const directory of directories){await mkdir(directory,{recursive:true,mode:0o700});const file=join(directory,'settings.json');let settings={};try{settings=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}settings.retry={...settings.retry,provider:{...settings.retry?.provider,maxRetries:0}};await writeFile(file,JSON.stringify(settings),{mode:0o600});}
  }
  const child = spawn(process.execPath, [binary, ...(command === 'validate' ? ['config', 'validate'] : ['gateway', 'run'])], { stdio: 'inherit', env: { ...process.env, OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: configPath } });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}
