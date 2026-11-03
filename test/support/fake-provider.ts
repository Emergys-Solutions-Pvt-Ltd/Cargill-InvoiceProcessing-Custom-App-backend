import { z } from 'zod';
import type { ExtractedPage, ExtractionRequest, IntegrationProvider, InvoiceExtractor, SourceRecord } from '../../src/modules/common/integrations/engine/core/contracts.js';
import { IntegrationError } from '../../src/modules/common/integrations/engine/core/errors.js';

/**
 * A second, non-SAP provider ("e-invoice feed") used to prove the framework is provider
 * independent: it is registered next to SAP without changing the orchestrator, worker, API or
 * mapping code. Records come from an in-memory feed instead of HTTP.
 */
export interface FeedRecord extends SourceRecord {
  docId: string;
  issuer: string;
  issuerTaxId: string;
  total: number;
  issuedOn: string;
  changedAt: string;
  voided?: boolean;
}

export const feedState = {
  records: [] as FeedRecord[],
  pageSize: 2,
  /** Throw this error when the given page (1-based) is requested. */
  failOnPage: null as { page: number; error: IntegrationError } | null,
  requests: [] as { since: string | null }[],
};

export const resetFeed = (records: FeedRecord[] = []) => {
  feedState.records = records;
  feedState.pageSize = 2;
  feedState.failOnPage = null;
  feedState.requests = [];
};

class FeedExtractor implements InvoiceExtractor {
  isIncremental() {
    return true;
  }

  changedAt(record: SourceRecord) {
    return new Date(String(record.changedAt));
  }

  async *extract(request: ExtractionRequest): AsyncIterable<ExtractedPage> {
    feedState.requests.push({ since: request.since?.toISOString() ?? null });
    const rows = feedState.records
      .filter((r) => !request.since || new Date(r.changedAt) >= request.since)
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    for (let i = 0, page = 1; i < rows.length; i += feedState.pageSize, page += 1) {
      if (request.signal.aborted) throw IntegrationError.cancelled();
      if (feedState.failOnPage?.page === page) throw feedState.failOnPage.error;
      yield { pageNumber: page, records: rows.slice(i, i + feedState.pageSize) };
    }
  }
}

export const feedProvider: IntegrationProvider = {
  type: 'e-invoice-feed',
  displayName: 'E-invoice feed (test)',
  description: 'In-memory provider used by the tests',
  connectionSchema: z.object({ endpoint: z.string().url() }),
  profileSettingsSchema: z.object({ channel: z.string().default('inbox') }),
  supportedAuthTypes: ['none', 'api-key'],
  templates: [],
  connectionUrls: (c) => [String(c.endpoint)],
  requestOptions: () => ({ timeoutMs: 1000, maxRetries: 0, minRequestIntervalMs: 0 }),
  createExtractor: () => new FeedExtractor(),
  createConnectionTester: () => ({ test: async () => ({ ok: true, steps: [{ name: 'Feed', ok: true, message: 'ok', durationMs: 0 }] }) }),
};

export const feedMapping = {
  vendorName: { path: 'issuer' },
  cuit: { path: 'issuerTaxId', transform: 'cuit' },
  receptionDate: { path: 'issuedOn', transform: 'date' },
  amount: { path: 'total', transform: 'number' },
};

export const feedRecord = (n: number, overrides: Partial<FeedRecord> = {}): FeedRecord => ({
  docId: `D-${n}`,
  issuer: 'Molinos Agro S.A.',
  issuerTaxId: '30500012349',
  total: 1000 + n,
  issuedOn: '2026-07-01',
  changedAt: new Date(Date.UTC(2026, 6, 1, 10, n)).toISOString(),
  ...overrides,
});
