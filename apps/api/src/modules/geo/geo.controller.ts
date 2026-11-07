import {
  Body,
  Controller,
  Get,
  Header,
  StreamableFile,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../platform/auth.service";
import { renderGeoReportPdf } from "./geo-report-pdf";
import { GeoService } from "./geo.service";
@Controller("api/v1/tenants/:tenantKey/apps/geo")
export class GeoController {
  @Post("analyses/:id/reconcile") async reconcile(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.reconcile(await this.ctx(r), id, b);
  }
  constructor(
    readonly auth: AuthService,
    readonly geo: GeoService,
  ) {}
  ctx(r: Request) {
    return this.auth.context(r, String(r.params.tenantKey), "geo");
  }
  @Get("metadata") async meta(@Req() r: Request) {
    return this.geo.metadata(await this.ctx(r));
  }
  @Get("projects") async projects(@Req() r: Request, @Query() q: unknown) {
    return this.geo.projects(await this.ctx(r), q);
  }
  @Post("projects") async create(@Req() r: Request, @Body() b: unknown) {
    return this.geo.saveProject(await this.ctx(r), b);
  }
  @Get("projects/:id") async project(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.geo.project(await this.ctx(r), id);
  }
  @Put("projects/:id") async save(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.saveProject(await this.ctx(r), b, id);
  }
  @Get("projects/:id/questions") async questions(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.geo.questions(await this.ctx(r), id);
  }
  @Post("projects/:id/questions") async addQuestion(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.saveQuestion(await this.ctx(r), id, b);
  }
  @Post("projects/:id/questions/batch") async addQuestions(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.addQuestions(await this.ctx(r), id, b);
  }
  @Put("projects/:id/questions/:questionId") async question(
    @Req() r: Request,
    @Param("id") id: string,
    @Param("questionId") qid: string,
    @Body() b: unknown,
  ) {
    return this.geo.saveQuestion(await this.ctx(r), id, b, qid);
  }
  @Get("models") async models(@Req() r: Request) {
    return this.geo.models(await this.ctx(r));
  }
  @Post("models") async addModel(@Req() r: Request, @Body() b: unknown) {
    return this.geo.saveModel(await this.ctx(r), b);
  }
  @Put("models/:id") async model(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.saveModel(await this.ctx(r), b, id);
  }
  @Get("settings") async settings(@Req() r: Request) {
    return this.geo.settings(await this.ctx(r));
  }
  @Put("settings") async setSettings(@Req() r: Request, @Body() b: unknown) {
    return this.geo.saveSettings(await this.ctx(r), b);
  }
  @Get("members") async members(@Req() r: Request) {
    return this.geo.members(await this.ctx(r));
  }
  @Put("members") async grant(@Req() r: Request, @Body() b: unknown) {
    return this.geo.grant(await this.ctx(r), b);
  }
  @Post("projects/:id/estimate") async estimate(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.estimate(await this.ctx(r), id, b);
  }
  @Post("projects/:id/analyses") async submit(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.submit(await this.ctx(r), id, b);
  }
  @Get("projects/:id/analyses") async history(
    @Req() r: Request,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    return this.geo.analyses(await this.ctx(r), id, q);
  }
  @Get("analyses") async all(@Req() r: Request, @Query() q: unknown) {
    return this.geo.analyses(await this.ctx(r), undefined, q);
  }
  @Get("analyses/:id/report.pdf")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async reportPdf(@Req() r: Request, @Param("id") id: string) {
    const analysis = await this.geo.analysis(await this.ctx(r), id);
    const file = await renderGeoReportPdf(analysis);
    const date = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(analysis.createdAt);
    return new StreamableFile(file, {
      type: "application/pdf",
      disposition: `attachment; filename="GEO-${date}.pdf"`,
    });
  }
  @Get("analyses/:id") async analysis(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.geo.analysis(await this.ctx(r), id);
  }
  @Post("analyses/:id/cancel") async cancel(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.cancel(await this.ctx(r), id, b);
  }
  @Get("projects/:id/insights") async insights(
    @Req() r: Request,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    return this.geo.insights(await this.ctx(r), id, q);
  }
  @Get("projects/:id/schedules") async schedules(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.geo.schedules(await this.ctx(r), id);
  }
  @Post("projects/:id/schedules/preview") async previewSchedule(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.previewSchedule(await this.ctx(r), id, b);
  }
  @Post("projects/:id/schedules") async addSchedule(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.saveSchedule(await this.ctx(r), id, b);
  }
  @Put("projects/:id/schedules/:scheduleId") async schedule(
    @Req() r: Request,
    @Param("id") id: string,
    @Param("scheduleId") sid: string,
    @Body() b: unknown,
  ) {
    return this.geo.saveSchedule(await this.ctx(r), id, b, sid);
  }
  @Put("schedules/:id/state") async toggle(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.toggleSchedule(await this.ctx(r), id, b);
  }
  @Get("optimizations/mine") async myOptimizations(@Req() r: Request) {
    return this.geo.myOptimizations(await this.ctx(r));
  }
  @Get("projects/:id/optimizations") async optimizations(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.geo.optimizations(await this.ctx(r), id);
  }
  @Post("projects/:id/optimizations") async addTask(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.geo.saveOptimization(await this.ctx(r), id, b);
  }
  @Put("projects/:id/optimizations/:taskId") async task(
    @Req() r: Request,
    @Param("id") id: string,
    @Param("taskId") tid: string,
    @Body() b: unknown,
  ) {
    return this.geo.saveOptimization(await this.ctx(r), id, b, tid);
  }
}
