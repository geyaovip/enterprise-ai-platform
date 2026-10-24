import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { hashPassword } from './modules/platform/security';

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_PASSWORD;
  const tenantSlug = process.env.BOOTSTRAP_TENANT_SLUG?.trim().toLowerCase();
  const tenantName = process.env.BOOTSTRAP_TENANT_NAME?.trim();
  if (!url || !email || !password || password.length < 12 || !tenantSlug || !tenantName) {
    throw new Error('DATABASE_URL, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD (12+), BOOTSTRAP_TENANT_SLUG and BOOTSTRAP_TENANT_NAME are required');
  }
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(tenantSlug)) throw new Error('Invalid tenant slug');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (await db.tenant.findUnique({ where: { slug: tenantSlug } })) throw new Error('Tenant already exists; bootstrap is one-time only');
    if (await db.user.findUnique({ where: { email } })) throw new Error('User already exists; use explicit invitation flow');
    const result = await db.$transaction(async tx => {
      const tenant = await tx.tenant.create({ data: { slug: tenantSlug, name: tenantName } });
      const user = await tx.user.create({ data: { email, name: email.split('@')[0], passwordHash: hashPassword(password) } });
      const member = await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'admin' } });
      const root = await tx.orgUnit.create({ data: { tenantId: tenant.id, name: tenantName } });
      await tx.membershipOrg.create({ data: { tenantId: tenant.id, membershipId: member.id, orgUnitId: root.id, primary: true } });
      await tx.tenantApp.create({ data: { tenantId: tenant.id, appId: 'erp' } });
      await tx.tenantCapability.createMany({ data: ['ai', 'knowledge'].map(capability => ({ tenantId: tenant.id, capability, delivered: true, enabled: true })) });
      await tx.auditEvent.create({ data: { tenantId: tenant.id, userId: user.id, membershipId: member.id, appId: 'platform', requestId: 'bootstrap', action: 'platform.tenant.bootstrap', resourceType: 'Tenant', resourceId: tenant.id } });
      return { tenantId: tenant.id, slug: tenant.slug, adminId: user.id };
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await db.$disconnect();
  }
}

void main();
