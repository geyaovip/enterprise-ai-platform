require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');
const { createApp } = require('../dist/server');
const { hashPassword } = require('../dist/modules/platform/security');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(url)) throw Error('Requires isolated suite_phase1_qa');
  process.env.NODE_ENV = 'test';
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const marker = randomUUID().slice(0,8), tenants = [], users = [], password = 'Collaboration-Test-Only!'; let app;
  try {
    for (const name of ['A','B']) { const t = await db.tenant.create({ data: { slug: `collab-${name}-${marker}`, name } }); tenants.push(t); await db.tenantApp.create({ data: { tenantId: t.id, appId: 'erp' } }); }
    const make = async (role,t=tenants[0]) => { const user = await db.user.create({ data: { email: `${role}-${t.name.toLowerCase()}-${marker}@test.example`, name: role, passwordHash: hashPassword(password) } }); users.push(user.id); return { user, member: await db.membership.create({ data: { tenantId:t.id,userId:user.id,role } }) }; };
    const admin=await make('admin'), sales=await make('sales'), finance=await make('finance'), outsider=await make('sales',tenants[1]);
    app=await createApp(); await app.listen(0,'127.0.0.1'); const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const request=async(path,method='GET',body,cookie)=> { const r=await fetch(base+path,{method,headers:{origin:'http://127.0.0.1:4601','content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}); return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')}; };
    const login=async x=> {const r=await request('/auth/login','POST',{email:x.user.email,password}); assert.equal(r.status,201);return r.cookie.split(';')[0];};
    const ac=await login(admin),sc=await login(sales),fc=await login(finance),oc=await login(outsider),erp=`/tenants/${tenants[0].slug}/erp`;
    assert.equal((await request(erp+'/tasks')).status,401);
    assert.equal((await request(erp+'/tasks','GET',undefined,oc)).status,403);
    assert.equal((await request(erp+'/task-assignees','GET',undefined,sc)).body.length,1);
    const input={requestKey:randomUUID(),title:'公开样例任务',description:'检查测试记录',assigneeMembershipId:sales.member.id,dueAt:'2026-10-01T00:00:00Z'};
    assert.equal((await request(erp+'/tasks','POST',{...input,assigneeMembershipId:finance.member.id},sc)).status,403);
    assert.equal((await request(erp+'/tasks','POST',{...input,assigneeMembershipId:outsider.member.id},ac)).status,404);
    const pair=await Promise.all([request(erp+'/tasks','POST',input,ac),request(erp+'/tasks','POST',input,ac)]);
    assert.equal(pair[0].status,201);assert.equal(pair[1].status,201);assert.equal(pair[0].body.id,pair[1].body.id);
    const task=pair[0].body;
    assert.equal(await db.erpNotification.count({where:{tenantId:tenants[0].id}}),1);
    assert.equal(await db.auditEvent.count({where:{tenantId:tenants[0].id,action:'erp.task.create'}}),1);
    assert.equal((await request(erp+'/tasks','POST',{...input,title:'Changed'},ac)).status,409);
    assert.equal((await request(erp+'/tasks','GET',undefined,sc)).body.items[0].id,task.id);
    assert.equal((await request(erp+'/tasks','GET',undefined,fc)).body.total,0);
    assert.equal((await request(erp+`/tasks/${task.id}/status`,'POST',{status:'completed',version:1},fc)).status,404);
    assert.equal((await request(erp+`/tasks/${task.id}/status`,'POST',{status:'cancelled',version:1},sc)).status,403);
    const notice=(await request(erp+'/notifications','GET',undefined,sc)).body.items[0];
    assert.equal((await request(erp+`/notifications/${notice.id}/read`,'POST',{},fc)).status,404);
    assert.equal((await request(erp+`/notifications/${notice.id}/read`,'POST',{},sc)).status,201);
    assert.equal((await request(erp+`/notifications/${notice.id}/read`,'POST',{},sc)).status,201);
    assert.equal((await request(erp+'/notifications','GET',undefined,sc)).body.unread,0);
    const race=await Promise.all([request(erp+`/tasks/${task.id}/status`,'POST',{status:'completed',version:1},sc),request(erp+`/tasks/${task.id}/status`,'POST',{status:'cancelled',version:1},ac)]);
    assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
    assert.equal(await db.erpNotification.count({where:{tenantId:tenants[0].id}}),3);
    assert.equal((await request(erp+`/tasks/${task.id}/status`,'POST',{status:'open',version:2},sc)).status,403);
    assert.equal((await request(erp+`/tasks/${task.id}/status`,'POST',{status:'open',version:2},ac)).status,201);
    assert.equal((await request(erp+'/announcements','POST',{title:'测试公告',body:'仅用于验收'},sc)).status,403);
    const announcement=await request(erp+'/announcements','POST',{title:'测试公告',body:'仅用于验收'},ac);assert.equal(announcement.status,201);
    const reads=await Promise.all([request(erp+`/announcements/${announcement.body.id}/read`,'POST',{},sc),request(erp+`/announcements/${announcement.body.id}/read`,'POST',{},sc)]);
    assert.equal(reads[0].body.readAt,reads[1].body.readAt);
    assert.equal((await request(erp+'/announcements','GET',undefined,fc)).body.items[0].readAt,null);
    assert.equal((await request(erp+`/announcements/${announcement.body.id}/withdraw`,'POST',{},sc)).status,403);
    assert.equal((await request(erp+`/announcements/${announcement.body.id}/withdraw`,'POST',{},ac)).status,201);
    assert.equal((await request(erp+'/announcements','GET',undefined,sc)).body.total,0);
    assert.equal((await request(erp+`/announcements/${announcement.body.id}/read`,'POST',{},sc)).status,404);
    await db.membership.update({where:{id:sales.member.id},data:{active:false}});
    assert.equal((await request(erp+'/tasks','GET',undefined,sc)).status,403);
    assert.equal((await request(erp+'/tasks','POST',{...input,requestKey:randomUUID()},ac)).status,404);
    await db.tenantApp.updateMany({where:{tenantId:tenants[0].id},data:{enabled:false}});
    assert.equal((await request(erp+'/notifications','GET',undefined,ac)).status,403);
    process.stdout.write('Collaboration: tenant/role isolation, creation retry/races, status races, transactional notifications, private reads, announcements and deactivation passed\n');
  } finally {
    if(app)await app.close();const where={tenantId:{in:tenants.map(t=>t.id)}};
    for(const table of ['memberInvitation','erpAccountEntry','erpAdvance','erpTradeReturn','erpOpeningBatch','erpQuotation','erpCustomerPrice','erpBusinessSettings','erpWarehouseStock','erpWarehouse'])await db[table].deleteMany({where});
    for(const table of ['erpAnnouncementRead','erpAnnouncement','erpNotification','erpTask','auditEvent','tenantApp','membership'])await db[table].deleteMany({where});
    await db.tenant.deleteMany({where:{id:{in:tenants.map(t=>t.id)}}});await db.session.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
  }
}
main().catch(e=>{process.stderr.write(`${e.stack}\n`);process.exitCode=1;});
