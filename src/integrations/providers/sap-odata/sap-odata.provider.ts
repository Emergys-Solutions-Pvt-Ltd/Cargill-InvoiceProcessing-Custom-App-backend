import type { IntegrationProvider, ProviderContext } from '../../core/contracts.js';
import { SapODataExtractor } from './sap-odata.adapter.js';
import { sapConnectionSchema, sapProfileSettingsSchema } from './sap-odata.schemas.js';
import { sapTemplates } from './sap-odata.templates.js';
import { SapODataConnectionTester } from './sap-odata.tester.js';

/** SAP S/4HANA / SAP Gateway OData (V2 and V4) invoice provider. */
export const sapODataProvider: IntegrationProvider = {
  type: 'sap-odata',
  displayName: 'SAP OData',
  description: 'SAP S/4HANA (Cloud or on-premise) and SAP Gateway OData V2 / V4 services.',
  connectionSchema: sapConnectionSchema,
  profileSettingsSchema: sapProfileSettingsSchema,
  supportedAuthTypes: ['oauth2-client-credentials', 'basic', 'api-key', 'none'],
  templates: sapTemplates,
  connectionUrls: (connection) => [String(connection.baseUrl)],
  requestOptions: (connection) => {
    const c = sapConnectionSchema.parse(connection);
    return { timeoutMs: c.timeoutMs, maxRetries: c.maxRetries, minRequestIntervalMs: c.minRequestIntervalMs };
  },
  createExtractor: (context: ProviderContext) => new SapODataExtractor(context),
  createConnectionTester: (context: ProviderContext) => new SapODataConnectionTester(context),
};
