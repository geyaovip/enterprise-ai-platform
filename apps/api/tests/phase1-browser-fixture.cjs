require('dotenv/config');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');
const { hashPassword } = require('../dist/modules/platform/security');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(url)) throw Error('Only isolated Phase1 QA database is allowed');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const file = resolve('../../var/phase1-browser-fixture.json');
  try {
    if (process.argv[2] === 'clean') {
      const fixture = JSON.parse(await readFile(file, 'utf8')); const where = { tenantId: fixture.tenant.id };
      const { removeOriginal } = require('../dist/modules/knowledge/knowledge-storage');
      for (const v of await db.knowledgeDocumentVersion.findMany({ where, select: { storageKey: true } })) await removeOriginal(v.storageKey);
      for (const t of ['knowledgeCitation','knowledgeIndex','knowledgeDocumentVersion','knowledgeDocument','knowledgeGrant','knowledgeSpace','aiExecution','infrastructureBinding','tenantCapability','operatorAudit','aiAction','aiConversation','aiUsage','erpAnnouncementRead','erpAnnouncement','erpNotification','erpTask','auditEvent','membershipOrg','orgUnit','tenantApp','membership']) await db[t].deleteMany({ where });
      await db.tenant.delete({ where: { id: fixture.tenant.id } });
      await db.session.deleteMany({ where: { userId: { in: fixture.users.map(u => u.id) } } });
      await db.user.deleteMany({ where: { id: { in: fixture.users.map(u => u.id) } } }); await unlink(file);
      process.stdout.write('Dedicated browser QA tenant and users removed.\n'); return;
    }
    const marker = randomUUID().slice(0,8); const password = 'Browser-QA-Only-2026!';
    const tenant = await db.tenant.create({ data: { name: '首阶段浏览器验收', slug: `phase1-ui-${marker}` } });
    const org = await db.orgUnit.create({ data: { name: '验收企业', tenantId: tenant.id } });
    await db.tenantApp.create({ data: { tenantId: tenant.id, appId: 'erp' } });
    await db.tenantCapability.createMany({ data: ['ai','knowledge'].map(capability => ({ tenantId: tenant.id, capability, delivered: true, enabled: true })) });
    const users = [];
    for (const role of ['admin', 'sales', 'operator']) {
      const user = await db.user.create({ data: { email: `phase1-${role}-${marker}@example.test`, name: role === 'admin' ? '验收管理员' : role === 'sales' ? '验收销售' : '验收运营', passwordHash: hashPassword(password), ...(role === 'operator' ? { platformRole: 'operator' } : {}) } });
      const member = role !== 'operator' ? await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role } }) : null;
      if (member) await db.membershipOrg.create({ data: { tenantId: tenant.id, membershipId: member.id, orgUnitId: org.id, primary: true } });
      users.push({ id: user.id, email: user.email, role, membershipId: member?.id });
    }
    await writeFile(file, JSON.stringify({ tenant, users, password }, null, 2), { mode: 0o600, flag: 'wx' });
    process.stdout.write(JSON.stringify({ slug: tenant.slug, users: users.map(u => ({ email: u.email, role: u.role })) }) + '\n');
  } finally { await db.$disconnect(); }
}
main().catch(e => { process.stderr.write(e.stack+'\n'); process.exitCode=1; });
