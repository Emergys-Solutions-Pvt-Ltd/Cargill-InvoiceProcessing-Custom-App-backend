import { Router } from 'express';
import { getLookups } from './lookups.repository.js';

// Dropdown sources for the Create / Bulk invoice modals and filters
const router = Router();

/** GET /api/lookups -> { vendors, stations, statuses, teams } */
router.get('/', async (_req, res) => {
  res.json(await getLookups());
});

export default router;
