import { Router } from 'express';
import { HttpError } from '../../../core/http/http-error.js';
import type { AppModule } from '../../common/apps/apps.models.js';
import { parse } from '../../../core/http/validate.js';
import { loadInvoice } from '../../common/invoices/invoices.controller.js';
import { toCcppDetail, toCcppListItem } from './ccpp.mapper.js';
import type { CcppInput } from './ccpp.models.js';
import { ccppBody, ccppIdParam } from './ccpp.schemas.js';
import { addInvoiceCcpp, getInvoiceCcpp, listInvoiceCcpps, updateInvoiceCcpp } from './ccpp.service.js';

// REST controller - GPP Invoice Detail "CCPP" tab, mounted at /api/apps/:appId/invoices after requireAppAccess
// (routes /:invoiceId/ccpp...). CCPP rows exist for GPP invoices only: other apps get 404.
const router = Router();

router.use('/:invoiceId/ccpp', (_req, res, next) => {
  if ((res.locals.appModule as AppModule).appSchema !== 'gpp') {
    throw HttpError.notFound('CCPP is only available for General Payments invoices');
  }
  next();
});

/** GET /api/apps/:appId/invoices/:invoiceId/ccpp - CCPP tab list (condensed columns) */
router.get('/:invoiceId/ccpp', async (req, res) => {
  const { invoice } = await loadInvoice(req, res);
  res.json((await listInvoiceCcpps(invoice.invoiceCode)).map(toCcppListItem));
});

/** GET /api/apps/:appId/invoices/:invoiceId/ccpp/:ccppId - CCPP tab row-expand detail (all fields) */
router.get('/:invoiceId/ccpp/:ccppId', async (req, res) => {
  const { invoice } = await loadInvoice(req, res);
  const { ccppId } = parse(ccppIdParam, req.params);
  res.json(toCcppDetail(await getInvoiceCcpp(invoice.invoiceCode, ccppId)));
});

/** POST /api/apps/:appId/invoices/:invoiceId/ccpp - CCPP tab "Add" */
router.post('/:invoiceId/ccpp', async (req, res) => {
  const { invoice } = await loadInvoice(req, res);
  const input = parse(ccppBody, req.body) as CcppInput;
  const ccpp = await addInvoiceCcpp(invoice.invoiceCode, req.user!.id, input);
  res.status(201).json({ message: 'CCPP entry added', data: toCcppDetail(ccpp) });
});

/** PUT /api/apps/:appId/invoices/:invoiceId/ccpp/:ccppId - CCPP tab "Edit" */
router.put('/:invoiceId/ccpp/:ccppId', async (req, res) => {
  const { invoice } = await loadInvoice(req, res);
  const { ccppId } = parse(ccppIdParam, req.params);
  const input = parse(ccppBody, req.body) as CcppInput;
  const ccpp = await updateInvoiceCcpp(invoice.invoiceCode, req.user!.id, ccppId, input);
  res.json({ message: 'CCPP entry updated', data: toCcppDetail(ccpp) });
});

export default router;
