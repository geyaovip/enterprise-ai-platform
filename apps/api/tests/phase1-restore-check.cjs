require('dotenv/config');
const assert = require('node:assert/strict');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');
const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
async function main() {
  const source = process.env.DATABASE_URL;
  const cloneName = process.env.PHASE1_RESTORE_DB;
  if (!source || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(source) || !/^suite_phase1_restore_qa_[a-z0-9_]+$/.test(cloneName ?? '')) throw Error('Only dedicated source and restore QA databases are allowed.');
  const fixture = JSON.parse(await readFile(resolve('../../var/phase1-browser-fixture.json'), 'utf8'));
  const target = new URL(source); target.pathname = '/' + cloneName;
  const left = new PrismaClient({ adapter: new PrismaPg({ connectionString: source }) });
  const right = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
  try {
    for (const table of ['knowledgeSpace', 'knowledgeGrant', 'knowledgeDocument', 'knowledgeDocumentVersion', 'tenantCapability', 'membershipOrg', 'auditEvent']) {
      const where = { tenantId: fixture.tenant.id };
      const orderBy = table === 'membershipOrg' ? [{ membershipId: 'asc' }, { orgUnitId: 'asc' }] : { id: 'asc' };
      const a = await left[table].findMany({ where, orderBy });
      const b = await right[table].findMany({ where, orderBy });
      assert.ok(JSON.stringify(a) === JSON.stringify(b), `Restored ${table} does not match source`);
    }
    const versions = await right.knowledgeDocumentVersion.findMany({ where: { tenantId: fixture.tenant.id } });
    assert.ok(versions.length, 'Restore test requires a public sample document');
    const originals = process.env.PHASE1_RESTORE_ORIGINALS;
    if (!originals) throw Error('PHASE1_RESTORE_ORIGINALS is required');
    for (const v of versions) {
      assert.match(v.storageKey, /^[a-f0-9-]{36}$/);
      const bytes = await readFile(resolve(originals, v.storageKey));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), v.sha256, 'Restored original SHA-256 mismatch');
      assert.equal(bytes.length, v.byteSize);
    }
    const environment = { ...process.env, DATABASE_URL: target.toString() };
    const migrate = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env: environment, stdio: 'inherit' });
    assert.equal(migrate.status, 0, 'Restored migration replay failed');
    const diff = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], { env: environment, stdio: 'inherit' });
    assert.equal(diff.status, 0, 'Restored schema drift detected');
    process.stdout.write(`Phase1 joint restore: ${versions.length} original(s), SHA-256/size, canonical version/ACL/capability/audit metadata, migration replay and schema diff passed.\n`);
  } finally { await Promise.all([left.$disconnect(), right.$disconnect()]); }
}
main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; });
