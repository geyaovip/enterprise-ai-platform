import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './modules/app.module';
import { ApiExceptionFilter } from './modules/api-exception.filter';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { abortOnError: false, bodyParser: false, bufferLogs: true, logger: process.env.NODE_ENV === 'test' ? false : undefined });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use(cookieParser());
  app.use(json({ limit: '12mb' }));
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:4601';
  const origins = (process.env.WEB_ORIGINS ?? webOrigin).split(',').map(x => x.trim());
  app.enableCors({ origin: origins, credentials: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !origins.includes(String(req.headers.origin))) {
      res.status(403).json({ error: { code: 'INVALID_ORIGIN', message: '请求来源无效' } });
      return;
    }
    next();
  });
  return app;
}
