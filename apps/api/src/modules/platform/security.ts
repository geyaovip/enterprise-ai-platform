import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType } from 'zod';

export function readBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; '));
  return result.data;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [method, salt, expected] = stored.split(':');
  if (method !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), 64);
  const old = Buffer.from(expected, 'hex');
  return actual.length === old.length && timingSafeEqual(actual, old);
}

export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function newSessionToken(): string { return randomBytes(32).toString('base64url'); }

export function sessionToken(req: Request): string {
  const token = req.cookies?.suite_session;
  if (typeof token !== 'string' || !token) throw new UnauthorizedException('请先登录');
  return token;
}
