import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const url = process.env.DATABASE_URL;
if (!url || !url.includes('127.0.0.1:54329/suite_dev')) {
  throw new Error('M1 smoke test is restricted to the local development database');
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const slug = `m1-${randomUUID()}`;
  try {
  try {
    await db.$transaction(async tx => {
      const tenant = await tx.tenant.create({ data: { slug, name: 'M1 smoke' } });
      await tx.orgUnit.create({ data: { tenantId: tenant.id, name: 'Root' } });
      throw new Error('rollback requested');
    });
    throw new Error('Transaction unexpectedly committed');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'rollback requested') throw error;
  }
  const found = await db.tenant.findUnique({ where: { slug } });
  if (found) throw new Error('Transaction did not roll back');
  process.stdout.write('M1 PostgreSQL transaction rollback: passed\n');
  } finally {
    await db.$disconnect();
  }
}

void main();
