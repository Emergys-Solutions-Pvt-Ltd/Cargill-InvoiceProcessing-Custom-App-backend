import type { ExtractedPage, ExtractionRequest, InvoiceExtractor, ProfileConfig, ProviderContext, SourceRecord } from '../../core/contracts.js';
import { IntegrationError } from '../../core/errors.js';
import { getPath, parseSourceDate } from '../../core/mapping/field-mapper.js';
import {
  buildQueryString,
  buildStructuredFilter,
  incrementalLiteral,
  parseSapTimestamp,
  type ODataVersion,
} from './odata-query.js';
import { sapConnectionSchema, sapProfileSettingsSchema, type SapConnection, type SapProfileSettings } from './sap-odata.schemas.js';

/**
 * Adapter between SAP OData services and the canonical extraction contract:
 * builds requests, follows server-driven paging (V2 "__next", V4 "@odata.nextLink") or falls back
 * to $top/$skip, and normalises V2 ("d.results") / V4 ("value") payloads into plain records.
 */

export interface ODataPage {
  records: SourceRecord[];
  nextLink: string | null;
}

/** Removes OData bookkeeping (__metadata, deferred navigation stubs, @odata.* annotations). */
export const normaliseRecord = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normaliseRecord);
  if (value === null || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if ('__deferred' in obj) return undefined;
  if ('results' in obj && Array.isArray(obj.results) && Object.keys(obj).every((k) => k === 'results' || k === '__next')) {
    return (obj.results as unknown[]).map(normaliseRecord);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '__metadata' || k.startsWith('@odata.') || k.includes('@odata.')) continue;
    const normalised = normaliseRecord(v);
    if (normalised !== undefined) out[k] = normalised;
  }
  return out;
};

export const parsePage = (body: string, version: ODataVersion): ODataPage => {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new IntegrationError('RESPONSE_INVALID', 'The OData service did not return JSON. Check the service path and OData version.');
  }
  const root = json as Record<string, unknown>;
  let rows: unknown;
  let next: unknown;
  if (version === 'v2') {
    const d = root.d as Record<string, unknown> | unknown[] | undefined;
    rows = Array.isArray(d) ? d : d?.results;
    next = Array.isArray(d) ? undefined : d?.__next;
  } else {
    rows = root.value;
    next = root['@odata.nextLink'];
  }
  if (!Array.isArray(rows)) {
    throw new IntegrationError('RESPONSE_INVALID', `Unexpected OData ${version.toUpperCase()} response: no collection found. Check the entity set and OData version.`);
  }
  return {
    records: rows.map((r) => normaliseRecord(r) as SourceRecord),
    nextLink: typeof next === 'string' && next ? next : null,
  };
};

export class SapODataClient {
  readonly connection: SapConnection;

  constructor(private readonly context: ProviderContext) {
    this.connection = sapConnectionSchema.parse(context.integration.connection);
  }

  get serviceRoot() {
    return `${this.connection.baseUrl}${this.connection.servicePath}`;
  }

  /** sap-client / sap-language query parameters. */
  extraParams(): Record<string, string> {
    const extra: Record<string, string> = {};
    if (this.connection.sapClient) extra['sap-client'] = this.connection.sapClient;
    if (this.connection.language) extra['sap-language'] = this.connection.language;
    return extra;
  }

  headers(accept = 'application/json'): Record<string, string> {
    return {
      Accept: accept,
      ...(this.connection.odataVersion === 'v4' ? { 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } : { DataServiceVersion: '2.0', MaxDataServiceVersion: '2.0' }),
      ...this.connection.customHeaders,
    };
  }

  async get(url: string, signal: AbortSignal, accept?: string) {
    // Next links come from the server; only follow them on the configured host
    if (new URL(url).origin !== new URL(this.connection.baseUrl).origin) {
      throw new IntegrationError('RESPONSE_INVALID', 'The service returned a paging link to another host; refusing to follow it.');
    }
    return this.context.http.request({
      url, headers: this.headers(accept), signal, auth: this.context.auth,
      timeoutMs: this.connection.timeoutMs, retry: { maxRetries: this.connection.maxRetries },
    });
  }

