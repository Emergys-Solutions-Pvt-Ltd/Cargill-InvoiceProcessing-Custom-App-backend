import { MockSapServer, type MockAuth } from './mock-sap-server.js';

/**
 * Local mock SAP OData service:  npm run mock:sap
 * Env: MOCK_SAP_PORT (default 4010), MOCK_SAP_AUTH = none | basic | oauth | api-key (default oauth),
 *      MOCK_SAP_INVOICES (default 40), MOCK_SAP_PAGE_SIZE (server paging, default 10)
 * Development credentials (configure them in Settings > SAP Configuration > Authentication):
 *   oauth: token URL http://localhost:4010/oauth/token, client id mock-client, secret mock-secret
 *   basic: mock-user / mock-password        api-key: header APIKey, key mock-api-key
 */
const port = Number(process.env.MOCK_SAP_PORT ?? 4010);
const authType = process.env.MOCK_SAP_AUTH ?? 'oauth';
const auth: MockAuth =
  authType === 'basic'
    ? { type: 'basic', username: 'mock-user', password: 'mock-password' }
    : authType === 'api-key'
      ? { type: 'api-key', headerName: 'APIKey', apiKey: 'mock-api-key' }
      : authType === 'none'
        ? { type: 'none' }
        : { type: 'oauth', clientId: 'mock-client', clientSecret: 'mock-secret' };

const main = async () => {
  const server = await new MockSapServer({
    port,
    auth,
    invoiceCount: Number(process.env.MOCK_SAP_INVOICES ?? 40),
    serverPageSize: Number(process.env.MOCK_SAP_PAGE_SIZE ?? 10),
  }).start();

  console.log(`Mock SAP OData listening on ${server.url} (auth: ${auth.type})`);
  console.log(`  V2 service path: ${server.v2ServicePath}`);
  console.log(`  V4 service path: ${server.v4ServicePath}`);
};

void main();
