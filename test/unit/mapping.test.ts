import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProfileConfig } from '../../src/modules/common/integrations/engine/core/contracts.js';
import {
  evaluateCancellation,
  fieldMappingSchema,
  mapRecord,
  parseSourceDate,
  renderInvoiceCode,
  type FieldMapping,
} from '../../src/modules/common/integrations/engine/core/mapping/field-mapper.js';
import { baseMapping, uid } from '../support/fakes.js';

const profile = (overrides: Partial<ProfileConfig> = {}): ProfileConfig => ({
  id: uid(1), name: 'GP', isActive: true, moduleId: uid(1), moduleSlug: 'GP', invoicePrefix: 'GP', settings: {},
  keyFields: ['CompanyCode', 'FiscalYear', 'SupplierInvoice'],
  invoiceCodeTemplate: 'INV-{prefix}-SAP-{SupplierInvoice}-{FiscalYear}',
  fieldMapping: baseMapping as FieldMapping,
  cancellationRule: { field: 'ReverseDocument', operator: 'notEmpty', values: [], setStatus: 'Rejected', onlyWhenStatusIn: ['Pending'] },
  defaultStatus: 'Pending', initialFrom: null, watermark: null,
  ...overrides,
});

const sapRecord = (overrides: Record<string, unknown> = {}) => ({
  CompanyCode: '1010', FiscalYear: '2026', SupplierInvoice: '5105600001',
  InvoicingPartyName: 'Molinos Agro S.A.', TaxNumber1: '30500012349', SupplierInvoiceIDByInvcgParty: '0001-00045000',
  DocumentDate: '/Date(1782864000000)/', PostingDate: '/Date(1782950400000)/', DocumentCurrency: 'ars',
  InvoiceGrossAmount: '12500.00', ReverseDocument: '',
  ...overrides,
});

describe('Field mapping', () => {
  it('maps an OData V2 SAP record to the canonical invoice', () => {
    const result = mapRecord(sapRecord(), profile(), new Date('2026-07-01T10:00:00Z'));
    assert.ok(result.ok);
    assert.equal(result.invoice.externalKey, '1010/2026/5105600001');
    assert.deepEqual(result.invoice.externalDoc, { CompanyCode: '1010', FiscalYear: '2026', SupplierInvoice: '5105600001' });
    assert.equal(result.invoice.invoiceCode, 'INV-GP-SAP-5105600001-2026');
    assert.equal(result.invoice.cuit, '30-50001234-9');
    assert.equal(result.invoice.amount, 12500);
    assert.equal(result.invoice.currencyCode, 'ARS');
    assert.equal(result.invoice.invoiceDate, '2026-07-01');
    assert.equal(result.invoice.receptionDate, '2026-07-02');
    assert.equal(result.invoice.cancelled, false);
    assert.equal(result.invoice.sourceChangedAt, '2026-07-01T10:00:00.000Z');
    assert.match(result.payloadHash, /^[0-9a-f]{64}$/);
  });

  it('hash ignores the change timestamp but reflects business changes', () => {
    const a = mapRecord(sapRecord(), profile(), new Date('2026-07-01T10:00:00Z'));
    const b = mapRecord(sapRecord(), profile(), new Date('2026-07-05T10:00:00Z'));
    const c = mapRecord(sapRecord({ InvoiceGrossAmount: '12600.00' }), profile(), null);
    assert.ok(a.ok && b.ok && c.ok);
    assert.equal(a.payloadHash, b.payloadHash);
    assert.notEqual(a.payloadHash, c.payloadHash);
  });

  it('rejects records with missing key fields (mapping stage)', () => {
    const result = mapRecord(sapRecord({ SupplierInvoice: '' }), profile(), null);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.stage === 'mapping' && result.message.includes('SupplierInvoice'));
  });

  it('rejects invalid values with field-level reasons (validation stage)', () => {
    const result = mapRecord(sapRecord({ TaxNumber1: '123', InvoiceGrossAmount: 'abc', PostingDate: null }), profile(), null);
    assert.ok(!result.ok);
    assert.equal(result.stage, 'validation');
    const errors = (result.details as { fieldErrors: Record<string, string> }).fieldErrors;
    assert.deepEqual(Object.keys(errors).sort(), ['amount', 'cuit', 'receptionDate']);
  });

  it('treats negative amounts as credit notes and evaluates the cancellation rule', () => {
    const result = mapRecord(sapRecord({ InvoiceGrossAmount: '-500.5', ReverseDocument: '5105600099' }), profile(), null);
    assert.ok(result.ok);
    assert.equal(result.invoice.amount, 500.5);
    assert.equal(result.invoice.creditNote, true);
    assert.equal(result.invoice.cancelled, true);
  });

  it('supports constants, nested $expand paths and length limits on the invoice id', () => {
    const mapping = { ...baseMapping, vendorName: { path: 'to_Supplier/SupplierName' }, currencyCode: { constant: 'USD' } } as FieldMapping;
    const ok = mapRecord(sapRecord({ to_Supplier: { SupplierName: 'Nested S.A.' } }), profile({ fieldMapping: mapping }), null);
    assert.ok(ok.ok && ok.invoice.vendorName === 'Nested S.A.' && ok.invoice.currencyCode === 'USD');
    const tooLong = mapRecord(sapRecord(), profile({ invoiceCodeTemplate: `${'X'.repeat(60)}-{SupplierInvoice}` }), null);
    assert.ok(!tooLong.ok && /invoiceCode/.test(tooLong.message));
  });

  it('validates mapping configuration: required fields must be mapped', () => {
    const result = fieldMappingSchema.safeParse({ vendorName: { path: 'X' } });
    assert.equal(result.success, false);
    const missing = result.error!.issues.map((i) => i.path[0]);
    assert.deepEqual(missing.sort(), ['amount', 'cuit', 'receptionDate']);
    assert.equal(fieldMappingSchema.safeParse({ ...baseMapping, amount: {} }).success, false, 'a rule needs a path or a constant');
  });

  it('parses SAP date formats and renders safe invoice ids', () => {
    assert.equal(parseSourceDate('/Date(1719792000000+0000)/')?.toISOString(), '2024-07-01T00:00:00.000Z');
    assert.equal(parseSourceDate('20260701')?.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.equal(parseSourceDate('2026-07-01T10:00:00')?.toISOString(), '2026-07-01T10:00:00.000Z');
    assert.equal(parseSourceDate('garbage'), null);
    assert.equal(renderInvoiceCode('INV-{prefix}-{Doc}', { Doc: '51/05 6?' }, 'SJO'), 'INV-SJO-51-05-6-');
    assert.equal(evaluateCancellation({ field: 'Status', operator: 'in', values: ['C', 'R'], setStatus: 'Rejected', onlyWhenStatusIn: ['Pending'] }, { Status: 'R' }), true);
  });
});
