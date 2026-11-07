// Only home and top-level sections are canonical public pages.
export const publicPaths = [
  "/",
  "/employees",
  "/solutions",
  "/products",
  "/knowledge",
  "/contact"
];
export const retiredPublicRoutes = {
  "/employees/erp": "/employees#erp",
  "/employees/crm": "/employees#crm",
  "/employees/mes": "/employees#mes",
  "/products/erp": "/products#erp",
  "/products/crm": "/products#crm",
  "/products/mes": "/products#mes",
  "/solutions/replenishment": "/solutions#replenishment",
  "/solutions/purchase-followup": "/solutions#purchase-followup",
  "/solutions/accounts": "/solutions#accounts",
  "/solutions/customer-operations": "/solutions#customer-operations",
  "/solutions/sales-followup": "/solutions#sales-followup",
  "/solutions/customer-service": "/solutions#customer-service",
  "/solutions/bom-review": "/solutions#bom-review",
  "/solutions/plan-preparation": "/solutions#plan-preparation",
  "/solutions/production-progress": "/solutions#production-progress",
  "/examples": "/employees#mes-example"
};
export const legacyHashRoutes = {
  "/": {
    "#employees": "/employees",
    "#scenarios": "/solutions",
    "#examples": "/employees#mes-example",
    "#products": "/products",
    "#platform": "/knowledge",
    "#delivery": "/contact#delivery",
    "#contact": "/contact"
  },
  "/products": {
    "#solutions": "/solutions",
    "#employees": "/employees",
    "#available": "/products",
    "#knowledge": "/knowledge",
    "#delivery": "/contact#delivery",
    "#contact": "/contact",
    "#employee-erp": "/employees#erp",
    "#job-replenishment": "/solutions#replenishment",
    "#job-purchase-followup": "/solutions#purchase-followup",
    "#job-accounts": "/solutions#accounts",
    "#employee-crm": "/employees#crm",
    "#job-customer-operations": "/solutions#customer-operations",
    "#job-sales-followup": "/solutions#sales-followup",
    "#job-customer-service": "/solutions#customer-service",
    "#employee-mes": "/employees#mes",
    "#job-bom-review": "/solutions#bom-review",
    "#job-plan-preparation": "/solutions#plan-preparation",
    "#job-production-progress": "/solutions#production-progress",
    "#scenario-bom": "/solutions#bom-review",
    "#scenario-fulfillment": "/solutions#replenishment",
    "#scenario-retention": "/solutions#customer-operations",
    "#scenario-receipts": "/solutions#accounts",
    "#scenario-production": "/solutions#production-progress"
  }
};

export function retiredPublicDestination(path, search = '') {
  const normalized = path.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
  if (normalized === '/examples') {
    const role = {bom:'mes', fulfillment:'erp', retention:'crm'}[new URLSearchParams(search).get('example')] || 'mes';
    return '/employees#' + role + '-example';
  }
  return retiredPublicRoutes[normalized] || null;
}
