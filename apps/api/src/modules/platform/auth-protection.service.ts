import { ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import type { Prisma } from '../../generated/prisma/client';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
type Transaction = Prisma.TransactionClient;

@Injectable()
export class AuthProtectionService {
  constructor(private readonly db: PrismaService) {}
  private key(value: string) {
    const secret = process.env.AUTH_EMAIL_SECRET;
    if (!secret || secret.length < 32) throw new ServiceUnavailableException('邮箱登录暂不可用，请稍后再试');
    return createHmac('sha256', secret).update('protection:' + value).digest('hex');
  }
  private pair(email: string, ip: string) { return email + ':' + ip; }
  private reject(until: Date, message = '操作过于频繁') {
    const retryAfter = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
    throw new HttpException({ code: 'AUTH_RATE_LIMITED', message: `${message}，请在${retryAfter}秒后重试`, retryAfter }, 429);
  }
  private turnstileConfiguration() {
    const sitekey = process.env.TURNSTILE_SITE_KEY?.trim(), secret = process.env.TURNSTILE_SECRET_KEY?.trim();
    const hosts = (process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? 'zhixingark.cn,www.zhixingark.cn,enterprise-ai-platform.492746023.workers.dev').split(',').map(x => x.trim()).filter(Boolean);
    if (!sitekey || !secret || !hosts.length || (process.env.NODE_ENV === 'production' && (/^[123]x0/.test(sitekey) || /^[123]x0/.test(secret)))) throw new ServiceUnavailableException('安全验证暂不可用，请稍后再试');
    return { sitekey, secret, hosts };
  }
  publicConfiguration() { return { siteKey: this.turnstileConfiguration().sitekey }; }

  async assertUnblocked(email: string, ip: string, tx: Transaction = this.db) {
    const blocked = await tx.authEmailRate.findUnique({ where: { key: this.key('blocked:' + this.pair(email, ip)) } });
    if (blocked && blocked.expiresAt > new Date()) this.reject(blocked.expiresAt);
  }
  async ingress(kind: 'send' | 'verify', email: string, ip: string) {
    await this.assertUnblocked(email, ip);
    const start = Math.floor(Date.now() / MINUTE) * MINUTE;
    const key = this.key(`ingress:${kind}:${ip}:${start}`), expiresAt = new Date(start + MINUTE);
    const row = await this.db.authEmailRate.upsert({ where: { key }, create: { key, count: 1, expiresAt }, update: { count: { increment: 1 } } });
    if (row.count > (kind === 'send' ? 30 : 60)) this.reject(expiresAt);
  }
  async cooldown(email: string, tx: Transaction = this.db) {
    const item = await tx.authEmailChallenge.findFirst({ where: { email, createdAt: { gt: new Date(Date.now() - MINUTE) } }, orderBy: { createdAt: 'desc' } });
    if (item) this.reject(new Date(item.createdAt.getTime() + MINUTE), '验证码已请求');
  }

  async verifyHuman(token: string | undefined, email: string, ip: string) {
    const config = this.turnstileConfiguration();
    if (!token) {
      await this.failure('human', email, ip);
      throw new ForbiddenException({ code: 'HUMAN_VERIFICATION_REQUIRED', message: '请先完成安全验证，再获取验证码' });
    }
    let result: { success?: boolean; hostname?: string; action?: string };
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: config.secret, response: token }), signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error('verification-unavailable');
      result = await response.json() as typeof result;
    } catch { throw new ServiceUnavailableException('安全验证服务暂不可用，请稍后重试'); }
    if (!result.success || !result.hostname || !config.hosts.includes(result.hostname) || result.action !== 'email_code') {
      await this.failure('human', email, ip);
      throw new ForbiddenException({ code: 'HUMAN_VERIFICATION_FAILED', message: '安全验证未通过，请重试' });
    }
    // Successful human proof clears only this mailbox/IP's human-failure burst.
    await this.db.authEmailRate.deleteMany({ where: { key: this.key('fail:human:' + this.pair(email, ip)) } });
  }

  // Called under the global admission lock: rejected requests roll back every
  // reservation. Only an admitted provider attempt consumes sending allowance.
  async reserveSending(email: string, ip: string, tx: Transaction) {
    await this.cooldown(email, tx);
    const configured = Number(process.env.AUTH_EMAIL_DAILY_LIMIT ?? 80);
    const limits = [
      { where: { email }, duration: HOUR, maximum: 5 },
      { where: { email }, duration: DAY, maximum: 10 },
      { where: {}, duration: DAY, maximum: Number.isSafeInteger(configured) && configured > 0 ? configured : 80 },
    ];
    for (const rule of limits) {
      const rows = await tx.authEmailChallenge.findMany({ where: { ...rule.where, createdAt: { gt: new Date(Date.now() - rule.duration) } }, select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: rule.maximum });
      if (rows.length >= rule.maximum) this.reject(new Date(rows.at(-1)!.createdAt.getTime() + rule.duration));
    }
    // IP is an auxiliary, generous reservation limit for shared enterprise NAT.
    const start = Math.floor(Date.now() / HOUR) * HOUR, key = this.key(`reserved-ip:${ip}:${start}`), until = new Date(start + HOUR);
    const current = await tx.authEmailRate.findUnique({ where: { key } });
    if (current && current.count >= 100) this.reject(until);
    await tx.authEmailRate.upsert({ where: { key }, create: { key, count: 1, expiresAt: until }, update: { count: { increment: 1 } } });
  }

  async failure(kind: 'human' | 'code', email: string, ip: string) {
    const pair = this.pair(email, ip), blockKey = this.key('blocked:' + pair);
    const retryAt = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${blockKey}))`;
      const now = new Date(), blocked = await tx.authEmailRate.findUnique({ where: { key: blockKey } });
      if (blocked && blocked.expiresAt > now) return blocked.expiresAt;
      const failKey = this.key('fail:' + kind + ':' + pair), old = await tx.authEmailRate.findUnique({ where: { key: failKey } });
      const count = old && old.expiresAt > now ? old.count + 1 : 1, expiresAt = old && old.expiresAt > now ? old.expiresAt : new Date(Date.now() + 15 * MINUTE);
      await tx.authEmailRate.upsert({ where: { key: failKey }, create: { key: failKey, count, expiresAt }, update: { count, expiresAt } });
      if (count < (kind === 'human' ? 3 : 10)) return null;
      const strikeKey = this.key('strikes:' + pair), oldStrike = await tx.authEmailRate.findUnique({ where: { key: strikeKey } });
      const strike = oldStrike && oldStrike.expiresAt > now ? Math.min(3, oldStrike.count + 1) : 1;
      const until = new Date(Date.now() + [5, 15, 60][strike - 1] * MINUTE);
      await tx.authEmailRate.upsert({ where: { key: strikeKey }, create: { key: strikeKey, count: strike, expiresAt: new Date(Date.now() + DAY) }, update: { count: strike, expiresAt: new Date(Date.now() + DAY) } });
      await tx.authEmailRate.upsert({ where: { key: blockKey }, create: { key: blockKey, count: strike, expiresAt: until }, update: { count: strike, expiresAt: until } });
      await tx.authEmailRate.deleteMany({ where: { key: failKey } });
      return until;
    });
    if (retryAt) this.reject(retryAt);
  }
  async clearFailures(email: string, ip: string, tx: Transaction = this.db) {
    const pair = this.pair(email, ip);
    await tx.authEmailRate.deleteMany({ where: { key: { in: ['fail:human:', 'fail:code:', 'strikes:', 'blocked:'].map(prefix => this.key(prefix + pair)) } } });
  }
}
