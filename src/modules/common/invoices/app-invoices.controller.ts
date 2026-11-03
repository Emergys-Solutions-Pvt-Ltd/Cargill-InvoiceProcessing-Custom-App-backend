import { Router } from 'express';
import { parse } from '../../../core/http/validate.js';
import type { AppModule } from '../apps/apps.models.js';
import { toInvoiceListItem } from './invoices.mapper.js';
import { invoiceListQuery } from './invoices.schemas.js';
import { bulkCreateSchemaFor, createInvoices, createSchemaFor, listAppInvoices } from './invoices.service.js';

// REST controller - mounted at /api/apps/:appId/invoices (requireAppAccess has resolved res.locals.appModule)
const router = Router();

/** GET /api/apps/:appId/invoices?search=&status=&page=&limit= */
router.get('/', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const { rows, ...meta } = await listAppInvoices(appModule, parse(invoiceListQuery, req.query));
  res.json({ data: rows.map(toInvoiceListItem), ...meta });
});

/** POST /api/apps/:appId/invoices/bulk  { invoices: [...] } */
router.post('/bulk', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const { invoices } = parse(bulkCreateSchemaFor(appModule), req.body);
  const created = await createInvoices(appModule, invoices, req.user!.id);
  res.status(201).json({
    message: 'Bulk invoices created successfully',
    count: created.length,
    data: created,
  });
});

/** POST /api/apps/:appId/invoices - "Create Invoice" modal */
router.post('/', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const input = parse(createSchemaFor(appModule), req.body);
  const [created] = await createInvoices(appModule, [input], req.user!.id);
  res.status(201).json({ message: 'Invoice created successfully', data: { id: created } });
});

export default router;
