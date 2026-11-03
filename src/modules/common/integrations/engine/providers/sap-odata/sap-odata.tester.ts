import type { ConnectionTestResult, ConnectionTestStep, ConnectionTester, ProfileConfig, ProviderContext } from '../../core/contracts.js';
import { errorMessage } from '../../core/errors.js';
import { mapRecord } from '../../core/mapping/field-mapper.js';
import { SapODataClient, SapODataExtractor, parsePage } from './sap-odata.adapter.js';
import { missingFields, parseMetadata, type ServiceMetadata } from './odata-metadata.js';
import { sapProfileSettingsSchema } from './sap-odata.schemas.js';

/**
 * "Test connection": authentication -> service $metadata -> per profile, entity set + referenced
 * fields exist -> one-record probe with the real filters -> mapping of that record.
 * Every step is reported; nothing is written to the database.
 */
export class SapODataConnectionTester implements ConnectionTester {
  private readonly client: SapODataClient;
  private readonly extractor: SapODataExtractor;

  constructor(private readonly context: ProviderContext) {
    this.client = new SapODataClient(context);
    this.extractor = new SapODataExtractor(context);
  }

  async test(profiles: ProfileConfig[], signal: AbortSignal): Promise<ConnectionTestResult> {
    const steps: ConnectionTestStep[] = [];
    const details: Record<string, unknown> = {};
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

    const authenticated = await step('Authentication', async () => {
      const headers = new Headers();
      await this.context.auth.authorize(headers, signal);
      return { message: this.context.auth.type === 'none' ? 'No credentials configured' : 'Credentials accepted', value: true };
    });
    if (!authenticated) return { ok: false, steps, details };

    const metadata = await step<ServiceMetadata>('Service metadata', async () => {
      const res = await this.client.get(this.metadataUrl(), signal, 'application/xml');
      const parsed = parseMetadata(res.body);
      if (parsed.entitySets.size === 0) throw new Error('The $metadata document lists no entity sets. Check the service path.');
      details.entitySets = [...parsed.entitySets.keys()].sort();
      return { message: `Service reachable; ${parsed.entitySets.size} entity set(s) available`, value: parsed };
    });

    for (const profile of profiles.filter((p) => p.isActive)) {
      const settings = sapProfileSettingsSchema.parse(profile.settings);
      if (metadata) {
        await step(`${profile.name}: entity set and fields`, async () => {
          const referenced = [
            ...profile.keyFields,
            ...Object.values(profile.fieldMapping).flatMap((r) => (r?.path ? [r.path] : [])),
            ...(settings.incrementalField ? [settings.incrementalField] : []),
            ...(profile.cancellationRule ? [profile.cancellationRule.field] : []),
            ...settings.filters.map((f) => f.field),
            ...(settings.select ? settings.select.split(',').map((s) => s.trim()) : []),
          ];
          const missing = missingFields(metadata, settings.entitySet, referenced);
          if (missing === null) throw new Error(`Entity set ${settings.entitySet} does not exist in this service`);
          (details.missingFields as Record<string, string[]> | undefined) ?? (details.missingFields = {});
          (details.missingFields as Record<string, string[]>)[profile.name] = missing;
          if (missing.length > 0) throw new Error(`Not found in ${settings.entitySet}: ${missing.join(', ')}`);
          return { message: `${settings.entitySet} found; all ${new Set(referenced).size} referenced fields exist` };
        });
      }

      await step(`${profile.name}: sample record`, async () => {
        const url = this.client.buildUrl(settings, profile.keyFields, profile.watermark ?? profile.initialFrom, 1);
        const res = await this.client.get(url, signal);
        const page = parsePage(res.body, this.client.connection.odataVersion);
        if (page.records.length === 0) return { message: 'Query succeeded; no records match the current filters' };
        const result = mapRecord(page.records[0], profile, this.extractor.changedAt(page.records[0], profile));
        if (!result.ok) throw new Error(`Query succeeded but the sample record does not map: ${result.message}`);
        return { message: `Query succeeded; sample ${result.invoice.externalKey} maps to invoice ${result.invoice.invoiceCode}` };
      });
    }

    return { ok: steps.every((s) => s.ok), steps, details };
  }

  private metadataUrl() {
    const extra = this.client.extraParams();
    const query = new URLSearchParams(extra).toString();
    return `${this.client.serviceRoot}/$metadata${query ? `?${query}` : ''}`;
  }
}
