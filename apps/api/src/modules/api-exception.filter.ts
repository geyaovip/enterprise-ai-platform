import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = '服务暂时不可用';
    let fieldErrors:unknown;
    if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 429 ? 'RATE_LIMITED' : 'INVALID_REQUEST';
      message = error.message;
      const detail = error.getResponse();
      if (req.path.includes('/apps/crm/') && typeof detail==='object' && detail!==null) {const d=detail as any;if(typeof d.code==='string' && /^[A-Z_]{2,60}$/.test(d.code))code=d.code;if(typeof d.message==='string')message=d.message;fieldErrors=d.fieldErrors;}
      if (status === 503 && typeof detail === 'object' && detail !== null && 'code' in detail && typeof detail.code === 'string' && ['RUNTIME_CREDENTIALS_REJECTED', 'RUNTIME_NOT_READY', 'RUNTIME_MODELS_UNAVAILABLE', 'RUNTIME_ASSISTANT_MISSING', 'RUNTIME_UNREACHABLE'].includes(detail.code)) code = detail.code;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') { status = 409; code = 'UNIQUE_CONFLICT'; message = '编号或参考号已存在'; }
      else if (error.code === 'P2003') { status = 409; code = 'RELATION_CONFLICT'; message = '关联记录状态已变化'; }
      else if (error.code === 'P2025') { status = 404; code = 'NOT_FOUND'; message = '记录不存在'; }
      else if (error.code === 'P2034') { status = 409; code = 'CONCURRENT_CONFLICT'; message = '数据已被其他操作更新，请重试'; }
    }
    const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].slice(0, 100) : randomUUID();
    if (status === 500 && process.env.NODE_ENV !== 'test') {
      process.stderr.write(`[api] ${requestId} ${req.method} ${req.path} ${error instanceof Error ? error.name : 'UnknownError'}\n`);
    }
    res.status(status).json({ error: { code, message, request_id: requestId, ...(fieldErrors?{fieldErrors}:{}) } });
  }
}