  /** Resolves a next link (absolute, or relative to the service root) and keeps sap-client. */
  resolveNextLink(link: string) {
    const url = new URL(link, `${this.serviceRoot}/`);
    for (const [k, v] of Object.entries(this.extraParams())) if (!url.searchParams.has(k)) url.searchParams.set(k, v);
    if (this.connection.odataVersion === 'v2' && !url.searchParams.has('$format')) url.searchParams.set('$format', 'json');
    return url.toString();
  }

  /** First-page URL of a profile for the given incremental start. */
  buildUrl(settings: SapProfileSettings, keyFields: string[], since: Date | null, top: number, skip = 0) {
    const version = this.connection.odataVersion;
    const filters: string[] = settings.filters.map((f) => buildStructuredFilter(f, version));
    if (settings.customFilter) filters.push(settings.customFilter);
    let orderBy = settings.orderBy;
    if (settings.incrementalField) {
      if (since) filters.push(`${settings.incrementalField} ge ${incrementalLiteral(since, settings.incrementalFieldType, version)}`);
      // Ascending change time + key: the cursor can be saved after every page
      orderBy = [`${settings.incrementalField} asc`, ...keyFields.filter((k) => !k.includes('/')).map((k) => `${k} asc`)].join(',');
    } else if (!orderBy) {
      // Stable order so $skip paging neither skips nor repeats records
      orderBy = keyFields.filter((k) => !k.includes('/')).map((k) => `${k} asc`).join(',');
    }
    const query = buildQueryString(
      { select: settings.select, expand: settings.expand, filters, orderBy, top, skip, extra: this.extraParams() },
      version,
    );
    return `${this.serviceRoot}/${settings.entitySet}?${query}`;
  }
}

export class SapODataExtractor implements InvoiceExtractor {
  private readonly client: SapODataClient;

  constructor(context: ProviderContext) {
    this.client = new SapODataClient(context);
  }

  isIncremental(profile: ProfileConfig) {
    return !!sapProfileSettingsSchema.parse(profile.settings).incrementalField;
  }

  changedAt(record: SourceRecord, profile: ProfileConfig): Date | null {
    const settings = sapProfileSettingsSchema.parse(profile.settings);
    if (!settings.incrementalField) return null;
    const value = getPath(record, settings.incrementalField);
    return settings.incrementalFieldType === 'TimestampDecimal' ? parseSapTimestamp(value) : parseSourceDate(value);
  }

  async *extract(request: ExtractionRequest): AsyncIterable<ExtractedPage> {
    const settings = sapProfileSettingsSchema.parse(request.profile.settings);
    const pageSize = settings.pageSize ?? this.client.connection.defaultPageSize;
    const version = this.client.connection.odataVersion;
    const limit = settings.maxRecordsPerRun ?? Number.POSITIVE_INFINITY;
    // Re-read a small window before the cursor: late-committed SAP changes with an older timestamp
    // are not missed; re-read records come back as "unchanged"
    const since = request.since ? new Date(request.since.getTime() - settings.overlapMinutes * 60_000) : null;

    // $top limits a request "window"; the server may split a window into several pages (next links).
    // When a window ends without a next link and was full, more records may exist: next window via $skip.
    let url: string | null = this.client.buildUrl(settings, request.profile.keyFields, since, pageSize);
    let skip = 0;
    let windowCount = 0;
    let pageNumber = 0;
    let total = 0;

    while (url) {
      if (request.signal.aborted) throw IntegrationError.cancelled();
      const response = await this.client.get(url, request.signal);
      const page = parsePage(response.body, version);
      pageNumber += 1;
      total += page.records.length;
      windowCount += page.records.length;
      yield { pageNumber, records: page.records };

      if (total >= limit) break;
      if (page.nextLink) {
        url = this.client.resolveNextLink(page.nextLink);
      } else if (windowCount >= pageSize) {
        skip += windowCount;
        windowCount = 0;
        url = this.client.buildUrl(settings, request.profile.keyFields, since, pageSize, skip);
      } else {
        url = null;
      }
    }
  }
}
