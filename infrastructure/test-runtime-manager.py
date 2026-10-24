import importlib.util
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('manager',Path(__file__).with_name('runtime-manager.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ControllerTests(unittest.TestCase):
 def test_policy_upgrade_preserves_existing_application_model_overrides(self):
  config={'agents':{'defaults':{'model':{'primary':'provider/erp'}},'entries':{'erp-assistant':{'model':{'primary':'provider/erp'}},'crm-assistant':{'model':{'primary':'provider/crm','fallbacks':[]}},'mes-assistant':{'model':{'primary':'provider/mes','fallbacks':[]}}}},'tools':{'allow':[]}}
  with patch.dict(m.os.environ,{'CRM_MODEL_ID':''}):self.manager.apply_turn_policy(config)
  self.assertEqual(config['agents']['entries']['crm-assistant']['model']['primary'],'provider/crm')
  self.assertEqual(config['agents']['entries']['mes-assistant']['model']['primary'],'provider/mes')
  self.assertEqual(config['agents']['defaults']['model']['primary'],'provider/erp')
 def test_mes_model_override_is_scoped_to_approved_ark_model(self):
  config={'agents':{'defaults':{'model':{'primary':'p/erp'}},'entries':{'erp-assistant':{}}},'models':{'providers':{'p':{'baseUrl':'https://ark.cn-beijing.volces.com/api/v3','models':[{'id':'erp'}]}}},'tools':{'allow':[]}}
  with patch.dict(m.os.environ,{'CRM_MODEL_ID':'','MES_MODEL_ID':'doubao-seed-evolving'}):self.manager.apply_turn_policy(config)
  self.assertEqual(config['agents']['entries']['mes-assistant']['model']['primary'],'p/doubao-seed-evolving')
  self.assertEqual(config['agents']['defaults']['model']['primary'],'p/erp')
  self.assertNotIn('model',config['agents']['entries']['erp-assistant'])
  with patch.dict(m.os.environ,{'MES_MODEL_ID':'unapproved'}):
   with self.assertRaises(ValueError):self.manager.apply_turn_policy(config)
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();m.ROOT=Path(self.tmp.name);m.IDLE=15;m.MAX_ACTIVE=1
  self.now=1000;self.containers={};self.calls=[];self.boot_ok=True
  self.tenant=str(uuid.uuid4());self.a=str(uuid.uuid4());self.b=str(uuid.uuid4())
  config={'gateway':{'auth':{'token':'original-token'}},'agents':{'defaults':{},'entries':{'erp-assistant':{}}},'tools':{'allow':['erp__*']},'models':{'private':'same-tenant-profile'}}
  m.atomic(m.ROOT/'profiles'/(self.tenant+'.json'),config)
  self.manager=m.Manager(lambda:self.now,self.docker,lambda run:run())
  self.chown=patch.object(m.os,'chown');self.chown.start()
 def tearDown(self):self.chown.stop();self.tmp.cleanup()
 def docker(self,*args):
  self.calls.append(args)
  if args[0]=='inspect':
   name=args[-1]
   if name not in self.containers:raise RuntimeError('missing')
   if '{{.State.Health.Status}}' in args:return 'healthy' if self.boot_ok else 'starting'
   return 'true' if self.containers[name] else 'false'
  if args[0]=='run':self.containers[args[args.index('--name')+1]]=True;return 'id'
  if args[0]=='start':self.containers[args[-1]]=True;return 'id'
  if args[0]=='stop':self.containers[args[-1]]=False;return ''
  if args[0]=='exec':
   if not self.boot_ok:raise RuntimeError('not ready')
   return ''
 def req(self,member,lease=None,tenant=None):return {'tenantId':tenant or self.tenant,'membershipId':member,'leaseId':lease or str(uuid.uuid4())}
 def acquire_ready(self,body):
  self.manager.command('acquire',body);self.manager.tick();self.manager.tick();return self.manager.command('acquire',body)
 def test_idempotent_create_and_isolated_tokens(self):
  a=self.req(self.a);one=self.acquire_ready(a);two=self.manager.command('acquire',a);self.assertEqual(one,two)
  self.assertEqual(sum(c[0]=='run' for c in self.calls),1)
  b=self.req(self.b);self.manager.command('acquire',b)
  self.assertNotEqual(self.manager.data['members'][self.a]['token'],self.manager.data['members'][self.b]['token'])
  self.assertNotEqual(self.manager.data['members'][self.a]['directory'],self.manager.data['members'][self.b]['directory'])
 def test_active_lease_blocks_idle_and_queue_admission(self):
  a,b=self.req(self.a),self.req(self.b);self.acquire_ready(a);self.manager.command('acquire',b)
  self.now+=16;self.manager.tick();self.assertTrue(self.containers['suite-managed-'+self.a]);self.assertFalse(self.manager.data['members'][self.b]['exists'])
  self.manager.command('release',a);self.manager.tick();self.assertFalse(self.containers['suite-managed-'+self.a]);self.assertTrue(self.containers['suite-managed-'+self.b])
 def test_idle_stop_and_wake_preserve_state(self):
  a=self.req(self.a);before=self.acquire_ready(a);record=self.manager.data['members'][self.a];config=Path(record['directory'])/'openclaw.json';contents=config.read_bytes()
  self.manager.command('release',a);self.now+=16;self.manager.tick();self.assertEqual(record['state'],'suspended')
  after=self.acquire_ready(self.req(self.a));self.assertEqual(before['secret'],after['secret']);self.assertEqual(contents,config.read_bytes());self.assertEqual(sum(c[0]=='run' for c in self.calls),1)
 def test_restart_keeps_lease_and_reconciles_docker(self):
  a=self.req(self.a);self.acquire_ready(a);self.manager=m.Manager(lambda:self.now,self.docker,lambda run:run());self.now+=16;self.manager.tick();self.assertTrue(self.containers['suite-managed-'+self.a])
  self.containers['suite-managed-'+self.a]=False;self.manager.tick();self.assertTrue(self.containers['suite-managed-'+self.a]);self.manager.tick();self.assertEqual(self.manager.command('acquire',a)['state'],'ready')
 def test_unhealthy_restart_cannot_admit_lease(self):
  a=self.req(self.a);self.acquire_ready(a);self.manager.command('release',a)
  self.boot_ok=False;self.manager.tick()
  self.assertEqual(self.manager.data['members'][self.a]['state'],'preparing')
  self.assertNotEqual(self.manager.command('acquire',self.req(self.a))['state'],'ready')
  self.boot_ok=True;self.manager.tick();self.assertEqual(self.manager.data['members'][self.a]['state'],'ready')
 def test_expired_lease_releases_capacity(self):
  a=self.req(self.a);self.acquire_ready(a);self.now+=m.LEASE_TTL+1;self.manager.tick();self.assertEqual(len(self.manager.data['leases']),0);self.assertEqual(self.manager.public(self.a)['state'],'suspended')
 def test_cross_tenant_member_and_lease_rejected(self):
  a=self.req(self.a);self.acquire_ready(a)
  with self.assertRaises(ValueError):self.manager.command('acquire',self.req(self.a,tenant=str(uuid.uuid4())))
  with self.assertRaises(ValueError):self.manager.command('release',self.req(self.b,lease=a['leaseId']))
 def test_failed_boot_retains_state_and_new_request_can_retry(self):
  self.boot_ok=False;a=self.req(self.a);self.manager.command('acquire',a);self.manager.tick();self.now+=m.BOOT_LIMIT+1;self.manager.command('acquire',a);self.manager.tick();self.assertEqual(self.manager.command('acquire',a)['state'],'failed')
  self.manager.command('release',a);self.boot_ok=True;self.now+=1;b=self.req(self.a);self.assertEqual(self.acquire_ready(b)['state'],'ready')
 def test_unconfigured_and_path_injection_rejected(self):
  with self.assertRaises(ValueError):self.manager.command('acquire',self.req(self.a,tenant=str(uuid.uuid4())))
  with self.assertRaises(ValueError):self.manager.command('acquire',{'tenantId':self.tenant,'membershipId':'../other','leaseId':str(uuid.uuid4())})
 def test_bounded_parallel_calls_for_one_member(self):
  a=self.req(self.a);self.acquire_ready(a);self.now+=1
  b=self.req(self.a);self.assertEqual(self.manager.command('acquire',b)['state'],'ready')
  self.now+=1;c=self.req(self.a);self.assertEqual(self.manager.command('acquire',c)['state'],'queued')
  self.manager.command('release',a);self.assertEqual(self.manager.command('acquire',c)['state'],'ready')
  config=json.loads((Path(self.manager.data['members'][self.a]['directory'])/'openclaw.json').read_text())
  self.assertEqual(config['agents']['defaults']['maxConcurrent'],2)
 def test_existing_member_concurrency_upgrade_waits_for_active_lease(self):
  a=self.req(self.a);self.acquire_ready(a)
  record=self.manager.data['members'][self.a];record['concurrency']=1
  config_path=Path(record['directory'])/'openclaw.json'
  config=json.loads(config_path.read_text());config['agents']['defaults']['maxConcurrent']=1;m.atomic(config_path,config)
  b=self.req(self.a);self.assertEqual(self.manager.command('acquire',b)['state'],'queued')
  self.manager.command('release',a);self.manager.command('release',b)
  self.manager.command('prepare',{'tenantId':self.tenant,'membershipId':self.a})
  self.assertEqual(record['concurrency'],2)
  self.assertEqual(json.loads(config_path.read_text())['agents']['defaults']['maxConcurrent'],2)
 def test_other_containers_untouched(self):
  self.containers['sing-box']=True;self.containers['clash-sub']=True;a=self.req(self.a);self.acquire_ready(a);self.manager.command('release',a);self.now+=20;self.manager.tick();self.assertTrue(self.containers['sing-box']);self.assertTrue(self.containers['clash-sub']);self.assertTrue(all(c[-1] not in ['sing-box','clash-sub'] for c in self.calls if c[0]=='stop'))
 def test_removed_container_recreated_from_retained_state(self):
  a=self.req(self.a);first=self.acquire_ready(a);self.containers.pop('suite-managed-'+self.a);self.manager.tick();self.manager.tick();self.assertEqual(self.manager.command('acquire',a)['secret'],first['secret'])
 def test_queue_is_not_starved_by_new_request_from_warm_member(self):
  a=self.req(self.a);self.acquire_ready(a);self.now+=1;b=self.req(self.b);self.manager.command('acquire',b);self.manager.command('release',a);self.now+=1;new=self.req(self.a);self.assertEqual(self.manager.command('acquire',new)['state'],'queued');self.manager.tick();self.assertFalse(self.containers['suite-managed-'+self.a]);self.assertTrue(self.containers['suite-managed-'+self.b])
 def test_model_reconfiguration_is_scoped_idle_and_preserves_token(self):
  with patch.dict(m.os.environ,{'AI_PROVIDER_ALLOWED_HOSTS':'approved.example'}):
   a=self.req(self.a);a['model']={'model':'test-model','baseUrl':'https://approved.example/v1','apiKey':'test-private-key'};first=self.acquire_ready(a)
   altered={**a,'model':{**a['model'],'model':'test-model-2'}}
   with self.assertRaises(ValueError):self.manager.command('acquire',altered)
   self.manager.command('release',a);second=self.acquire_ready({**altered,'leaseId':str(uuid.uuid4())});self.assertEqual(first['secret'],second['secret'])
   config=json.loads((Path(self.manager.data['members'][self.a]['directory'])/'openclaw.json').read_text());self.assertEqual(config['agents']['defaults']['model']['primary'],'suite/test-model-2')
 def test_model_provisions_fast_agent_without_changing_standard_agent(self):
  with patch.dict(m.os.environ,{'AI_PROVIDER_ALLOWED_HOSTS':'approved.example'}):
   a=self.req(self.a);a['model']={'model':'test-model','baseUrl':'https://approved.example/v1','apiKey':'test-private-key'}
   ready=self.acquire_ready(a);self.assertEqual(ready['fastAgentId'],'erp-assistant-fast')
   config=json.loads((Path(self.manager.data['members'][self.a]['directory'])/'openclaw.json').read_text())
   self.assertEqual(config['agents']['ownership'],'explicit')
   self.assertEqual(config['agents']['defaults']['systemAgent']['agentId'],'erp-assistant')
   self.assertNotIn('params',config['agents']['entries']['erp-assistant'])
   self.assertEqual(config['agents']['entries']['erp-assistant-fast']['params']['extra_body']['thinking']['type'],'disabled')
   self.assertEqual(ready['readAgentId'],'erp-assistant-read')
   self.assertTrue(ready['ephemeralTurns'])
   self.assertEqual(config['agents']['entries']['erp-assistant-read']['tools']['allow'],['session_status'])
   self.assertNotIn('params',config['agents']['entries']['erp-assistant-read'])
 def test_crm_model_and_tool_policy_preserves_erp(self):
  config={'agents':{'defaults':{'model':{'primary':'ark/erp-model'}},'entries':{'erp-assistant':{'tools':{'allow':['erp__*']}}}},'tools':{'allow':['erp__*']},'models':{'providers':{'ark':{'baseUrl':'https://ark.cn-beijing.volces.com/api/v3','models':[{'id':'erp-model'}]}}}}
  with patch.dict(m.os.environ,{'CRM_MODEL_ID':'doubao-seed-2-1-lite-260915'}):self.manager.apply_turn_policy(config)
  self.assertEqual(config['agents']['defaults']['model']['primary'],'ark/erp-model')
  self.assertEqual(config['agents']['entries']['erp-assistant']['tools']['allow'],['erp__*'])
  crm=config['agents']['entries']['crm-assistant'];self.assertEqual(crm['model']['primary'],'ark/doubao-seed-2-1-lite-260915')
  self.assertEqual(crm['tools']['allow'],['crm__*','suite__return_answer','session_status'])
  self.assertEqual(len(crm['skills']),3)
  mes=config['agents']['entries']['mes-assistant']
  self.assertEqual(mes['tools']['allow'],['mes__*','suite__return_answer','session_status'])
  self.assertEqual(mes['skills'],[])
  self.assertNotIn('model',mes)
  self.assertIn('mes__*',config['tools']['allow'])
 def test_fixed_crm_skills_install_without_arbitrary_files(self):
  self.manager.install_crm_skills(m.ROOT/'member')
  skills=m.ROOT/'member'/'workspace'/'skills'
  self.assertEqual(sorted(p.name for p in skills.iterdir()),['crm-customer-insight','crm-retention-plan','crm-segment-advisor'])
  for p in skills.iterdir():self.assertIn('"version":"1.0.1"',(p/'SKILL.md').read_text())
 def test_embedded_retry_settings_preserve_other_settings(self):
  root=m.ROOT/'member';directory=root/'agents'/'erp-assistant';directory.mkdir(parents=True)
  m.atomic(directory/'settings.json',{'other':'preserve','retry':{'provider':{'maxRetries':8}}})
  config={'agents':{'entries':{'erp-assistant':{'agentDir':'/state/agents/erp-assistant'},'crm-assistant':{'agentDir':'/state/agents/crm-assistant'}}}}
  self.manager.install_crm_skills(root,config)
  self.assertEqual(json.loads((directory/'settings.json').read_text())['other'],'preserve')
  for agent in config['agents']['entries']:
   for sub in [Path('agents')/agent,Path('agents')/agent/'agent']:
    self.assertEqual(json.loads((root/sub/'settings.json').read_text())['retry']['provider']['maxRetries'],0)
 def test_unapproved_model_host_rejected(self):
  with patch.dict(m.os.environ,{'AI_PROVIDER_ALLOWED_HOSTS':'approved.example'}):
   a=self.req(self.a);a['model']={'model':'test','baseUrl':'http://127.0.0.1/v1','apiKey':'test-private-key'}
   with self.assertRaises(ValueError):self.manager.command('acquire',a)
 def test_prepared_gateway_stays_ready_and_unprepare_releases_it(self):
  body={'tenantId':self.tenant,'membershipId':self.a}
  self.manager.command('prepare',body);self.manager.tick();self.manager.tick()
  self.assertEqual(self.manager.public(self.a)['state'],'ready')
  self.assertFalse(self.manager.data['leases'])
  self.now+=m.IDLE+1;self.manager.tick()
  self.assertTrue(self.containers['suite-managed-'+self.a])
  self.manager.command('unprepare',body);self.manager.tick()
  self.assertFalse(self.containers['suite-managed-'+self.a])
 def test_prepared_capacity_does_not_block_active_request(self):
  self.manager.command('prepare',{'tenantId':self.tenant,'membershipId':self.a})
  self.manager.tick();self.manager.tick()
  b=self.req(self.b);self.manager.command('acquire',b);self.manager.tick()
  self.assertFalse(self.containers['suite-managed-'+self.a])
  self.assertTrue(self.containers['suite-managed-'+self.b])
  self.manager.tick();self.assertEqual(self.manager.command('acquire',b)['state'],'ready')
  self.manager.command('release',b);self.now+=m.IDLE+1;self.manager.tick();self.manager.tick()
  self.assertTrue(self.containers['suite-managed-'+self.a])
 def test_more_than_one_prepared_member_when_capacity_allows(self):
  m.MAX_ACTIVE=2
  for member in (self.a,self.b):self.manager.command('prepare',{'tenantId':self.tenant,'membershipId':member})
  self.manager.tick();self.manager.tick()
  self.assertEqual([self.manager.public(x)['state'] for x in (self.a,self.b)],['ready','ready'])

 def test_release_cleanup_is_scoped_to_generated_turn(self):
  body=self.req(self.a);ready=self.acquire_ready(body)
  self.assertTrue(ready['ephemeralTurns'])
  self.manager.command('release',body);record=self.manager.data['members'][self.a]
  self.assertEqual(record['pendingCleanup'],[body['leaseId']])
  self.manager.tick();self.assertEqual(record['pendingCleanup'],[])
  clean=[c for c in self.calls if c[0]=='exec' and 'sessions.delete' in c[4]]
  self.assertEqual(len(clean),1)
  self.assertIn('agent:erp-assistant:dashboard:incognito-'+body['leaseId'],clean[0][5:])
  self.assertTrue(all('suite:' not in key for key in clean[0][5:]))
  launch=next(c for c in self.calls if c[0]=='run')
  self.assertEqual(launch[launch.index('--cpus')+1],str(m.GATEWAY_CPUS))

 def test_cleanup_failure_is_retained_and_retried_after_restart(self):
  body=self.req(self.a);self.acquire_ready(body);self.manager.command('release',body)
  def reject(*args):
   if args[0]=='exec' and 'sessions.delete' in args[4]:raise RuntimeError('cleanup unavailable')
   return self.docker(*args)
  self.manager.docker=reject;self.manager.tick()
  self.assertEqual(self.manager.data['members'][self.a]['pendingCleanup'],[body['leaseId']])
  self.manager.persist();self.now+=11
  self.manager=m.Manager(lambda:self.now,self.docker,lambda run:run())
  self.manager.tick();self.assertEqual(self.manager.data['members'][self.a]['pendingCleanup'],[])

 def test_pending_cleanup_bounds_admission(self):
  body=self.req(self.a);self.acquire_ready(body)
  record=self.manager.data['members'][self.a];record['pendingCleanup']=[str(uuid.uuid4()) for _ in range(100)]
  self.assertEqual(self.manager.command('acquire',body)['state'],'ready')
  with self.assertRaises(ValueError):self.manager.command('acquire',self.req(self.a))

 def test_turn_policy_upgrade_waits_for_lease_and_preserves_token(self):
  body=self.req(self.a);before=self.acquire_ready(body);record=self.manager.data['members'][self.a]
  record['turnPolicyVersion']=0
  self.assertFalse(self.manager.command('acquire',body)['ephemeralTurns'])
  self.manager.command('release',body)
  self.manager.command('prepare',{'tenantId':self.tenant,'membershipId':self.a})
  self.manager.tick();self.manager.tick()
  after=self.manager.command('acquire',self.req(self.a))
  self.assertTrue(after['ephemeralTurns']);self.assertEqual(before['secret'],after['secret'])
  config=json.loads((Path(record['directory'])/'openclaw.json').read_text())
  self.assertEqual(config['agents']['defaults']['contextInjection'],'never')
  self.assertFalse(config['session']['notifyOnCreate'])

 def test_operator_profile_gets_agents_without_replacing_its_model(self):
  path=m.ROOT/'profiles'/(self.tenant+'.json');config=json.loads(path.read_text())
  config['agents']['defaults']['model']={'primary':'suite-model/doubao-seed-2-1-pro-260915'}
  config['models']={'providers':{'suite-model':{'baseUrl':'https://ark.cn-beijing.volces.com/api/v3','api':'openai-completions','apiKey':'private-profile-key','models':[{'id':'doubao-seed-2-1-pro-260915'}]}}}
  m.atomic(path,config);before=json.dumps(config['models'],sort_keys=True)
  body=self.req(self.a);ready=self.acquire_ready(body)
  self.assertEqual(ready['fastAgentId'],'erp-assistant-fast');self.assertEqual(ready['readAgentId'],'erp-assistant-read')
  saved=json.loads((Path(self.manager.data['members'][self.a]['directory'])/'openclaw.json').read_text())
  self.assertEqual(json.dumps(saved['models'],sort_keys=True),before)
  self.assertEqual(saved['agents']['entries']['erp-assistant-fast']['params']['extra_body']['thinking']['type'],'disabled')

 def test_existing_profile_agents_are_adopted_without_restart(self):
  body=self.req(self.a);before=self.acquire_ready(body);record=self.manager.data['members'][self.a]
  record['profileAgentVersion']=None;self.manager.command('release',body)
  stops=sum(c[0]=='stop' for c in self.calls)
  self.manager.command('prepare',{'tenantId':self.tenant,'membershipId':self.a})
  self.assertEqual(sum(c[0]=='stop' for c in self.calls),stops)
  self.assertEqual(record['profileAgentVersion'],m.PROFILE_AGENT_VERSION)
  self.assertEqual(record['token'],before['secret'])

 def test_memory_upgrade_drains_active_execution_and_preserves_state(self):
  body=self.req(self.a);before=self.acquire_ready(body);record=self.manager.data['members'][self.a]
  path=Path(record['directory'])/'openclaw.json';config=path.read_bytes();record['gatewayMemoryMb']=1024;record['warm']=True
  self.manager.tick();self.assertEqual(record['state'],'ready');self.assertEqual(record['gatewayMemoryMb'],1024)
  self.manager.command('release',body);self.manager.tick();self.manager.tick()
  self.assertEqual(record['gatewayMemoryMb'],m.GATEWAY_MEMORY_MB)
  self.assertEqual(record['token'],before['secret']);self.assertEqual(path.read_bytes(),config)
  update=next(c for c in self.calls if c[0]=='update')
  self.assertEqual(update[update.index('--memory')+1],str(m.GATEWAY_MEMORY_MB)+'m')

if __name__=='__main__':unittest.main()
