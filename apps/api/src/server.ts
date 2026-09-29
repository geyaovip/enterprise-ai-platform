import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './modules/app.module';
import { ApiExceptionFilter } from './modules/api-exception.filter';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, logger: process.env.NODE_ENV === 'test' ? false : undefined });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use(cookieParser());
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:4601';
  app.enableCors({ origin: webOrigin, credentials: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== webOrigin) {
      res.status(403).json({ error: { code: 'INVALID_ORIGIN', message: '请求来源无效' } });
      return;
    }
    next();
  });
  return app;
}
