import {Controller,Get,Post,Req,Param,Query,Body} from '@nestjs/common';
import type {Request} from 'express';
import {AuthService} from '../platform/auth.service';
import {CrmGrowthService} from './growth.service';
import {CrmTaskService} from './operation-task.service';
@Controller('api/v1/tenants/:tenantKey/apps/crm')
export class CrmGrowthController {
 constructor(readonly auth:AuthService,readonly growth:CrmGrowthService,readonly tasks:CrmTaskService){}
 private context(r:Request){return this.auth.context(r,r.params.tenantKey as string,'crm');}
 @Get('growth') board(@Req() r:Request,@Query() q:any){return this.context(r).then(c=>this.growth.board(c,q));}
 @Get('tasks/:id/customers') targets(@Req() r:Request,@Param('id') id:string,@Query() q:any){return this.context(r).then(c=>this.tasks.customerTargets(c,id,q));}
 @Post('tasks/:id/customers/:customerId/outcomes') outcome(@Req() r:Request,@Param('id') id:string,@Param('customerId') customerId:string,@Body() body:unknown){return this.context(r).then(c=>this.tasks.customerOutcome(c,id,customerId,body));}
}
