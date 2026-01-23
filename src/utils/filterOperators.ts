import { FilterOperator } from '../types';

/**
 * Human-readable labels for filter operators
 */
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  EQUALS: 'Equals',
  NOT_EQUALS: 'Not Equals',
  LESS_THAN: 'Less Than',
  GREATER_THAN: 'Greater Than',
  LESS_EQUAL_THAN: 'Less or Equal',
  GREATER_EQUAL_THAN: 'Greater or Equal',
  IN: 'In',
  NOT_IN: 'Not In',
  LIKE: 'Like',
  MATCH_REGEX: 'Regex Match',
  CONTAINS: 'Contains',
  STARTS_WITH: 'Starts With',
  ENDS_WITH: 'Ends With',
  BETWEEN: 'Between',
  IS_NULL: 'Is Null',
  IS_NOT_NULL: 'Is Not Null',
  ANY_EQ: 'Any Equals',
  ANY_LIKE: 'Any Like',
};

/** Comparison operators (numeric order) */
const COMPARISON_OPERATORS: FilterOperator[] = [
  'EQUALS',
  'NOT_EQUALS',
  'LESS_THAN',
  'GREATER_THAN',
  'LESS_EQUAL_THAN',
  'GREATER_EQUAL_THAN',
];

/** String-specific operators */
const STRING_OPERATORS: FilterOperator[] = ['LIKE', 'MATCH_REGEX', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH'];

/** Null-check operators */
const NULL_OPERATORS: FilterOperator[] = ['IS_NULL', 'IS_NOT_NULL'];

/** Array-specific operators */
const ARRAY_OPERATORS: FilterOperator[] = ['ANY_EQ', 'ANY_LIKE'];

/** Set/list operators */
const SET_OPERATORS: FilterOperator[] = ['IN', 'NOT_IN'];

/**
 * Operators valid for numeric types (Integer, Decimal, Double)
 */
const NUMERIC_OPERATORS: FilterOperator[] = [...COMPARISON_OPERATORS, ...SET_OPERATORS, 'BETWEEN', ...NULL_OPERATORS];

/**
 * Operators valid for DateTime type
 */
const DATETIME_OPERATORS: FilterOperator[] = [...COMPARISON_OPERATORS, 'BETWEEN', ...NULL_OPERATORS];

/**
 * Operators valid for String type
 */
const STRING_TYPE_OPERATORS: FilterOperator[] = [
  ...COMPARISON_OPERATORS,
  ...STRING_OPERATORS,
  ...SET_OPERATORS,
  ...NULL_OPERATORS,
];

/**
 * Operators valid for Boolean type
 */
const BOOLEAN_OPERATORS: FilterOperator[] = ['EQUALS', 'NOT_EQUALS', ...NULL_OPERATORS];

/**
 * Operators valid for Array types
 */
const ARRAY_TYPE_OPERATORS: FilterOperator[] = [...ARRAY_OPERATORS, ...NULL_OPERATORS];

/**
 * Get list of valid operators for a given column value type
 */
export function getOperatorsForType(valueType: string): FilterOperator[] {
  const normalizedType = valueType.toLowerCase().replace('_', '');

  switch (normalizedType) {
    case 'integer':
    case 'decimal':
    case 'double':
    case 'int':
    case 'float':
    case 'long':
      return NUMERIC_OPERATORS;

    case 'datetime':
    case 'date':
    case 'time':
      return DATETIME_OPERATORS;

    case 'boolean':
    case 'bool':
      return BOOLEAN_OPERATORS;

    case 'string':
    case 'text':
      return STRING_TYPE_OPERATORS;

    // Array types - check if type contains array indicators
    default:
      if (
        normalizedType.includes('array') ||
        normalizedType.includes('list') ||
        normalizedType.startsWith('[') ||
        normalizedType.endsWith('[]')
      ) {
        return ARRAY_TYPE_OPERATORS;
      }
      // Default to string operators for unknown types
      return STRING_TYPE_OPERATORS;
  }
}

/**
 * Check if an operator requires a comparison value
 * IS_NULL and IS_NOT_NULL don't need values
 */
export function requiresValue(operator: FilterOperator): boolean {
  return operator !== 'IS_NULL' && operator !== 'IS_NOT_NULL';
}

/**
 * Check if an operator requires two values (BETWEEN)
 */
export function requiresTwoValues(operator: FilterOperator): boolean {
  return operator === 'BETWEEN';
}

/**
 * Check if an operator accepts comma-separated list (IN, NOT_IN)
 */
export function acceptsMultipleValues(operator: FilterOperator): boolean {
  return operator === 'IN' || operator === 'NOT_IN';
}

/**
 * Get human-readable label for an operator
 */
export function getOperatorLabel(operator: FilterOperator): string {
  return OPERATOR_LABELS[operator] ?? operator;
}

/**
 * Get all available operators
 */
export function getAllOperators(): FilterOperator[] {
  return Object.keys(OPERATOR_LABELS) as FilterOperator[];
}
