import { getBackendSrv, isFetchError } from '@grafana/runtime';
import {
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  createDataFrame,
  FieldType,
} from '@grafana/data';

import {
  OctoMeshQuery,
  OctoMeshDataSourceOptions,
  DEFAULT_QUERY,
  TenantDto,
  TenantsResponse,
  SystemQueryDto,
  SystemQueryResponse,
  QueryColumnDto,
  QueryRowDto,
  FieldFilterDto,
  RuntimeQueryResponse,
  QueryColumnsResponse,
} from './types';
import { QueryType, getQueryType, supportsTimeFilter } from './queryTypes';
import { buildQueryPayload } from './graphql/queryBuilder';
import { lastValueFrom } from 'rxjs';

export class DataSource extends DataSourceApi<OctoMeshQuery, OctoMeshDataSourceOptions> {
  baseUrl: string;
  tenantId?: string;

  constructor(instanceSettings: DataSourceInstanceSettings<OctoMeshDataSourceOptions>) {
    super(instanceSettings);
    this.baseUrl = instanceSettings.url!;
    this.tenantId = instanceSettings.jsonData.tenantId;
  }

  getDefaultQuery(_: CoreApp): Partial<OctoMeshQuery> {
    return DEFAULT_QUERY;
  }

  filterQuery(query: OctoMeshQuery): boolean {
    // Only execute queries that have a selected SystemQuery
    return !!query.queryRtId;
  }

  async query(options: DataQueryRequest<OctoMeshQuery>): Promise<DataQueryResponse> {
    const { range } = options;

    const promises = options.targets.filter(this.filterQuery).map(async (target) => {
      // Determine query type from cached queryCkTypeId
      const queryType = getQueryType(target.queryCkTypeId);

      // Build time range filters if timeFilterColumn is set and query type supports it
      const fieldFilters: FieldFilterDto[] = [];
      if (target.timeFilterColumn && range && supportsTimeFilter(queryType)) {
        fieldFilters.push({
          attributePath: target.timeFilterColumn,
          operator: 'GREATER_EQUAL_THAN',
          comparisonValue: range.from.toISOString(),
        });
        fieldFilters.push({
          attributePath: target.timeFilterColumn,
          operator: 'LESS_EQUAL_THAN',
          comparisonValue: range.to.toISOString(),
        });
      }

      const result = await this.executeQuery(
        target.queryRtId!,
        target.maxRows ?? 1000,
        queryType,
        fieldFilters.length > 0 ? fieldFilters : undefined
      );

      return this.toDataFrame(target, result);
    });

    const data = await Promise.all(promises);
    return { data };
  }

