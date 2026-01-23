import React, { useEffect, useState } from 'react';
import { Combobox, FieldSet, InlineField, Input, Stack, Switch, MultiSelect } from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { ComboboxOption } from '@grafana/ui/dist/types/components/Combobox/types';
import { DataSource } from '../datasource';
import { OctoMeshDataSourceOptions, OctoMeshQuery, SystemQueryDto, QueryColumnDto } from '../types';

type Props = QueryEditorProps<DataSource, OctoMeshQuery, OctoMeshDataSourceOptions>;

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

  // DateTime columns for time filter dropdown
  const dateTimeColumns = columns.filter((c) => {
    const lower = c.attributeValueType.toLowerCase();
    return lower === 'datetime' || lower === 'date_time';
  });

  // Numeric columns for aggregation functions
  const numericColumns = columns.filter((c) => {
    const lower = c.attributeValueType.toLowerCase();
    return ['integer', 'decimal', 'double', 'number', 'float', 'long'].includes(lower);
  });

  const onQueryChange = (option: ComboboxOption<string>) => {
    const selected = systemQueries.find((q) => q.rtId === option.value);
    onChange({
      ...query,
      queryRtId: option.value,
      queryName: selected?.name,
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

  const onApplyAggregationChange = (e: React.FormEvent<HTMLInputElement>) => {
    onChange({ ...query, applyAggregation: e.currentTarget.checked });
    onRunQuery();
  };

  const onAggregationGroupByChange = (options: Array<SelectableValue<string>>) => {
    onChange({
      ...query,
      aggregationGroupBy: options.map((o) => o.value).filter((v): v is string => !!v),
    });
    onRunQuery();
  };

  const onAggregationSumChange = (options: Array<SelectableValue<string>>) => {
    onChange({
      ...query,
      aggregationSum: options.map((o) => o.value).filter((v): v is string => !!v),
    });
    onRunQuery();
  };

  const onAggregationAvgChange = (options: Array<SelectableValue<string>>) => {
    onChange({
      ...query,
      aggregationAvg: options.map((o) => o.value).filter((v): v is string => !!v),
    });
    onRunQuery();
  };

  const onAggregationMinChange = (options: Array<SelectableValue<string>>) => {
    onChange({
      ...query,
      aggregationMin: options.map((o) => o.value).filter((v): v is string => !!v),
    });
    onRunQuery();
  };

  const onAggregationMaxChange = (options: Array<SelectableValue<string>>) => {
    onChange({
      ...query,
      aggregationMax: options.map((o) => o.value).filter((v): v is string => !!v),
    });
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
        </Stack>
      )}

      {/* Aggregation Configuration */}
      {query.queryRtId && (
        <Stack direction="column" gap={1}>
          <Stack direction="row" gap={2}>
            <InlineField label="Apply Aggregation" labelWidth={20} tooltip="Enable server-side Group By aggregation.">
              <Switch value={query.applyAggregation ?? false} onChange={onApplyAggregationChange} />
            </InlineField>

            {query.applyAggregation && (
              <InlineField label="Group By" labelWidth={16} tooltip="Select columns to group by.">
                <MultiSelect
                  options={columns.map(c => ({ label: c.attributePath, value: c.attributePath }))}
                  value={query.aggregationGroupBy}
                  onChange={onAggregationGroupByChange}
                  placeholder="Select columns..."
                  width={40}
                />
              </InlineField>
            )}
          </Stack>

          {/* Aggregation Functions - only show when aggregation is enabled */}
          {query.applyAggregation && (
            <Stack direction="row" gap={2} wrap="wrap">
              <InlineField label="Sum" labelWidth={8} tooltip="Calculate sum of selected numeric columns per group.">
                <MultiSelect
                  options={numericColumns.map(c => ({ label: c.attributePath, value: c.attributePath }))}
                  value={query.aggregationSum}
                  onChange={onAggregationSumChange}
                  placeholder="Select columns..."
                  width={30}
                />
              </InlineField>

              <InlineField label="Average" labelWidth={10} tooltip="Calculate average of selected numeric columns per group.">
                <MultiSelect
                  options={numericColumns.map(c => ({ label: c.attributePath, value: c.attributePath }))}
                  value={query.aggregationAvg}
                  onChange={onAggregationAvgChange}
                  placeholder="Select columns..."
                  width={30}
                />
              </InlineField>

              <InlineField label="Min" labelWidth={8} tooltip="Get minimum value of selected numeric columns per group.">
                <MultiSelect
                  options={numericColumns.map(c => ({ label: c.attributePath, value: c.attributePath }))}
                  value={query.aggregationMin}
                  onChange={onAggregationMinChange}
                  placeholder="Select columns..."
                  width={30}
                />
              </InlineField>

              <InlineField label="Max" labelWidth={8} tooltip="Get maximum value of selected numeric columns per group.">
                <MultiSelect
                  options={numericColumns.map(c => ({ label: c.attributePath, value: c.attributePath }))}
                  value={query.aggregationMax}
                  onChange={onAggregationMaxChange}
                  placeholder="Select columns..."
                  width={30}
                />
              </InlineField>
            </Stack>
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
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => (
                <tr key={col.attributePath}>
                  <td style={{ padding: '4px' }}>{col.attributePath}</td>
                  <td style={{ padding: '4px' }}>{col.attributeValueType}</td>
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
