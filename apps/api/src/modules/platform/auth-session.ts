import type { Response } from 'express';

export const SESSION_IDLE_MS = 180 * 24 * 3600_000;
export const SESSION_ABSOLUTE_MS = 365 * 24 * 3600_000;
export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie('suite_session', token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}
