import type { ProviderContext } from '../../core/contracts.js';
import { IntegrationError } from '../../core/errors.js';
import { onbaseConnectionSchema, type OnBaseConnection } from './onbase.schemas.js';

/**
 * Adapter for the OnBase REST API (Hyland API Server, `<apiServer>/onbase/core`):
 *   POST /documents/queries                 create a document query -> { id }
 *   GET  /documents/queries/{id}/results    query results
 *   GET  /documents/{id}/keywords           keyword values of a document
 *   GET  /documents/{id}/revisions/latest/renditions/default/content   the file
 *   GET  /document-types?systemName=|id=    lookups
 *   GET  /keyword-types?systemName=|id=
 * Response shapes vary between OnBase versions; the normalisers below accept the documented
 * `items` collections plus common variants, so a version difference fails loudly in
 * "Test connection" instead of silently importing nothing.
 */

export interface OnBaseResultItem {
  id: string;
  name: string | null;
  documentDate: string | null;
  typeId: number | null;
}

export interface OnBaseKeyword {
  typeId: number;
  values: string[];
}

export interface KeywordFilter {
  typeId: number;
  value: string;
  operator: string;
}

type Json = Record<string, unknown>;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const itemsOf = (json: unknown): unknown[] => {
  if (Array.isArray(json)) return json;
  const obj = (json ?? {}) as Json;
  return asArray(obj.items ?? obj.results ?? obj.documents ?? obj.value ?? (obj.data as Json | undefined)?.items);
};

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    const v = value as Json;
    return text(v.value ?? v.formattedValue ?? v.displayValue);
  }
  const s = String(value).trim();
  return s === '' ? null : s;
};

const toIsoDate = (value: string | null): string | null => {
  if (!value) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value); // OnBase display format MM/DD/YYYY
  const d = m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Query result row: id + name + document date (direct properties, or the requested display columns). */
export const normaliseResultItem = (raw: unknown): OnBaseResultItem | null => {
  const item = (raw ?? {}) as Json;
  const id = text(item.id ?? item.documentId ?? item.documentHandle ?? item.handle);
  if (!id) return null;
  const columns = asArray(item.displayColumns ?? item.displayColumnValues ?? item.columns ?? item.values);
  return {
    id,
    name: text(item.name ?? item.documentName ?? columns[0]),
    documentDate: toIsoDate(text(item.documentDate ?? item.date ?? item.dateStored ?? columns[1])),
    typeId: Number(item.typeId ?? item.documentTypeId ?? (item.documentType as Json | undefined)?.id) || null,
  };
};

/** Keyword collection of a document: keyword groups (`items[].keywords[]`) or a flat list. */
export const normaliseKeywords = (json: unknown): OnBaseKeyword[] => {
  const obj = (json ?? {}) as Json;
  const flat = [
    ...asArray(obj.keywords),
    ...itemsOf(obj).flatMap((group) => {
      const g = (group ?? {}) as Json;
      return g.keywords ? asArray(g.keywords) : g.typeId !== undefined ? [g] : [];
    }),
  ];
  const result: OnBaseKeyword[] = [];
  for (const raw of flat) {
    const k = (raw ?? {}) as Json;
    const typeId = Number(k.typeId ?? k.keywordTypeId ?? k.id);
    if (!Number.isFinite(typeId)) continue;
    const values = (k.values !== undefined ? asArray(k.values) : [k.value]).map(text).filter((v): v is string => v !== null);
    const existing = result.find((r) => r.typeId === typeId);
    if (existing) existing.values.push(...values);
    else result.push({ typeId, values });
  }
  return result;
};

const isNumericId = (ref: string) => /^\d+$/.test(ref);

export class OnBaseClient {
  readonly connection: OnBaseConnection;
  private readonly keywordNames = new Map<number, string>();

  constructor(private readonly context: ProviderContext) {
    this.connection = onbaseConnectionSchema.parse(context.integration.connection);
  }

  get coreUrl() {
    return `${this.connection.apiServerUrl}${this.connection.coreApiPath}`;
  }

