
import { DataSource } from './datasource';
import {
    OctoMeshDataSourceOptions,
    OctoMeshQuery,
    RuntimeQueryResponse,
    CkTypeAttributesResponse,
    QueryColumnsResponse,
} from './types';
import { DataSourceInstanceSettings, dateTime } from '@grafana/data';

import { of } from 'rxjs';

// Mock the backend service
const fetchMock = jest.fn().mockReturnValue(
    of({
        data: {
            data: {
                runtime: {
                    runtimeQuery: {
                        items: [
                            {
                                queryRtId: 'mock-query-id',
                                associatedCkTypeId: 'mock-type-id',
                                columns: [],
                                rows: { items: [], totalCount: 0 },
                            },
                        ],
                    },
                },
            },
        } as RuntimeQueryResponse,
    })
);

jest.mock('@grafana/runtime', () => ({
    ...jest.requireActual('@grafana/runtime'),
    getBackendSrv: () => ({
        fetch: fetchMock,
    }),
}));

describe('DataSource', () => {
    const instanceSettings = {
        url: 'http://localhost:3000',
        jsonData: {
            tenantId: 'test-tenant',
        },
    } as DataSourceInstanceSettings<OctoMeshDataSourceOptions>;

    let ds: DataSource;

    beforeEach(() => {
        ds = new DataSource(instanceSettings);
        jest.clearAllMocks();
    });

    describe('query', () => {
        it('should pass time filter to backend when timeFilterColumn is set', async () => {
            const options: any = {
                range: {
                    from: dateTime('2023-01-01T00:00:00Z'),
                    to: dateTime('2023-01-02T00:00:00Z'),
                    raw: {
                        from: '2023-01-01T00:00:00Z',
                        to: '2023-01-02T00:00:00Z',
                    },
                },
                targets: [
                    {
                        refId: 'A',
                        queryRtId: 'query-1',
                        timeFilterColumn: 'createdAt',
                    } as OctoMeshQuery,
                ],
            };

            await ds.query(options);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const callArg = fetchMock.mock.calls[0][0];

            expect(callArg.url).toBe('http://localhost:3000/tenants/test-tenant/graphql');
            expect(callArg.data.variables.fieldFilter).toBeDefined();
            expect(callArg.data.variables.fieldFilter).toHaveLength(2);

            // Check start time filter
            expect(callArg.data.variables.fieldFilter).toContainEqual({
                attributePath: 'createdAt',
                operator: 'GREATER_EQUAL_THAN',
                comparisonValue: '2023-01-01T00:00:00.000Z',
            });

            // Check end time filter
            expect(callArg.data.variables.fieldFilter).toContainEqual({
                attributePath: 'createdAt',
                operator: 'LESS_EQUAL_THAN',
                comparisonValue: '2023-01-02T00:00:00.000Z',
            });
        });

        it('should NOT pass fieldFilter when timeFilterColumn is NOT set', async () => {
            const options: any = {
                range: {
                    from: dateTime('2023-01-01T00:00:00Z'),
                    to: dateTime('2023-01-02T00:00:00Z'),
                    raw: {
                        from: '2023-01-01T00:00:00Z',
                        to: '2023-01-02T00:00:00Z',
                    },
                },
                targets: [
                    {
                        refId: 'A',
                        queryRtId: 'query-1',
                        // No timeFilterColumn
                    } as OctoMeshQuery,
                ],
            };

            await ds.query(options);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const callArg = fetchMock.mock.calls[0][0];
            // Expect fieldFilter to be undefined as per implementation
            // The implementation does "fieldFilters.length > 0 ? fieldFilters : undefined"
            expect(callArg.data.variables.fieldFilter).toBeUndefined();
        });
    });
    describe('testDatasource', () => {
        it('should return success when tenant exists', async () => {
            fetchMock.mockReturnValueOnce(
                of({
                    data: {
                        list: [{ tenantId: 'test-tenant', database: 'db1' }],
                    },
                })
            );

            const result = await ds.testDatasource();

            expect(result.status).toBe('success');
            expect(result.message).toContain('Connected successfully to tenant "test-tenant"');
        });

        it('should return error when tenant does not exist', async () => {
            fetchMock.mockReturnValueOnce(
                of({
                    data: {
                        list: [{ tenantId: 'other-tenant', database: 'db1' }],
                    },
                })
            );

            const result = await ds.testDatasource();

            expect(result.status).toBe('error');
            expect(result.message).toContain('Configured tenant "test-tenant" not found');
        });

        it('should return error when no tenant is configured', async () => {
            ds.tenantId = undefined;
            fetchMock.mockReturnValueOnce(
                of({
                    data: {
                        list: [{ tenantId: 'any-tenant', database: 'db1' }],
                    },
                })
            );

            const result = await ds.testDatasource();

            expect(result.status).toBe('error');
            expect(result.message).toContain('Please select a tenant');
        });
    });

    describe('fetchTypeAttributes', () => {
        it('should fetch type attributes via GraphQL', async () => {
            const mockResponse: CkTypeAttributesResponse = {
                data: {
                    constructionKit: {
                        types: {
                            items: [
                                {
                                    availableQueryColumns: {
                                        items: [
                                            { attributePath: 'name', attributeValueType: 'String' },
                                            { attributePath: 'value', attributeValueType: 'Decimal' },
                                            { attributePath: 'timestamp', attributeValueType: 'DateTime' },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                },
            };

            fetchMock.mockReturnValueOnce(of({ data: mockResponse }));

            const result = await ds.fetchTypeAttributes('Industry.Basic/Alarm');

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const callArg = fetchMock.mock.calls[0][0];

            expect(callArg.url).toBe('http://localhost:3000/tenants/test-tenant/graphql');
            expect(callArg.data.variables.rtCkId).toBe('Industry.Basic/Alarm');
            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({ attributePath: 'name', attributeValueType: 'String' });
        });

        it('should return empty array when tenantId is not set', async () => {
            ds.tenantId = undefined;

            const result = await ds.fetchTypeAttributes('Industry.Basic/Alarm');

            expect(fetchMock).not.toHaveBeenCalled();
            expect(result).toEqual([]);
        });

        it('should return empty array when type not found', async () => {
            const mockResponse: CkTypeAttributesResponse = {
                data: {
                    constructionKit: {
                        types: {
                            items: [],
                        },
                    },
                },
            };

            fetchMock.mockReturnValueOnce(of({ data: mockResponse }));

            const result = await ds.fetchTypeAttributes('NonExistent/Type');

            expect(result).toEqual([]);
        });
    });

    describe('query with fieldFilters', () => {
        it('should use source attributes for filter type conversion when querySourceTypeId is set', async () => {
            // Mock for fetchTypeAttributes
            const typeAttributesMock: CkTypeAttributesResponse = {
                data: {
                    constructionKit: {
                        types: {
                            items: [
                                {
                                    availableQueryColumns: {
                                        items: [
                                            { attributePath: 'severity', attributeValueType: 'Integer' },
                                            { attributePath: 'message', attributeValueType: 'String' },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                },
            };

            // Mock for executeQuery (runtimeQuery)
            const runtimeQueryMock: RuntimeQueryResponse = {
                data: {
                    runtime: {
                        runtimeQuery: {
                            items: [
                                {
                                    queryRtId: 'query-1',
                                    associatedCkTypeId: 'System/AggregationRtQuery',
                                    columns: [{ attributePath: 'count', attributeValueType: 'Integer' }],
                                    rows: { items: [], totalCount: 0 },
                                },
                            ],
                        },
                    },
                },
            };

            // First call is fetchTypeAttributes, second is executeQuery
            fetchMock
                .mockReturnValueOnce(of({ data: typeAttributesMock }))
                .mockReturnValueOnce(of({ data: runtimeQueryMock }));

            const options: any = {
                range: {
                    from: dateTime('2023-01-01T00:00:00Z'),
                    to: dateTime('2023-01-02T00:00:00Z'),
                    raw: { from: '2023-01-01T00:00:00Z', to: '2023-01-02T00:00:00Z' },
                },
                targets: [
                    {
                        refId: 'A',
                        queryRtId: 'query-1',
                        queryCkTypeId: 'System/AggregationRtQuery',
                        querySourceTypeId: 'Industry.Basic/Alarm',
                        fieldFilters: [
                            { id: 'f1', attributePath: 'severity', operator: 'GREATER_THAN', comparisonValue: '5' },
                        ],
                    } as OctoMeshQuery,
                ],
            };

            await ds.query(options);

            expect(fetchMock).toHaveBeenCalledTimes(2);

            // First call should be fetchTypeAttributes with correct rtCkId
            const firstCallArg = fetchMock.mock.calls[0][0];
            expect(firstCallArg.data.variables.rtCkId).toBe('Industry.Basic/Alarm');

            // Second call should be executeQuery with converted filter (severity as integer)
            const secondCallArg = fetchMock.mock.calls[1][0];
            expect(secondCallArg.data.variables.fieldFilter).toBeDefined();
            expect(secondCallArg.data.variables.fieldFilter).toContainEqual({
                attributePath: 'severity',
                operator: 'GREATER_THAN',
                comparisonValue: 5, // Should be number, not string
            });
        });

        it('should fallback to columns when querySourceTypeId is NOT set', async () => {
            // Mock for fetchQueryColumns
            const columnsMock: QueryColumnsResponse = {
                data: {
                    runtime: {
                        runtimeQuery: {
                            items: [
                                {
                                    columns: [
                                        { attributePath: 'name', attributeValueType: 'String' },
                                        { attributePath: 'count', attributeValueType: 'Integer' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            };

            // Mock for executeQuery
            const runtimeQueryMock: RuntimeQueryResponse = {
                data: {
                    runtime: {
                        runtimeQuery: {
                            items: [
                                {
                                    queryRtId: 'query-1',
                                    associatedCkTypeId: 'System/SimpleRtQuery',
                                    columns: [{ attributePath: 'name', attributeValueType: 'String' }],
                                    rows: { items: [], totalCount: 0 },
                                },
                            ],
                        },
                    },
                },
            };

            // First call is fetchQueryColumns, second is executeQuery
            fetchMock
                .mockReturnValueOnce(of({ data: columnsMock }))
                .mockReturnValueOnce(of({ data: runtimeQueryMock }));

            const options: any = {
                range: {
                    from: dateTime('2023-01-01T00:00:00Z'),
                    to: dateTime('2023-01-02T00:00:00Z'),
                    raw: { from: '2023-01-01T00:00:00Z', to: '2023-01-02T00:00:00Z' },
                },
                targets: [
                    {
                        refId: 'A',
                        queryRtId: 'query-1',
                        queryCkTypeId: 'System/SimpleRtQuery',
                        // NO querySourceTypeId - should fallback to columns
                        fieldFilters: [
                            { id: 'f1', attributePath: 'name', operator: 'EQUALS', comparisonValue: 'test' },
                        ],
                    } as OctoMeshQuery,
                ],
            };

            await ds.query(options);

            expect(fetchMock).toHaveBeenCalledTimes(2);

            // First call should be fetchQueryColumns (runtimeQuery), not fetchTypeAttributes (constructionKit)
            const firstCallArg = fetchMock.mock.calls[0][0];
            expect(firstCallArg.data.query).toContain('runtimeQuery');
            expect(firstCallArg.data.query).not.toContain('constructionKit');
            expect(firstCallArg.data.variables.rtId).toBe('query-1');
        });

        it('should not call fetchTypeAttributes or fetchQueryColumns when no fieldFilters', async () => {
            const runtimeQueryMock: RuntimeQueryResponse = {
                data: {
                    runtime: {
                        runtimeQuery: {
                            items: [
                                {
                                    queryRtId: 'query-1',
                                    associatedCkTypeId: 'System/SimpleRtQuery',
                                    columns: [],
                                    rows: { items: [], totalCount: 0 },
                                },
                            ],
                        },
                    },
                },
            };

            fetchMock.mockReturnValueOnce(of({ data: runtimeQueryMock }));

            const options: any = {
                range: {
                    from: dateTime('2023-01-01T00:00:00Z'),
                    to: dateTime('2023-01-02T00:00:00Z'),
                    raw: { from: '2023-01-01T00:00:00Z', to: '2023-01-02T00:00:00Z' },
                },
                targets: [
                    {
                        refId: 'A',
                        queryRtId: 'query-1',
                        // No fieldFilters
                    } as OctoMeshQuery,
                ],
            };

            await ds.query(options);

            // Should only call executeQuery, not fetchTypeAttributes or fetchQueryColumns
            expect(fetchMock).toHaveBeenCalledTimes(1);
            const callArg = fetchMock.mock.calls[0][0];
            expect(callArg.data.variables.rtId).toBe('query-1');
        });
    });
});
