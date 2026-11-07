// Credentials are consumed in-process and never printed. Requires the explicit loopback-only QA binding.
const {execFileSync,spawnSync}=require('node:child_process'),{randomBytes}=require('node:crypto'),path=require('node:path');
const mode=process.argv[2]??'bom-intake.cjs';
if(!['bom-intake.cjs','business-intake.cjs','business-intake-notice.cjs','mes-flow.cjs','mes-ai.cjs','bom-browser-fixture.cjs'].includes(mode))throw Error('Unknown isolated QA command');
const project=path.resolve(__dirname,'../../..');
const info=JSON.parse(execFileSync('docker',['inspect',process.env.BOM_QA_CONTAINER??'suite-prelaunch-qa-20261027'],{encoding:'utf8'}))[0];
const port=info.HostConfig.PortBindings['5432/tcp']?.[0];
if(!info.State.Running||port?.HostIp!=='127.0.0.1'||port?.HostPort!=='54329')throw Error('Isolated loopback QA database required');
const config=Object.fromEntries(info.Config.Env.map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)]}));
const url=new URL('postgresql://127.0.0.1:54329/suite_phase1_qa');url.username=config.POSTGRES_USER;url.password=config.POSTGRES_PASSWORD;
const env={...process.env,DATABASE_URL:url.toString(),NODE_ENV:'test',WEB_ORIGINS:'http://127.0.0.1:4601,http://127.0.0.1:4637',MES_AI_RELEASE_ENABLED:'true',CRM_AI_RELEASE_ENABLED:'true',NATIVE_AI_MODEL_ENABLED:['business-intake.cjs','mes-ai.cjs'].includes(mode)?'true':'false',AI_ENCRYPTION_KEY:randomBytes(32).toString('base64'),CHANNEL_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
for(const key of ['RUNTIME_MANAGER_SOCKET','AGENT_RUNTIME_PROVIDER','MEMORY_CORE_URL'])delete env[key];
if(['bom-intake.cjs','bom-browser-fixture.cjs'].includes(mode)){
 env.KNOWLEDGE_PYTHON_PATH=path.join(project,'output/bom-intake-20261027/python-parser.sh');
 env.BOM_INTAKE_FIXTURES=path.join(project,'output/bom-intake-20261027/fixtures');
}
const result=spawnSync(process.execPath,['tests/'+mode],{cwd:path.join(project,'apps/api'),env,stdio:'inherit'});process.exitCode=result.status??1;
