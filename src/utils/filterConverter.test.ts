import { convertUserFiltersToDto, generateFilterId } from './filterConverter';
import { UserFieldFilter, QueryColumnDto, CkTypeAttributeDto } from '../types';

describe('convertUserFiltersToDto', () => {
  // Type conversion tests
  describe('type conversions', () => {
    it('should convert Integer values correctly', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'count', operator: 'EQUALS', comparisonValue: '42' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'count', attributeValueType: 'Integer' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe(42);
      expect(typeof result[0].comparisonValue).toBe('number');
    });

    it('should convert Decimal values correctly', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'price', operator: 'GREATER_THAN', comparisonValue: '99.99' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'price', attributeValueType: 'Decimal' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe(99.99);
      expect(typeof result[0].comparisonValue).toBe('number');
    });

    it('should convert Double values correctly', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'ratio', operator: 'LESS_THAN', comparisonValue: '0.123' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'ratio', attributeValueType: 'Double' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe(0.123);
    });

    it('should convert Boolean values correctly - true', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'active', operator: 'EQUALS', comparisonValue: 'true' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'active', attributeValueType: 'Boolean' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe(true);
      expect(typeof result[0].comparisonValue).toBe('boolean');
    });

    it('should convert Boolean values correctly - false', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'active', operator: 'EQUALS', comparisonValue: 'false' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'active', attributeValueType: 'Boolean' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe(false);
    });

    it('should convert DateTime values as-is (string)', () => {
      const filters: UserFieldFilter[] = [
        {
          id: 'f1',
          attributePath: 'createdAt',
          operator: 'GREATER_THAN',
          comparisonValue: '2023-01-01T00:00:00Z',
        },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'createdAt', attributeValueType: 'DateTime' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe('2023-01-01T00:00:00Z');
      expect(typeof result[0].comparisonValue).toBe('string');
    });

    it('should handle String values as-is', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'name', operator: 'EQUALS', comparisonValue: 'test value' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'name', attributeValueType: 'String' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe('test value');
    });

    it('should default to String for unknown types', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'custom', operator: 'EQUALS', comparisonValue: '42' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'custom', attributeValueType: 'UnknownType' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe('42'); // Stays as string
    });

    it('should default to String when column not found', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'missing', operator: 'EQUALS', comparisonValue: '123' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'other', attributeValueType: 'Integer' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toBe('123'); // String because column not found
    });
  });

  // Operator tests
  describe('operator handling', () => {
    it('should skip filters without attributePath', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', operator: 'EQUALS', comparisonValue: 'test' }, // Missing attributePath
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'name', attributeValueType: 'String' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(0);
    });

    it('should skip filters without operator', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'name', comparisonValue: 'test' }, // Missing operator
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'name', attributeValueType: 'String' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(0);
    });

    it('should handle IS_NULL without value', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'name', operator: 'IS_NULL' }, // No value needed
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'name', attributeValueType: 'String' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        attributePath: 'name',
        operator: 'IS_NULL',
        comparisonValue: null,
      });
    });

    it('should handle IS_NOT_NULL without value', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'count', operator: 'IS_NOT_NULL' },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'count', attributeValueType: 'Integer' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        attributePath: 'count',
        operator: 'IS_NOT_NULL',
        comparisonValue: null,
      });
    });

    it('should handle BETWEEN with two values', () => {
      const filters: UserFieldFilter[] = [
        {
          id: 'f1',
          attributePath: 'value',
          operator: 'BETWEEN',
          comparisonValue: '10',
          comparisonValueEnd: '20',
        },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'value', attributeValueType: 'Integer' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toEqual([10, 20]);
    });

    it('should skip BETWEEN when missing end value', () => {
      const filters: UserFieldFilter[] = [
        {
          id: 'f1',
          attributePath: 'value',
          operator: 'BETWEEN',
          comparisonValue: '10',
          // Missing comparisonValueEnd
        },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'value', attributeValueType: 'Integer' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(0);
    });

    it('should handle IN with comma-separated values', () => {
      const filters: UserFieldFilter[] = [
        {
          id: 'f1',
          attributePath: 'status',
          operator: 'IN',
          comparisonValue: 'active, pending, complete',
        },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'status', attributeValueType: 'String' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toEqual(['active', 'pending', 'complete']);
    });

    it('should handle NOT_IN with comma-separated numeric values', () => {
      const filters: UserFieldFilter[] = [
        {
          id: 'f1',
          attributePath: 'errorCode',
          operator: 'NOT_IN',
          comparisonValue: '1, 2, 3',
        },
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'errorCode', attributeValueType: 'Integer' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toEqual([1, 2, 3]);
    });

    it('should skip IN without value', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'status', operator: 'IN' }, // No value
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'status', attributeValueType: 'String' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(0);
    });

    it('should skip standard operators without value', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'name', operator: 'EQUALS' }, // No value
      ];
      const columns: QueryColumnDto[] = [{ attributePath: 'name', attributeValueType: 'String' }];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(0);
    });
  });

  // CkTypeAttributeDto compatibility tests
  describe('CkTypeAttributeDto compatibility', () => {
    it('should work with CkTypeAttributeDto objects (same shape as QueryColumnDto)', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'severity', operator: 'GREATER_THAN', comparisonValue: '5' },
        { id: 'f2', attributePath: 'message', operator: 'CONTAINS', comparisonValue: 'error' },
      ];

      // CkTypeAttributeDto has the same shape as QueryColumnDto for these properties
      const attributes: CkTypeAttributeDto[] = [
        { attributePath: 'severity', attributeValueType: 'Integer' },
        { attributePath: 'message', attributeValueType: 'String' },
        { attributePath: 'timestamp', attributeValueType: 'DateTime' },
      ];

      const result = convertUserFiltersToDto(filters, attributes);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        attributePath: 'severity',
        operator: 'GREATER_THAN',
        comparisonValue: 5, // Converted to number
      });
      expect(result[1]).toEqual({
        attributePath: 'message',
        operator: 'CONTAINS',
        comparisonValue: 'error',
      });
    });

    it('should use source attribute types for conversion, not result column types', () => {
      // This test verifies the main use case: filtering by source entity attributes
      // which may have different types than aggregated result columns
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'value', operator: 'BETWEEN', comparisonValue: '100.5', comparisonValueEnd: '200.5' },
      ];

      const sourceAttributes: CkTypeAttributeDto[] = [
        { attributePath: 'value', attributeValueType: 'Decimal' },
      ];

      const result = convertUserFiltersToDto(filters, sourceAttributes);

      expect(result).toHaveLength(1);
      expect(result[0].comparisonValue).toEqual([100.5, 200.5]);
    });
  });

  // Multiple filters test
  describe('multiple filters', () => {
    it('should process multiple filters correctly', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'name', operator: 'CONTAINS', comparisonValue: 'test' },
        { id: 'f2', attributePath: 'count', operator: 'GREATER_THAN', comparisonValue: '10' },
        { id: 'f3', attributePath: 'active', operator: 'EQUALS', comparisonValue: 'true' },
      ];
      const columns: QueryColumnDto[] = [
        { attributePath: 'name', attributeValueType: 'String' },
        { attributePath: 'count', attributeValueType: 'Integer' },
        { attributePath: 'active', attributeValueType: 'Boolean' },
      ];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(3);
      expect(result[0].comparisonValue).toBe('test');
      expect(result[1].comparisonValue).toBe(10);
      expect(result[2].comparisonValue).toBe(true);
    });

    it('should skip invalid filters and keep valid ones', () => {
      const filters: UserFieldFilter[] = [
        { id: 'f1', attributePath: 'name', operator: 'EQUALS', comparisonValue: 'valid' },
        { id: 'f2', operator: 'EQUALS', comparisonValue: 'invalid' }, // Missing attributePath
        { id: 'f3', attributePath: 'count', operator: 'GREATER_THAN', comparisonValue: '5' },
      ];
      const columns: QueryColumnDto[] = [
        { attributePath: 'name', attributeValueType: 'String' },
        { attributePath: 'count', attributeValueType: 'Integer' },
      ];

      const result = convertUserFiltersToDto(filters, columns);

      expect(result).toHaveLength(2);
      expect(result[0].attributePath).toBe('name');
      expect(result[1].attributePath).toBe('count');
    });
  });
});

describe('generateFilterId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateFilterId();
    const id2 = generateFilterId();

    expect(id1).not.toBe(id2);
  });

  it('should start with filter- prefix', () => {
    const id = generateFilterId();

    expect(id.startsWith('filter-')).toBe(true);
  });
});
