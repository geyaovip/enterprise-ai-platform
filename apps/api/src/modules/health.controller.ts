import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('api/v1')
export class HealthController {
  constructor(private readonly db: PrismaService) {}

  @Get('health')
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true, database: 'ready' };
  }
}
