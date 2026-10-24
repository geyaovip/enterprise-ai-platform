import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { readBody } from '../platform/security';
import { AuthService } from '../platform/auth.service';
import { AccountingService } from './accounting.service';
import { BusinessService } from './business.service';
import { CorrectionService } from './correction.service';

@Controller('api/v1/tenants/:tenantKey/erp')
export class BusinessController {
 constructor(private readonly auth: AuthService,private readonly accounting:AccountingService,private readonly business:BusinessService,private readonly correction:CorrectionService){}
 private ctx(r:Request,key:string){return this.auth.context(r,key,'erp');}
 @Get('returns') returns(@Req()r:Request,@Param('tenantKey')k:string,@Query()q:unknown){return this.ctx(r,k).then(c=>this.correction.returns(c,q));}
 @Get('returns/:id') returnDetail(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string){return this.ctx(r,k).then(c=>this.correction.getReturn(c,id));}
 @Post('returns') returnRequest(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.correction.requestReturn(c,b));}
 @Post('returns/:id/review') returnReview(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.correction.reviewReturn(c,id,b));}
 @Get('trade/:kind/:id/return-sources') returnSources(@Req()r:Request,@Param('tenantKey')k:string,@Param('kind')kind:string,@Param('id')id:string){const type=readBody(z.enum(['sales','purchase']),kind);return this.ctx(r,k).then(c=>this.correction.sources(c,type,id));}
 @Post('trade/:kind/:id/close') close(@Req()r:Request,@Param('tenantKey')k:string,@Param('kind')kind:string,@Param('id')id:string,@Body()b:unknown){const type=readBody(z.enum(['sales','purchase']),kind);return this.ctx(r,k).then(c=>this.correction.closeOrder(c,type,id,b));}
 @Post('contracts/:id/amend') amend(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.correction.changeSales(c,id,b));}
 @Post('opening/csv-preview') csvOpening(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.accounting.csvOpening(c,b));}
 @Post('opening/preview') openingPreview(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.accounting.previewOpening(c,b));}
 @Post('opening') opening(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.accounting.opening(c,b));}
 @Get('advances') advances(@Req()r:Request,@Param('tenantKey')k:string,@Query()q:unknown){return this.ctx(r,k).then(c=>this.accounting.advances(c,q));}
 @Post('advances') advance(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.accounting.advance(c,b));}
 @Get('advances/:id/history') advanceHistory(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string){return this.ctx(r,k).then(c=>this.accounting.advanceHistory(c,id));}
 @Post('advances/:id/refund') advanceRefund(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.accounting.refundAdvance(c,id,b));}
 @Post('advances/:id/apply') applyAdvance(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.accounting.applyAdvance(c,id,b));}
 @Post('payments/:id/reverse') reverse(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.accounting.reverse(c,id,b));}
 @Post('accounts/:kind/:id/refund') refund(@Req()r:Request,@Param('tenantKey')k:string,@Param('kind')kind:string,@Param('id')id:string,@Body()b:unknown){const type=readBody(z.enum(['receivable','payable']),kind);return this.ctx(r,k).then(c=>this.accounting.refund(c,type,id,b));}
 @Get('statements') statement(@Req()r:Request,@Param('tenantKey')k:string,@Query()q:unknown){return this.ctx(r,k).then(c=>this.accounting.statement(c,q));}
 @Get('aging') aging(@Req()r:Request,@Param('tenantKey')k:string){return this.ctx(r,k).then(c=>this.accounting.aging(c));}
 @Get('onboarding') onboarding(@Req()r:Request,@Param('tenantKey')k:string){return this.ctx(r,k).then(c=>this.business.onboarding(c));}
 @Post('quotes/:id/cancel') quoteCancel(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.business.cancelQuote(c,id,b));}
 @Get('quotes') quotes(@Req()r:Request,@Param('tenantKey')k:string,@Query()q:unknown){return this.ctx(r,k).then(c=>this.business.quotes(c,q));}
 @Post('quotes') createQuote(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.business.createQuote(c,b));}
 @Get('quotes/:id') quote(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string){return this.ctx(r,k).then(c=>this.business.quote(c,id));}
 @Post('quotes/:id/convert') convert(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.business.convertQuote(c,id,b));}
 @Get('customer-prices/:customerId') prices(@Req()r:Request,@Param('tenantKey')k:string,@Param('customerId')id:string){return this.ctx(r,k).then(c=>this.business.prices(c,id));}
 @Post('customer-prices') price(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.business.setPrice(c,b));}
 @Get('warehouses') warehouses(@Req()r:Request,@Param('tenantKey')k:string){return this.ctx(r,k).then(c=>this.business.warehouses(c));}
 @Post('warehouses') warehouse(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.business.saveWarehouse(c,b));}
 @Get('warehouse-stocks') stocks(@Req()r:Request,@Param('tenantKey')k:string,@Query()q:unknown){return this.ctx(r,k).then(c=>this.business.warehouseStocks(c,q));}
 @Post('transfers') transfer(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.business.transfer(c,b));}
 @Get('business-settings') settings(@Req()r:Request,@Param('tenantKey')k:string){return this.ctx(r,k).then(async c=>({...await this.business.settings(c),permissions:c.permissions}));}
 @Post('business-settings') saveSettings(@Req()r:Request,@Param('tenantKey')k:string,@Body()b:unknown){return this.ctx(r,k).then(c=>this.business.saveSettings(c,b));}
 @Get('trade/:kind/:id/timeline') timeline(@Req()r:Request,@Param('tenantKey')k:string,@Param('kind')kind:string,@Param('id')id:string){const type=readBody(z.enum(['sales','purchase']),kind);return this.ctx(r,k).then(c=>this.business.timeline(c,type,id));}
 @Get('stock-documents/:id') stockDocument(@Req()r:Request,@Param('tenantKey')k:string,@Param('id')id:string){return this.ctx(r,k).then(c=>this.business.stockDocument(c,id));}
 @Get('business-reports') reports(@Req()r:Request,@Param('tenantKey')k:string,@Query()q:unknown){return this.ctx(r,k).then(c=>this.business.reports(c,q));}
}
