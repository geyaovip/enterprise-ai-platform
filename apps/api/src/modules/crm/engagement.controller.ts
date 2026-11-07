import {
  Controller,
  Get,
  Post,
  Patch,
  Req,
  Param,
  Body,
  Query,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../platform/auth.service";
import { CrmEngagementService } from "./engagement.service";
@Controller("api/v1/tenants/:tenantKey/apps/crm")
export class CrmEngagementController {
  constructor(
    readonly auth: AuthService,
    readonly service: CrmEngagementService,
  ) {}
  private context(r: Request) {
    return this.auth.context(r, r.params.tenantKey as string, "crm");
  }
  @Get("workbench") workbench(@Req() r: Request) {
    return this.context(r).then((c) => this.service.workbench(c));
  }
  @Get("leads") leads(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.service.leads(c, q));
  }
  @Post("leads/duplicate-candidates") leadCandidates(
    @Req() r: Request,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.leadCandidates(c, b));
  }
  @Post("leads") createLead(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.service.createLead(c, b));
  }
  @Get("leads/:id") getLead(@Req() r: Request, @Param("id") id: string) {
    return this.context(r).then((c) => this.service.getLead(c, id));
  }
  @Get("leads/:id/contact") leadContact(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.context(r).then((c) => this.service.leadContact(c, id));
  }
  @Post("leads/:id/actions") leadAction(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.leadAction(c, id, b));
  }
  @Post("customers") createCustomer(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.service.createCustomer(c, b));
  }
  @Post("customers/:id/assignment") assignCustomer(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.assignCustomer(c, id, b));
  }
  @Get("customers/:id/business-contacts") contacts(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.context(r).then((c) => this.service.contacts(c, id));
  }
  @Get("customers/:id/business-contacts/reveal") revealContacts(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.context(r).then((c) => this.service.contacts(c, id, true));
  }
  @Post("customers/:id/business-contacts") saveContact(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.saveContact(c, id, b));
  }
  @Get("sales-pools") pools(@Req() r: Request) {
    return this.context(r).then((c) => this.service.pools(c));
  }
  @Post("sales-pools") savePool(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.service.savePool(c, b));
  }
  @Get("opportunities") opportunities(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.service.opportunities(c, q));
  }
  @Post("opportunities") newOpportunity(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) =>
      this.service.saveOpportunity(c, undefined, b),
    );
  }
  @Get("opportunities/:id") getOpportunity(
    @Req() r: Request,
    @Param("id") id: string,
  ) {
    return this.context(r).then((c) => this.service.getOpportunity(c, id));
  }
  @Patch("opportunities/:id") editOpportunity(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.saveOpportunity(c, id, b));
  }
  @Post("opportunities/:id/stage") opportunityStage(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.opportunityStage(c, id, b));
  }
  @Get("follow-ups") followUps(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.service.followUps(c, q));
  }
  @Post("follow-ups") createFollowUp(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.service.createFollowUp(c, b));
  }
  @Post("follow-ups/:id/complete") completeFollowUp(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.completeFollowUp(c, id, b));
  }
  @Get("service-plans") plans(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.service.plans(c, q));
  }
  @Post("service-plans") createPlan(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.service.createPlan(c, b));
  }
  @Post("service-plans/:id/actions") planAction(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.planAction(c, id, b));
  }
  @Post("service-plans/:id/tasks") createServiceTask(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) =>
      this.service.createServiceTask(c, id, b),
    );
  }
  @Post("service-tasks/:id/actions") serviceTaskAction(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) =>
      this.service.serviceTaskAction(c, id, b),
    );
  }
  @Get("service-risks") risks(@Req() r: Request, @Query() q: any) {
    return this.context(r).then((c) => this.service.risks(c, q));
  }
  @Post("service-risks") createRisk(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.service.createRisk(c, b));
  }
  @Post("service-risks/:id/close") closeRisk(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.closeRisk(c, id, b));
  }
  @Patch("leads/:id") editLead(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.editLead(c, id, b));
  }
  @Patch("customers/:id/profile") profile(
    @Req() r: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.context(r).then((c) => this.service.profile(c, id, b));
  }
  @Post("service-renewals") renewal(@Req() r: Request, @Body() b: unknown) {
    return this.context(r).then((c) => this.service.createRenewal(c, b));
  }
}
