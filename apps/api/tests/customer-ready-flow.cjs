require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');
const { createApp } = require('../dist/server');
const { hashPassword } = require('../dist/modules/platform/security');
const { ReminderService } = require('../dist/modules/erp/reminder.service');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(url)) throw Error('Requires isolated suite_phase1_qa');
  process.env.NODE_ENV = 'test';
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const tenants = [], users = [], marker = randomUUID().slice(0, 8), password = 'CustomerReady-Test-Only!'; let app;
  try {
    for (const name of ['A', 'B']) { const tenant = await db.tenant.create({ data: { slug: `ready-${name}-${marker}`, name } }); tenants.push(tenant); await db.tenantApp.create({ data: { tenantId: tenant.id, appId: 'erp' } }); }
    const make = async (role, tenant = tenants[0]) => { const user = await db.user.create({ data: { email: `ready-${role}-${tenant.name.toLowerCase()}-${marker}@example.test`, name: role, passwordHash: hashPassword(password) } }); users.push(user.id); return { user, member: await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role } }) }; };
    const admin = await make('admin'), sales = await make('sales'), warehouse = await make('warehouse'), other = await make('admin', tenants[1]);
    app = await createApp(); await app.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`, erp = `/tenants/${tenants[0].slug}/erp`;
    const request = async (path, method = 'GET', body, cookie) => { const r = await fetch(base + path, { method, headers: { origin: 'http://127.0.0.1:4601', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') }; };
    const login = async ({ user }) => { const r = await request('/auth/login', 'POST', { email: user.email, password }); assert.equal(r.status, 201); return r.cookie.split(';')[0]; };
    const ac = await login(admin), sc = await login(sales), wc = await login(warehouse), oc = await login(other);
    const preview = '/master/customers/import-preview', importer = '/master/customers/import';
    const csv = '\uFEFF客户编号,名称,联系人,电话,行业\r\nC1,"客户,一",,,软件\r\nC2,"多行\n客户",,,制造\r\n';
    assert.equal((await request(erp + preview, 'POST', { csv })).status, 401);
    assert.equal((await request(erp + preview, 'POST', { csv }, oc)).status, 403);
    assert.equal((await request(erp + preview, 'POST', { csv }, wc)).status, 403);
    const p = await request(erp + preview, 'POST', { csv }, sc); assert.equal(p.status, 201); assert.equal(p.body.valid, true); assert.equal(p.body.total, 2);
    assert.equal((await request(erp + preview, 'POST', { csv: '客户编号,名称\nC1,A\nC1,B' }, sc)).body.valid, false);
    assert.equal((await request(erp + preview, 'POST', { csv: '客户编号,名称\nC1,"broken' }, sc)).status, 400);
    const input = { csv, requestKey: randomUUID() };
    const race = await Promise.all([request(erp + importer, 'POST', input, sc), request(erp + importer, 'POST', input, sc)]);
    assert.deepEqual(race.map(r => r.status), [201, 201]); assert.equal(await db.erpCustomer.count({ where: { tenantId: tenants[0].id } }), 2);
    assert.equal(await db.auditEvent.count({ where: { tenantId: tenants[0].id, action: 'erp.master.import' } }), 1);
    assert.equal((await request(erp + importer, 'POST', { ...input, csv: csv.replace('软件', '金融') }, sc)).status, 409);
    assert.equal((await request(erp + preview, 'POST', { csv }, sc)).body.valid, false);
    const failed = await request(erp + importer, 'POST', { requestKey: randomUUID(), csv: '客户编号,名称\nC3,不应部分导入\nC1,重复' }, sc); assert.equal(failed.status, 409);
    assert.equal(await db.erpCustomer.count({ where: { tenantId: tenants[0].id, code: 'C3' } }), 0);
    const privateCustomer = await db.erpCustomer.create({ data: { tenantId: tenants[0].id, ownerMembershipId: admin.member.id, code: 'PRIVATE', name: '管理员客户' } });
    const exported = await request(erp + '/master/customers/export', 'GET', undefined, sc); assert.equal(exported.status, 200); assert.equal(exported.body.total, 2); assert.ok(!exported.body.csv.includes('PRIVATE')); assert.equal(await db.auditEvent.count({ where: { tenantId: tenants[0].id, action: 'erp.master.export' } }), 1);
    assert.equal((await request(erp + '/master/customers/export?q=C1', 'GET', undefined, sc)).body.total, 1);
    assert.equal((await request(erp + '/master/customers/export', 'GET', undefined, wc)).status, 403);
    await db.erpCustomer.create({ data: { tenantId: tenants[0].id, ownerMembershipId: admin.member.id, code: 'FORMULA', name: ' =1+1' } });
    assert.ok((await request(erp + '/master/customers/export', 'GET', undefined, ac)).body.csv.includes("' =1+1"));
    const productInput = { requestKey: randomUUID(), csv: '商品编码,名称,单位,售价,采购价,低库存阈值\nP1,测试商品,件,20.00,10.00,2' };
    assert.equal((await request(erp + '/master/products/import', 'POST', productInput, sc)).status, 403);
    assert.equal((await request(erp + '/master/products/import', 'POST', productInput, ac)).status, 201);
    assert.equal((await request(erp + '/master/products/import-preview', 'POST', { csv: productInput.csv.replace(',2', ',1.2345678') }, ac)).body.valid, false);
    const product = await db.erpProduct.findFirstOrThrow({ where: { tenantId: tenants[0].id, sku: 'P1' }, include: { balance: true } }); assert.equal(product.balance.quantity, 0);
    assert.equal((await request(erp + '/master/suppliers/import', 'POST', { requestKey: randomUUID(), csv: '供应商编号,名称\nS1,测试供应商' }, ac)).status, 201);
    const supplier = await db.erpSupplier.findFirstOrThrow({ where: { tenantId: tenants[0].id } });
    const purchase = await request(erp + '/purchases', 'POST', { number: 'PO-READY', supplierId: supplier.id, lines: [{ productId: product.id, quantity: 3 }] }, ac); assert.equal(purchase.status, 201);
    assert.equal((await request(erp + `/purchases/${purchase.body.id}/confirm`, 'POST', { version: 1 }, ac)).status, 201);
    assert.ok((await request(erp + '/work-items?kind=purchase_receipt', 'GET', undefined, wc)).body.items.some(item => item.resourceId === purchase.body.id));
    assert.equal((await request(erp + '/work-items?kind=purchase_receipt', 'GET', undefined, sc)).body.total, 0);
    assert.equal((await request(erp + `/purchases/${purchase.body.id}/receive`, 'POST', { requestKey: randomUUID(), version: 2, lines: [{ lineId: purchase.body.lines[0].id, quantity: 3 }] }, wc)).status, 201);
    assert.equal((await request(erp + '/work-items?kind=purchase_receipt', 'GET', undefined, wc)).body.total, 0);
    const contract = await request(erp + '/contracts', 'POST', { number: 'SO-READY', customerId: privateCustomer.id, lines: [{ productId: product.id, quantity: 2 }] }, ac); assert.equal(contract.status, 201);
    assert.equal((await request(erp + `/contracts/${contract.body.id}/confirm`, 'POST', { version: 1 }, ac)).status, 201);
    assert.equal((await request(erp + '/work-items?kind=sales_shipment', 'GET', undefined, wc)).body.total, 1);
    assert.equal((await request(erp + `/contracts/${contract.body.id}/ship`, 'POST', { requestKey: randomUUID(), version: 2, lines: [{ lineId: contract.body.lines[0].id, quantity: 2 }] }, wc)).status, 201);
    assert.equal((await request(erp + '/work-items?kind=sales_shipment', 'GET', undefined, wc)).body.total, 0);

    const due = new Date(Date.now() - 60000);
    await db.erpTask.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ tenantId: tenants[0].id, requestKey: randomUUID(), title: `分页任务 ${i}`, createdByMembershipId: admin.member.id, assigneeMembershipId: sales.member.id, dueAt: i < 2 ? due : null })) });
    const pages = await Promise.all(Array.from({ length: 6 }, (_, i) => request(erp + `/work-items?kind=task&page=${i + 1}`, 'GET', undefined, sc)));
    assert.equal(pages[0].body.total, 105); assert.equal(new Set(pages.flatMap(p => p.body.items.map(i => i.resourceId))).size, 105);
    assert.equal((await request(erp + '/work-items?kind=task', 'GET', undefined, ac)).body.total, 0);
    assert.equal((await request(erp + '/work-items?page=-1', 'GET', undefined, sc)).status, 400);
    const customer = await db.erpCustomer.findFirstOrThrow({ where: { tenantId: tenants[0].id, code: 'C1' } });
    const opportunity = await db.erpOpportunity.create({ data: { tenantId: tenants[0].id, customerId: customer.id, ownerMembershipId: sales.member.id, name: '到期商机', estimatedAmount: '1.00', followups: { create: { tenantId: tenants[0].id, actorMembershipId: sales.member.id, note: '公开测试', nextActionAt: due } } } });
    // Restrict the scheduled worker to this isolated test's public fixture via a temporary DB filter.
    const reminders = app.get(ReminderService);
    const rawTasks = reminders.db.erpTask.findMany.bind(reminders.db.erpTask), rawOpp = reminders.db.erpOpportunity.findMany.bind(reminders.db.erpOpportunity);
    reminders.db.erpTask.findMany = args => rawTasks({ ...args, where: { ...args.where, tenantId: tenants[0].id } });
    reminders.db.erpOpportunity.findMany = args => rawOpp({ ...args, where: { ...args.where, tenantId: tenants[0].id } });
    await reminders.tick(); await reminders.tick();
    assert.equal(await db.erpNotification.count({ where: { tenantId: tenants[0].id, recipientMembershipId: sales.member.id } }), 3);
    await db.erpOpportunityFollowup.create({ data: { tenantId: tenants[0].id, opportunityId: opportunity.id, actorMembershipId: sales.member.id, note: '新的计划', nextActionAt: new Date(Date.now() + 86400000) } });
    assert.equal((await request(erp + '/work-items?kind=opportunity_followup', 'GET', undefined, sc)).body.total, 0);
    await db.erpTask.create({ data: { tenantId: tenants[0].id, requestKey: randomUUID(), title: '停用成员不提醒', createdByMembershipId: admin.member.id, assigneeMembershipId: sales.member.id, dueAt: due } });
    await db.membership.update({ where: { id: sales.member.id }, data: { active: false } }); await reminders.tick();
    assert.equal(await db.erpNotification.count({ where: { tenantId: tenants[0].id, recipientMembershipId: sales.member.id } }), 3);
    assert.equal((await request(erp + '/work-items', 'GET', undefined, sc)).status, 403);
    process.stdout.write('Customer ready: CSV validation/atomic rollback/idempotency/ownership/formula safety; fulfillment completion; 105-task pagination; deduplicated due reminders and revocation passed.\n');
  } finally {
    if (app) await app.close(); const where = { tenantId: { in: tenants.map(t => t.id) } };
    for(const table of ['memberInvitation','erpAccountEntry','erpAdvance','erpTradeReturn','erpOpeningBatch','erpQuotation','erpCustomerPrice','erpBusinessSettings','erpWarehouseStock','erpWarehouse'])await db[table].deleteMany({where});
    for (const table of ['erpPayment', 'erpStockMovement', 'erpStockDocument', 'erpReceivable', 'erpPayable', 'erpPurchaseChange']) await db[table].deleteMany({ where });
    await db.erpPurchaseLine.deleteMany({ where: { order: where } }); await db.erpSalesLine.deleteMany({ where: { contract: where } });
    for (const table of ['erpPurchaseOrder', 'erpSalesContract', 'erpOpportunityFollowup', 'erpOpportunity', 'erpCustomer', 'erpInventoryBalance', 'erpProduct', 'erpSupplier', 'erpNotification', 'erpTask', 'auditEvent', 'tenantApp', 'membership']) await db[table].deleteMany({ where });
    await db.tenant.deleteMany({ where: { id: { in: tenants.map(t => t.id) } } }); await db.session.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  }
}
main().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });
