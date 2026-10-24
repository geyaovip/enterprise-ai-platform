import { CollaborationService } from './collaboration.service';
import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../platform/auth.service';
import { MasterService } from './master.service';
import { PurchaseService } from './purchase.service';
import { SalesService } from './sales.service';
import { InventoryService } from './inventory.service';
import { FinanceService } from './finance.service';
import { WorkItemsService } from './work-items.service';
import { InvoiceService } from './invoice.service';
import { ReceiptService } from './receipt.service';
import { z } from 'zod';
import { readBody } from '../platform/security';

@Controller('api/v1/tenants/:tenantKey/erp')
export class ErpController {
  constructor(private readonly auth: AuthService, private readonly master: MasterService, private readonly purchases: PurchaseService, private readonly sales: SalesService, private readonly stock: InventoryService, private readonly finance: FinanceService, private readonly collaboration: CollaborationService, private readonly workItems: WorkItemsService, private readonly invoices: InvoiceService, private readonly receipts: ReceiptService) {}
  private ctx(req: Request, key: string) { return this.auth.context(req, key, 'erp'); }

  @Post('master/:kind/import-preview') previewImport(@Req() r: Request, @Param('tenantKey') key: string, @Param('kind') kind: string, @Body() b: unknown) { const type = readBody(z.enum(['customers', 'products', 'suppliers']), kind); return this.ctx(r, key).then(ctx => this.master.previewImport(ctx, type, b)); }
  @Post('master/:kind/import') importMaster(@Req() r: Request, @Param('tenantKey') key: string, @Param('kind') kind: string, @Body() b: unknown) { const type = readBody(z.enum(['customers', 'products', 'suppliers']), kind); return this.ctx(r, key).then(ctx => this.master.importMaster(ctx, type, b)); }
  @Get('master/:kind/export') exportMaster(@Req() r: Request, @Param('tenantKey') key: string, @Param('kind') kind: string, @Query() q: unknown) { const type = readBody(z.enum(['customers', 'products', 'suppliers']), kind); return this.ctx(r, key).then(ctx => this.master.exportMaster(ctx, type, q)); }