  /**
   * Fetch list of available tenants from OctoMesh
   */
  async fetchTenants(): Promise<TenantDto[]> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<TenantsResponse>({
        url: `${this.baseUrl}/system/v1/tenants`,
        method: 'GET',
      })
    );
    return response.data.list ?? [];
  }

  /**
   * Fetch list of SystemQueries from the configured tenant via GraphQL
   */
  async fetchSystemQueries(): Promise<SystemQueryDto[]> {
    if (!this.tenantId) {
      return [];
    }

    const query = `query {
      runtime {
        systemPersistentQuery {
          totalCount
          items {
            rtId
            name
            description
            ckTypeId
            queryCkTypeId
          }
        }
      }
    }`;

    const response = await lastValueFrom(
      getBackendSrv().fetch<SystemQueryResponse>({
        url: `${this.baseUrl}/tenants/${this.tenantId}/graphql`,
        method: 'POST',
        data: { query },
      })
    );

    return response.data.data?.runtime?.systemPersistentQuery?.items ?? [];
  }

  /**
   * Fetch column definitions for a specific query (for preview in QueryEditor)
   */
  async fetchQueryColumns(queryRtId: string): Promise<QueryColumnDto[]> {
    if (!this.tenantId) {
      return [];
    }

    const query = `query($rtId: OctoObjectId!) {
      runtime {
        runtimeQuery(rtId: $rtId) {
          items {
            columns {
              attributePath
              attributeValueType
              aggregationType
            }
          }
        }
      }
    }`;

    const response = await lastValueFrom(
      getBackendSrv().fetch<QueryColumnsResponse>({
        url: `${this.baseUrl}/tenants/${this.tenantId}/graphql`,
        method: 'POST',
        data: { query, variables: { rtId: queryRtId } },
      })
    );

    return response.data.data?.runtime?.runtimeQuery?.items?.[0]?.columns ?? [];
  }

  /**
   * Helper to perform GraphQL requests
   */
  private async doRequest<T>(query: { query: string; variables: object }, tenantId?: string): Promise<T> {
    if (!tenantId) {
      throw new Error('Tenant ID is not configured.');
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<T>({
        url: `${this.baseUrl}/tenants/${tenantId}/graphql`,
        method: 'POST',
        data: query,
      })
    );
    return response.data;
  }

  /**
   * Execute a RuntimeQuery and return columns + rows
   *
   * Uses the query builder to construct the appropriate GraphQL query
   * based on the query type (Simple, Aggregation, or GroupedAggregation).
   */
  async executeQuery(
    rtId: string,
    maxRows: number,
    queryType: QueryType,
    fieldFilter?: FieldFilterDto[]
  ): Promise<{ columns: QueryColumnDto[]; rows: QueryRowDto[]; totalCount: number }> {
    const payload = buildQueryPayload(queryType, rtId, maxRows, fieldFilter);
    const response = await this.doRequest<RuntimeQueryResponse>(payload, this.tenantId);

    const result = response.data?.runtime?.runtimeQuery?.items?.[0];
    return {
      columns: result?.columns ?? [],
      rows: result?.rows?.items ?? [],
      totalCount: result?.rows?.totalCount ?? 0,
    };
  }

  /**
   * Transform query results to Grafana DataFrame
   */
  private toDataFrame(
    query: OctoMeshQuery,
    result: { columns: QueryColumnDto[]; rows: QueryRowDto[] }
  ) {
    return createDataFrame({
      refId: query.refId,
      fields: result.columns.map((col) => ({
        name: col.attributePath,
        type: this.mapAttributeType(col.attributeValueType),
        values: result.rows.map((row) => {
          const cell = row.cells.items.find((c) => c.attributePath === col.attributePath);
          return this.convertValue(cell?.value, col.attributeValueType);
        }),
      })),
    });
  }

  /**
   * Map OctoMesh attribute type to Grafana FieldType
   */
  private mapAttributeType(octoType: string): FieldType {
    switch (octoType) {
      case 'Integer':
      case 'Decimal':
      case 'Double':
        return FieldType.number;
      case 'DateTime':
      case 'datetime':
      case 'DATE_TIME':
        return FieldType.time;
      case 'Boolean':
        return FieldType.boolean;
      default:
        // Try case-insensitive check for datetime or date_time
        const lower = octoType.toLowerCase();
        if (lower === 'datetime' || lower === 'date_time') {
          return FieldType.time;
        }
        return FieldType.string;
    }
  }

  /**
   * Convert cell value to appropriate type for Grafana
   */
  private convertValue(value: unknown, octoType: string): unknown {
    if (value == null) {
      return null;
    }
    if ((octoType === 'DateTime' || octoType === 'DATE_TIME' || octoType.toLowerCase().replace('_', '') === 'datetime') && typeof value === 'string') {
      return new Date(value).getTime(); // Grafana expects epoch ms for time
    }
    return value;
  }

  /**
   * Tests connectivity by fetching the tenant list and validating configuration
   */
  async testDatasource() {
    try {
      const tenants = await this.fetchTenants();

      // Check if tenant is configured - return error so Grafana doesn't show green success box
      if (!this.tenantId) {
        return {
          status: 'error',
          message: `Connection OK. Found ${tenants.length} tenant(s). Please select a tenant to complete configuration.`,
        };
      }

      // Verify the configured tenant exists
      const tenantExists = tenants.some((t) => t.tenantId === this.tenantId);
      if (!tenantExists) {
        return {
          status: 'error',
          message: `Configured tenant "${this.tenantId}" not found. Available tenants: ${tenants.map((t) => t.tenantId).join(', ')}`,
        };
      }

      return {
        status: 'success',
        message: `Connected successfully to tenant "${this.tenantId}".`,
      };
    } catch (err) {
      let message = 'Cannot connect to OctoMesh API';

      if (typeof err === 'string') {
        message = err;
      } else if (isFetchError(err)) {
        message = err.statusText ?? message;
        if (err.status === 401) {
          message = 'Unauthorized. Check your OAuth configuration.';
        } else if (err.status === 403) {
          message = 'Forbidden. You do not have access to this resource.';
        } else if (err.data?.message) {
          message = err.data.message;
        }
      } else if (err instanceof Error) {
        message = err.message;
      }

      return {
        status: 'error',
        message,
      };
    }
  }
}
