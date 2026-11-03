import { Router } from 'express';
import { parse } from '../../../core/http/validate.js';
import type { IntegrationService } from './integrations.service.js';
import {
  credentialsBody,
  errorListQuery,
  idParam,
  integrationBody,
  jobListQuery,
  jobParams,
  listQuery,
  profileParams,
  summaryQuery,
  testConnectionBody,
  updateBody,
} from './integrations.schemas.js';

/**
 * /api/integrations - Settings > SAP Configuration (mounted behind authenticate + requireAdmin).
 * Built by a factory so tests can mount it with a fake service.
 */
export interface MonitoringInfo {
  workerEnabled: boolean;
  workerId: string | null;
  metrics: Record<string, unknown>;
}

export const createIntegrationsRouter = (service: IntegrationService, monitoring: () => MonitoringInfo) => {
  const router = Router();

  /** GET /api/integrations/providers - providers, auth methods, mapping fields, templates, schedule presets */
  router.get('/providers', (_req, res) => {
    res.json(service.catalog());
  });

  /** GET /api/integrations/monitoring - background worker state and process counters */
  router.get('/monitoring', (_req, res) => {
    res.json(monitoring());
  });

  /** POST /api/integrations/test-connection - test unsaved settings (new integration form) */
  router.post('/test-connection', async (req, res) => {
    res.json(await service.testDraft(parse(integrationBody, req.body)));
  });

  /** GET /api/integrations?providerType=sap-odata */
  router.get('/', async (req, res) => {
    const { providerType } = parse(listQuery, req.query);
    res.json(await service.list(providerType));
  });

  /** POST /api/integrations - create (secret optional) */
  router.post('/', async (req, res) => {
    const data = await service.create(parse(integrationBody, req.body), req.user!.id);
    res.status(201).json({ message: `Integration '${data.name}' created`, data });
  });

  /** GET /api/integrations/:id */
  router.get('/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await service.get(id));
  });

  /** PUT /api/integrations/:id - full update incl. profiles; body.version must match (409 otherwise) */
  router.put('/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const data = await service.update(id, parse(updateBody, req.body), req.user!.id);
    res.json({ message: 'Integration saved', data });
  });

  /** DELETE /api/integrations/:id */
  router.delete('/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await service.remove(id, req.user!.id);
    res.json({ message: 'Integration deleted' });
  });

  /** PUT /api/integrations/:id/credentials - set / rotate secrets (write-only) */
  router.put('/:id/credentials', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { secret } = parse(credentialsBody, req.body);
    const data = await service.setCredentials(id, secret, req.user!.id);
    res.json({ message: 'Credentials saved', data });
  });

  /** POST /api/integrations/:id/test-connection - stored settings, optionally overridden by { draft } */
  router.post('/:id/test-connection', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { draft } = parse(testConnectionBody, req.body ?? {});
    res.json(await service.testConnection(id, draft, req.user!.id));
  });

  /** POST /api/integrations/:id/sync - manual synchronization (202; 409 when one is queued / running) */
  router.post('/:id/sync', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const data = await service.syncNow(id, req.user!.id);
    res.status(202).json({ message: 'Synchronization queued', data });
  });

  /** GET /api/integrations/:id/summary?days=30 - dashboard */
  router.get('/:id/summary', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { days } = parse(summaryQuery, req.query);
    res.json(await service.summary(id, days));
  });

  /** GET /api/integrations/:id/jobs?status=&trigger=&from=&to=&page=&limit= - history */
  router.get('/:id/jobs', async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await service.listJobs(id, parse(jobListQuery, req.query)));
  });

  /** GET /api/integrations/:id/jobs/:jobId */
  router.get('/:id/jobs/:jobId', async (req, res) => {
    const { id, jobId } = parse(jobParams, req.params);
    res.json(await service.getJob(id, jobId));
  });

  /** GET /api/integrations/:id/jobs/:jobId/errors?stage=&page=&limit= */
  router.get('/:id/jobs/:jobId/errors', async (req, res) => {
    const { id, jobId } = parse(jobParams, req.params);
    const { stage, page, limit } = parse(errorListQuery, req.query);
    res.json(await service.listJobErrors(id, jobId, stage, page, limit));
  });

  /** POST /api/integrations/:id/jobs/:jobId/retry */
  router.post('/:id/jobs/:jobId/retry', async (req, res) => {
    const { id, jobId } = parse(jobParams, req.params);
    const data = await service.retryJob(id, jobId, req.user!.id);
    res.status(202).json({ message: 'Retry queued', data });
  });

  /** POST /api/integrations/:id/jobs/:jobId/cancel */
  router.post('/:id/jobs/:jobId/cancel', async (req, res) => {
    const { id, jobId } = parse(jobParams, req.params);
    const data = await service.cancelJob(id, jobId, req.user!.id);
    res.json({ message: data.status === 'cancelled' ? 'Job cancelled' : 'Cancellation requested; the job stops after the current page', data });
  });

  /** POST /api/integrations/:id/profiles/:profileId/reset-cursor - full re-sync of a profile */
  router.post('/:id/profiles/:profileId/reset-cursor', async (req, res) => {
    const { id, profileId } = parse(profileParams, req.params);
    await service.resetCursor(id, profileId, req.user!.id);
    res.json({ message: 'Cursor reset: the next run re-reads this profile from its initial date' });
  });

  return router;
};