  @Get('tasks') tasks(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.collaboration.tasks(ctx, q)); }
  @Get('task-assignees') assignees(@Req() r: Request, @Param('tenantKey') key: string) { return this.ctx(r, key).then(ctx => this.collaboration.assignees(ctx)); }
  @Post('tasks') createTask(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.collaboration.createTask(ctx, b)); }
  @Post('tasks/:id/status') taskStatus(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.collaboration.status(ctx, id, b)); }
  @Get('notifications') notifications(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.collaboration.notifications(ctx, q)); }
  @Post('notifications/:id/read') readNotification(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.collaboration.readNotification(ctx, id)); }
  @Get('announcements') announcements(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.collaboration.announcements(ctx, q)); }
  @Post('announcements') publish(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.collaboration.publish(ctx, b)); }
  @Post('announcements/:id/withdraw') withdrawAnnouncement(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.collaboration.withdraw(ctx, id)); }
  @Post('announcements/:id/read') readAnnouncement(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.collaboration.readAnnouncement(ctx, id)); }

  @Get('work-items') worklist(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.workItems.list(ctx, q)); }
  @Get('invoices') invoiceList(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.invoices.list(ctx, q)); }
  @Post('invoices') requestInvoice(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.invoices.request(ctx, b)); }
  @Post('invoices/:id/register') registerInvoice(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.invoices.register(ctx, id, b)); }
  @Post('invoices/:id/reject') rejectInvoice(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.invoices.reject(ctx, id, b)); }
  @Post('invoices/:id/withdraw') withdrawInvoice(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.invoices.withdraw(ctx, id)); }
  @Post('invoices/:id/void') voidInvoice(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.invoices.voidRegistration(ctx, id, b)); }
  @Get('receipts') receiptList(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.receipts.list(ctx, q)); }
  @Post('receipts') registerReceipt(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.receipts.register(ctx, b)); }
  @Get('receipts/:id/claimable') receiptClaimable(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.receipts.claimable(ctx, id)); }
  @Post('receipts/:id/claims') claimReceipt(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.receipts.claim(ctx, id, b)); }
  @Post('receipts/:id/claims/:claimId/approve') approveReceiptClaim(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Param('claimId') claimId: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.receipts.review(ctx, id, claimId, 'approve', b)); }
  @Post('receipts/:id/claims/:claimId/reject') rejectReceiptClaim(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Param('claimId') claimId: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.receipts.review(ctx, id, claimId, 'reject', b)); }
  @Post('receipts/:id/claims/:claimId/withdraw') withdrawReceiptClaim(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Param('claimId') claimId: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.receipts.review(ctx, id, claimId, 'withdraw', b)); }
  @Post('receipts/:id/cancel') cancelReceipt(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.receipts.cancel(ctx, id, b)); }

  @Get('customers') customers(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.customers(ctx, q)); }
  @Get('customers/pool') customerPool(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.customerPool(ctx, q)); }
  @Post('customers') createCustomer(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createCustomer(ctx, b)); }
  @Post('customers/:id/claim') claimCustomer(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.master.claimCustomer(ctx, id)); }
  @Post('customers/:id/transfer') transferCustomer(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.transferCustomer(ctx, id, b)); }
  @Get('customers/:id') customer(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.master.customer(ctx, id)); }
  @Patch('customers/:id') updateCustomer(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.updateCustomer(ctx, id, b)); }

  @Get('opportunities') opportunities(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.opportunities(ctx, q)); }
  @Post('opportunities') createOpportunity(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createOpportunity(ctx, b)); }
  @Post('opportunities/:id/stage') stage(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.changeOpportunity(ctx, id, b)); }
  @Get('opportunities/:id/followups') followups(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.opportunityFollowups(ctx, id, q)); }
  @Post('opportunities/:id/followups') createFollowup(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createOpportunityFollowup(ctx, id, b)); }

  @Get('products') products(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.products(ctx, q)); }
  @Post('products') createProduct(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createProduct(ctx, b)); }
  @Patch('products/:id') updateProduct(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.updateProduct(ctx, id, b)); }

  @Get('suppliers') suppliers(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.master.suppliers(ctx, q)); }
  @Post('suppliers') createSupplier(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.createSupplier(ctx, b)); }
  @Patch('suppliers/:id') updateSupplier(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.master.updateSupplier(ctx, id, b)); }

  @Get('purchases') purchasesList(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.purchases.list(ctx, q)); }
  @Post('purchases') createPurchase(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.create(ctx, b)); }
  @Get('purchases/:id') purchase(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.purchases.get(ctx, id)); }
  @Put('purchases/:id') updatePurchaseDraft(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.updateDraft(ctx, id, b)); }
  @Post('purchases/:id/submit') submitPurchase(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.submit(ctx, id, b)); }
  @Post('purchases/:id/confirm') confirmPurchase(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.confirm(ctx, id, b)); }
  @Post('purchases/:id/reject') rejectPurchase(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.reject(ctx, id, b)); }
  @Post('purchases/:id/changes') requestPurchaseChange(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.requestChange(ctx, id, b)); }
  @Post('purchases/:id/changes/:changeId/approve') approvePurchaseChange(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Param('changeId') changeId: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.reviewChange(ctx, id, changeId, 'approve', b)); }
  @Post('purchases/:id/changes/:changeId/reject') rejectPurchaseChange(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Param('changeId') changeId: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.reviewChange(ctx, id, changeId, 'reject', b)); }
  @Post('purchases/:id/receive') receivePurchase(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.purchases.receive(ctx, id, b)); }

  @Get('contracts') contracts(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.sales.list(ctx, q)); }
  @Post('contracts') createContract(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.create(ctx, b)); }
  @Get('contracts/:id') contract(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string) { return this.ctx(r, key).then(ctx => this.sales.get(ctx, id)); }
  @Put('contracts/:id') updateContractDraft(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.updateDraft(ctx, id, b)); }
  @Post('contracts/:id/submit') submitContract(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.submit(ctx, id, b)); }
  @Post('contracts/:id/confirm') confirmContract(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.confirm(ctx, id, b)); }
  @Post('contracts/:id/reject') rejectContract(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.reject(ctx, id, b)); }
  @Post('contracts/:id/ship') shipContract(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.sales.ship(ctx, id, b)); }

  @Get('inventory') inventory(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.stock.balances(ctx, q)); }
  @Get('inventory/alerts') inventoryAlerts(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.stock.alerts(ctx, q)); }
  @Get('inventory/movements') movements(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.stock.movements(ctx, q)); }
  @Get('inventory/documents') documents(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.stock.documents(ctx, q)); }
  @Post('inventory/stocktakes') stocktake(@Req() r: Request, @Param('tenantKey') key: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.stock.stocktake(ctx, b)); }

  @Get('finance/receivables') receivables(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.finance.receivables(ctx, q)); }
  @Get('finance/payables') payables(@Req() r: Request, @Param('tenantKey') key: string, @Query() q: unknown) { return this.ctx(r, key).then(ctx => this.finance.payables(ctx, q)); }
  @Post('finance/receivables/:id/payments') receivePayment(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.finance.payment(ctx, 'receivable', id, b)); }
  @Post('finance/payables/:id/payments') makePayment(@Req() r: Request, @Param('tenantKey') key: string, @Param('id') id: string, @Body() b: unknown) { return this.ctx(r, key).then(ctx => this.finance.payment(ctx, 'payable', id, b)); }
  @Get('dashboard') dashboard(@Req() r: Request, @Param('tenantKey') key: string) { return this.ctx(r, key).then(ctx => this.finance.dashboard(ctx)); }
  @Get('dashboard/responsibilities') responsibilities(@Req() r: Request, @Param('tenantKey') key: string) { return this.ctx(r, key).then(ctx => this.finance.responsibilities(ctx)); }
}
