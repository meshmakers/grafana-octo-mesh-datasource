import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

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
  /** Maximum number of rows to return */
  maxRows?: number;
  /** DateTime column to filter by Grafana time range (not available for GroupedAggregation queries) */
  timeFilterColumn?: string;
}

export const DEFAULT_QUERY: Partial<OctoMeshQuery> = {
  maxRows: 1000,
};

/**
 * Datasource configuration options (stored in jsonData)
 *
 * Note: oauthPassThru is a standard Grafana field that should be in DataSourceJsonData
 * but isn't. We declare it here to document our usage. When true, Grafana forwards
 * the logged-in user's OAuth token to our backend via the proxy.
 */
export interface OctoMeshDataSourceOptions extends DataSourceJsonData {
  /** Selected tenant ID */
  tenantId?: string;
  /**
   * Forward the user's OAuth token to OctoMesh.
   * Standard Grafana field, missing from DataSourceJsonData types.
   * @see https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/add-authentication-for-data-source-plugins
   */
  oauthPassThru?: boolean;
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
 * Field filter for query execution
 */
export interface FieldFilterDto {
  attributePath: string;
  operator: 'EQUALS' | 'NOT_EQUALS' | 'LESS_THAN' | 'LESS_EQUAL_THAN' | 'GREATER_THAN' | 'GREATER_EQUAL_THAN' | 'IN' | 'NOT_IN' | 'LIKE' | 'MATCH_REGEX' | 'ANY_EQ' | 'ANY_LIKE';
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
