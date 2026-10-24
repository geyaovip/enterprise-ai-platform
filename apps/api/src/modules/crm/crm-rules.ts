import {z} from 'zod';
import {parse,problem,hash,currency,money,iso,dayDifference,dec,subtractDays} from './crm.common';
const fields=['channelId','tag','status','recencyDays','customerAgeDays','frequency','lifetimeOrderCount','monetary','lifetimeNetAmount','lastPurchaseAt','sourceCreatedAt'] as const;
export const RULE_FIELDS=fields.map(field=>({field,label:({channelId:'渠道',tag:'标签',status:'客户状态',recencyDays:'距最近购买天数',customerAgeDays:'来源客龄（天）',frequency:'窗口购买订单数',lifetimeOrderCount:'历史有效订单数',monetary:'窗口净消费',lifetimeNetAmount:'历史净消费',lastPurchaseAt:'最近有效购买',sourceCreatedAt:'来源创建时间'})[field],type:['channelId','tag'].includes(field)?'id':field==='status'?'status':['monetary','lifetimeNetAmount'].includes(field)?'money':field.endsWith('At')?'date':'number',ops:['channelId','tag','status'].includes(field)?['eq','in']:['eq','gt','gte','lt','lte','between',...(['recencyDays','customerAgeDays','lastPurchaseAt','sourceCreatedAt'].includes(field)?['is_null']:[])]}));
const condition=z.object({field:z.enum(fields),op:z.enum(['eq','in','gt','gte','lt','lte','between','is_null']),value:z.unknown()}).strict();
const base=z.object({match:z.enum(['all','any']),conditions:z.array(condition).min(1).max(20),currency:currency.default('CNY'),windowStart:iso.optional(),windowEnd:iso.optional()}).strict();
export type Rule=z.infer<typeof base>;
export function normalizeRule(raw:unknown,asOf:Date):Rule{
 const r=parse(base,raw);r.windowEnd??=asOf.toISOString();r.windowStart??=subtractDays(new Date(r.windowEnd),90).toISOString();
 if(new Date(r.windowStart)>=new Date(r.windowEnd)||new Date(r.windowEnd)>new Date(asOf.getTime()+1000)||new Date(r.windowStart)<new Date('2000-01-01'))problem('INVALID_RULE','查询窗口须起止有序，且不能超过当前计算时点。',400);
 for(const c of r.conditions){const meta=RULE_FIELDS.find(f=>f.field===c.field)!;if(!meta.ops.includes(c.op))problem('INVALID_RULE','字段不支持该操作符',400);
  if(c.op==='is_null'){if(typeof c.value!=='boolean')problem('INVALID_RULE','空值条件须为布尔值',400);continue;}
  const schema:z.ZodType<any>=meta.type==='id'?z.uuid():meta.type==='status'?z.enum(['active','archived']):meta.type==='money'?money:meta.type==='date'?iso:z.int().nonnegative().max(10000000);
  if(c.op==='in'){c.value=[...new Set(parse(z.array(schema).min(1).max(100),c.value))].sort();}
  else if(c.op==='between'){const values=parse(z.tuple([schema,schema]),c.value);if(compare(values[0],values[1],meta.type)>0||meta.type==='date'&&compare(values[0],values[1],meta.type)===0)problem('INVALID_RULE','区间起点须小于终点',400);c.value=values;}
  else c.value=parse(schema,c.value);
  const canonical=(v:any)=>meta.type==='money'?dec(v).toFixed(2):meta.type==='date'?new Date(v).toISOString():v;c.value=Array.isArray(c.value)?c.value.map(canonical):canonical(c.value);
 }
 r.conditions=[...new Map(r.conditions.map(c=>[hash(c),c])).values()].sort((a,b)=>hash(a).localeCompare(hash(b)));
 return r;
}
function compare(a:any,b:any,type:string){return type==='money'?dec(a).cmp(dec(b)):type==='date'?Math.sign(Date.parse(a)-Date.parse(b)):typeof a==='number'?Math.sign(a-b):String(a).localeCompare(String(b));}
export function matches(row:any,rule:Rule){if(!rule.conditions.some(c=>c.field==='status')&&row.status!=='active')return false;const tests=rule.conditions.map(c=>{const value=c.field==='tag'?row.tagIds:c.field==='channelId'?row.channelIds:row[c.field],meta=RULE_FIELDS.find(f=>f.field===c.field)!;if(c.op==='is_null')return (value==null)===c.value;if(value==null)return false;if(Array.isArray(value))return c.op==='in'?(c.value as any[]).some(x=>value.includes(x)):value.includes(c.value);if(c.op==='in')return (c.value as any[]).includes(value);const result=(v:any)=>compare(value,v,meta.type);if(c.op==='between'){const [a,b]=c.value as any[];return result(a)>=0&&(meta.type==='date'?result(b)<0:result(b)<=0);}const n=result(c.value);return c.op==='eq'?n===0:c.op==='gt'?n>0:c.op==='gte'?n>=0:c.op==='lt'?n<0:n<=0;});return rule.match==='all'?tests.every(Boolean):tests.some(Boolean);}
export const defaultRule=()=>({match:'all',currency:'CNY',conditions:[{field:'status',op:'eq',value:'active'}]});
const status={field:'status',op:'eq',value:'active'};
export const SEGMENT_TEMPLATES=[
 {id:'T-01',version:1,name:'高价值沉睡',description:'历史净消费达到阈值，且超过90天未购买',rule:{match:'all',currency:'CNY',conditions:[status,{field:'lifetimeNetAmount',op:'gte',value:'1000.00'},{field:'recencyDays',op:'gt',value:90}]}},
 {id:'T-02',version:1,name:'首购未复购',description:'历史仅一次有效购买，距最近购买7～30天',rule:{match:'all',currency:'CNY',conditions:[status,{field:'lifetimeOrderCount',op:'eq',value:1},{field:'recencyDays',op:'between',value:[7,30]}]}},
 {id:'T-03',version:1,name:'近期活跃',description:'最近30天内有有效购买',rule:{match:'all',currency:'CNY',conditions:[status,{field:'recencyDays',op:'lte',value:30}]}},
 {id:'T-04',version:1,name:'新客未购买',description:'来源创建不超过30天，尚无有效购买',rule:{match:'all',currency:'CNY',conditions:[status,{field:'customerAgeDays',op:'lte',value:30},{field:'lifetimeOrderCount',op:'eq',value:0}]}}
];

