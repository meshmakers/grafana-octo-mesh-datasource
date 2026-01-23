import React, { useEffect, useState, useMemo } from 'react';
import { Badge, Combobox, FieldSet, InlineField, Input, Stack } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { ComboboxOption } from '@grafana/ui/dist/types/components/Combobox/types';
import { DataSource } from '../datasource';
import { OctoMeshDataSourceOptions, OctoMeshQuery, SystemQueryDto, QueryColumnDto } from '../types';
import { QueryType, getQueryType, supportsTimeFilter, getQueryTypeLabel } from '../queryTypes';

type Props = QueryEditorProps<DataSource, OctoMeshQuery, OctoMeshDataSourceOptions>;

/**
 * Get badge color based on query type
 */
function getQueryTypeBadgeColor(queryType: QueryType): 'blue' | 'green' | 'purple' {
  switch (queryType) {
    case QueryType.Simple:
      return 'blue';
    case QueryType.Aggregation:
      return 'green';
    case QueryType.GroupedAggregation:
      return 'purple';
  }
}

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const [systemQueries, setSystemQueries] = useState<SystemQueryDto[]>([]);
  const [columns, setColumns] = useState<QueryColumnDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load SystemQueries on mount
  useEffect(() => {
    const loadQueries = async () => {
      if (!datasource.tenantId) {
        setError('No tenant configured. Configure a tenant in the datasource settings.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const queries = await datasource.fetchSystemQueries();
        setSystemQueries(queries);
      } catch (err) {
        setError('Failed to load SystemQueries');
        setSystemQueries([]);
      } finally {
        setLoading(false);
      }
    };

    loadQueries();
  }, [datasource]);

  // Load columns when query changes
  useEffect(() => {
    if (!query.queryRtId) {
      setColumns([]);
      return;
    }
    setColumnsLoading(true);
    datasource
      .fetchQueryColumns(query.queryRtId)
      .then(setColumns)
      .catch(() => setColumns([]))
      .finally(() => setColumnsLoading(false));
  }, [query.queryRtId, datasource]);

  // Determine query type from cached queryCkTypeId
  const queryType = useMemo(() => getQueryType(query.queryCkTypeId), [query.queryCkTypeId]);

  // Check if time filtering is supported for this query type
  const showTimeFilter = supportsTimeFilter(queryType);

  // DateTime columns for time filter dropdown
  const dateTimeColumns = columns.filter((c) => {
    const lower = c.attributeValueType.toLowerCase();
    return lower === 'datetime' || lower === 'date_time';
  });

  // Check if any column has aggregationType (indicates an aggregation query)
  const hasAggregations = columns.some((c) => c.aggregationType);

  const onQueryChange = (option: ComboboxOption<string>) => {
    const selected = systemQueries.find((q) => q.rtId === option.value);
    onChange({
      ...query,
      queryRtId: option.value,
      queryName: selected?.name,
      queryCkTypeId: selected?.ckTypeId, // Cache the query definition type (e.g., "System/SimpleRtQuery")
      timeFilterColumn: undefined, // Reset time filter when query changes
    });
    onRunQuery();
  };

  const onMaxRowsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, maxRows: parseInt(e.target.value, 10) || 1000 });
  };

  const onTimeFilterColumnChange = (option: ComboboxOption<string>) => {
    onChange({ ...query, timeFilterColumn: option.value || undefined });
    onRunQuery();
  };

  const queryOptions: Array<ComboboxOption<string>> = systemQueries.map((q) => ({
    label: q.name,
    value: q.rtId,
    description: q.queryCkTypeId,
  }));

  const timeFilterOptions: Array<ComboboxOption<string>> = [
    { label: 'None', value: '' },
    ...dateTimeColumns.map((c) => ({ label: c.attributePath, value: c.attributePath })),
  ];

  return (
    <Stack direction="column" gap={1}>
      {/* SystemQuery selector */}
      <Stack direction="row" gap={2} alignItems="center">
        <InlineField
          label="SystemQuery"
          labelWidth={16}
          tooltip="Select a SystemQuery to execute"
          invalid={!!error}
          error={error}
        >
          <Combobox
            id="query-editor-query-selector"
            options={queryOptions}
            value={query.queryRtId ?? null}
            onChange={onQueryChange}
            loading={loading}
            placeholder={loading ? 'Loading queries...' : 'Select a query'}
            width={40}
          />
        </InlineField>

        {/* Query type badge - shows when a query is selected */}
        {query.queryRtId && (
          <Badge
            text={getQueryTypeLabel(queryType)}
            color={getQueryTypeBadgeColor(queryType)}
            tooltip={`Query type determined by the SystemQuery definition (${query.queryCkTypeId ?? 'unknown'})`}
          />
        )}
      </Stack>

      {/* Max rows and time filter row - only show when query is selected */}
      {query.queryRtId && (
        <Stack direction="row" gap={2}>
          <InlineField label="Max Rows" labelWidth={16} tooltip="Maximum number of rows to return">
            <Input
              type="number"
              value={query.maxRows ?? 1000}
              onChange={onMaxRowsChange}
              onBlur={onRunQuery}
              width={12}
            />
          </InlineField>

          {/* Time filter - only shown for query types that support it */}
          {showTimeFilter && (
            <InlineField
              label="Time Filter Column"
              labelWidth={20}
              tooltip="Apply Grafana time range to this DateTime column"
            >
              <Combobox
                id="query-editor-time-filter"
                options={timeFilterOptions}
                value={query.timeFilterColumn ?? ''}
                onChange={onTimeFilterColumnChange}
                loading={columnsLoading}
                width={24}
              />
            </InlineField>
          )}

          {/* Info message for grouped aggregation queries */}
          {!showTimeFilter && (
            <div style={{ padding: '8px', color: '#888', fontSize: '12px' }}>
              Time filtering is not available for grouped aggregation queries.
            </div>
          )}
        </Stack>
      )}

      {/* Columns preview */}
      {columns.length > 0 && (
        <FieldSet label={`Columns (${columns.length})`}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #444' }}>
                <th style={{ textAlign: 'left', padding: '4px' }}>Attribute Path</th>
                <th style={{ textAlign: 'left', padding: '4px' }}>Type</th>
                {hasAggregations && (
                  <th style={{ textAlign: 'left', padding: '4px' }}>Aggregation</th>
                )}
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => (
                <tr key={col.attributePath}>
                  <td style={{ padding: '4px' }}>{col.attributePath}</td>
                  <td style={{ padding: '4px' }}>{col.attributeValueType}</td>
                  {hasAggregations && (
                    <td style={{ padding: '4px' }}>{col.aggregationType ?? '-'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </FieldSet>
      )}

      {/* Loading indicator for columns */}
      {columnsLoading && <div style={{ padding: '8px', color: '#888' }}>Loading columns...</div>}
    </Stack>
  );
}
