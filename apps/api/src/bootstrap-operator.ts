import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { hashPassword } from './modules/platform/security';
async function main() {
  const email = process.env.OPERATOR_EMAIL?.trim().toLowerCase(); const password = process.env.OPERATOR_PASSWORD;
  if (!email || !password || password.length < 12 || !process.env.DATABASE_URL) throw new Error('OPERATOR_EMAIL, OPERATOR_PASSWORD (12+) and DATABASE_URL are required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    if (await db.user.findUnique({ where: { email } })) throw new Error('Account already exists; role escalation requires a separate audited operation');
    const user = await db.user.create({ data: { email, name: process.env.OPERATOR_NAME ?? '平台运营', passwordHash: hashPassword(password), platformRole: 'operator' } });
    await db.operatorAudit.create({ data: { userId: user.id, action: 'platform.operator.bootstrap', resourceId: user.id } });
    process.stdout.write('Platform operator created\n');
  } finally { await db.$disconnect(); }
}
void main();
