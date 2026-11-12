import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../platform/auth.service';
import { ManufacturingService } from './manufacturing.service';

@Controller('api/v1/tenants/:tenantKey/apps/manufacturing')
export class ManufacturingController {
  constructor(private readonly auth: AuthService, private readonly manufacturing: ManufacturingService) {}

  private context(request: Request) {
    return this.auth.context(request, String(request.params.tenantKey), 'manufacturing');
  }

  @Get('catalog')
  async catalog(@Req() req: Request, @Query() query: unknown) {
    return this.manufacturing.catalog(await this.context(req), query);
  }
  @Get('orders')
  async orders(@Req() req: Request, @Query() query: unknown) {
    return this.manufacturing.orders(await this.context(req), query);
  }
  @Get('orders/:id')
  async order(@Req() req: Request, @Param('id') id: string) {
    return this.manufacturing.order(await this.context(req), id);
  }
  @Post('orders')
  async createOrder(@Req() req: Request, @Body() body: unknown) {
    return this.manufacturing.createOrder(await this.context(req), body);
  }
  @Post('orders/:id/actions')
  async action(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.manufacturing.action(await this.context(req), id, body);
  }
  @Post('parties')
  async party(@Req() req: Request, @Body() body: unknown) {
    return this.manufacturing.createParty(await this.context(req), body);
  }
  @Post('items')
  async item(@Req() req: Request, @Body() body: unknown) {
    return this.manufacturing.createItem(await this.context(req), body);
  }
  @Post('links')
  async link(@Req() req: Request, @Body() body: unknown) {
    return this.manufacturing.linkItem(await this.context(req), body);
  }
  @Post('boms')
  async bom(@Req() req: Request, @Body() body: unknown) {
    return this.manufacturing.createBom(await this.context(req), body);
  }
  @Get('stock')
  async stock(@Req() req: Request, @Query() query: unknown) {
    return this.manufacturing.stock(await this.context(req), query);
  }
  @Post('stock/actions')
  async warehouseAction(@Req() req: Request, @Body() body: unknown) {
    return this.manufacturing.warehouseAction(await this.context(req), body);
  }
  @Get('scan')
  async scan(@Req() req: Request, @Query('code') code: unknown) {
    return this.manufacturing.scan(await this.context(req), code);
  }
  @Get('team')
  async team(@Req() req: Request) {
    return this.manufacturing.team(await this.context(req));
  }
  @Post('team')
  async grantTeam(@Req() req: Request, @Body() body: unknown) {
    return this.manufacturing.grantTeam(await this.context(req), body);
  }
  @Post('orders/:id/production')
  async productionAction(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.manufacturing.productionAction(await this.context(req), id, body);
  }

}
