import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../../auth/auth.middleware.js';
import { paginationQuery } from '../../../core/http/pagination.js';
import { parse } from '../../../core/http/validate.js';
import {
  createMasterDataItem,
  deactivateMasterDataItem,
  listMasterDataEntities,
  listMasterDataItems,
  listMasterDataOptions,
  updateMasterDataItem,
} from './master-data.service.js';
import { MASTER_DATA_ENTITIES, STATUS_COLORS } from './master-data.models.js';

// REST controller - mounted at /api/master-data - Settings > Configuration.
// Dropdown options are readable by any signed-in user; the lists and all changes are admin only.
const router = Router();

const entityParam = z.object({ entity: z.enum(MASTER_DATA_ENTITIES, { message: 'Unknown configuration list' }) });
const itemParams = entityParam.extend({ id: z.coerce.number().int().positive() });
const optionalId = z.coerce.number().int().positive().optional();

const listQuery = z.object({
  search: z.string().trim().default(''),
  parentId: optionalId,
  includeInactive: z.stringbool().default(true),
  ...paginationQuery,
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const itemBody = z.object({
  code: z.string().trim().max(30).nullable().optional(),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(500).nullable().optional(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
  color: z.enum(STATUS_COLORS).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
});

/** GET /api/master-data/entities - the Configuration lists (tabs) and their form rules */
router.get('/entities', async (_req, res) => {
  res.json(await listMasterDataEntities());
});

/** GET /api/master-data/:entity/options[?parentId=] - active items for dropdowns */
router.get('/:entity/options', async (req, res) => {
  const { entity } = parse(entityParam, req.params);
  const { parentId } = parse(z.object({ parentId: optionalId }), req.query);
  res.json(await listMasterDataOptions(entity, parentId));
});

/** GET /api/master-data/:entity?search=&parentId=&includeInactive=&page=&limit= */
router.get('/:entity', requireAdmin, async (req, res) => {
  const { entity } = parse(entityParam, req.params);
  res.json(await listMasterDataItems(entity, parse(listQuery, req.query)));
});

/** POST /api/master-data/:entity - create an item */
router.post('/:entity', requireAdmin, async (req, res) => {
  const { entity } = parse(entityParam, req.params);
  const item = await createMasterDataItem(entity, parse(itemBody, req.body));
  res.status(201).json({ message: `${item.name} created`, data: item });
});

/** PUT /api/master-data/:entity/:id - update an item (all fields) */
router.put('/:entity/:id', requireAdmin, async (req, res) => {
  const { entity, id } = parse(itemParams, req.params);
  const item = await updateMasterDataItem(entity, id, parse(itemBody, req.body));
  res.json({ message: `${item.name} updated`, data: item });
});

/**
 * DELETE /api/master-data/:entity/:id - Configuration screen's "Delete" (confirm -> flip active
 * flag to NO) via usp_master_data_save(..., p_is_active => false): items stay referenced by invoices,
 * so there is no hard delete.
 */
router.delete('/:entity/:id', requireAdmin, async (req, res) => {
  const { entity, id } = parse(itemParams, req.params);
  const item = await deactivateMasterDataItem(entity, id);
  res.json({ message: `${item.name} deactivated`, data: item });
});

export default router;
