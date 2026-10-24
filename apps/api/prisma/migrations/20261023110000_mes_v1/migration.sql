-- CreateTable
CREATE TABLE "MesMemberGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MesMemberGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MesMaterial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MesMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MesBom" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lines" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "MesBom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MesBomReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "bomVersion" INTEGER NOT NULL,
    "findings" JSONB NOT NULL,
    "decisions" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MesBomReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MesPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "bomRevision" INTEGER NOT NULL,
    "targetQty" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "requirements" JSONB NOT NULL,
    "bomVersions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MesPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MesWorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "targetQty" INTEGER NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "goodQty" INTEGER NOT NULL DEFAULT 0,
    "defectQty" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MesWorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MesReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "goodQty" INTEGER NOT NULL,
    "defectQty" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MesReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MesCommandReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MesCommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MesMemberGrant_tenantId_membershipId_key" ON "MesMemberGrant"("tenantId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "MesMaterial_tenantId_sku_key" ON "MesMaterial"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "MesMaterial_id_tenantId_key" ON "MesMaterial"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MesBom_tenantId_status_idx" ON "MesBom"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MesBom_tenantId_productId_revision_key" ON "MesBom"("tenantId", "productId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "MesBom_id_tenantId_key" ON "MesBom"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MesBomReview_tenantId_bomId_createdAt_idx" ON "MesBomReview"("tenantId", "bomId", "createdAt");

-- CreateIndex
CREATE INDEX "MesPlan_tenantId_status_idx" ON "MesPlan"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MesPlan_tenantId_code_key" ON "MesPlan"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MesPlan_id_tenantId_key" ON "MesPlan"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MesWorkOrder_tenantId_assigneeId_status_idx" ON "MesWorkOrder"("tenantId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "MesWorkOrder_tenantId_planId_idx" ON "MesWorkOrder"("tenantId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "MesWorkOrder_tenantId_code_key" ON "MesWorkOrder"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MesWorkOrder_id_tenantId_key" ON "MesWorkOrder"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MesReport_tenantId_orderId_status_idx" ON "MesReport"("tenantId", "orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MesReport_id_tenantId_key" ON "MesReport"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MesCommandReceipt_tenantId_membershipId_command_requestKey_key" ON "MesCommandReceipt"("tenantId", "membershipId", "command", "requestKey");

ALTER TABLE "MesMaterial" ADD CONSTRAINT "MesMaterial_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

ALTER TABLE "MesBom" ADD CONSTRAINT "MesBom_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

ALTER TABLE "MesBomReview" ADD CONSTRAINT "MesBomReview_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

ALTER TABLE "MesPlan" ADD CONSTRAINT "MesPlan_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

ALTER TABLE "MesWorkOrder" ADD CONSTRAINT "MesWorkOrder_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

ALTER TABLE "MesReport" ADD CONSTRAINT "MesReport_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

ALTER TABLE "MesMemberGrant" ADD CONSTRAINT "MesMemberGrant_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

ALTER TABLE "MesCommandReceipt" ADD CONSTRAINT "MesCommandReceipt_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;
ALTER TABLE "MesMemberGrant" ADD CONSTRAINT "MesMemberGrant_membershipId_tenant_fk" FOREIGN KEY ("membershipId","tenantId") REFERENCES "Membership"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesBom" ADD CONSTRAINT "MesBom_productId_tenant_fk" FOREIGN KEY ("productId","tenantId") REFERENCES "MesMaterial"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesBomReview" ADD CONSTRAINT "MesBomReview_bomId_tenant_fk" FOREIGN KEY ("bomId","tenantId") REFERENCES "MesBom"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesPlan" ADD CONSTRAINT "MesPlan_productId_tenant_fk" FOREIGN KEY ("productId","tenantId") REFERENCES "MesMaterial"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesPlan" ADD CONSTRAINT "MesPlan_bomId_tenant_fk" FOREIGN KEY ("bomId","tenantId") REFERENCES "MesBom"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesWorkOrder" ADD CONSTRAINT "MesWorkOrder_planId_tenant_fk" FOREIGN KEY ("planId","tenantId") REFERENCES "MesPlan"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesWorkOrder" ADD CONSTRAINT "MesWorkOrder_assigneeId_tenant_fk" FOREIGN KEY ("assigneeId","tenantId") REFERENCES "Membership"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesReport" ADD CONSTRAINT "MesReport_orderId_tenant_fk" FOREIGN KEY ("orderId","tenantId") REFERENCES "MesWorkOrder"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesReport" ADD CONSTRAINT "MesReport_reporterId_tenant_fk" FOREIGN KEY ("reporterId","tenantId") REFERENCES "Membership"(id,"tenantId") ON DELETE RESTRICT;
ALTER TABLE "MesReport" ADD CONSTRAINT "MesReport_reviewerId_tenant_fk" FOREIGN KEY ("reviewerId","tenantId") REFERENCES "Membership"(id,"tenantId") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "MesBom_one_published_per_product" ON "MesBom" ("tenantId", "productId") WHERE status='published';
ALTER TABLE "MesMaterial" ADD CONSTRAINT "MesMaterial_kind_unit_check" CHECK (kind IN ('finished','semi','raw','packaging','auxiliary') AND (kind NOT IN ('finished','semi') OR unit='件'));
ALTER TABLE "MesBom" ADD CONSTRAINT "MesBom_state_check" CHECK (status IN ('draft','published','archived') AND version>0 AND revision>0 AND jsonb_typeof(lines)='array');
ALTER TABLE "MesPlan" ADD CONSTRAINT "MesPlan_state_quantity_check" CHECK (status IN ('draft','released','completed','cancelled') AND "targetQty">0 AND "targetQty"<=10000000);
ALTER TABLE "MesWorkOrder" ADD CONSTRAINT "MesWorkOrder_quantity_check" CHECK ("targetQty">0 AND "goodQty">=0 AND "defectQty">=0 AND "goodQty"+"defectQty"<="targetQty" AND status IN ('ready','in_progress','completed','cancelled'));
ALTER TABLE "MesReport" ADD CONSTRAINT "MesReport_quantity_review_check" CHECK ("goodQty">=0 AND "defectQty">=0 AND "goodQty"+"defectQty">0 AND status IN ('pending','approved','rejected') AND ("reviewerId" IS NULL OR "reviewerId"<>"reporterId"));
ALTER TABLE "MesMemberGrant" ADD CONSTRAINT "MesMemberGrant_role_check" CHECK (role IN ('planner','supervisor','operator','viewer','none'));
