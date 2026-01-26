/**
 * Query type enumeration for OctoMesh SystemQueries
 *
 * Query types are determined by the CkTypeId of the query definition:
 * - Simple queries return individual entity rows
 * - Aggregation queries return a single aggregated row
 * - GroupedAggregation queries return grouped rows with aggregations per group
 */
export enum QueryType {
  Simple = 'simple',
  Aggregation = 'aggregation',
  GroupedAggregation = 'groupedAggregation',
}

/**
 * CkTypeId patterns for query type detection
 *
 * These patterns match the ckTypeId field of SystemPersistentQuery:
 * - "System/SimpleRtQuery" → Simple query returning entity rows
 * - "System/AggregationRtQuery" → Aggregation query returning single aggregated row
 * - "System/GroupingAggregationRtQuery" → Grouped aggregation with rows per group
 */
const QUERY_TYPE_PATTERNS = {
  SIMPLE: 'SimpleRtQuery',
  AGGREGATION: 'AggregationRtQuery',
  GROUPED_AGGREGATION: 'GroupingAggregationRtQuery',
} as const;

/**
 * Detect query type from the ckTypeId field of a SystemPersistentQuery
 *
 * @param ckTypeId - The CkTypeId of the query definition (e.g., "System/SimpleRtQuery")
 * @returns The detected QueryType
 *
 * @example
 * getQueryType('System/SimpleRtQuery') // QueryType.Simple
 * getQueryType('System/AggregationRtQuery') // QueryType.Aggregation
 * getQueryType('System/GroupingAggregationRtQuery') // QueryType.GroupedAggregation
 */
export function getQueryType(ckTypeId: string | undefined): QueryType {
  if (!ckTypeId) {
    console.warn('No ckTypeId provided, defaulting to Simple query type');
    return QueryType.Simple;
  }

  // Check in order of specificity (GroupingAggregation before Aggregation)
  if (ckTypeId.includes(QUERY_TYPE_PATTERNS.GROUPED_AGGREGATION)) {
    return QueryType.GroupedAggregation;
  }
  if (ckTypeId.includes(QUERY_TYPE_PATTERNS.AGGREGATION)) {
    return QueryType.Aggregation;
  }
  if (ckTypeId.includes(QUERY_TYPE_PATTERNS.SIMPLE)) {
    return QueryType.Simple;
  }

  console.warn(`Unknown query type: ${ckTypeId}, defaulting to Simple`);
  return QueryType.Simple;
}

/**
 * Get a human-readable label for a query type
 */
export function getQueryTypeLabel(queryType: QueryType): string {
  switch (queryType) {
    case QueryType.Simple:
      return 'Simple Query';
    case QueryType.Aggregation:
      return 'Aggregation Query';
    case QueryType.GroupedAggregation:
      return 'Grouped Aggregation Query';
  }
}
