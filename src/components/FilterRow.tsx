import React, { useMemo } from 'react';
import { Combobox, IconButton, Input, Select, Stack } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { ComboboxOption } from '@grafana/ui/dist/types/components/Combobox/types';
import { UserFieldFilter, QueryColumnDto, FilterOperator } from '../types';
import {
  getOperatorsForType,
  getOperatorLabel,
  requiresValue,
  requiresTwoValues,
  acceptsMultipleValues,
} from '../utils/filterOperators';

interface FilterRowProps {
  filter: UserFieldFilter;
  columns: QueryColumnDto[];
  onChange: (filter: UserFieldFilter) => void;
  onRemove: () => void;
}

/**
 * Single filter row component with column, operator, and value inputs
 */
export function FilterRow({ filter, columns, onChange, onRemove }: FilterRowProps) {
  // Find selected column to determine value type
  const selectedColumn = useMemo(
    () => columns.find((c) => c.attributePath === filter.attributePath),
    [columns, filter.attributePath]
  );

  const valueType = selectedColumn?.attributeValueType ?? 'String';
  const normalizedType = valueType.toLowerCase().replace('_', '');

  // Get valid operators for the selected column type
  const validOperators = useMemo(() => {
    if (!filter.attributePath) {
      return [];
    }
    return getOperatorsForType(valueType);
  }, [filter.attributePath, valueType]);

  // Column options for dropdown
  const columnOptions: Array<ComboboxOption<string>> = useMemo(
    () =>
      columns.map((c) => ({
        label: c.attributePath,
        value: c.attributePath,
        description: c.attributeValueType,
      })),
    [columns]
  );

  // Operator options for dropdown
  const operatorOptions: Array<SelectableValue<FilterOperator>> = useMemo(
    () =>
      validOperators.map((op) => ({
        label: getOperatorLabel(op),
        value: op,
      })),
    [validOperators]
  );

  // Boolean value options
  const booleanOptions: Array<SelectableValue<string>> = [
    { label: 'True', value: 'true' },
    { label: 'False', value: 'false' },
  ];

  const onColumnChange = (option: ComboboxOption<string>) => {
    // Reset operator and values when column changes
    onChange({
      ...filter,
      attributePath: option.value,
      operator: undefined,
      comparisonValue: undefined,
      comparisonValueEnd: undefined,
    });
  };

  const onOperatorChange = (option: SelectableValue<FilterOperator>) => {
    // Reset values when operator changes
    onChange({
      ...filter,
      operator: option.value,
      comparisonValue: undefined,
      comparisonValueEnd: undefined,
    });
  };

  const onValueChange = (value: string) => {
    onChange({
      ...filter,
      comparisonValue: value,
    });
  };

  const onValueEndChange = (value: string) => {
    onChange({
      ...filter,
      comparisonValueEnd: value,
    });
  };

  // Determine input type based on column type
  const getInputType = (): string => {
    switch (normalizedType) {
      case 'integer':
      case 'int':
      case 'long':
      case 'decimal':
      case 'double':
      case 'float':
        return 'number';
      case 'datetime':
        return 'datetime-local';
      case 'date':
        return 'date';
      default:
        return 'text';
    }
  };

  // Get placeholder text for value input
  const getPlaceholder = (): string => {
    if (!filter.operator) {
      return 'Select operator first';
    }
    if (acceptsMultipleValues(filter.operator)) {
      return 'value1, value2, ...';
    }
    return 'Value';
  };

  // Render value input(s) based on operator and column type
  const renderValueInput = () => {
    if (!filter.operator || !requiresValue(filter.operator)) {
      return null;
    }

    // Boolean type gets a dropdown
    if (normalizedType === 'boolean' || normalizedType === 'bool') {
      return (
        <Select
          options={booleanOptions}
          value={filter.comparisonValue}
          onChange={(option) => onValueChange(option.value ?? '')}
          width={12}
          placeholder="Select..."
        />
      );
    }

    // BETWEEN needs two inputs
    if (requiresTwoValues(filter.operator)) {
      return (
        <>
          <Input
            type={getInputType()}
            value={filter.comparisonValue ?? ''}
            onChange={(e) => onValueChange(e.currentTarget.value)}
            width={16}
            placeholder="From"
          />
          <span style={{ alignSelf: 'center' }}>and</span>
          <Input
            type={getInputType()}
            value={filter.comparisonValueEnd ?? ''}
            onChange={(e) => onValueEndChange(e.currentTarget.value)}
            width={16}
            placeholder="To"
          />
        </>
      );
    }

    // Standard single-value input
    return (
      <Input
        type={getInputType()}
        value={filter.comparisonValue ?? ''}
        onChange={(e) => onValueChange(e.currentTarget.value)}
        width={24}
        placeholder={getPlaceholder()}
      />
    );
  };

  return (
    <Stack direction="row" gap={1} alignItems="center">
      {/* Column selector */}
      <Combobox
        options={columnOptions}
        value={filter.attributePath ?? null}
        onChange={onColumnChange}
        width={24}
        placeholder="Select column"
      />

      {/* Operator selector */}
      <Select
        options={operatorOptions}
        value={filter.operator}
        onChange={onOperatorChange}
        width={18}
        placeholder="Operator"
        disabled={!filter.attributePath}
      />

      {/* Value input(s) */}
      {renderValueInput()}

      {/* Remove button */}
      <IconButton name="trash-alt" onClick={onRemove} tooltip="Remove filter" variant="destructive" />
    </Stack>
  );
}