// The model sees the same typed DSL accepted by the application, including value types.
const comparisons=['eq','gt','gte','lt','lte'] as const;
const typed=(fs:readonly [string,...string[]],value:z.ZodType<any>,nullable=false)=>[
 z.object({field:z.enum(fs),op:z.enum(comparisons),value}).strict(),
 z.object({field:z.enum(fs),op:z.literal('between'),value:z.tuple([value,value])}).strict(),
 ...(nullable?[z.object({field:z.enum(fs),op:z.literal('is_null'),value:z.boolean()}).strict()]:[])
];
export const RULE_TOOL_SCHEMA=z.object({match:z.enum(['all','any']),currency:currency.default('CNY'),conditions:z.array(z.union([
 ...typed(['monetary','lifetimeNetAmount'],money),
 ...typed(['recencyDays','customerAgeDays'],z.int().nonnegative(),true),
 ...typed(['frequency','lifetimeOrderCount'],z.int().nonnegative()),
 ...typed(['lastPurchaseAt','sourceCreatedAt'],iso,true),
 z.object({field:z.enum(['channelId','tag']),op:z.literal('eq'),value:uuidForTool()}).strict(),
 z.object({field:z.enum(['channelId','tag']),op:z.literal('in'),value:z.array(uuidForTool()).min(1).max(100)}).strict(),
 z.object({field:z.literal('status'),op:z.literal('eq'),value:z.enum(['active','archived'])}).strict(),
 z.object({field:z.literal('status'),op:z.literal('in'),value:z.array(z.enum(['active','archived'])).min(1).max(2)}).strict()
])).min(1).max(20),windowStart:iso.optional(),windowEnd:iso.optional()}).strict();
function uuidForTool(){return z.uuid();}

// Concise model-facing DSL. The full RULE_TOOL_SCHEMA and normalizeRule above
// remain authoritative for field/operator/value combinations at execution time.
const wireInteger={type:'integer',minimum:0,maximum:10000000};
const wireMoney={type:'string',pattern:'^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,2})?$'};
const wireDate={type:'string',format:'date-time'};
const wireId={type:'string',format:'uuid'};
const wireStatus={type:'string',enum:['active','archived']};
const wireCondition=(names:readonly string[],ops:readonly string[],scalar:unknown,nullable=false,maxArray=2)=>({type:'object',additionalProperties:false,required:['field','op','value'],properties:{field:{type:'string',enum:names},op:{type:'string',enum:ops},value:{anyOf:[scalar,{type:'array',items:scalar,minItems:maxArray===2?2:1,maxItems:maxArray},...(nullable?[{type:'boolean'}]:[])],description:'between用两项数组；in用数组；is_null用布尔值；其他操作符用单个值。'}}});
const wireComparisons=['eq','gt','gte','lt','lte','between'];
export const RULE_WIRE_SCHEMA={type:'object',additionalProperties:false,required:['match','conditions'],properties:{
 match:{type:'string',enum:['all','any']},currency:{type:'string',pattern:'^[A-Z]{3}$'},
 conditions:{type:'array',minItems:1,maxItems:20,items:{anyOf:[
  wireCondition(['monetary','lifetimeNetAmount'],wireComparisons,wireMoney),
  wireCondition(['frequency','lifetimeOrderCount'],wireComparisons,wireInteger),
  wireCondition(['recencyDays','customerAgeDays'],[...wireComparisons,'is_null'],wireInteger,true),
  wireCondition(['lastPurchaseAt','sourceCreatedAt'],[...wireComparisons,'is_null'],wireDate,true),
  wireCondition(['channelId','tag'],['eq','in'],wireId,false,100),
  wireCondition(['status'],['eq','in'],wireStatus,false,100)
 ]}},windowStart:wireDate,windowEnd:wireDate
}};
