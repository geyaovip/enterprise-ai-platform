import {problem} from './crm.common';
import {CrmComposerDraftService} from './composer-draft.service';
import {Controller,Get,Post,Put,Patch,Req,Param,Body,Query} from '@nestjs/common';
import type {Request} from 'express';
import {AuthService} from '../platform/auth.service';
import {CrmSettingsService} from './settings.service';import {CrmCustomerService} from './customer.service';import {CrmSegmentService} from './segment.service';import {CrmTaskService} from './operation-task.service';import {CrmImportService} from './import.service';import {CrmMetricsService} from './metrics.service';import {SEGMENT_TEMPLATES} from './crm-rules';
@Controller('api/v1/tenants/:tenantKey/apps/crm')
export class CrmController {
 constructor(readonly auth:AuthService,readonly settings:CrmSettingsService,readonly customers:CrmCustomerService,readonly segments:CrmSegmentService,readonly tasks:CrmTaskService,readonly imports:CrmImportService,readonly metrics:CrmMetricsService,readonly drafts:CrmComposerDraftService){}
 private queryRule(raw:any){if(!raw)return undefined;try{return JSON.parse(raw);}catch{problem('INVALID_RULE','经营条件格式无效',400);}}
 private context(r:Request){return this.auth.context(r,r.params.tenantKey as string,'crm');}
 @Get('ai/draft') draft(@Req() r:Request){return this.context(r).then(c=>this.drafts.get(c));}
 @Put('ai/draft') draftSave(@Req() r:Request,@Body() b:any){return this.context(r).then(c=>this.drafts.put(c,b));}
 @Get('metadata') meta(@Req() r:Request){return this.context(r).then(c=>this.settings.metadata(c));}
 @Get('settings/channels') channels(@Req() r:Request){return this.context(r).then(c=>this.settings.channels(c));}
 @Post('settings/channels') channelCreate(@Req() r:Request,@Body() b:unknown){return this.context(r).then(c=>this.settings.saveChannel(c,undefined,b));}
 @Patch('settings/channels/:id') channelUpdate(@Req() r:Request,@Param('id') id:string,@Body() b:unknown){return this.context(r).then(c=>this.settings.saveChannel(c,id,b));}
 @Get('settings/access') grants(@Req() r:Request){return this.context(r).then(c=>this.settings.grants(c));}
 @Put('settings/access') grantSave(@Req() r:Request,@Body() b:unknown){return this.context(r).then(c=>this.settings.saveGrants(c,b));}
 @Get('settings/metrics') policy(@Req() r:Request){return this.context(r).then(c=>this.settings.policy(c));}
 @Put('settings/metrics') policySave(@Req() r:Request,@Body() b:unknown){return this.context(r).then(c=>this.settings.savePolicy(c,b));}
 @Get('audit') audit(@Req() r:Request,@Query() q:any){return this.context(r).then(c=>this.settings.audit(c,q));}
 @Get('dashboard') dashboard(@Req() r:Request,@Query() q:any){return this.context(r).then(c=>this.metrics.overview(c,this.queryRule(q.rule)));}
 @Get('reports') reports(@Req() r:Request,@Query() q:any){return this.dashboard(r,q);}
 @Get('customers') list(@Req() r:Request,@Query() q:any){return this.context(r).then(c=>this.customers.list(c,q));}
 @Post('customers/export') export(@Req() r:Request,@Body() b:unknown){return this.context(r).then(c=>this.customers.export(c,b));}
 @Get('customers/:id') customer(@Req() r:Request,@Param('id') id:string,@Query() q:any){return this.context(r).then(c=>this.customers.detail(c,id,q));}
 @Patch('customers/:id') customerSave(@Req() r:Request,@Param('id') id:string,@Body() b:unknown){return this.context(r).then(c=>this.customers.update(c,id,b));}
 @Get('customers/:id/contacts') contacts(@Req() r:Request,@Param('id') id:string){return this.context(r).then(c=>this.customers.contact(c,id));}
 @Get('customers/:id/orders') orders(@Req() r:Request,@Param('id') id:string,@Query() q:any){return this.context(r).then(c=>this.customers.orders(c,id,q));}
 @Put('customers/:id/tags') tagsAssign(@Req() r:Request,@Param('id') id:string,@Body() b:unknown){return this.context(r).then(c=>this.customers.assignTags(c,id,b));}
 @Get('tags') tags(@Req() r:Request){return this.context(r).then(c=>this.customers.tags(c));}
 @Post('tags') tagCreate(@Req() r:Request,@Body() b:unknown){return this.context(r).then(c=>this.customers.saveTag(c,undefined,b));}
 @Patch('tags/:id') tagUpdate(@Req() r:Request,@Param('id') id:string,@Body() b:unknown){return this.context(r).then(c=>this.customers.saveTag(c,id,b));}
 @Get('segment-templates') templates(@Req() r:Request){return this.context(r).then(async c=>{await this.segments.core.guard(c,'crm.segment.read');return SEGMENT_TEMPLATES;});}
 @Post('segments/preview') preview(@Req() r:Request,@Body() b:any){return this.context(r).then(c=>this.segments.preview(c,b));}
 @Get('segments') segmentList(@Req() r:Request,@Query() q:any){return this.context(r).then(c=>this.segments.list(c,q));}
 @Post('segments') segmentCreate(@Req() r:Request,@Body() b:unknown){return this.context(r).then(c=>this.segments.save(c,undefined,b));}
 @Get('segments/:id') segment(@Req() r:Request,@Param('id') id:string){return this.context(r).then(c=>this.segments.get(c,id));}
 @Patch('segments/:id') segmentSave(@Req() r:Request,@Param('id') id:string,@Body() b:unknown){return this.context(r).then(c=>this.segments.save(c,id,b));}
 @Post('segments/:id/evaluate') evaluate(@Req() r:Request,@Param('id') id:string,@Body() b:unknown){return this.context(r).then(c=>this.segments.evaluate(c,id,b));}
 @Get('segments/:id/evaluations/:evaluationId') evaluation(@Req() r:Request,@Param('id') id:string,@Param('evaluationId') e:string){return this.context(r).then(c=>this.segments.evaluation(c,id,e));}
 @Post('segments/:id/archive') archive(@Req() r:Request,@Param('id') id:string,@Body() b:unknown){return this.context(r).then(c=>this.segments.archive(c,id,b));}
 @Get('tasks') taskList(@Req() r:Request,@Query() q:any){return this.context(r).then(c=>this.tasks.list(c,q));}
 @Post('tasks') taskCreate(@Req() r:Request,@Body() b:any){return this.context(r).then(c=>this.tasks.save(c,undefined,b));}
 @Get('tasks/:id') task(@Req() r:Request,@Param('id') id:string){return this.context(r).then(c=>this.tasks.get(c,id));}
 @Patch('tasks/:id') taskSave(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.tasks.save(c,id,b));}
 @Post('tasks/:id/actions') taskAction(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.tasks.actions(c,id,b));}
 @Post('tasks/:id/target-preview') taskPreview(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.tasks.targetPreview(c,id,b));}
 @Post('tasks/:id/logs') taskLog(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.tasks.log(c,id,b));}
 @Get('tasks/:id/results') results(@Req() r:Request,@Param('id') id:string){return this.context(r).then(c=>this.tasks.results(c,id));}
 @Get('imports') importList(@Req() r:Request,@Query() q:any){return this.context(r).then(c=>this.imports.list(c,q));}
 @Post('imports') importCreate(@Req() r:Request,@Body() b:any){return this.context(r).then(c=>this.imports.create(c,b));}
 @Get('imports/:id') importGet(@Req() r:Request,@Param('id') id:string){return this.context(r).then(c=>this.imports.detail(c,id));}
 @Patch('imports/:id') importUpdate(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.imports.update(c,id,b));}
 @Post('imports/:id/files/:role') upload(@Req() r:Request,@Param('id') id:string,@Param('role') role:string,@Body() b:any){return this.context(r).then(c=>this.imports.upload(c,id,role,b));}
 @Post('imports/:id/preview') importPreview(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.imports.preview(c,id,b));}
 @Post('imports/:id/confirm') importConfirm(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.imports.confirm(c,id,b));}
 @Post('imports/:id/actions') importAction(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.imports.actions(c,id,b));}
 @Get('imports/:id/errors') importErrors(@Req() r:Request,@Param('id') id:string,@Query() q:any){return this.context(r).then(c=>this.imports.errors(c,id,q));}
 @Get('imports/:id/files/:fileId') original(@Req() r:Request,@Param('id') id:string,@Param('fileId') fid:string){return this.context(r).then(c=>this.imports.original(c,id,fid));}
 @Post('imports/:id/compensation-preview') compensationPreview(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.imports.compensationPreview(c,id,b));}
 @Post('imports/:id/compensate') compensate(@Req() r:Request,@Param('id') id:string,@Body() b:any){return this.context(r).then(c=>this.imports.compensate(c,id,b));}
}
