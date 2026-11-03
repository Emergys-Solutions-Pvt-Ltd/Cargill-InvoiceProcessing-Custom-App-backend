import { deactivateItem, listEntities, listItems, listOptions, saveItem } from './master-data.dal.js';
import type { MasterDataEntity, MasterDataFilters, MasterDataInput } from './master-data.models.js';

// ---- Business rules of Settings > Configuration (master data lists) ----
// The functions validate parents, unique codes / names and the entity whitelist (app.master_data_entities).

export const listMasterDataEntities = () => listEntities();

/** Active items for dropdowns (e.g. countries, business-units, erp-systems). */
export const listMasterDataOptions = (entity: MasterDataEntity, parentId?: number) => listOptions(entity, parentId);

export const listMasterDataItems = (entity: MasterDataEntity, filters: MasterDataFilters) => listItems(entity, filters);

export const createMasterDataItem = (entity: MasterDataEntity, input: MasterDataInput) => saveItem(entity, input);

export const updateMasterDataItem = (entity: MasterDataEntity, id: number, input: MasterDataInput) => saveItem(entity, input, id);

/**
 * The Configuration screen's "Delete" deactivates the item (it stays referenced by invoices).
 */
export const deactivateMasterDataItem = (entity: MasterDataEntity, id: number) => deactivateItem(entity, id);
