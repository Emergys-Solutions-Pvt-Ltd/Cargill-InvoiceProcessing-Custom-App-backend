import { callFunction, callFunctionSingle, toPageMeta, type PageColumns } from '../../../core/db/procedures.js';
import { HttpError } from '../../../core/http/http-error.js';
import type { Paginated } from '../../../core/http/pagination.js';
import { type MasterDataEntity, type MasterDataEntityDef, type MasterDataItem, type MasterDataOption, type MasterDataFilters, type MasterDataInput } from './master-data.models.js';

// app.udt_master_data_entity_result / udt_master_data_result / udt_master_data_option_result
interface EntityResult {
  entity: MasterDataEntity;
  label: string;
  parent_entity: MasterDataEntity | null;
  code_required: boolean;
  has_color: boolean;
}

interface ItemResult {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  parent_id: number | null;
  parent_name: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at: Date | null;
}

const toItem = (r: ItemResult): MasterDataItem => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  parentId: r.parent_id,
  parentName: r.parent_name,
  color: r.color,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  updatedAt: r.updated_at,
});

export const listEntities = async (): Promise<MasterDataEntityDef[]> =>
  (await callFunction<EntityResult>('usp_master_data_entities')).map((e) => ({
    entity: e.entity,
    label: e.label,
    parentEntity: e.parent_entity,
    codeRequired: e.code_required,
    hasColor: e.has_color,
  }));

export const listItems = async (entity: MasterDataEntity, f: MasterDataFilters): Promise<Paginated<MasterDataItem>> => {
  const rows = await callFunction<ItemResult & PageColumns>('usp_master_data_list', {
    p_entity: entity,
    p_search: f.search || null,
    p_parent_id: f.parentId ?? null,
    p_include_inactive: f.includeInactive,
    p_page: f.page,
    p_page_size: f.limit,
  });
  return { data: rows.map(toItem), ...toPageMeta(rows[0], f.limit) };
};

export const listOptions = async (entity: MasterDataEntity, parentId?: number): Promise<MasterDataOption[]> =>
  (
    await callFunction<{ id: number; code: string | null; name: string; parent_id: number | null; color: string | null }>(
      'usp_master_data_options',
      { p_entity: entity, p_parent_id: parentId ?? null },
    )
  ).map((o) => ({ id: o.id, code: o.code, name: o.name, parentId: o.parent_id, color: o.color }));

/** Create when id is undefined. Raises CA400 (missing / invalid field), CA404, CA409 (duplicate). */
export const saveItem = async (entity: MasterDataEntity, input: MasterDataInput, id?: number): Promise<MasterDataItem> =>
  toItem(
    await callFunctionSingle<ItemResult>('usp_master_data_save', {
      p_entity: entity,
      p_id: id ?? null,
      p_code: input.code ?? null,
      p_name: input.name,
      p_description: input.description ?? null,
      p_parent_id: input.parentId ?? null,
      p_color: input.color ?? null,
      p_sort_order: input.sortOrder ?? 0,
      p_is_active: input.isActive ?? true,
    }),
  );

/**
 * usp_master_data_save expects the full row on every call (confirmed with Database-1 during the
 * original masters module work) - fetch the current row and resend it with isActive: false,
 * rather than a bare partial patch that would null out name/code/etc.
 */
const findItemById = async (entity: MasterDataEntity, id: number): Promise<MasterDataItem | null> => {
  const MAX_PAGE_SIZE = 100;
  for (let page = 1; page <= 50; page++) {
    const { data, totalPages } = await listItems(entity, { search: '', includeInactive: true, page, limit: MAX_PAGE_SIZE });
    const item = data.find((r) => r.id === id);
    if (item) return item;
    if (data.length === 0 || page >= totalPages) return null;
  }
  return null;
};

/** Configuration screen's "Delete" (confirm -> flip active flag to NO). Raises CA404 if the item doesn't exist. */
export const deactivateItem = async (entity: MasterDataEntity, id: number): Promise<MasterDataItem> => {
  const current = await findItemById(entity, id);
  if (!current) throw new HttpError(404, `Record ${id} not found in '${entity}'`);
  return saveItem(
    entity,
    {
      code: current.code,
      name: current.name,
      description: current.description,
      parentId: current.parentId,
      color: current.color,
      sortOrder: current.sortOrder,
      isActive: false,
    },
    id,
  );
};
