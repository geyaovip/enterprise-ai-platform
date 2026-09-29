import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../platform/auth.service';
import { MasterService } from './master.service';
import { PurchaseService } from './purchase.service';
import { SalesService } from './sales.service';
import { InventoryService } from './inventory.service';
import { FinanceService } from './finance.service';

@Controller('api/v1/tenants/:tenantKey/erp')
export class ErpController {
  constructor(private readonly auth: AuthService, private readonly master: MasterService, private readonly purchases: PurchaseService, private readonly sales: SalesService, private readonly stock: InventoryService, private readonly finance: FinanceService) {}
  private ctx(req: Request, key: string) { return this.auth.context(req, key, 'erp'); }

  @Get('customers') customers(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.customers(ctx, q)); }
  @Post('customers') createCustomer(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createCustomer(ctx, b)); }
  @Get('customers/:id') customer(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.master.customer(ctx, id)); }
  @Patch('customers/:id') updateCustomer(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.updateCustomer(ctx, id, b)); }

  @Get('opportunities') opportunities(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.opportunities(ctx, q)); }
  @Post('opportunities') createOpportunity(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createOpportunity(ctx, b)); }
  @Post('opportunities/:id/stage') stage(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.changeOpportunity(ctx, id, b)); }

  @Get('products') products(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.products(ctx, q)); }
  @Post('products') createProduct(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createProduct(ctx, b)); }
  @Patch('products/:id') updateProduct(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.updateProduct(ctx, id, b)); }

  @Get('suppliers') suppliers(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.suppliers(ctx, q)); }
  @Post('suppliers') createSupplier(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createSupplier(ctx, b)); }
  @Patch('suppliers/:id') updateSupplier(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.updateSupplier(ctx, id, b)); }

  @Get('purchases') purchasesList(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.purchases.list(ctx, q)); }
  @Post('purchases') createPurchase(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.create(ctx, b)); }
  @Get('purchases/:id') purchase(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.purchases.get(ctx, id)); }
  @Post('purchases/:id/confirm') confirmPurchase(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.confirm(ctx, id, b)); }
  @Post('purchases/:id/receive') receivePurchase(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.receive(ctx, id, b)); }

  @Get('contracts') contracts(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.sales.list(ctx, q)); }
  @Post('contracts') createContract(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.create(ctx, b)); }
  @Get('contracts/:id') contract(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.sales.get(ctx, id)); }
  @Post('contracts/:id/confirm') confirmContract(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.confirm(ctx, id, b)); }
  @Post('contracts/:id/ship') shipContract(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.ship(ctx, id, b)); }

  @Get('inventory') inventory(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.stock.balances(ctx, q)); }
  @Get('inventory/movements') movements(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.stock.movements(ctx, q)); }
  @Get('inventory/documents') documents(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.stock.documents(ctx, q)); }
  @Post('inventory/stocktakes') stocktake(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.stock.stocktake(ctx, b)); }

  @Get('finance/receivables') receivables(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.finance.receivables(ctx, q)); }
  @Get('finance/payables') payables(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.finance.payables(ctx, q)); }
  @Post('finance/receivables/:id/payments') receivePayment(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.finance.payment(ctx, 'receivable', id, b)); }
  @Post('finance/payables/:id/payments') makePayment(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.finance.payment(ctx, 'payable', id, b)); }
  @Get('dashboard') dashboard(@Req() r: Request, @Param('tenantKey') key: string) { return this.ctx(r, key).then(ctx => this.finance.dashboard(ctx)); }
}
