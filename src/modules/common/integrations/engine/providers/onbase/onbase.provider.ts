import type { IntegrationProvider, ProviderContext } from '../../core/contracts.js';
import { OnBaseDocumentFetcher, OnBaseExtractor } from './onbase.adapter.js';
import { onbaseConnectionSchema, onbaseProfileSettingsSchema } from './onbase.schemas.js';
import { onbaseTemplates } from './onbase.templates.js';
import { OnBaseConnectionTester } from './onbase.tester.js';

/** Hyland OnBase ECM (REST API through the Hyland API Server) - imports invoice documents + PDFs. */
export const onbaseProvider: IntegrationProvider = {
  type: 'onbase-rest',
  displayName: 'Hyland OnBase',
  description: 'OnBase enterprise content management: invoice documents (document types + keywords) and their files.',
  connectionSchema: onbaseConnectionSchema,
  profileSettingsSchema: onbaseProfileSettingsSchema,
  supportedAuthTypes: ['hyland-idp-password', 'oauth2-client-credentials', 'none'],
  templates: onbaseTemplates,
  connectionUrls: (connection) => [String(connection.apiServerUrl)],
  requestOptions: (connection) => {
    const c = onbaseConnectionSchema.parse(connection);
    return { timeoutMs: c.timeoutMs, maxRetries: c.maxRetries, minRequestIntervalMs: c.minRequestIntervalMs };
  },
  createExtractor: (context: ProviderContext) => new OnBaseExtractor(context),
  createConnectionTester: (context: ProviderContext) => new OnBaseConnectionTester(context),
  createDocumentFetcher: (context: ProviderContext) => new OnBaseDocumentFetcher(context),
};
