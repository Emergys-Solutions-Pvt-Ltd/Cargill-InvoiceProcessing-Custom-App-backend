import { Router } from 'express';
import { getInvoiceLookups } from './lookups.service.js';

// REST controller - mounted at /api/lookups: dropdown sources for the Create / Bulk invoice modals and filters
const router = Router();

/** GET /api/lookups -> { vendors, stations, statuses, teams } */
router.get('/', async (_req, res) => {
  res.json(await getInvoiceLookups());
});

export default router;
