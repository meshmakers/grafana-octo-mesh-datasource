import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

/**
 * All supported filter operators for field filtering
 */
export type FilterOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'LESS_THAN'
  | 'GREATER_THAN'
  | 'LESS_EQUAL_THAN'
  | 'GREATER_EQUAL_THAN'
  | 'IN'
  | 'NOT_IN'
  | 'LIKE'
  | 'MATCH_REGEX'
  | 'CONTAINS'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'BETWEEN'
  | 'IS_NULL'
  | 'IS_NOT_NULL'
  | 'ANY_EQ'
  | 'ANY_LIKE';

/**
 * User-defined field filter (UI representation)
 */
export interface UserFieldFilter {
  /** Unique identifier for this filter row */
  id: string;
  /** Column/attribute path to filter on */
  attributePath?: string;
  /** Filter operator */
  operator?: FilterOperator;
  /** Primary comparison value */
  comparisonValue?: string;
  /** Secondary comparison value (for BETWEEN operator) */
  comparisonValueEnd?: string;
}

/**
 * Query model for OctoMesh datasource
 */
export interface OctoMeshQuery extends DataQuery {
  /** Runtime ID of the selected SystemQuery */
  queryRtId?: string;
  /** Display name of the selected query */
  queryName?: string;
  /**
   * CK Type ID of the query definition (e.g., "System/SimpleRtQuery", "System/AggregationRtQuery")
   * This determines the query type and is cached from SystemQueryDto.ckTypeId
   */
  queryCkTypeId?: string;
  /**
   * CK Type ID of the source entity type (e.g., "Industry.Basic/Alarm")
   * Used to fetch available attributes for filtering
   */
  querySourceTypeId?: string;
  /** Maximum number of rows to return */
  maxRows?: number;
  /** DateTime column to filter by Grafana time range (not available for GroupedAggregation queries) */
  timeFilterColumn?: string;
  /** User-defined field filters applied before aggregation */
  fieldFilters?: UserFieldFilter[];
}

export const DEFAULT_QUERY: Partial<OctoMeshQuery> = {
  maxRows: 1000,
};

/**
 * Datasource configuration options (stored in jsonData)
 *
 * The Go backend handles tenant-specific OAuth via acr_values.
 * No oauthPassThru needed — the backend manages tokens per user/tenant.
 */
export interface OctoMeshDataSourceOptions extends DataSourceJsonData {
  /** Selected tenant ID */
  tenantId?: string;
  /** OctoMesh Identity Server URL (e.g., https://connect.example.com) */
  identityServerUrl?: string;
  /** OAuth client ID for tenant-specific authentication (e.g., grafana-datasource) */
  oauthClientId?: string;
  /** OAuth scopes (space-separated) */
  oauthScopes?: string;
  /**
   * Skip TLS certificate verification.
   * WARNING: Insecure, use only for development/testing environments.
   */
  tlsSkipVerify?: boolean;
}

/**
 * Secure configuration (stored encrypted, backend only)
 */
export interface OctoMeshSecureJsonData {
  // Reserved for future use (e.g., API keys if not using OAuth)
}

/**
 * Tenant data transfer object from /system/v1/tenants
 */
export interface TenantDto {
  tenantId: string;
  database: string;
}

/**
 * Response from /system/v1/tenants endpoint (PagedResult)
 */
export interface TenantsResponse {
  totalCount: number;
  skip: number;
  take: number;
  list: TenantDto[];
}

/**
 * SystemPersistentQuery data from GraphQL runtime.systemPersistentQuery
 */
export interface SystemQueryDto {
  rtId: string;
  name: string;
  description: string;
  ckTypeId: string;
  queryCkTypeId: string;
}

/**
 * GraphQL response for systemPersistentQuery query
 */
export interface SystemQueryResponse {
  data: {
    runtime: {
      systemPersistentQuery: {
        totalCount: number;
        items: SystemQueryDto[];
      };
    };
  };
}

/**
 * Column definition from RuntimeQuery
 */
export interface QueryColumnDto {
  attributePath: string;
  attributeValueType: string;
  /** Aggregation type if this column is an aggregated value (e.g., 'Sum', 'Avg', 'Count') */
  aggregationType?: string;
}

/**
 * Cell value in a query row
 */
export interface QueryCellDto {
  attributePath: string;
  value: unknown;
}

/**
 * Row in query results
 *
 * Note: rtId is only present for Simple queries.
 * Aggregation and GroupedAggregation queries have ckTypeId instead.
 */
export interface QueryRowDto {
  /** Runtime ID - only present for Simple queries */
  rtId?: string;
  /** CK Type ID - present for all row types */
  ckTypeId?: string;
  cells: {
    items: QueryCellDto[];
  };
}

/**
 * Field filter for query execution (GraphQL DTO)
 */
export interface FieldFilterDto {
  attributePath: string;
  operator: FilterOperator;
  comparisonValue: unknown;
}

/**
 * GraphQL response for runtimeQuery execution
 */
export interface RuntimeQueryResponse {
  data: {
    runtime: {
      runtimeQuery: {
        items: Array<{
          queryRtId: string;
          associatedCkTypeId: string;
          columns: QueryColumnDto[];
          rows: {
            totalCount: number;
            items: QueryRowDto[];
          };
        }>;
      };
    };
  };
}

/**
 * GraphQL response for columns-only query (preview)
 */
export interface QueryColumnsResponse {
  data: {
    runtime: {
      runtimeQuery: {
        items: Array<{
          columns: QueryColumnDto[];
        }>;
      };
    };
  };
}

/**
 * Attribute definition from Construction Kit type schema
 * Used for fetching source entity attributes for filtering
 */
export interface CkTypeAttributeDto {
  attributePath: string;
  attributeValueType: string;
}

/**
 * GraphQL response for CK type attributes query
 */
export interface CkTypeAttributesResponse {
  data: {
    constructionKit: {
      types: {
        items: Array<{
          availableQueryColumns: {
            items: CkTypeAttributeDto[];
          };
        }>;
      };
    };
  };
}
