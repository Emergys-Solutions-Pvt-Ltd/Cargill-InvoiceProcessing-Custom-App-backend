import type { ConnectionTestResult, ConnectionTestStep, ConnectionTester, ProfileConfig, ProviderContext } from '../../core/contracts.js';
import { errorMessage } from '../../core/errors.js';
import { mapRecord } from '../../core/mapping/field-mapper.js';
import { OnBaseExtractor } from './onbase.adapter.js';
import { OnBaseClient } from './onbase.client.js';
import { onbaseProfileSettingsSchema } from './onbase.schemas.js';

/**
 * "Test connection" for OnBase: Hyland IdP sign-in -> per profile, document types and keyword
 * filters exist -> a sample document from the configured window with its keywords (the keyword
 * names are returned so the field mapping can be completed) -> mapping of that sample ->
 * download of its file. Nothing is written.
 */
export class OnBaseConnectionTester implements ConnectionTester {
  private readonly client: OnBaseClient;

  constructor(private readonly context: ProviderContext) {
    this.client = new OnBaseClient(context);
  }

  async test(profiles: ProfileConfig[], signal: AbortSignal): Promise<ConnectionTestResult> {
    const steps: ConnectionTestStep[] = [];
    const details: Record<string, unknown> = { sampleKeywords: {} as Record<string, Record<string, string>> };
    const step = async <T>(name: string, run: () => Promise<{ message: string; value?: T }>): Promise<T | undefined> => {
      const started = Date.now();
      try {
        const { message, value } = await run();
        steps.push({ name, ok: true, message, durationMs: Date.now() - started });
        return value;
      } catch (err) {
        steps.push({ name, ok: false, message: errorMessage(err), durationMs: Date.now() - started });
        return undefined;
      }
    };

    const signedIn = await step('Hyland IdP sign-in', async () => {
      await this.context.auth.authorize(new Headers(), signal);
      return { message: this.context.auth.type === 'none' ? 'No credentials configured' : 'Access token issued', value: true };
    });
    if (!signedIn) return { ok: false, steps, details };

    for (const profile of profiles.filter((p) => p.isActive)) {
      const settings = onbaseProfileSettingsSchema.parse(profile.settings);
      const types = await step(`${profile.name}: document types and keyword filters`, async () => {
        const resolved = await this.client.resolveDocumentTypes(settings.documentTypes, signal);
        for (const f of settings.keywordFilters) await this.client.resolveKeywordType(f.keyword, signal);
        return {
          message: `${resolved.map((t) => `${t.name} (${t.id})`).join(', ')}${settings.keywordFilters.length ? `; ${settings.keywordFilters.length} keyword filter(s) valid` : ''}`,
          value: resolved,
        };
      });
      if (!types) continue;

      const sample = await step(`${profile.name}: sample document`, async () => {
        const extractor = new OnBaseExtractor(this.context, this.client);
        const probe = { ...profile, settings: { ...settings, pageSize: 1 } };
        for await (const page of extractor.extract({ profile: probe, since: profile.watermark ?? profile.initialFrom, signal })) {
          const record = page.records[0];
          if (record) {
            (details.sampleKeywords as Record<string, unknown>)[profile.name] = record.keywords;
            return { message: `Document ${record.documentId} "${record.documentName ?? ''}" with ${Object.keys(record.keywords as object).length} keyword(s)`, value: record };
          }
        }
        return { message: `Query succeeded; no documents in the last ${settings.lookbackDays} day(s) match the filters` };
      });
      if (!sample) continue;

      await step(`${profile.name}: field mapping`, async () => {
        const result = mapRecord(sample, profile, new OnBaseExtractor(this.context, this.client).changedAt(sample));
        if (!result.ok) throw new Error(`${result.message}. Available keywords: ${Object.keys(sample.keywords as object).map((k) => `keywords/${k}`).join(', ') || 'none'}`);
        return { message: `Maps to invoice ${result.invoice.invoiceCode} (${result.invoice.vendorName}, ${result.invoice.amount})` };
      });

      if (settings.attachDocuments) {
        await step(`${profile.name}: document file`, async () => {
          const file = await this.client.content(String(sample.documentId), signal);
          return { message: `${file.mimeType}, ${Math.max(1, Math.round(file.content.length / 1024))} KB` };
        });
      }
    }
    return { ok: steps.every((s) => s.ok), steps, details };
  }
}
