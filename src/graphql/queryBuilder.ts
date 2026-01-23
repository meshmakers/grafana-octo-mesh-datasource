import { QueryType } from '../queryTypes';
import { FieldFilterDto } from '../types';

/**
 * Row fragments for different query types
 *
 * Each query type returns different row structures:
 * - Simple: Has rtId (entity identifier)
 * - Aggregation: Has ckTypeId only (single aggregated result)
 * - GroupedAggregation: Has ckTypeId only (grouped aggregated results)
 */
const ROW_FRAGMENTS = {
  [QueryType.Simple]: `
    ... on RtSimpleQueryRow {
      rtId
      ckTypeId
      cells {
        items {
          attributePath
          value
        }
      }
    }
  `,
  [QueryType.Aggregation]: `
    ... on RtAggregationQueryRow {
      ckTypeId
      cells {
        items {
          attributePath
          value
        }
      }
    }
  `,
  [QueryType.GroupedAggregation]: `
    ... on RtGroupingAggregationQueryRow {
      ckTypeId
      cells {
        items {
          attributePath
          value
        }
      }
    }
  `,
} as const;

/**
 * Build the columns selection for the query
 * Aggregation queries include the aggregationType field
 */
function buildColumnsSelection(queryType: QueryType): string {
  const baseColumns = `
    attributePath
    attributeValueType
  `;

  // Include aggregationType for aggregation query types
  if (queryType === QueryType.Aggregation || queryType === QueryType.GroupedAggregation) {
    return `
      ${baseColumns}
      aggregationType
    `;
  }

  return baseColumns;
}

/**
 * Build a GraphQL query for runtime query execution
 *
 * @param queryType - The type of query (Simple, Aggregation, GroupedAggregation)
 * @returns GraphQL query string with appropriate row fragment
 */
export function buildRuntimeQuery(queryType: QueryType): string {
  const rowFragment = ROW_FRAGMENTS[queryType];
  const columnsSelection = buildColumnsSelection(queryType);

  return `
    query($rtId: OctoObjectId!, $first: Int, $fieldFilter: [FieldFilter]) {
      runtime {
        runtimeQuery(rtId: $rtId) {
          items {
            queryRtId
            associatedCkTypeId
            columns {
              ${columnsSelection}
            }
            rows(first: $first, fieldFilter: $fieldFilter) {
              totalCount
              items {
                ${rowFragment}
              }
            }
          }
        }
      }
    }
  `;
}

/**
 * Build variables for the runtime query
 */
export function buildQueryVariables(
  rtId: string,
  maxRows: number,
  fieldFilter?: FieldFilterDto[]
): {
  rtId: string;
  first: number;
  fieldFilter?: FieldFilterDto[];
} {
  return {
    rtId,
    first: maxRows,
    ...(fieldFilter && fieldFilter.length > 0 && { fieldFilter }),
  };
}

/**
 * Build the complete query payload for GraphQL execution
 */
export function buildQueryPayload(
  queryType: QueryType,
  rtId: string,
  maxRows: number,
  fieldFilter?: FieldFilterDto[]
): {
  query: string;
  variables: {
    rtId: string;
    first: number;
    fieldFilter?: FieldFilterDto[];
  };
} {
  return {
    query: buildRuntimeQuery(queryType),
    variables: buildQueryVariables(rtId, maxRows, fieldFilter),
  };
}
