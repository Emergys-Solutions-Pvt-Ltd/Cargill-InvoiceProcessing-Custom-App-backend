import { registerInvoiceExtension } from './common/index.js';
import { gppInvoiceExtension } from './gpp/index.js';
import { rospbuInvoiceExtension } from './rospbu/index.js';
import { sjoInvoiceExtension } from './sjo/index.js';

/**
 * Modules by app / logical area:
 *   auth/    sign-in, JWT middleware, users (User Access Management)
 *   common/  apps, invoices, attachments (S3 / local), master data, lookups, integrations (SAP, OnBase)
 *   gpp/     General Payments: CCPP tab, legacy Salesforce "GP Invoice" fields
 *   sjo/     SJO Invoice Processing: SJO invoice fields
 *   rospbu/  ROSPBU Invoice Processing (common model for now)
 * Each module: *.controller.ts (REST) -> *.service.ts (business rules) -> *.dal.ts (app.usp_* calls),
 * *.models.ts (types), *.mapper.ts (API DTOs), *.schemas.ts (request validation).
 */
export const registerAppModules = () => {
  registerInvoiceExtension(gppInvoiceExtension);
  registerInvoiceExtension(sjoInvoiceExtension);
  registerInvoiceExtension(rospbuInvoiceExtension);
};

export * from './auth/index.js';
export * from './common/index.js';
export { ccppController } from './gpp/index.js';
