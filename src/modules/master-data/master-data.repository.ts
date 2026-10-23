import { callFunction, callFunctionSingle, toPageMeta, type PageColumns } from '../../db/procedures.js';
import type { Paginated } from '../../utils/pagination.js';

/** API names of the Settings > Configuration lists (rows of app.master_data_entities). */
export const MASTER_DATA_ENTITIES = [
  'countries',
  'states',
  'cities',
  'business-units',
  'teams',
  'statuses',
  'processes',
] as const;
export type MasterDataEntity = (typeof MASTER_DATA_ENTITIES)[number];

export const STATUS_COLORS = ['warning', 'info', 'success', 'danger', 'neutral'] as const;

export interface MasterDataEntityDef {
  entity: MasterDataEntity;
  label: string;
  parentEntity: MasterDataEntity | null;
  codeRequired: boolean;
  hasColor: boolean;
}

export interface MasterDataItem {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  parentId: number | null;
  parentName: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date | null;
}

export interface MasterDataOption {
  id: number;
  code: string | null;
  name: string;
  parentId: number | null;
  color: string | null;
}

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

export interface MasterDataFilters {
  search: string;
  parentId?: number;
  includeInactive: boolean;
  page: number;
  limit: number;
}

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

export interface MasterDataInput {
  code?: string | null;
  name: string;
  description?: string | null;
  parentId?: number | null;
  color?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

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

/** Raises CA404 (not found) or CA409 (still referenced: deactivate instead). */
export const deleteItem = async (entity: MasterDataEntity, id: number): Promise<number> =>
  (await callFunctionSingle<{ rows_affected: number }>('usp_master_data_delete', { p_entity: entity, p_id: id }))
    .rows_affected;
