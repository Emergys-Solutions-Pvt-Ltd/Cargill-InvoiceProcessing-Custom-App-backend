import type {
  DocumentFetcher,
  ExtractedPage,
  ExtractionRequest,
  InvoiceExtractor,
  ProfileConfig,
  ProviderContext,
  SourceDocument,
  SourceRecord,
} from '../../core/contracts.js';
import { IntegrationError } from '../../core/errors.js';
import { OnBaseClient, type KeywordFilter, type OnBaseResultItem } from './onbase.client.js';
import { keywordKey, onbaseProfileSettingsSchema, type OnBaseProfileSettings } from './onbase.schemas.js';

/**
 * OnBase extraction: invoice documents of the configured Document Types (optionally restricted
 * by keyword values) become source records:
 *   { documentId, documentName, documentDate, documentTypeId, documentTypeName,
 *     keywords: { Invoice_Number: '...', Vendor_Name: '...', ... },   // by keyword name
 *     keywordsById: { '105': '...' } }
 * so the field mapping uses paths like keywords/Invoice_Number.
 *
 * Incremental by document date: date windows from the cursor (minus the overlap) up to today,
 * read in ascending order; a window that returns maxResults documents is split (down to one day),
 * so a query limit never silently drops documents.
 */
const DAY_MS = 86_400_000;

const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Runs `fn` over items with at most `limit` in flight, keeping order. */
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

export class OnBaseExtractor implements InvoiceExtractor {
  private readonly client: OnBaseClient;

  constructor(context: ProviderContext, client?: OnBaseClient) {
    this.client = client ?? new OnBaseClient(context);
  }

  isIncremental(profile: ProfileConfig) {
    return onbaseProfileSettingsSchema.parse(profile.settings).incremental;
  }

  changedAt(record: SourceRecord): Date | null {
    const value = record.documentDate;
    if (typeof value !== 'string') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async *extract(request: ExtractionRequest): AsyncIterable<ExtractedPage> {
    const settings = onbaseProfileSettingsSchema.parse(request.profile.settings);
    const { signal } = request;
    const documentTypes = await this.client.resolveDocumentTypes(settings.documentTypes, signal);
    const typeNames = new Map(documentTypes.map((t) => [t.id, t.name]));
    const keywords: KeywordFilter[] = [];
    for (const f of settings.keywordFilters) {
      const type = await this.client.resolveKeywordType(f.keyword, signal);
      keywords.push({ typeId: type.id, value: f.value, operator: f.operator });
    }

    const today = dayStart(new Date());
    const from =
      settings.incremental && request.since
        ? dayStart(new Date(request.since.getTime() - settings.overlapDays * DAY_MS))
        : dayStart(new Date(today.getTime() - settings.lookbackDays * DAY_MS));

    let pageNumber = 0;
    for (let start = from; start <= today; start = new Date(start.getTime() + settings.windowDays * DAY_MS)) {
      const end = new Date(Math.min(start.getTime() + (settings.windowDays - 1) * DAY_MS, today.getTime()));
      const items = await this.window(documentTypes.map((t) => t.id), keywords, start, end, signal);
      items.sort((a, b) => (a.documentDate ?? '').localeCompare(b.documentDate ?? '') || a.id.localeCompare(b.id, undefined, { numeric: true }));

      for (let i = 0; i < items.length; i += settings.pageSize) {
        if (signal.aborted) throw IntegrationError.cancelled();
        const chunk = items.slice(i, i + settings.pageSize);
        const records = await this.toRecords(chunk, typeNames, signal);
        yield { pageNumber: ++pageNumber, records };
      }
    }
  }

  /** Documents of one date window; splits windows that reach maxResults. */
  private async window(typeIds: number[], keywords: KeywordFilter[], start: Date, end: Date, signal: AbortSignal): Promise<OnBaseResultItem[]> {
    const maxResults = this.client.connection.maxResults;
    const items = await this.client.query({ documentTypeIds: typeIds, keywords, start: ymd(start), end: ymd(end), maxResults }, signal);
    if (items.length < maxResults) return items;
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    if (days <= 1) {
      throw new IntegrationError(
        'RESPONSE_INVALID',
        `More than ${maxResults} OnBase documents dated ${ymd(start)}: raise "Max. results per query" or add keyword filters`,
      );
    }
    const midEnd = new Date(start.getTime() + (Math.floor(days / 2) - 1) * DAY_MS);
    const left = await this.window(typeIds, keywords, start, midEnd, signal);
    const right = await this.window(typeIds, keywords, new Date(midEnd.getTime() + DAY_MS), end, signal);
    return [...left, ...right];
  }

  private async toRecords(items: OnBaseResultItem[], typeNames: Map<number, string>, signal: AbortSignal): Promise<SourceRecord[]> {
    const keywordLists = await mapLimit(items, this.client.connection.keywordConcurrency, (item) => this.client.keywords(item.id, signal));
    const names = await this.client.keywordTypeNames(keywordLists.flat().map((k) => k.typeId), signal);
    return items.map((item, i) => {
      const byName: Record<string, string> = {};
      const byId: Record<string, string> = {};
      for (const k of keywordLists[i]) {
        const value = k.values[0];
        if (value === undefined) continue;
        byId[String(k.typeId)] = value;
        byName[keywordKey(names.get(k.typeId) ?? `Keyword_${k.typeId}`)] ??= value;
      }
      return {
        documentId: item.id,
        documentName: item.name,
        documentDate: item.documentDate,
        documentTypeId: item.typeId,
        documentTypeName: item.typeId !== null ? (typeNames.get(item.typeId) ?? null) : null,
        keywords: byName,
        keywordsById: byId,
      };
    });
  }
}

const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 150) || 'document';

const EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/tiff': '.tif', 'image/png': '.png', 'image/jpeg': '.jpg' };

export class OnBaseDocumentFetcher implements DocumentFetcher {
  private readonly client: OnBaseClient;

  constructor(context: ProviderContext, client?: OnBaseClient) {
    this.client = client ?? new OnBaseClient(context);
  }

  isEnabled(profile: ProfileConfig) {
    const settings: OnBaseProfileSettings = onbaseProfileSettingsSchema.parse(profile.settings);
    return settings.attachDocuments;
  }

  async fetch(record: SourceRecord, _profile: ProfileConfig, signal: AbortSignal): Promise<SourceDocument> {
    const id = String(record.documentId);
    const { content, mimeType } = await this.client.content(id, signal);
    const base = safeFileName(String(record.documentName ?? `OnBase-${id}`));
    const ext = EXT[mimeType] ?? '';
    return {
      fileName: base.toLowerCase().endsWith(ext) || !ext ? base : `${base}${ext}`,
      mimeType,
      content,
      title: `OnBase document ${id}`,
    };
  }
}
