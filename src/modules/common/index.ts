// Common module: everything the GPP, SJO and ROSPBU apps share
export { default as appsController } from './apps/apps.controller.js';
export { default as lookupsController } from './lookups/lookups.controller.js';
export { default as masterDataController } from './master-data/master-data.controller.js';
export { default as filesController } from './attachments/files.controller.js';
export { default as integrationsController } from './integrations/index.js';
export { attachmentStorage } from './attachments/storage/index.js';
export { registerInvoiceExtension } from './invoices/invoice-extensions.js';
