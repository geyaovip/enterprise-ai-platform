BEGIN;
CREATE INDEX "CrmCustomer_tenantId_ownerMembershipId_idx" ON "CrmCustomer"("tenantId", "ownerMembershipId");
CREATE INDEX "CrmCustomer_tenantId_serviceOwnerMembershipId_idx" ON "CrmCustomer"("tenantId", "serviceOwnerMembershipId");
CREATE INDEX "CrmLead_tenantId_normalizedName_idx" ON "CrmLead"("tenantId", "normalizedName");
CREATE INDEX "CrmServiceTask_tenantId_planId_idx" ON "CrmServiceTask"("tenantId", "planId");
COMMIT;
