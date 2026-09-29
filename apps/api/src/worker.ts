import 'dotenv/config';
import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Prisma } from './generated/prisma/client';
import { AppModule } from './modules/app.module';
import { PrismaService } from './modules/prisma.service';
import { AuthService } from './modules/platform/auth.service';
import { AiService } from './modules/ai/ai.service';

export async function processNextTask(db: PrismaService, auth: AuthService, ai: AiService): Promise<boolean> {
  const stale = new Date(Date.now() - 120_000);
  const task = await db.aiTask.findFirst({ where: { OR: [{ status: 'queued' }, { status: 'running', startedAt: { lt: stale } }] }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  const claimed = await db.aiTask.updateMany({ where: { id: task.id, status: task.status, ...(task.status === 'running' ? { startedAt: task.startedAt } : {}) }, data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } } });
  if (!claimed.count) return true;
  if (task.attempts >= 3) {
    await db.aiTask.update({ where: { id: task.id }, data: { status: 'failed', errorCode: 'RETRY_LIMIT', finishedAt: new Date() } });
    return true;
  }
  try {
    const ctx = await auth.taskContext({ tenantId: task.tenantId, userId: task.userId, membershipId: task.membershipId, appId: task.appId, taskId: task.id });
    const result = task.kind === 'analyze' ? await ai.analyze(ctx, task.input) : task.kind === 'extract' ? await ai.extract(ctx, task.input) : undefined;
    if (!result) throw new Error('UNKNOWN_TASK_KIND');
    await db.aiTask.update({ where: { id: task.id }, data: { status: 'completed', result: result as Prisma.InputJsonValue, finishedAt: new Date() } });
  } catch (error) {
    await db.aiTask.update({ where: { id: task.id }, data: { status: 'failed', errorCode: error instanceof Error ? error.name.slice(0, 80) : 'UNKNOWN', finishedAt: new Date() } });
  }
  return true;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const db = app.get(PrismaService);
  const auth = app.get(AuthService);
  const ai = app.get(AiService);
  let stopping = false;
  let lastTick = Date.now();
  const health = createServer(async (req, res) => {
    if (req.url !== '/health') { res.writeHead(404).end(); return; }
    try {
      await db.$queryRaw`SELECT 1`;
      const ready = !stopping && Date.now() - lastTick < 15_000;
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: ready, database: 'ready' }));
    } catch { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, database: 'unavailable' })); }
  });
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 4602);
  await new Promise<void>(resolve => health.listen(port, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', resolve));
  const shutdown = () => { stopping = true; };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  while (!stopping) {
    try { await processNextTask(db, auth, ai); }
    catch (error) { process.stderr.write(`[worker] poll failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`); }
    lastTick = Date.now();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await new Promise<void>(resolve => health.close(() => resolve()));
  await app.close();
}

if (require.main === module) void main().catch(error => { process.stderr.write(`[worker] startup failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`); process.exitCode = 1; });
