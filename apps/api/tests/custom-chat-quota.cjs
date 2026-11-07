const assert = require('node:assert/strict');
const { QuotaService } = require('../dist/modules/orchestration/quota.service');

(async () => {
  const customTenants = new Set(['custom']), records = [];
  let trialWrites = 0;
  const db = {
    $executeRaw: async () => {},
    aiProviderSettings: {count: async ({where}) => Number(customTenants.has(where.tenantId))},
    aiChatTurn: {count: async () => 3, findUnique: async () => null, create: async () => {trialWrites++;}},
    tenantSubscription: {findUnique: async () => ({status: 'active', expiresAt: new Date(Date.now() + 60000), entitlement: {appIds: ['erp'], aiRunLimit: 1, taskLimit: 1}})},
    usageRecord: {findUnique: async () => null, count: async () => 100, create: async ({data}) => {records.push(data); return data;}},
  };
  const quota = new QuotaService(db), custom = {tenantId: 'custom', userId: 'shared-account', membershipId: 'member', app: {appId: 'erp'}}, platform = {...custom, tenantId: 'platform'};
  assert.deepEqual(await quota.chatSummary(custom), {limit: null, used: 0, remaining: null, period: 'unlimited'});
  assert.equal((await quota.chatSummary(platform)).remaining, 0);
  for (let i = 0; i < 6; i++) await quota.reserveChat(custom, 'custom-' + i, db);
  assert.equal(trialWrites, 0);
  await assert.rejects(() => quota.reserveChat(platform, 'default', db), /3 次/);
  await quota.reserve(custom, 'ai_run', 'custom-run', db);
  assert.equal(records[0].tenantId, custom.tenantId);
  assert.equal(records[0].metric, 'ai_run');
  await assert.rejects(() => quota.reserve(platform, 'ai_run', 'default-run', db), /本月可用额度不足/);
  await assert.rejects(() => quota.reserve(custom, 'task', 'task', db), /本月可用额度不足/);
  await assert.rejects(() => quota.reserve({...custom, app: {appId: 'mes'}}, 'ai_run', 'unauthorized-app', db), /套餐未包含/);
  customTenants.clear();
  assert.equal((await quota.chatSummary(custom)).remaining, 0);
  await assert.rejects(() => quota.reserveChat(custom, 'restored-default', db), /3 次/);
  console.log('Custom channel quota checks passed: trial and monthly AI limits bypassed, metering retained, tenant/app/task boundaries preserved, original default trial restored. Synthetic storage only.');
})().catch(error => {console.error(error); process.exitCode = 1;});
