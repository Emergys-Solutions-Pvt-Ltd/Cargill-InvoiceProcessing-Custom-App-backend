export interface Application {
  id: string;
  name: string;
  description: string | null;
}

export interface AppModule {
  moduleId: number;
  slug: string;
  name: string;
  invoicePrefix: string;
  applicationId: number;
  applicationCode: string;
  /** Schema of the app's own invoice tables and functions (gpp, sjo, rospbu). */
  appSchema: AppSchema;
}

/** Every app keeps its invoices in its own schema: gpp.gpp_invoices, sjo.sjo_invoices, rospbu.rospbu_invoices. */
export const APP_SCHEMAS = ['gpp', 'sjo', 'rospbu'] as const;
export type AppSchema = (typeof APP_SCHEMAS)[number];
