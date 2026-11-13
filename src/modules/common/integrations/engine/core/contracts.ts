import type { z } from 'zod';
import type { AuthStrategy } from './auth/auth-strategy.js';
import type { HttpClient } from './http/http-client.js';
import type { Logger } from './logger.js';
import type { CancellationRule, FieldMapping } from './mapping/field-mapper.js';
import type { RetryPolicy, ScheduleConfig } from './schedule.js';

/**
 * Contracts between the synchronization core and integration providers.
 * The core (orchestrator, worker, services) depends only on these interfaces; SAP OData is one
 * implementation. Interfaces are deliberately small (ISP): a provider supplies schemas for its
 * settings, an extractor, and a connection tester - authentication is a separate strategy.
 */

// ---------------------------------------------------------------- configuration (validated)

export interface ProfileConfig {
  id: string;
  name: string;
  isActive: boolean;
  moduleId: string;
  moduleSlug: string;
  invoicePrefix: string;
  /** Provider-specific extraction settings, already validated by profileSettingsSchema. */
  settings: Record<string, unknown>;
  keyFields: string[];
  invoiceCodeTemplate: string;
  fieldMapping: FieldMapping;
  cancellationRule: CancellationRule | null;
  defaultStatus: string;
  initialFrom: Date | null;
  watermark: Date | null;
}

export interface IntegrationConfig {
  id: string;
  providerType: string;
  name: string;
  sourceSystem: string;
  isActive: boolean;
  /** Provider-specific connection settings, already validated by connectionSchema. */
  connection: Record<string, unknown>;
  authType: string;
  authSettings: Record<string, unknown>;
  schedule: ScheduleConfig;
  autoSyncEnabled: boolean;
  retryPolicy: RetryPolicy;
  profiles: ProfileConfig[];
}

// ---------------------------------------------------------------- extraction

/** One source record as returned by the provider (normalised JSON object). */
export type SourceRecord = Record<string, unknown>;

export interface ExtractionRequest {
  profile: ProfileConfig;
  /**
   * Incremental cursor: records changed at or after this instant (the provider may re-read a small
   * overlap before it); null = everything allowed by the filters.
   */
  since: Date | null;
  signal: AbortSignal;
}

export interface ExtractedPage {
  pageNumber: number;
  records: SourceRecord[];
}

export interface InvoiceExtractor {
  /** Streams pages; the consumer persists each page before the next one is requested. */
  extract(request: ExtractionRequest): AsyncIterable<ExtractedPage>;
  /** Change timestamp of a record (drives the incremental cursor); null when not tracked. */
  changedAt(record: SourceRecord, profile: ProfileConfig): Date | null;
  /** True when the profile is configured for incremental extraction. */
  isIncremental(profile: ProfileConfig): boolean;
}

// ---------------------------------------------------------------- source documents (ECM providers)

export interface SourceDocument {
  fileName: string;
  mimeType: string;
  content: Buffer;
  title: string | null;
}

/**
 * Optional capability (ISP): providers whose records have a document behind them (OnBase, other
 * ECM systems) can supply it, and the orchestrator attaches it to the imported invoice.
 */
export interface DocumentFetcher {
  /** Whether documents should be attached for this profile. */
  isEnabled(profile: ProfileConfig): boolean;
  fetch(record: SourceRecord, profile: ProfileConfig, signal: AbortSignal): Promise<SourceDocument>;
}

// ---------------------------------------------------------------- connection test

export interface ConnectionTestStep {
  name: string;
  ok: boolean;
  message: string;
  durationMs: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  steps: ConnectionTestStep[];
  /** Provider-specific findings, e.g. available entity sets or mapped fields missing in the metadata. */
  details?: Record<string, unknown>;
}

export interface ConnectionTester {
  test(profiles: ProfileConfig[], signal: AbortSignal): Promise<ConnectionTestResult>;
}

// ---------------------------------------------------------------- provider

export interface ProviderContext {
  integration: IntegrationConfig;
  auth: AuthStrategy;
  http: HttpClient;
  logger: Logger;
}

export interface RequestOptions {
  timeoutMs: number;
  maxRetries: number;
  minRequestIntervalMs: number;
}

export interface ProviderTemplate {
  id: string;
  name: string;
  description: string;
  /** Application the template is meant for: GP (General Payments) or sjo (SJO). */
  applicationCode: string;
  notes: string[];
  profile: {
    name: string;
    settings: Record<string, unknown>;
    keyFields: string[];
    invoiceCodeTemplate: string;
    fieldMapping: FieldMapping;
    cancellationRule: CancellationRule | null;
    defaultStatus: string;
  };
}

export interface IntegrationProvider {
  readonly type: string;
  readonly displayName: string;
  readonly description: string;
  readonly connectionSchema: z.ZodType<Record<string, unknown>>;
  readonly profileSettingsSchema: z.ZodType<Record<string, unknown>>;
  readonly supportedAuthTypes: readonly string[];
  readonly templates: readonly ProviderTemplate[];
  /** Outbound URLs of a validated connection (checked against the URL policy). */
  connectionUrls(connection: Record<string, unknown>): string[];
  requestOptions(connection: Record<string, unknown>): RequestOptions;
  createExtractor(context: ProviderContext): InvoiceExtractor;
  createConnectionTester(context: ProviderContext): ConnectionTester;
  /** Only for providers that store documents (ECM). */
  createDocumentFetcher?(context: ProviderContext): DocumentFetcher;
}
