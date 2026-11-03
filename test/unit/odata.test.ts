import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildQueryString,
  buildStructuredFilter,
  formatLiteral,
  incrementalLiteral,
  parseSapTimestamp,
  toSapTimestamp,
} from '../../src/modules/common/integrations/engine/providers/sap-odata/odata-query.js';
import { normaliseRecord, parsePage } from '../../src/modules/common/integrations/engine/providers/sap-odata/sap-odata.adapter.js';
import { missingFields, parseMetadata } from '../../src/modules/common/integrations/engine/providers/sap-odata/odata-metadata.js';
import { sapConnectionSchema, sapProfileSettingsSchema } from '../../src/modules/common/integrations/engine/providers/sap-odata/sap-odata.schemas.js';
import { IntegrationError } from '../../src/modules/common/integrations/engine/core/errors.js';

const since = new Date('2026-07-01T10:15:30.123Z');

describe('OData query building', () => {
  it('formats literals per version and escapes quotes', () => {
    assert.equal(formatLiteral("O'Brien", 'string', 'v2'), "'O''Brien'");
    assert.equal(formatLiteral('2026-07-01', 'date', 'v2'), "datetime'2026-07-01T00:00:00'");
    assert.equal(formatLiteral('2026-07-01', 'date', 'v4'), '2026-07-01');
    assert.equal(formatLiteral('2026-07-01T10:00:00Z', 'datetimeoffset', 'v2'), "datetimeoffset'2026-07-01T10:00:00Z'");
    assert.throws(() => formatLiteral('1 or 1 eq 1', 'number', 'v2'), /not a number/);
  });

  it('builds structured filters (eq, in, startswith) for V2 and V4', () => {
    assert.equal(buildStructuredFilter({ field: 'CompanyCode', operator: 'in', type: 'string', values: ['1010', '2020'] }, 'v2'), "(CompanyCode eq '1010' or CompanyCode eq '2020')");
    assert.equal(buildStructuredFilter({ field: 'Supplier', operator: 'startswith', type: 'string', values: ['173'] }, 'v2'), "startswith(Supplier,'173') eq true");
    assert.equal(buildStructuredFilter({ field: 'Supplier', operator: 'startswith', type: 'string', values: ['173'] }, 'v4'), "startswith(Supplier,'173')");
    assert.throws(() => buildStructuredFilter({ field: "x') or (1", operator: 'eq', type: 'string', values: ['a'] }, 'v2'), /Invalid field/);
  });

  it('builds incremental literals for each field type', () => {
    assert.equal(incrementalLiteral(since, 'DateTimeOffset', 'v2'), "datetimeoffset'2026-07-01T10:15:30Z'");
    assert.equal(incrementalLiteral(since, 'DateTime', 'v2'), "datetime'2026-07-01T10:15:30'");
    assert.equal(incrementalLiteral(since, 'DateTimeOffset', 'v4'), '2026-07-01T10:15:30Z');
    assert.equal(incrementalLiteral(since, 'TimestampDecimal', 'v4'), '20260701101530');
    assert.equal(parseSapTimestamp(toSapTimestamp(since))?.toISOString(), '2026-07-01T10:15:30.000Z');
  });

  it('encodes the query with %20 (not +) and keeps $ readable', () => {
    const qs = buildQueryString({ select: 'A, B', filters: ["CompanyCode eq '1010'", ''], orderBy: 'A asc', top: 50, skip: 100, extra: { 'sap-client': '100' } }, 'v2');
    assert.equal(qs, "$select=A,B&$filter=(CompanyCode%20eq%20'1010')&$orderby=A%20asc&$top=50&$skip=100&$format=json&sap-client=100");
    assert.ok(!buildQueryString({ filters: [], top: 1 }, 'v4').includes('$format'));
  });
});

describe('OData responses', () => {
  it('normalises V2 payloads (d.results, __metadata, deferred, nested results) and next links', () => {
    const page = parsePage(JSON.stringify({
      d: {
        results: [{ __metadata: { uri: 'x' }, A: 1, to_Tax: { __deferred: { uri: 'y' } }, to_Items: { results: [{ __metadata: {}, B: 2 }] } }],
        __next: 'https://sap.example/svc/E?$skiptoken=10',
      },
    }), 'v2');
    assert.deepEqual(page.records, [{ A: 1, to_Items: [{ B: 2 }] }]);
    assert.equal(page.nextLink, 'https://sap.example/svc/E?$skiptoken=10');
  });

  it('normalises V4 payloads (value, @odata annotations, nextLink)', () => {
    const page = parsePage(JSON.stringify({ '@odata.context': 'x', value: [{ A: 1, 'A@odata.type': 'x', '@odata.etag': 'W/1' }], '@odata.nextLink': 'E?$skiptoken=2' }), 'v4');
    assert.deepEqual(page.records, [{ A: 1 }]);
    assert.equal(page.nextLink, 'E?$skiptoken=2');
    assert.deepEqual(normaliseRecord({ x: null }), { x: null });
  });

  it('reports non-JSON / wrong-version responses clearly', () => {
    assert.throws(() => parsePage('<html>login</html>', 'v2'), (e: unknown) => e instanceof IntegrationError && e.code === 'RESPONSE_INVALID');
    assert.throws(() => parsePage('{"value":[]}', 'v2'), /no collection found/);
  });

  it('reads $metadata and finds missing fields', () => {
    const md = parseMetadata(`<edmx:Edmx><Schema><EntityType Name="T"><Property Name="A" Type="Edm.String"/><NavigationProperty Name="to_B"/></EntityType>
      <EntityContainer><EntitySet EntityType="NS.T" Name="ES"/></EntityContainer></Schema></edmx:Edmx>`);
    assert.equal(md.entitySets.get('ES'), 'T');
    assert.deepEqual(missingFields(md, 'ES', ['A', 'to_B/Name', 'C']), ['C']);
    assert.equal(missingFields(md, 'Nope', ['A']), null);
  });
});

describe('SAP OData configuration validation', () => {
  it('validates connection settings', () => {
    assert.equal(sapConnectionSchema.safeParse({ baseUrl: 'https://sap.example/', servicePath: '/sap/opu/odata/sap/API_X/' }).data?.baseUrl, 'https://sap.example');
    assert.equal(sapConnectionSchema.safeParse({ baseUrl: 'nope', servicePath: '/x' }).success, false);
    assert.equal(sapConnectionSchema.safeParse({ baseUrl: 'https://s', servicePath: 'no-slash' }).success, false);
    assert.equal(sapConnectionSchema.safeParse({ baseUrl: 'https://s', servicePath: '/x', sapClient: '1' }).success, false);
    assert.equal(sapConnectionSchema.safeParse({ baseUrl: 'https://s', servicePath: '/x', customHeaders: { Authorization: 'x' } }).success, false);
  });

  it('validates extraction settings ($select, $orderby, filters, page size)', () => {
    assert.equal(sapProfileSettingsSchema.safeParse({ entitySet: 'A_SupplierInvoice', select: 'A,B/C', orderBy: 'A asc, B desc' }).success, true);
    assert.equal(sapProfileSettingsSchema.safeParse({ entitySet: 'A_SupplierInvoice;drop' }).success, false);
    assert.equal(sapProfileSettingsSchema.safeParse({ entitySet: 'E', select: 'A B' }).success, false);
    assert.equal(sapProfileSettingsSchema.safeParse({ entitySet: 'E', pageSize: 0 }).success, false);
    assert.equal(sapProfileSettingsSchema.safeParse({ entitySet: 'E', filters: [{ field: 'X', operator: 'eq', values: [] }] }).success, false);
  });
});
