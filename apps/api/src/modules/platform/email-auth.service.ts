import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { newSessionToken, tokenHash } from './security';
import { AuthProtectionService } from './auth-protection.service';
import { SESSION_IDLE_MS } from './auth-session';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
type VerifyInput = { email: string; challengeId: string; code: string };

@Injectable()
export class EmailAuthService {
  constructor(private readonly db: PrismaService, private readonly protection: AuthProtectionService) {}

  private configuration() {
    const key = process.env.RESEND_API_KEY?.trim(), from = process.env.AUTH_EMAIL_FROM?.trim();
    const secret = process.env.AUTH_EMAIL_SECRET;
    if (!key || !from || !secret || secret.length < 32) throw new ServiceUnavailableException('邮箱登录暂不可用，请稍后再试');
    return { key, from, secret };
  }
  private digest(value: string) { return createHmac('sha256', this.configuration().secret).update(value).digest('hex'); }

  async request(email: string, sourceIp: string, humanToken?: string) {
    const config = this.configuration();
    await this.protection.ingress('send', email, sourceIp);
    await this.protection.cooldown(email);
    await this.protection.verifyHuman(humanToken, email, sourceIp);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), id = randomUUID();
    const challenge = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'auth-email-send-admission'}))`;
      await this.protection.assertUnblocked(email, sourceIp, tx);
      await this.protection.reserveSending(email, sourceIp, tx);
      return tx.authEmailChallenge.create({ data: { id, email, codeHash: this.digest(`${id}:${email}:${code}`), expiresAt: new Date(Date.now() + 10 * MINUTE) } });
    });
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `auth-code/${id}` },
        body: JSON.stringify({ from: config.from, to: [email], subject: `${code} · 知行方舟登录验证码`, text: `你的登录验证码是 ${code}，10分钟内有效。请勿向他人透露。如非本人操作，请忽略此邮件。`, html: `<div style="font-family:Arial,sans-serif;color:#202535;max-width:480px;margin:32px auto"><h2 style="color:#6554d9">知行方舟</h2><p>你的登录验证码</p><p style="font-size:32px;font-weight:600;letter-spacing:8px">${code}</p><p>10分钟内有效，请勿向他人透露。</p><p style="color:#626777;font-size:13px">如非本人操作，请忽略此邮件。</p></div>` }),
        signal: AbortSignal.timeout(12_000),
      });
      // Only the provider status is consumed; never log a recipient, code, or key.
      if (!response.ok) throw new Error('provider-failure');
      await response.arrayBuffer();
    } catch {
      await this.db.authEmailChallenge.update({ where: { id }, data: { usedAt: new Date() } });
      throw new ServiceUnavailableException('验证码发送失败，请稍后重试');
    }
    await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'auth-email:' + email}))`;
      await tx.authEmailChallenge.updateMany({ where: { email, id: { not: id }, usedAt: null }, data: { usedAt: new Date() } });
      await tx.authEmailChallenge.update({ where: { id }, data: { sentAt: new Date() } });
      await tx.authEmailChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - DAY) } } });
      await tx.authEmailRate.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - DAY) } } });
    });
    return { challengeId: challenge.id, expiresIn: 600, retryAfter: 60 };
  }

  async verify(input: VerifyInput, sourceIp: string, bindUserId?: string) {
    this.configuration();
    await this.protection.ingress('verify', input.email, sourceIp);
    const result = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'auth-email:' + input.email}))`;
      // Lock by ID as well: mismatched email attempts must not race the real owner.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'auth-challenge:' + input.challengeId}))`;
      const item = await tx.authEmailChallenge.findUnique({ where: { id: input.challengeId } });
      if (!item || item.usedAt || !item.sentAt || item.expiresAt <= new Date() || item.attempts >= 5) return { error: '验证码无效或已过期，请重新获取' };
      const expected = Buffer.from(item.codeHash, 'hex'), actual = Buffer.from(this.digest(`${item.id}:${input.email}:${input.code}`), 'hex');
      const valid = item.email === input.email && expected.length === actual.length && timingSafeEqual(expected, actual);
      // Failed attempts must commit rather than roll back with an exception.
      await tx.authEmailChallenge.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
      if (!valid) return { error: '验证码无效或已过期，请重新获取' };
      let user = await tx.user.findUnique({ where: { email: input.email } });
      if (bindUserId) {
        const legacy = await tx.user.findUnique({ where: { id: bindUserId } });
        if (!legacy?.active || (legacy.email && legacy.email !== input.email) || (user && user.id !== legacy.id)) return { error: '邮箱已被使用或无法设置，请换一个邮箱' };
        // Only the already-authenticated user can set their own empty login email.
        const bound = await tx.user.updateMany({ where: { id: legacy.id, active: true, email: legacy.email, passwordHash: legacy.passwordHash }, data: { email: input.email, emailVerifiedAt: new Date() } });
        if (bound.count !== 1) return { error: '账号关联状态已变化，请重新登录' };
        user = await tx.user.findUniqueOrThrow({ where: { id: legacy.id } });
      }
      if (user && !user.active) return { error: '账号已停用，请联系管理员' };
      if (!user) user = await tx.user.create({ data: { email: input.email, name: input.email.split('@')[0], passwordHash: 'email-only', emailVerifiedAt: new Date() } });
      else if (!user.emailVerifiedAt) user = await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      const token = newSessionToken(), expiresAt = new Date(Date.now() + SESSION_IDLE_MS);
      await tx.session.create({ data: { userId: user.id, tokenHash: tokenHash(token), expiresAt } });
      await tx.authEmailChallenge.update({ where: { id: item.id }, data: { usedAt: new Date() } });
      await this.protection.clearFailures(input.email, sourceIp, tx);
      return { token, expiresAt, user: { id: user.id, name: user.name, email: user.email } };
    }, { timeout: 10_000 });
    if ('error' in result) { await this.protection.failure('code', input.email, sourceIp); throw new UnauthorizedException(result.error); }
    return result;
  }
}
