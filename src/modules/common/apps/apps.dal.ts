import { callFunction } from '../../../core/db/procedures.js';
import { type Application, type AppModule, type AppSchema } from './apps.models.js';

// app.udt_application_result / app.udt_app_module_result
interface ApplicationResult {
  code: string;
  name: string;
  description: string | null;
}

interface AppModuleResult {
  module_id: number;
  slug: string;
  name: string;
  invoice_prefix: string;
  application_id: number;
  application_code: string;
  db_schema: AppSchema;
}

/** All active applications, or only `codes` when given (non-admin users). */
export const listApplications = async (codes?: string[]): Promise<Application[]> => {
  const rows = await callFunction<ApplicationResult>('usp_application_list', {
    p_codes: codes ?? [],
    p_filter_by_codes: codes !== undefined,
  });
  return rows.map((a) => ({ id: a.code, name: a.name, description: a.description }));
};

export const findModuleBySlug = async (slug: string): Promise<AppModule | null> => {
  if (!slug) return null;
  const [row] = await callFunction<AppModuleResult>('usp_app_module_get_by_slug', { p_slug: slug });
  return row
    ? {
        moduleId: row.module_id,
        slug: row.slug,
        name: row.name,
        invoicePrefix: row.invoice_prefix,
        applicationId: row.application_id,
        applicationCode: row.application_code,
        appSchema: row.db_schema,
      }
    : null;
};
