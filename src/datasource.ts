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
  CkTypeAttributeDto,
  CkTypeAttributesResponse,
} from './types';
import { QueryType, getQueryType } from './queryTypes';
import { buildQueryPayload } from './graphql/queryBuilder';
import { convertUserFiltersToDto } from './utils/filterConverter';
import { lastValueFrom } from 'rxjs';

/**
 * Auth status response from the Go backend's /auth/status endpoint
 */
interface AuthStatusResponse {
  authenticated: boolean;
  tenantId?: string;
  userLogin?: string;
  error?: string;
}

/**
 * Auth start response from the Go backend's /auth/start endpoint
 */
interface AuthStartResponse {
  authorizeUrl?: string;
  error?: string;
}

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
      const timeFilters: FieldFilterDto[] = [];
      if (target.timeFilterColumn && range) {
        timeFilters.push({
          attributePath: target.timeFilterColumn,
          operator: 'GREATER_EQUAL_THAN',
          comparisonValue: range.from.toISOString(),
        });
        timeFilters.push({
          attributePath: target.timeFilterColumn,
          operator: 'LESS_EQUAL_THAN',
          comparisonValue: range.to.toISOString(),
        });
      }

      // Convert user-defined field filters to DTOs
      let userFilters: FieldFilterDto[] = [];
      if (target.fieldFilters && target.fieldFilters.length > 0) {
        if (target.querySourceTypeId) {
          // Use source entity attributes for type conversion (correct for aggregation queries)
          const sourceAttributes = await this.fetchTypeAttributes(target.querySourceTypeId);
          userFilters = convertUserFiltersToDto(target.fieldFilters, sourceAttributes);
        } else {
          // Fallback to result columns for Simple queries or when source type not set
          const columns = await this.fetchQueryColumns(target.queryRtId!);
          userFilters = convertUserFiltersToDto(target.fieldFilters, columns);
        }
      }

      // Merge time filters and user filters (implicit AND logic)
      const allFilters = [...timeFilters, ...userFilters];

      const result = await this.executeQuery(
        target.queryRtId!,
        target.maxRows ?? 1000,
        queryType,
        allFilters.length > 0 ? allFilters : undefined
      );

      return this.toDataFrame(target, result);
    });

    const data = await Promise.all(promises);
    return { data };
  }

  // ─── Auth Flow Methods ───────────────────────────────────────────────

  /**
   * Check authentication status with the Go backend
   */
  async checkAuthStatus(): Promise<AuthStatusResponse> {
    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<AuthStatusResponse>({
          url: `${this.baseUrl}/auth/status`,
          method: 'GET',
        })
      );
      return response.data;
    } catch {
      return { authenticated: false, error: 'Failed to check auth status' };
    }
  }

  /**
   * Initiate the tenant-specific OAuth flow via a popup window.
   * Returns a promise that resolves when authentication is complete.
   */
  async initiateAuth(): Promise<boolean> {
    // Build the callback URL pointing to the plugin's resource endpoint
    const callbackUrl = `${window.location.origin}${this.baseUrl}/auth/callback`;

    // Get the authorize URL from the Go backend
    const response = await lastValueFrom(
      getBackendSrv().fetch<AuthStartResponse>({
        url: `${this.baseUrl}/auth/start?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        method: 'GET',
      })
    );

    const authorizeUrl = response.data.authorizeUrl;
    if (!authorizeUrl) {
      throw new Error(response.data.error ?? 'Failed to get authorize URL');
    }

    // Open popup for OAuth flow
    return new Promise<boolean>((resolve, reject) => {
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authorizeUrl,
        'octo-mesh-auth',
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no`
      );

      if (!popup) {
        reject(new Error('Popup blocked. Please allow popups for this site.'));
        return;
      }

      // Listen for postMessage from the callback page
      const messageHandler = (event: MessageEvent) => {
        if (event.data?.type === 'octo-mesh-auth-callback') {
          window.removeEventListener('message', messageHandler);
          clearInterval(pollTimer);
          resolve(event.data.success === true);
        }
      };
      window.addEventListener('message', messageHandler);

      // Poll for popup close (in case postMessage doesn't fire)
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer);
          window.removeEventListener('message', messageHandler);
          // Check auth status after popup closed
          this.checkAuthStatus().then((status) => {
            resolve(status.authenticated);
          });
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollTimer);
        window.removeEventListener('message', messageHandler);
        if (!popup.closed) {
          popup.close();
        }
        reject(new Error('Authentication timed out'));
      }, 5 * 60 * 1000);
    });
  }

  // ─── Data Fetching Methods ───────────────────────────────────────────

  // ─── Data Fetching Methods (routed through Go backend) ────────────

  /**
   * Fetch list of available tenants from OctoMesh via backend proxy
   */
  async fetchTenants(): Promise<TenantDto[]> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<TenantsResponse>({
        url: `${this.baseUrl}/tenants`,
        method: 'GET',
      })
    );
    return response.data.list ?? [];
  }

  /**
   * Perform a GraphQL request via the Go backend proxy.
   * The backend injects the tenant-specific OAuth token.
   */
  private async graphqlRequest<T>(payload: { query: string; variables?: object }): Promise<T> {
    if (!this.tenantId) {
      throw new Error('Tenant ID is not configured.');
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<T>({
        url: `${this.baseUrl}/graphql`,
        method: 'POST',
        data: payload,
      })
    );
    return response.data;
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

    const response = await this.graphqlRequest<SystemQueryResponse>({ query });
    return response.data?.runtime?.systemPersistentQuery?.items ?? [];
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

    const response = await this.graphqlRequest<QueryColumnsResponse>({ query, variables: { rtId: queryRtId } });
    return response.data?.runtime?.runtimeQuery?.items?.[0]?.columns ?? [];
  }

  /**
   * Fetch available attributes for a CK type (for filter dropdowns)
   */
  async fetchTypeAttributes(rtCkTypeId: string): Promise<CkTypeAttributeDto[]> {
    if (!this.tenantId) {
      return [];
    }

    const query = `query($rtCkId: String!) {
      constructionKit {
        types(rtCkId: $rtCkId) {
          items {
            availableQueryColumns(first: 100) {
              items {
                attributePath
                attributeValueType
              }
            }
          }
        }
      }
    }`;

    const response = await this.graphqlRequest<CkTypeAttributesResponse>({ query, variables: { rtCkId: rtCkTypeId } });
    return response.data?.constructionKit?.types?.items?.[0]?.availableQueryColumns?.items ?? [];
  }

  /**
   * Execute a RuntimeQuery and return columns + rows
   */
  async executeQuery(
    rtId: string,
    maxRows: number,
    queryType: QueryType,
    fieldFilter?: FieldFilterDto[]
  ): Promise<{ columns: QueryColumnDto[]; rows: QueryRowDto[]; totalCount: number }> {
    const payload = buildQueryPayload(queryType, rtId, maxRows, fieldFilter);
    const response = await this.graphqlRequest<RuntimeQueryResponse>(payload);

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
    const lower = octoType.toLowerCase();

    switch (lower) {
      case 'integer':
      case 'decimal':
      case 'double':
        return FieldType.number;
      case 'datetime':
      case 'date_time':
        return FieldType.time;
      case 'boolean':
        return FieldType.boolean;
      default:
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
   * Tests connectivity by fetching the tenant list via the backend proxy
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
