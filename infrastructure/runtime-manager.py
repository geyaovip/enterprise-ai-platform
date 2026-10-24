#!/usr/bin/env python3
"""Private Unix-socket lifecycle controller. Only allowlisted member Gateways are managed.

No public listener, arbitrary Docker commands, shell interpolation, or state deletion.
API/Worker receive the control socket, never the Docker socket. Queue and leases survive
controller restarts; an expired lease retains a grace window beyond model deadlines.
"""
import copy
import shutil
import http.server
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import socketserver
import subprocess
import threading
import time
import uuid
from urllib.parse import urlparse

ROOT = Path(os.environ.get('RUNTIME_MANAGER_ROOT', '/opt/apaas/enterprise-ai-platform/shared/runtime-manager'))
SOCKET = os.environ.get('RUNTIME_MANAGER_SOCKET', '/run/suite-runtime/control.sock')
IMAGE = 'ghcr.io/openclaw/openclaw:2026.9.7@sha256:0da12cd49983fcb5e4915fd3135ce7a33d82f93649b1df6964946d2c1d1dbcfc'
NETWORK = os.environ.get('RUNTIME_MANAGER_NETWORK', 'enterprise-ai-platform_default')
MAX_ACTIVE = max(1, min(4, int(os.environ.get('RUNTIME_MAX_ACTIVE', '1'))))
MEMBER_CONCURRENT = max(1, min(4, int(os.environ.get('RUNTIME_MEMBER_CONCURRENT', '2'))))
GATEWAY_CPUS = max(0.5, min(64, float(os.environ.get('RUNTIME_GATEWAY_CPUS', '2'))))
GATEWAY_MEMORY_MB = max(1024, min(65536, int(os.environ.get('RUNTIME_GATEWAY_MEMORY_MB', '1536'))))
TURN_POLICY_VERSION = 4
FAST_AGENT_VERSION = 4
PROFILE_AGENT_VERSION = 1
IDLE = max(0, int(os.environ.get('RUNTIME_IDLE_SECONDS', '900')))
LEASE_TTL = 180  # heartbeat is 10 seconds; model call deadline is 60 seconds
BOOT_LIMIT = 180
LOCK = threading.RLock()


def identifier(value):
    return str(uuid.UUID(value))


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w') as f:
        os.chmod(tmp, 0o600)
        json.dump(data, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def docker(*args):
    # Never include stdout/stderr in public errors: Docker can echo config paths.
    p = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=35)
    if p.returncode:
        raise RuntimeError('CONTAINER_OPERATION_FAILED')
    return p.stdout.strip()


