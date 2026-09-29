import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { AuthService } from './platform/auth.service';
import { PlatformService } from './platform/platform.service';
import { PlatformController } from './platform/platform.controller';
import { ErpController } from './erp/erp.controller';
import { MasterService } from './erp/master.service';
import { PurchaseService } from './erp/purchase.service';
import { SalesService } from './erp/sales.service';
import { InventoryService } from './erp/inventory.service';
import { FinanceService } from './erp/finance.service';
import { ModelGateway } from './ai/model.gateway';
import { AiService } from './ai/ai.service';
import { AiController } from './ai/ai.controller';
import { APP_AI_PROVIDER } from './ai/app-ai-provider';
import { ErpAiProvider } from './erp/erp-ai.provider';

@Module({ controllers: [HealthController, PlatformController, ErpController, AiController], providers: [PrismaService, AuthService, PlatformService, MasterService, PurchaseService, SalesService, InventoryService, FinanceService, ModelGateway, ErpAiProvider, { provide: APP_AI_PROVIDER, useExisting: ErpAiProvider }, AiService], exports: [PrismaService, AuthService] })
export class AppModule {}
