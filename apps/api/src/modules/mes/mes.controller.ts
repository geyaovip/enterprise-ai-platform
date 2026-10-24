import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Req,
  Param,
  Body,
  Query,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../platform/auth.service";
import { MesService } from "./mes.service";
@Controller("api/v1/tenants/:tenantKey/apps/mes")
export class MesController {
  constructor(
    readonly auth: AuthService,
    readonly mes: MesService,
  ) {}
  context(r: Request) {
    return this.auth.context(r, r.params.tenantKey as string, "mes");
  }
  @Get("metadata") meta(@Req() r: Request) {
    return this.context(r).then((c) => this.mes.metadata(c));
  }
  @Get("members") members(@Req() r: Request) {
    return this.context(r).then((c) => this.mes.members(c));
  }
  @Get("settings/access") access(@Req() r: Request) {
    return this.context(r).then((c) => this.mes.access(c));
  }
  @Put("settings/access") saveAccess(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.mes.saveAccess(c, b));
  }
  @Get("dashboard") dashboard(@Req() r: Request) {
    return this.context(r).then((c) => this.mes.dashboard(c));
  }
  @Get("audit") audit(@Req() r: Request) {
    return this.context(r).then((c) => this.mes.auditList(c));
  }
  @Get("materials") materials(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.mes.list(c, "materials", q));
  }
  @Post("materials") materialCreate(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.mes.saveMaterial(c, undefined, b));
  }
  @Patch("materials/:id") materialSave(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.saveMaterial(c, id, b));
  }
  @Get("boms") boms(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.mes.list(c, "boms", q));
  }
  @Post("boms") bomCreate(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.mes.saveBom(c, undefined, b));
  }
  @Get("boms/:id") bom(@Req() r: Request, @Param("id") id: string) {
    return this.context(r).then((c) => this.mes.get(c, "bom", id));
  }
  @Patch("boms/:id") bomSave(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.saveBom(c, id, b));
  }
  @Post("boms/:id/publish") publish(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.publishBom(c, id, b));
  }
  @Post("boms/:id/reviews") reviewSave(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.saveReview(c, id, b));
  }
  @Post("boms/:id/review-resolution") reviewResolve(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.resolveReview(c, id, b));
  }
  @Get("plans") plans(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.mes.list(c, "plans", q));
  }
  @Post("plans/preview") preview(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.mes.planPreview(c, b));
  }
  @Post("plans") planCreate(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.mes.savePlan(c, undefined, b));
  }
  @Get("plans/:id") plan(@Req() r: Request, @Param("id") id: string) {
    return this.context(r).then((c) => this.mes.get(c, "plan", id));
  }
  @Patch("plans/:id") planSave(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.savePlan(c, id, b));
  }
  @Post("plans/:id/actions") planAction(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.planAction(c, id, b));
  }
  @Post("plans/:id/orders") orderCreate(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.createOrder(c, id, b));
  }
  @Get("orders") orders(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.mes.list(c, "orders", q));
  }
  @Get("orders/:id") order(@Req() r: Request, @Param("id") id: string) {
    return this.context(r).then((c) => this.mes.get(c, "order", id));
  }
  @Post("orders/:id/actions") orderAction(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.orderAction(c, id, b));
  }
  @Post("orders/:id/reports") report(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.report(c, id, b));
  }
  @Get("reports") reports(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.mes.list(c, "reports", q));
  }
  @Post("reports/:id/review") review(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.mes.review(c, id, b));
  }
}
