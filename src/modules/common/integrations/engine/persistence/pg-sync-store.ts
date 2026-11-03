import { callFunction, callFunctionSingle } from '../../../../../core/db/procedures.js';
import {
  QueueConflictError,
  type EnqueueRequest,
  type IntegrationRecord,
  type JobQueue,
  type JobRecord,
  type JobStatus,
  type PageApplyInput,
  type RowOutcome,
  type SyncErrorInput,
  type SyncStore,
} from '../sync/ports.js';
import { toIntegrationRecord, toJobRecord, type IntegrationRow, type JobRow } from './row-mappers.js';

/** PostgreSQL implementation of the sync ports (app.usp_integration_* / app.usp_sync_* functions). */

/** CA409 from a function = business conflict (e.g. one active job per integration). */
const asConflict = (err: unknown): never => {
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'CA409') {
    throw new QueueConflictError((err as Error).message);
  }
  throw err;
};

const errorsJson = (errors: SyncErrorInput[]) =>
  JSON.stringify(errors.map((e) => ({ external_key: e.externalKey, stage: e.stage, message: e.message, details: e.details ?? null })));

export class PgSyncStore implements SyncStore {
  async loadIntegration(integrationId: number): Promise<IntegrationRecord | null> {
    const [row] = await callFunction<IntegrationRow>('usp_integration_get', { p_integration_id: integrationId });
    return row ? toIntegrationRecord(row) : null;
  }

  async loadSecret(integrationId: number): Promise<string | null> {
    const [row] = await callFunction<{ secret_ciphertext: string | null }>('usp_integration_get_secret', { p_integration_id: integrationId });
    return row?.secret_ciphertext ?? null;
  }

  async applyPage(input: PageApplyInput): Promise<RowOutcome[]> {
    const rows = input.rows.map(({ rowNo, invoice: i, payloadHash }) => ({
      row_no: rowNo,
      external_key: i.externalKey,
      external_doc: i.externalDoc,
      invoice_code: i.invoiceCode,
      vendor_name: i.vendorName,
      cuit: i.cuit,
      invoice_1a: i.invoice1a,
      invoice_2a: i.invoice2a,
      first_invoice_number: i.firstInvoiceNumber,
      second_invoice_number: i.secondInvoiceNumber,
      invoice_date: i.invoiceDate,
      reception_date: i.receptionDate,
      currency_code: i.currencyCode,
      amount: i.amount,
      invoice_subtotal: i.invoiceSubtotal,
      invoice_subtotal_with_tax: i.invoiceSubtotalWithTax,
      credit_note: i.creditNote,
      source_changed_at: i.sourceChangedAt,
      payload_hash: payloadHash,
      cancelled: i.cancelled,
    }));
    const result = await callFunction<{ row_no: number; external_key: string; outcome: RowOutcome['outcome']; invoice_code: string | null; message: string | null }>(
      'usp_sync_page_apply',
      {
        p_job_id: input.jobId,
        p_worker_id: input.workerId,
        p_profile_id: input.profileId,
        p_fetched: input.fetched,
        p_rows: JSON.stringify(rows),
        p_rejects: errorsJson(input.rejects),
        p_watermark: input.watermark,
      },
    ).catch(asConflict);
    return result.map((r) => ({ rowNo: r.row_no, externalKey: r.external_key, outcome: r.outcome, invoiceCode: r.invoice_code, message: r.message }));
  }

  async addErrors(jobId: number, profileId: number | null, errors: SyncErrorInput[]) {
    if (errors.length === 0) return;
    await callFunction('usp_sync_error_add', { p_job_id: jobId, p_profile_id: profileId, p_errors: errorsJson(errors) });
  }
}

export class PgJobQueue implements JobQueue {
  async enqueue(request: EnqueueRequest): Promise<JobRecord> {
    const row = await callFunctionSingle<JobRow>('usp_sync_job_enqueue', {
      p_integration_id: request.integrationId,
      p_trigger_type: request.trigger,
      p_requested_by: request.requestedBy,
      p_retry_of_job_id: request.retryOfJobId ?? null,
      p_attempt: request.attempt ?? 1,
      p_run_after: request.runAfter ?? null,
    }).catch(asConflict);
    return toJobRecord(row);
  }

  async claim(workerId: string): Promise<JobRecord | null> {
    const [row] = await callFunction<JobRow>('usp_sync_job_claim', { p_worker_id: workerId });
    return row ? toJobRecord(row) : null;
  }

  async heartbeat(jobId: number, workerId: string): Promise<JobRecord> {
    return toJobRecord(await callFunctionSingle<JobRow>('usp_sync_job_heartbeat', { p_job_id: jobId, p_worker_id: workerId }).catch(asConflict));
  }

  async finish(jobId: number, workerId: string, status: JobStatus, summary: string | null): Promise<JobRecord> {
    return toJobRecord(
      await callFunctionSingle<JobRow>('usp_sync_job_finish', {
        p_job_id: jobId, p_worker_id: workerId, p_status: status, p_error_summary: summary,
      }).catch(asConflict),
    );
  }

  async release(jobId: number, workerId: string): Promise<boolean> {
    const row = await callFunctionSingle<{ rows_affected: number }>('usp_sync_job_release', { p_job_id: jobId, p_worker_id: workerId });
    return row.rows_affected > 0;
  }

  async recoverStale(staleSeconds: number): Promise<JobRecord[]> {
    return (await callFunction<JobRow>('usp_sync_job_recover_stale', { p_stale_seconds: staleSeconds })).map(toJobRecord);
  }

  async dueIntegrations(limit: number): Promise<IntegrationRecord[]> {
    return (await callFunction<IntegrationRow>('usp_integration_due_list', { p_limit: limit })).map(toIntegrationRecord);
  }

  async setNextRun(integrationId: number, nextRunAt: Date | null) {
    await callFunction('usp_integration_set_next_run', { p_integration_id: integrationId, p_next_run_at: nextRunAt });
  }

  async purgeHistory(keepDays: number): Promise<number> {
    return (await callFunctionSingle<{ rows_affected: number }>('usp_integration_purge_history', { p_keep_days: keepDays })).rows_affected;
  }
}