  private async call(method: 'GET' | 'POST', path: string, signal: AbortSignal, body?: unknown, query?: [string, string][]) {
    const qs = query?.length ? `?${query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
    const res = await this.context.http.request({
      url: `${this.coreUrl}${path}${qs}`,
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      auth: this.context.auth,
      timeoutMs: this.connection.timeoutMs,
      retry: { maxRetries: this.connection.maxRetries },
    });
    if (!res.body) return {};
    try {
      return JSON.parse(res.body) as unknown;
    } catch {
      throw new IntegrationError('RESPONSE_INVALID', `OnBase returned a non-JSON response for ${path}. Check the API Server URL and core API path.`);
    }
  }

  /** Document type ids from ids or system names. */
  async resolveDocumentTypes(refs: string[], signal: AbortSignal): Promise<{ id: number; name: string }[]> {
    const out: { id: number; name: string }[] = [];
    for (const ref of refs) {
      const json = await this.call('GET', '/document-types', signal, undefined, [[isNumericId(ref) ? 'id' : 'systemName', ref]]);
      const item = itemsOf(json)[0] as Json | undefined;
      if (!item || item.id === undefined) throw IntegrationError.config(`OnBase document type "${ref}" was not found`);
      out.push({ id: Number(item.id), name: text(item.name ?? item.systemName) ?? ref });
    }
    return out;
  }

  /** Keyword type id from an id or system name (cached with its display name). */
  async resolveKeywordType(ref: string, signal: AbortSignal): Promise<{ id: number; name: string }> {
    const json = await this.call('GET', '/keyword-types', signal, undefined, [[isNumericId(ref) ? 'id' : 'systemName', ref]]);
    const item = itemsOf(json)[0] as Json | undefined;
    if (!item || item.id === undefined) throw IntegrationError.config(`OnBase keyword type "${ref}" was not found`);
    const resolved = { id: Number(item.id), name: text(item.name ?? item.systemName) ?? ref };
    this.keywordNames.set(resolved.id, resolved.name);
    return resolved;
  }

  /** Display names of keyword type ids (one lookup for the ids not cached yet). */
  async keywordTypeNames(ids: number[], signal: AbortSignal): Promise<Map<number, string>> {
    const unknown = [...new Set(ids)].filter((id) => !this.keywordNames.has(id));
    if (unknown.length > 0) {
      const json = await this.call('GET', '/keyword-types', signal, undefined, unknown.map((id) => ['id', String(id)]));
      for (const raw of itemsOf(json)) {
        const item = (raw ?? {}) as Json;
        if (item.id !== undefined) this.keywordNames.set(Number(item.id), text(item.name ?? item.systemName) ?? String(item.id));
      }
      for (const id of unknown) if (!this.keywordNames.has(id)) this.keywordNames.set(id, `Keyword_${id}`);
    }
    return this.keywordNames;
  }

  /** Runs a document query for one document-date window (dates inclusive, YYYY-MM-DD). */
  async query(
    params: { documentTypeIds: number[]; keywords: KeywordFilter[]; start: string | null; end: string | null; maxResults: number },
    signal: AbortSignal,
  ): Promise<OnBaseResultItem[]> {
    const created = (await this.call('POST', '/documents/queries', signal, {
      queryType: [{ type: 'DocumentType', ids: params.documentTypeIds }],
      queryKeywordCollection: params.keywords.map((k) => ({ typeId: k.typeId, value: k.value, operator: k.operator, relation: 'And' })),
      userDisplayColumns: [{ displayColumnType: 'DocumentName' }, { displayColumnType: 'DocumentDate' }],
      documentDateRangeCollection: params.start || params.end ? [{ ...(params.start ? { start: params.start } : {}), ...(params.end ? { end: params.end } : {}) }] : [],
      maxResults: params.maxResults,
    })) as Json;
    const queryId = text(created.id ?? created.queryId);
    if (!queryId) throw new IntegrationError('RESPONSE_INVALID', 'OnBase did not return a query id');
    const results = await this.call('GET', `/documents/queries/${encodeURIComponent(queryId)}/results`, signal);
    return itemsOf(results).map(normaliseResultItem).filter((i): i is OnBaseResultItem => i !== null);
  }

  async keywords(documentId: string, signal: AbortSignal): Promise<OnBaseKeyword[]> {
    return normaliseKeywords(await this.call('GET', `/documents/${encodeURIComponent(documentId)}/keywords`, signal));
  }

  async content(documentId: string, signal: AbortSignal): Promise<{ content: Buffer; mimeType: string }> {
    const res = await this.context.http.request({
      url: `${this.coreUrl}/documents/${encodeURIComponent(documentId)}/revisions/latest/renditions/default/content`,
      headers: { Accept: '*/*' },
      signal,
      auth: this.context.auth,
      timeoutMs: Math.max(this.connection.timeoutMs, 60_000),
      retry: { maxRetries: this.connection.maxRetries },
      acceptStatuses: [206],
      binary: true,
      maxBytes: this.connection.maxDocumentMb * 1024 * 1024,
    });
    const content = res.buffer ?? Buffer.alloc(0);
    if (content.length === 0) throw new IntegrationError('RESPONSE_INVALID', `OnBase returned an empty file for document ${documentId}`);
    const declared = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const sniffed = content.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : null;
    return { content, mimeType: sniffed ?? (declared || 'application/octet-stream') };
  }
}
