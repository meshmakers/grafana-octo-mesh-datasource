
import { DataSource } from './datasource';
import {
    OctoMeshDataSourceOptions,
    OctoMeshQuery,
    RuntimeQueryResponse,
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
});
