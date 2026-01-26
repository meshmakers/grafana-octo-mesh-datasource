import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Badge, Button, Combobox, FieldSet, InlineField, Input, Stack } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { ComboboxOption } from '@grafana/ui/dist/types/components/Combobox/types';
import { DataSource } from '../datasource';
import { OctoMeshDataSourceOptions, OctoMeshQuery, SystemQueryDto, QueryColumnDto, UserFieldFilter, CkTypeAttributeDto } from '../types';
import { QueryType, getQueryType, getQueryTypeLabel } from '../queryTypes';
import { FilterRow } from './FilterRow';
import { generateFilterId } from '../utils/filterConverter';

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
  const [sourceAttributes, setSourceAttributes] = useState<CkTypeAttributeDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [attributesLoading, setAttributesLoading] = useState(false);
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

  // Load columns when query changes (for result preview)
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

  // Load source attributes when querySourceTypeId changes (for filter dropdowns)
  useEffect(() => {
    if (!query.querySourceTypeId) {
      setSourceAttributes([]);
      return;
    }
    setAttributesLoading(true);
    datasource
      .fetchTypeAttributes(query.querySourceTypeId)
      .then(setSourceAttributes)
      .catch(() => setSourceAttributes([]))
      .finally(() => setAttributesLoading(false));
  }, [query.querySourceTypeId, datasource]);

  // Determine query type from cached queryCkTypeId
  const queryType = useMemo(() => getQueryType(query.queryCkTypeId), [query.queryCkTypeId]);

  // DateTime attributes for time filter dropdown (from source entity type)
  // Use sourceAttributes when available (for proper filtering on source entity attributes)
  // Fall back to columns for Simple queries or when sourceAttributes not yet loaded
  const attributesForFiltering = sourceAttributes.length > 0 ? sourceAttributes : columns;
  const dateTimeAttributes = attributesForFiltering.filter((c) => {
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
      querySourceTypeId: selected?.queryCkTypeId, // Cache the source entity type (e.g., "Industry.Basic/Alarm")
      timeFilterColumn: undefined, // Reset time filter when query changes
      fieldFilters: [], // Reset filters when query changes (source attributes will be different)
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

  // Filter handlers
  const onAddFilter = useCallback(() => {
    const newFilter: UserFieldFilter = {
      id: generateFilterId(),
    };
    onChange({
      ...query,
      fieldFilters: [...(query.fieldFilters ?? []), newFilter],
    });
  }, [query, onChange]);

  const onFilterChange = useCallback(
    (id: string, updated: UserFieldFilter) => {
      onChange({
        ...query,
        fieldFilters: (query.fieldFilters ?? []).map((f) => (f.id === id ? updated : f)),
      });
    },
    [query, onChange]
  );

  const onRemoveFilter = useCallback(
    (id: string) => {
      onChange({
        ...query,
        fieldFilters: (query.fieldFilters ?? []).filter((f) => f.id !== id),
      });
      onRunQuery();
    },
    [query, onChange, onRunQuery]
  );

  const queryOptions: Array<ComboboxOption<string>> = systemQueries.map((q) => ({
    label: q.name,
    value: q.rtId,
    description: q.queryCkTypeId,
  }));

  const timeFilterOptions: Array<ComboboxOption<string>> = [
    { label: 'None', value: '' },
    ...dateTimeAttributes.map((c) => ({ label: c.attributePath, value: c.attributePath })),
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

          <InlineField
            label="Time Filter Column"
            labelWidth={20}
            tooltip="Apply Grafana time range to this DateTime attribute from source entity"
          >
            <Combobox
              id="query-editor-time-filter"
              options={timeFilterOptions}
              value={query.timeFilterColumn ?? ''}
              onChange={onTimeFilterColumnChange}
              loading={attributesLoading || columnsLoading}
              width={24}
            />
          </InlineField>
        </Stack>
      )}

      {/* Field Filters section - only show when query is selected and source attributes are loaded */}
      {query.queryRtId && attributesForFiltering.length > 0 && (
        <FieldSet
          label={`Field Filters${query.fieldFilters?.length ? ` (${query.fieldFilters.length})` : ''}`}
        >
          <Stack direction="column" gap={1}>
            {(query.fieldFilters ?? []).map((filter) => (
              <FilterRow
                key={filter.id}
                filter={filter}
                columns={attributesForFiltering}
                onChange={(updated) => onFilterChange(filter.id, updated)}
                onRemove={() => onRemoveFilter(filter.id)}
              />
            ))}
            <div>
              <Button
                variant="secondary"
                size="sm"
                icon="plus"
                onClick={onAddFilter}
              >
                Add Filter
              </Button>
              {(query.fieldFilters?.length ?? 0) > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onRunQuery}
                  style={{ marginLeft: '8px' }}
                >
                  Apply Filters
                </Button>
              )}
            </div>
          </Stack>
        </FieldSet>
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
