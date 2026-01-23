import { UserFieldFilter, FieldFilterDto, QueryColumnDto, FilterOperator } from '../types';
import { requiresValue, requiresTwoValues, acceptsMultipleValues } from './filterOperators';

/**
 * Convert a string value to the appropriate type based on column type
 */
function convertValueToType(value: string, valueType: string): unknown {
  const normalizedType = valueType.toLowerCase().replace('_', '');

  switch (normalizedType) {
    case 'integer':
    case 'int':
    case 'long':
      return parseInt(value, 10);

    case 'decimal':
    case 'double':
    case 'float':
      return parseFloat(value);

    case 'boolean':
    case 'bool':
      return value.toLowerCase() === 'true';

    case 'datetime':
    case 'date':
      // Return ISO string for datetime values
      return value;

    default:
      // String and unknown types stay as-is
      return value;
  }
}

/**
 * Parse comma-separated values into an array with type conversion
 */
function parseMultipleValues(value: string, valueType: string): unknown[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => convertValueToType(v, valueType));
}

/**
 * Convert user-defined field filters (UI representation) to GraphQL FieldFilterDto objects
 *
 * @param userFilters - Array of user filters from the query editor
 * @param columns - Column definitions for type conversion
 * @returns Array of FieldFilterDto ready for GraphQL execution
 */
export function convertUserFiltersToDto(
  userFilters: UserFieldFilter[],
  columns: QueryColumnDto[]
): FieldFilterDto[] {
  const result: FieldFilterDto[] = [];

  for (const filter of userFilters) {
    // Skip incomplete filters
    if (!filter.attributePath || !filter.operator) {
      continue;
    }

    // Find column to get value type
    const column = columns.find((c) => c.attributePath === filter.attributePath);
    const valueType = column?.attributeValueType ?? 'String';

    const dto: FieldFilterDto = {
      attributePath: filter.attributePath,
      operator: filter.operator,
      comparisonValue: null,
    };

    // Handle operators that don't need values
    if (!requiresValue(filter.operator)) {
      result.push(dto);
      continue;
    }

    // For BETWEEN, we need two values as an array
    if (requiresTwoValues(filter.operator)) {
      if (!filter.comparisonValue || !filter.comparisonValueEnd) {
        // Skip incomplete BETWEEN filter
        continue;
      }
      dto.comparisonValue = [
        convertValueToType(filter.comparisonValue, valueType),
        convertValueToType(filter.comparisonValueEnd, valueType),
      ];
      result.push(dto);
      continue;
    }

    // For IN/NOT_IN, parse comma-separated values into array
    if (acceptsMultipleValues(filter.operator)) {
      if (!filter.comparisonValue) {
        continue;
      }
      dto.comparisonValue = parseMultipleValues(filter.comparisonValue, valueType);
      result.push(dto);
      continue;
    }

    // Standard single-value operators
    if (!filter.comparisonValue) {
      // Skip filter without required value
      continue;
    }
    dto.comparisonValue = convertValueToType(filter.comparisonValue, valueType);
    result.push(dto);
  }

  return result;
}

/**
 * Generate a unique ID for a new filter
 */
export function generateFilterId(): string {
  return `filter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