class Manager:
    def __init__(self, clock=time.time, executor=docker, submit_cleanup=None):
        self.clock, self.docker = clock, executor
        self.path = ROOT / 'state.json'
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {'members': {}, 'leases': {}}
        self.ready_cache = {}
        self.cleanup_active = set()
        self.submit_cleanup = submit_cleanup or (lambda run: threading.Thread(target=run, daemon=True).start())

    def apply_turn_policy(self, config):
        # The platform sends authorized history and owns durable messages/audits.
        # Workspace bootstrap and Home notices must not add a second context source.
        config['agents']['defaults']['contextInjection'] = 'never'
        config.setdefault('session', {})['notifyOnCreate'] = False
        entries = config['agents']['entries']
        base = next((v for k,v in entries.items() if k not in ('crm-assistant','mes-assistant') and not k.endswith(('-fast','-read'))), {})
        crm = copy.deepcopy(base)
        if 'model' in entries.get('crm-assistant', {}):
            crm['model'] = copy.deepcopy(entries['crm-assistant']['model'])
        crm.pop('default', None)
        crm['workspace'] = '/state/workspace'
        crm['agentDir'] = '/state/agents/crm-assistant'
        crm['skills'] = ['crm-customer-insight','crm-segment-advisor','crm-retention-plan']
        crm['tools'] = {'allow':['crm__*','suite__return_answer','session_status']}
        crm.setdefault('params', {})['extra_body'] = {'thinking': {'type':'disabled'}}
        crm_model = os.environ.get('CRM_MODEL_ID', '')
        if crm_model:
            if crm_model not in ['doubao-seed-2-1-lite-260915']:
                raise ValueError('CRM_MODEL_NOT_APPROVED')
            primary = config['agents']['defaults'].get('model', {})
            primary = primary.get('primary','') if isinstance(primary,dict) else primary
            provider_id = primary.partition('/')[0]
            provider = config.get('models',{}).get('providers',{}).get(provider_id)
            if provider and urlparse(provider.get('baseUrl','')).hostname == 'ark.cn-beijing.volces.com':
                if not any(m.get('id') == crm_model for m in provider.get('models',[])):
                    provider.setdefault('models',[]).append({'id':crm_model,'name':crm_model,'reasoning':False,'input':['text'],'contextWindow':64000,'maxTokens':4000})
                crm['model'] = {'primary':provider_id+'/'+crm_model,'fallbacks':[]}

        entries['crm-assistant'] = crm
        mes = copy.deepcopy(base)
        if 'model' in entries.get('mes-assistant', {}):
            mes['model'] = copy.deepcopy(entries['mes-assistant']['model'])
        mes.pop('default', None)
        mes['workspace'] = '/state/workspace'
        mes['agentDir'] = '/state/agents/mes-assistant'
        mes['skills'] = []
        mes['tools'] = {'allow':['mes__*','suite__return_answer','session_status']}
        mes.setdefault('params', {})['extra_body'] = {'thinking': {'type':'disabled'}}
        mes_model = os.environ.get('MES_MODEL_ID', '')
        if mes_model:
            if mes_model != 'doubao-seed-evolving':
                raise ValueError('MES_MODEL_NOT_APPROVED')
            primary = config['agents']['defaults'].get('model', {})
            primary = primary.get('primary','') if isinstance(primary,dict) else primary
            provider_id = primary.partition('/')[0]
            provider = config.get('models',{}).get('providers',{}).get(provider_id)
            if provider and urlparse(provider.get('baseUrl','')).hostname == 'ark.cn-beijing.volces.com':
                if not any(v.get('id') == mes_model for v in provider.get('models', [])):
                    provider.setdefault('models', []).append({'id':mes_model,'name':mes_model,'reasoning':False,'input':['text'],'contextWindow':64000,'maxTokens':2000})
                mes['model'] = {'primary':provider_id+'/'+mes_model,'fallbacks':[]}
        entries['mes-assistant'] = mes
        config['tools']['allow'] = list(dict.fromkeys(config['tools'].get('allow', []) + ['crm__*','mes__*']))


    def install_crm_skills(self, state_dir, config=None):
        source = Path(__file__).parent / 'crm-skills'
        destination = state_dir / 'workspace' / 'skills'
        for name in ['crm-customer-insight','crm-segment-advisor','crm-retention-plan']:
            target = destination / name
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(source / name / 'SKILL.md', target / 'SKILL.md')
        for p in [destination, *destination.rglob('*')]:
            os.chown(p, 1000, 1000)
        # OpenClaw's recovery retries are an embedded-agent settings key, not a
        # Gateway config key. Keep one provider attempt per platform execution.
        for agent_id, entry in (config or {}).get('agents', {}).get('entries', {}).items():
            directories = {state_dir / 'agents' / agent_id / 'agent'}
            configured = entry.get('agentDir', '')
            if configured.startswith('/state/') and '..' not in Path(configured).parts:
                directories.add(state_dir / configured.removeprefix('/state/'))
            for directory in directories:
                directory.mkdir(parents=True, exist_ok=True, mode=0o700)
                settings_path = directory / 'settings.json'
                settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
                settings.setdefault('retry', {}).setdefault('provider', {})['maxRetries'] = 0
                atomic(settings_path, settings)
                os.chown(directory, 1000, 1000)
                os.chown(settings_path, 1000, 1000)

    def apply_profile_agents(self, config):
        # An operator-provisioned tenant profile may already hold an approved
        # model without an AiProviderSettings row. Preserve that model and key.
        entries = config['agents']['entries']
        base_id = next(key for key in entries if not key.endswith(('-fast', '-read')))
        read_id = base_id + '-read'
        read_agent = copy.deepcopy(entries[base_id])
        read_agent.pop('default', None)
        read_agent['tools'] = {'allow': ['session_status']}
        entries[read_id] = read_agent
        primary = config['agents']['defaults'].get('model', {})
        primary = primary.get('primary', '') if isinstance(primary, dict) else primary
        provider_id, _, model_id = primary.partition('/')
        provider = config.get('models', {}).get('providers', {}).get(provider_id, {})
        fast_id = None
        # This is the existing validated Ark contract, not an assumed option
        # for every vendor. Other profiles keep their configured model behavior.
        if (urlparse(provider.get('baseUrl', '')).hostname == 'ark.cn-beijing.volces.com'
                and provider.get('api') == 'openai-completions' and model_id.startswith('doubao-seed-')):
            fast_id = base_id + '-fast'
            fast_agent = copy.deepcopy(read_agent)
            params = fast_agent.setdefault('params', {})
            params['extra_body'] = {**params.get('extra_body', {}), 'thinking': {'type': 'disabled'}}
            entries[fast_id] = fast_agent
        config['tools']['allow'] = list(dict.fromkeys(config['tools'].get('allow', []) + ['session_status']))
        config['agents']['ownership'] = 'explicit'
        config['agents']['defaults']['systemAgent'] = {'agentId': base_id}
        self.apply_turn_policy(config)
        return read_id, fast_id

    def persist(self):
        atomic(self.path, self.data)

    def profile(self, tenant):
        path = ROOT / 'profiles' / (identifier(tenant) + '.json')
        return json.loads(path.read_text()) if path.exists() else None

    def public(self, member):
        record = self.data['members'].get(member)
        if not record:
            return {'state': 'unprovisioned'}
        return {'state': record['state'], 'lastUsedAt': record.get('lastUsedAt'), 'managed': True}

    def apply_model(self, config, model):
        url = urlparse(model['baseUrl'])
        allowed = os.environ.get('AI_PROVIDER_ALLOWED_HOSTS', '').split(',')
        if url.scheme != 'https' or url.hostname not in allowed or url.username or url.password or url.query or url.fragment:
            raise ValueError('MODEL_HOST_REJECTED')
        if not isinstance(model.get('apiKey'), str) or len(model['apiKey']) < 8:
            raise ValueError('MODEL_KEY_REJECTED')
        config['models'] = {'mode': 'replace', 'providers': {'suite': {
            'baseUrl': model['baseUrl'], 'apiKey': model['apiKey'], 'api': 'openai-completions',
            'models': [{'id': model['model'], 'name': model['model'], 'reasoning': False, 'input': ['text'], 'contextWindow': 64000, 'maxTokens': 4000}]}}}
        config['agents']['defaults']['model'] = {'primary': 'suite/' + model['model'], 'fallbacks': []}
        config['agents']['defaults']['timeoutSeconds'] = 150
        model_defaults = config['agents']['defaults'].get('models')
        if isinstance(model_defaults, dict):
            for key in list(model_defaults):
                if key.startswith('suite/'):
                    model_defaults.pop(key)
            if not model_defaults:
                config['agents']['defaults'].pop('models', None)
        # Pinned 2026.9.7 uses agents.entries, not the older agents.list schema.
        entries = config['agents']['entries']
        base_id = next(key for key in entries if not key.endswith(('-fast', '-read')))
        fast_id = base_id + '-fast'
        entries.pop(fast_id, None)
        fast_agent = copy.deepcopy(entries[base_id])
        fast_agent['params'] = {**fast_agent.get('params', {}), 'extra_body': {'thinking': {'type': 'disabled'}}}
        fast_agent['tools'] = {'allow': ['session_status']}
        entries[fast_id] = fast_agent
        read_agent = copy.deepcopy(entries[base_id])
        read_agent['tools'] = {'allow': ['session_status']}
        entries[base_id + '-read'] = read_agent
        config['tools']['allow'] = list(dict.fromkeys(config['tools'].get('allow', []) + ['session_status']))
        config['agents']['ownership'] = 'explicit'
        config['agents']['defaults']['systemAgent'] = {'agentId': base_id}
        for agent in entries.values():
            agent.pop('model', None)
        self.apply_turn_policy(config)
        return hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest()

    def command(self, op, body):
        if op == 'list':
            with LOCK:
                return {'members': [{'tenantId': record['tenantId'], 'membershipId': member,
                                     'warm': bool(record.get('warm'))}
                                    for member, record in self.data['members'].items()]}
        tenant, member = identifier(body['tenantId']), identifier(body['membershipId'])
        with LOCK:
            record = self.data['members'].get(member)
            if record and record['tenantId'] != tenant:
                raise ValueError('MEMBER_TENANT_MISMATCH')
            if op == 'status':
                return {**self.public(member), 'available': bool(record or self.profile(tenant))}
            if op == 'prepare':
                model = body.get('model')
                model_hash = hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest() if model else None
                if (record and record.get('warm') and record.get('concurrency') == MEMBER_CONCURRENT
                        and record.get('turnPolicyVersion') == TURN_POLICY_VERSION
                        and (model or record.get('modelHash') is not None or record.get('profileAgentVersion') == PROFILE_AGENT_VERSION)
                        and (not model or record.get('fastAgentVersion') == FAST_AGENT_VERSION)
                        and record.get('modelHash') == model_hash and record['state'] != 'failed'):
                    return self.public(member)
                if record and record['state'] == 'failed' and self.clock() - record.get('failedAt', 0) < 60:
                    return self.public(member)
                # Provision through the same validated path as a real request, but do not
                # hold an execution lease while the Gateway starts in the background.
                lease_id = str(uuid.uuid4())
                request = {**body, 'leaseId': lease_id}
                self.command('acquire', request)
                self.command('release', request)
                record = self.data['members'][member]
                record['warm'] = True
                self.persist()
                return self.public(member)
            if op == 'unprepare':
                if record:
                    record['warm'] = False
                    self.persist()
                return self.public(member)
            lease_id = identifier(body['leaseId'])
            old = self.data['leases'].get(lease_id)
            if old and (old['member'] != member or old['tenantId'] != tenant):
                raise ValueError('LEASE_OWNER_MISMATCH')
            if op == 'release':
                if old:
                    del self.data['leases'][lease_id]
                    if record:
                        record['lastUsedAt'] = self.clock()
                        self.queue_cleanup(record, lease_id)
                    self.persist()
                return {'released': True}
            if op != 'acquire':
                raise ValueError('UNKNOWN_OPERATION')
            if not record:
                profile = self.profile(tenant)
                model = body.get('model')
                if not profile and not model:
                    raise ValueError('MODEL_NOT_CONFIGURED')
                # A provisioned profile is always scoped to its owning tenant.
                config = copy.deepcopy(profile or json.loads((ROOT / 'template.json').read_text()))
                self.apply_turn_policy(config)
                config['tools']['allow'] = list(dict.fromkeys(config['tools'].get('allow', []) + ['suite__return_answer']))
                for agent_id, agent in config['agents'].get('entries', {}).items():
                    policy = agent.setdefault('tools', {})
                    if not agent_id.endswith('-fast'):
                        policy['allow'] = list(dict.fromkeys(policy.get('allow', []) + ['suite__return_answer']))
                model_hash = self.apply_model(config, model) if model else None
                profile_read_id, profile_fast_id = self.apply_profile_agents(config) if not model else (None, None)
                token = secrets.token_hex(32)
                config['gateway']['auth']['token'] = token
                # Each Gateway has only its own writable state and workspace.
                config['agents']['defaults']['workspace'] = '/state/workspace'
                config['agents']['defaults']['maxConcurrent'] = MEMBER_CONCURRENT
                for agent_id, agent in config['agents'].get('entries', {}).items():
                    agent['workspace'] = '/state/workspace'
                    agent['agentDir'] = '/state/agents/' + agent_id
                state_dir = ROOT / 'members' / member
                state_dir.mkdir(parents=True, mode=0o700)
                for sub in ['workspace', 'agents', '.cache', 'tmp']:
                    (state_dir / sub).mkdir(mode=0o700, exist_ok=True)
                self.install_crm_skills(state_dir, config)
                atomic(state_dir / 'openclaw.json', config)
                for path in [state_dir, *state_dir.rglob('*')]:
                    os.chown(path, 1000, 1000)
                record = {'tenantId': tenant, 'container': 'suite-managed-' + member,
                          'directory': str(state_dir), 'token': token, 'agentId': next(iter(config['agents']['entries'])),
                          'state': 'suspended', 'lastUsedAt': self.clock(), 'exists': False, 'modelHash': model_hash,
                          'warm': False, 'concurrency': MEMBER_CONCURRENT,
                          'fastAgentId': next(iter(config['agents']['entries'])) + '-fast' if model else profile_fast_id,
                          'readAgentId': next(iter(config['agents']['entries'])) + '-read' if model else profile_read_id,
                          'fastAgentVersion': FAST_AGENT_VERSION if model else None,
                          'turnPolicyVersion': TURN_POLICY_VERSION,
                          'profileAgentVersion': PROFILE_AGENT_VERSION if not model else None}
                self.data['members'][member] = record
            model = body.get('model')
            if model and record.get('fastAgentVersion') != FAST_AGENT_VERSION:
                if any(l['member'] == member for l in self.data['leases'].values()):
                    raise ValueError('CONFIG_CHANGED_DURING_ACTIVE_LEASE')
                config_path = Path(record['directory']) / 'openclaw.json'
                config = json.loads(config_path.read_text())
                self.apply_model(config, model)
                base_id = record['agentId']
                fast_id = base_id + '-fast'
                config['agents']['entries'][fast_id]['workspace'] = '/state/workspace'
                config['agents']['entries'][fast_id]['agentDir'] = '/state/agents/' + fast_id
                read_id = base_id + '-read'
                config['agents']['entries'][read_id]['workspace'] = '/state/workspace'
                config['agents']['entries'][read_id]['agentDir'] = '/state/agents/' + read_id
                if record['state'] in ['ready', 'preparing']:
                    self.stop(record)
                atomic(config_path, config)
                os.chown(config_path, 1000, 1000)
                record['fastAgentId'] = fast_id
                record['readAgentId'] = read_id
                record['fastAgentVersion'] = FAST_AGENT_VERSION
                record['turnPolicyVersion'] = TURN_POLICY_VERSION
                self.persist()
            if record.get('turnPolicyVersion') != TURN_POLICY_VERSION and not any(l['member'] == member for l in self.data['leases'].values()):
                config_path = Path(record['directory']) / 'openclaw.json'
                config = json.loads(config_path.read_text())
                self.apply_turn_policy(config)
                self.install_crm_skills(Path(record['directory']), config)
                if record['state'] in ['ready', 'preparing']:
                    self.stop(record)
                atomic(config_path, config)
                os.chown(config_path, 1000, 1000)
                record['turnPolicyVersion'] = TURN_POLICY_VERSION
                self.persist()
            if not model and record.get('modelHash') is None and record.get('profileAgentVersion') != PROFILE_AGENT_VERSION and not any(l['member'] == member for l in self.data['leases'].values()):
                config_path = Path(record['directory']) / 'openclaw.json'
                config = json.loads(config_path.read_text())
                original = copy.deepcopy(config)
                read_id, fast_id = self.apply_profile_agents(config)
                for agent_id in [read_id, fast_id]:
                    if agent_id:
                        config['agents']['entries'][agent_id]['workspace'] = '/state/workspace'
                        config['agents']['entries'][agent_id]['agentDir'] = '/state/agents/' + agent_id
                if config != original:
                    if record['state'] in ['ready', 'preparing']:
                        self.stop(record)
                    atomic(config_path, config)
                    os.chown(config_path, 1000, 1000)
                record['readAgentId'], record['fastAgentId'] = read_id, fast_id
                record['profileAgentVersion'] = PROFILE_AGENT_VERSION
                self.persist()
            if record.get('concurrency') != MEMBER_CONCURRENT:
                if not any(l['member'] == member for l in self.data['leases'].values()):
                    config_path = Path(record['directory']) / 'openclaw.json'
                    config = json.loads(config_path.read_text())
                    config['agents']['defaults']['maxConcurrent'] = MEMBER_CONCURRENT
                    if record['state'] in ['ready', 'preparing']:
                        self.stop(record)
                    atomic(config_path, config)
                    os.chown(config_path, 1000, 1000)
                    record['concurrency'] = MEMBER_CONCURRENT
                    self.persist()
            model = body.get('model')
            if model:
                fingerprint = hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest()
                if record.get('modelHash') != fingerprint:
                    if any(l['member'] == member for l in self.data['leases'].values()):
                        raise ValueError('MODEL_CHANGED_DURING_ACTIVE_LEASE')
                    config_path = Path(record['directory']) / 'openclaw.json'
                    config = json.loads(config_path.read_text())
                    new_model_hash = self.apply_model(config, model)
                    fast_id = record['agentId'] + '-fast'
                    config['agents']['entries'][fast_id]['workspace'] = '/state/workspace'
                    config['agents']['entries'][fast_id]['agentDir'] = '/state/agents/' + fast_id
                    read_id = record['agentId'] + '-read'
                    config['agents']['entries'][read_id]['workspace'] = '/state/workspace'
                    config['agents']['entries'][read_id]['agentDir'] = '/state/agents/' + read_id
                    if record['state'] in ['ready', 'preparing']:
                        self.stop(record)
                    atomic(config_path, config)
                    os.chown(config_path, 1000, 1000)
                    record['modelHash'] = new_model_hash
                    record['readAgentId'] = read_id
                    self.persist()
            if len(record.get('pendingCleanup', [])) >= 100 and not old:
                raise ValueError('RUNTIME_CLEANUP_BACKLOG')
            if len(self.data['leases']) >= 100 and not old:
                raise ValueError('QUEUE_FULL')
            if not old:
                self.data['leases'][lease_id] = {'member': member, 'tenantId': tenant, 'queuedAt': self.clock(), 'expiresAt': self.clock() + LEASE_TTL}
            else:
                old['expiresAt'] = self.clock() + LEASE_TTL
            self.persist()
            lease = self.data['leases'][lease_id]
            # Separate sessions may run in parallel up to the Gateway's explicit limit.
            ahead = [l for k, l in self.data['leases'].items() if k != lease_id and l['queuedAt'] < lease['queuedAt']]
            member_leases = sorted(((k, l) for k, l in self.data['leases'].items() if l['member'] == member), key=lambda p: p[1]['queuedAt'])
            rank = next(i for i, (key, _) in enumerate(member_leases) if key == lease_id)
            admitted_here = sum(bool(l.get('admitted')) for key, l in member_leases if key != lease_id)
            older_other = any(l['member'] != member for l in ahead)
            if (record['state'] == 'ready' and (lease.get('admitted') or (rank < record.get('concurrency', 1)
                    and admitted_here < record.get('concurrency', 1) and (not older_other or MAX_ACTIVE > 1)))):
                lease['admitted'] = True
                self.persist()
                return {'state': 'ready', 'baseUrl': 'http://gateway-' + member + ':18789', 'secret': record['token'], 'agentId': record['agentId'], 'fastAgentId': record.get('fastAgentId'), 'readAgentId': record.get('readAgentId'), 'ephemeralTurns': record.get('turnPolicyVersion') == TURN_POLICY_VERSION}
            if record['state'] == 'failed':
                # Don't auto-retry a failed boot forever. A new request can retry it.
                if lease['queuedAt'] > record.get('failedAt', 0):
                    record['state'] = 'suspended'
                    self.persist()
                else:
                    return {'state': 'failed'}
            return {'state': 'preparing' if record['state'] == 'preparing' and rank == 0 else 'queued', 'queuePosition': len(ahead) + 1}

    def stop(self, record):
        self.docker('stop', '--time', '20', record['container'])
        record.update(state='suspended', lastUsedAt=self.clock())
        record['pendingCleanup'] = []  # Process-owned Incognito stores expire on stop.

    def queue_cleanup(self, record, lease_id):
        if record.get('turnPolicyVersion') != TURN_POLICY_VERSION:
            return
        pending = record.setdefault('pendingCleanup', [])
        if lease_id not in pending:
            pending.append(lease_id)

    def cleanup(self, member, record):
        if member in self.cleanup_active or not record.get('pendingCleanup') or self.clock() < record.get('cleanupRetryAt', 0):
            return
        if record['state'] not in ['ready', 'preparing']:
            record['pendingCleanup'] = []
            return
        lease_id = record['pendingCleanup'][0]
        agent_ids = [record['agentId'], record.get('fastAgentId'), record.get('readAgentId')]
        keys = ['agent:' + agent + ':dashboard:incognito-' + identifier(lease_id) for agent in agent_ids if agent]
        self.cleanup_active.add(member)
        # Outside the admission lock and model path. Only keys derived from an
        # owned execution lease are passed to the private loopback RPC helper.
        def run():
            try:
                script = Path(__file__).with_name('openclaw-ephemeral-cleanup.cjs').read_text()
                self.docker('exec', record['container'], 'node', '-e', script, *keys)
                with LOCK:
                    record['pendingCleanup'] = [key for key in record.get('pendingCleanup', []) if key != lease_id]
                    self.persist()
            except (RuntimeError, OSError, subprocess.TimeoutExpired):
                with LOCK:
                    record['cleanupRetryAt'] = self.clock() + 10
            finally:
                with LOCK:
                    self.cleanup_active.discard(member)
        self.submit_cleanup(run)

    def probe_script(self):
        return "const fs=require('fs');const c=JSON.parse(fs.readFileSync('/state/openclaw.json'));fetch('http://127.0.0.1:18789/readyz',{headers:{authorization:'Bearer '+c.gateway.auth.token},signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

    def ready(self, record):
        # Probe admission readiness, never host-published ports or a heavyweight CLI.
        try:
            self.docker('exec', record['container'], 'node', '-e', self.probe_script())
            return True
        except (RuntimeError, subprocess.TimeoutExpired):
            return False

    def start(self, member, record):
        # Inspect every time: a removed container is recreated from retained state.
        # This also recovers a crash between docker run and persistence.
        try:
            self.docker('inspect', record['container'])
        except RuntimeError:
            exists = False
        else:
            exists = True
        if exists:
            self.docker('update', '--cpus', str(GATEWAY_CPUS), '--memory', str(GATEWAY_MEMORY_MB) + 'm',
                        '--memory-swap', str(GATEWAY_MEMORY_MB * 2) + 'm', record['container'])
            self.docker('start', record['container'])
        else:
            self.docker('run', '-d', '--name', record['container'], '--label', 'suite.runtime.managed=true',
                        '--label', 'suite.runtime.member=' + member, '--network', NETWORK,
                        '--network-alias', 'gateway-' + member, '--user', '1000:1000',
                        '--read-only', '--tmpfs', '/tmp:size=64m,mode=1777', '--cap-drop', 'ALL',
                        '--security-opt', 'no-new-privileges:true', '--pids-limit', '128',
                        '--memory', str(GATEWAY_MEMORY_MB) + 'm', '--cpus', str(GATEWAY_CPUS), '--restart', 'unless-stopped',
                        '--health-cmd', 'node -e ' + shlex.quote(self.probe_script()),
                        '--health-interval', '15s', '--health-timeout', '5s', '--health-retries', '8', '--health-start-period', '180s',
                        '-v', record['directory'] + ':/state', '-e', 'HOME=/state', '-e', 'XDG_CACHE_HOME=/state/.cache',
                        '-e', 'TMPDIR=/state/tmp', '-e', 'OPENCLAW_STATE_DIR=/state',
                        '-e', 'OPENCLAW_CONFIG_PATH=/state/openclaw.json', '-e', 'NODE_OPTIONS=--max-old-space-size=768',
                        IMAGE, 'node', 'dist/index.js', 'gateway', 'run')
        record.update(state='preparing', startedAt=self.clock(), exists=True, gatewayMemoryMb=GATEWAY_MEMORY_MB)

    def tick(self):
        with LOCK:
            now = self.clock()
            for key, lease in self.data['leases'].items():
                if lease['expiresAt'] <= now:
                    self.queue_cleanup(self.data['members'][lease['member']], key)
            self.data['leases'] = {k: l for k, l in self.data['leases'].items() if l['expiresAt'] > now}
            waiting = sorted(self.data['leases'].values(), key=lambda l: l['queuedAt'])
            members_with_leases = {l['member'] for l in waiting}
            active = []
            for member, record in self.data['members'].items():
                if record['state'] not in ['ready', 'preparing']:
                    continue
                # Reconcile Docker after manager / host / Gateway restart.
                try:
                    running = self.docker('inspect', '-f', '{{.State.Running}}', record['container']) == 'true'
                except RuntimeError:
                    running = False
                if not running:
                    record['state'] = 'suspended'
                    continue
                if record['state'] == 'ready':
                    try:
                        health = self.docker('inspect', '-f', '{{.State.Health.Status}}', record['container'])
                    except RuntimeError:
                        health = 'unknown'
                    if health != 'healthy':
                        record.update(state='preparing', startedAt=now)
                admitted_here = any(l['member'] == member and l.get('admitted') for l in waiting)
                # OpenClaw samples constrained memory at startup. Updating only
                # the Docker cap leaves the old pressure threshold in the process.
                # Wait for active turns to drain, then resume with the new cap.
                if record.get('gatewayMemoryMb') != GATEWAY_MEMORY_MB and not admitted_here:
                    self.stop(record)
                    continue
                oldest_other = bool(waiting and waiting[0]['member'] != member)
                if (not record.get('warm') and member not in members_with_leases and now - record['lastUsedAt'] >= IDLE) or (not admitted_here and oldest_other and record['state'] == 'ready' and len(active) + 1 >= MAX_ACTIVE):
                    self.stop(record)
                    continue
                if record['state'] == 'preparing':
                    if self.ready(record):
                        record['state'] = 'ready'
                    elif now - record.get('startedAt', now) > BOOT_LIMIT:
                        self.stop(record)
                        record.update(state='failed', failedAt=now)
                active.append(member)
            for lease in waiting:
                member = lease['member']
                record = self.data['members'][member]
                if member in active or record['state'] == 'failed':
                    continue
                if len(active) >= MAX_ACTIVE:
                    break
                self.start(member, record)
                active.append(member)
            for member, record in self.data['members'].items():
                if len(active) >= MAX_ACTIVE:
                    break
                if not record.get('warm') or record['state'] in ['ready', 'preparing', 'failed'] or member in active:
                    continue
                self.start(member, record)
                active.append(member)
            for member, record in self.data['members'].items():
                self.cleanup(member, record)
            self.persist()


class UnixHTTP(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    os.umask(0o077)
    manager = Manager()

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length < 16000:
                    raise ValueError('INVALID_REQUEST_SIZE')
                body = json.loads(self.rfile.read(length))
                result = manager.command(self.path.removeprefix('/'), body)
                self.send_response(200)
            except (ValueError, KeyError, TypeError):
                result = {'error': 'REQUEST_REJECTED'}
                self.send_response(400)
            except Exception:
                result = {'error': 'MANAGER_UNAVAILABLE'}
                self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

    Path(SOCKET).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    Path(SOCKET).unlink(missing_ok=True)
    server = UnixHTTP(SOCKET, Handler)
    os.chmod(SOCKET, 0o600)

    def loop():
        while True:
            try:
                manager.tick()
            except Exception:
                print('runtime-manager reconciliation failed', flush=True)
            time.sleep(2)
    threading.Thread(target=loop, daemon=True).start()
    server.serve_forever()


if __name__ == '__main__':
    main()
