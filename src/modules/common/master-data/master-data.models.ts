/** API names of the Settings > Configuration lists (rows of app.master_data_entities). */
export const MASTER_DATA_ENTITIES = [
  'countries',
  'states',
  'cities',
  'business-units',
  'teams',
  'statuses',
  'processes',
  'erp-systems',
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

export interface MasterDataFilters {
  search: string;
  parentId?: number;
  includeInactive: boolean;
  page: number;
  limit: number;
}

export interface MasterDataInput {
  code?: string | null;
  name: string;
  description?: string | null;
  parentId?: number | null;
  color?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}
