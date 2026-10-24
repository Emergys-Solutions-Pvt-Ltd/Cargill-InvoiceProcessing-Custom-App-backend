import { z } from 'zod';
import type { IntegrationRecord, ProfileRecord } from '../sync/ports.js';
import type { AuthStrategyRegistry } from './auth/auth-strategy.js';
import type { IntegrationConfig, IntegrationProvider, ProfileConfig } from './contracts.js';
import { IntegrationError } from './errors.js';
import {
  cancellationRuleSchema,
  fieldMappingSchema,
  invoiceCodeTemplateSchema,
  keyFieldsSchema,
  type FieldMapping,
} from './mapping/field-mapper.js';
import type { ProviderRegistry } from './provider-registry.js';
import { retryPolicySchema, scheduleSchema } from './schedule.js';
import { checkUrl, type UrlPolicyOptions } from './url-policy.js';

/**
 * Validation of an integration as a whole - used by the API before saving and by the
 * orchestrator before every run (settings may have been edited directly in the database, or a
 * provider may have become stricter). Problems are returned as field paths, e.g.
 * "connection.baseUrl" or "profiles.0.fieldMapping.cuit", so the UI can show them in place.
 */
export type FieldProblems = Record<string, string[]>;

export interface ConfigDependencies {
  providers: ProviderRegistry;
  authStrategies: AuthStrategyRegistry;
  urlPolicy: UrlPolicyOptions;
}

const add = (problems: FieldProblems, path: string, message: string) => {
  (problems[path] ??= []).push(message);
};

const collect = <T>(problems: FieldProblems, prefix: string, schema: z.ZodType<T>, value: unknown): T | undefined => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) add(problems, [prefix, ...issue.path.map(String)].filter(Boolean).join('.'), issue.message);
  return undefined;
};

export interface ValidatedProfile {
  settings: Record<string, unknown>;
  keyFields: string[];
  invoiceCodeTemplate: string;
  fieldMapping: FieldMapping;
  cancellationRule: z.infer<typeof cancellationRuleSchema> | null;
}

export const validateProfileParts = (
  provider: IntegrationProvider,
  profile: { settings: unknown; keyFields: unknown; invoiceCodeTemplate: unknown; fieldMapping: unknown; cancellationRule: unknown },
  prefix: string,
  problems: FieldProblems,
): ValidatedProfile | undefined => {
  const settings = collect(problems, `${prefix}.settings`, provider.profileSettingsSchema, profile.settings);
  const keyFields = collect(problems, `${prefix}.keyFields`, keyFieldsSchema, profile.keyFields);
  const invoiceCodeTemplate = collect(problems, `${prefix}.invoiceCodeTemplate`, invoiceCodeTemplateSchema, profile.invoiceCodeTemplate);
  const fieldMapping = collect(problems, `${prefix}.fieldMapping`, fieldMappingSchema, profile.fieldMapping);
  const cancellationRule =
    profile.cancellationRule === null || profile.cancellationRule === undefined
      ? null
      : collect(problems, `${prefix}.cancellationRule`, cancellationRuleSchema, profile.cancellationRule);
  if (!settings || !keyFields || !invoiceCodeTemplate || !fieldMapping || cancellationRule === undefined) return undefined;
  return { settings, keyFields, invoiceCodeTemplate, fieldMapping: fieldMapping as FieldMapping, cancellationRule };
};

export const validateConnectionParts = (
  deps: ConfigDependencies,
  provider: IntegrationProvider,
  input: { connection: unknown; authType: string; authSettings: unknown },
  problems: FieldProblems,
) => {
  const connection = collect(problems, 'connection', provider.connectionSchema, input.connection);
  if (connection) {
    for (const url of provider.connectionUrls(connection)) {
      const problem = checkUrl(url, deps.urlPolicy);
      if (problem) add(problems, 'connection.baseUrl', `URL ${problem}`);
    }
  }
  let authSettings: Record<string, unknown> | undefined;
  if (!provider.supportedAuthTypes.includes(input.authType)) {
    add(problems, 'authType', `${provider.displayName} does not support authentication method '${input.authType}'`);
  } else {
    const factory = deps.authStrategies.require(input.authType);
    authSettings = collect(problems, 'authSettings', factory.settingsSchema, input.authSettings) as Record<string, unknown> | undefined;
    if (authSettings) {
      for (const url of factory.urlsOf(authSettings)) {
        const problem = checkUrl(url, deps.urlPolicy);
        if (problem) add(problems, 'authSettings.tokenUrl', `URL ${problem}`);
      }
    }
  }
  return { connection, authSettings };
};

const toProfileConfig = (record: ProfileRecord, parts: ValidatedProfile): ProfileConfig => ({
  id: record.id,
  name: record.name,
  isActive: record.isActive,
  moduleId: record.moduleId,
  moduleSlug: record.moduleSlug,
  invoicePrefix: record.invoicePrefix,
  settings: parts.settings,
  keyFields: parts.keyFields,
  invoiceCodeTemplate: parts.invoiceCodeTemplate,
  fieldMapping: parts.fieldMapping,
  cancellationRule: parts.cancellationRule,
  defaultStatus: record.defaultStatus,
  initialFrom: record.initialFrom,
  watermark: record.watermark,
});

/** Validates a stored integration; throws IntegrationError('CONFIG_INVALID') listing every problem. */
export const resolveIntegrationConfig = (record: IntegrationRecord, deps: ConfigDependencies): IntegrationConfig => {
  const provider = deps.providers.get(record.providerType);
  if (!provider) throw IntegrationError.config(`No provider is installed for type '${record.providerType}'`);

  const problems: FieldProblems = {};
  const { connection, authSettings } = validateConnectionParts(deps, provider, record, problems);
  const schedule = collect(problems, 'schedule', scheduleSchema, record.schedule);
  const retryPolicy = collect(problems, 'retryPolicy', retryPolicySchema, record.retryPolicy);
  const profiles: ProfileConfig[] = [];
  record.profiles.forEach((p, i) => {
    const parts = validateProfileParts(provider, p, `profiles.${i}`, problems);
    if (parts) profiles.push(toProfileConfig(p, parts));
  });

  const entries = Object.entries(problems);
  if (entries.length > 0 || !connection || !authSettings || !schedule || !retryPolicy) {
    const summary = entries.slice(0, 5).map(([path, msgs]) => `${path}: ${msgs[0]}`).join('; ');
    throw IntegrationError.config(`The integration configuration is invalid (${summary || 'unknown problem'})`);
  }

  return {
    id: record.id,
    providerType: record.providerType,
    name: record.name,
    sourceSystem: record.sourceSystem,
    isActive: record.isActive,
    connection,
    authType: record.authType,
    authSettings,
    schedule,
    autoSyncEnabled: record.autoSyncEnabled,
    retryPolicy,
    profiles,
  };
};
