import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Mock SAP OData service (Supplier Invoice API shape) for local development and automated tests.
 *   V2: /sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice   ("d.results", "__next")
 *   V4: /sap/opu/odata4/sap/api_supplierinvoice/srvd_a2x/sap/supplierinvoice/0001/A_SupplierInvoice
 *       ("value", "@odata.nextLink")
 * Supports $metadata, $filter (eq / ne / gt / ge / lt / le, and / or, parentheses), $orderby,
 * $top / $skip, server-driven paging, OAuth2 client credentials (/oauth/token), Basic, API key,
 * and fault injection (429 throttling, 503 errors) - all in-memory, deterministic.
 */

export type MockAuth =
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'oauth'; clientId: string; clientSecret: string; tokenLifetimeSeconds?: number }
  | { type: 'api-key'; headerName: string; apiKey: string };

export interface MockSapOptions {
  port?: number;
  auth?: MockAuth;
  invoiceCount?: number;
  /** Server-driven paging size (next links); null = only honour client $top/$skip. */
  serverPageSize?: number | null;
}

export interface MockInvoice {
  CompanyCode: string;
  FiscalYear: string;
  SupplierInvoice: string;
  AccountingDocumentType: string;
  DocumentDate: Date;
  PostingDate: Date;
  InvoicingParty: string;
  InvoicingPartyName: string;
  TaxNumber1: string;
  DocumentCurrency: string;
  InvoiceGrossAmount: string;
  SupplierInvoiceIDByInvcgParty: string;
  SupplierInvoiceStatus: string;
  ReverseDocument: string;
  LastChangeDateTime: Date;
}

const VENDORS = [
  ['17300001', 'Molinos Agro S.A.', '30500012349'],
  ['17300002', 'Vicentin S.A.I.C.', '30612345672'],
  ['17300003', 'Terminal Quequén S.A.', '30711223345'],
  ['17300004', 'Cargill Logistics S.R.L.', '30500098761'],
  ['17300005', 'Aceitera General Deheza', '30500034568'],
] as const;

const BASE_TIME = Date.UTC(2026, 6, 1, 8, 0, 0); // 2026-07-01 08:00 UTC

export const buildInvoices = (count: number): MockInvoice[] =>
  Array.from({ length: count }, (_, i) => {
    const [party, name, cuit] = VENDORS[i % VENDORS.length];
    const posting = new Date(BASE_TIME + i * 3_600_000);
    return {
      CompanyCode: i % 4 === 3 ? '2020' : '1010',
      FiscalYear: '2026',
      SupplierInvoice: String(5105600000 + i + 1),
      AccountingDocumentType: i % 3 === 2 ? 'KR' : 'RE',
      DocumentDate: new Date(posting.getTime() - 86_400_000),
      PostingDate: new Date(Date.UTC(posting.getUTCFullYear(), posting.getUTCMonth(), posting.getUTCDate())),
      InvoicingParty: party,
      InvoicingPartyName: name,
      TaxNumber1: cuit,
      DocumentCurrency: 'ARS',
      InvoiceGrossAmount: (12_500 + i * 731.25).toFixed(2),
      SupplierInvoiceIDByInvcgParty: `0001-${String(45000 + i).padStart(8, '0')}`,
      SupplierInvoiceStatus: '5',
      ReverseDocument: '',
      LastChangeDateTime: new Date(BASE_TIME + i * 60_000),
    };
  });

const PROPERTIES: [keyof MockInvoice, string][] = [
  ['CompanyCode', 'Edm.String'], ['FiscalYear', 'Edm.String'], ['SupplierInvoice', 'Edm.String'],
  ['AccountingDocumentType', 'Edm.String'], ['DocumentDate', 'Edm.DateTime'], ['PostingDate', 'Edm.DateTime'],
  ['InvoicingParty', 'Edm.String'], ['InvoicingPartyName', 'Edm.String'], ['TaxNumber1', 'Edm.String'],
  ['DocumentCurrency', 'Edm.String'], ['InvoiceGrossAmount', 'Edm.Decimal'], ['SupplierInvoiceIDByInvcgParty', 'Edm.String'],
  ['SupplierInvoiceStatus', 'Edm.String'], ['ReverseDocument', 'Edm.String'], ['LastChangeDateTime', 'Edm.DateTimeOffset'],
];

const metadataXml = (version: 'v2' | 'v4') =>
  version === 'v2'
    ? `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
 <edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <Schema Namespace="API_SUPPLIERINVOICE_PROCESS_SRV" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
   <EntityType Name="A_SupplierInvoiceType">
    <Key><PropertyRef Name="SupplierInvoice"/><PropertyRef Name="FiscalYear"/></Key>
    ${PROPERTIES.map(([n, t]) => `<Property Name="${n}" Type="${t}"/>`).join('\n    ')}
    <NavigationProperty Name="to_SupplierInvoiceTax" Relationship="x" FromRole="a" ToRole="b"/>
   </EntityType>
   <EntityContainer Name="API_SUPPLIERINVOICE_PROCESS_SRV_Entities" m:IsDefaultEntityContainer="true">
    <EntitySet Name="A_SupplierInvoice" EntityType="API_SUPPLIERINVOICE_PROCESS_SRV.A_SupplierInvoiceType"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`
    : `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
 <edmx:DataServices>
  <Schema Namespace="com.sap.gateway.srvd_a2x.api_supplierinvoice.v0001" xmlns="http://docs.oasis-open.org/odata/ns/edm">
   <EntityType Name="A_SupplierInvoiceType">
    <Key><PropertyRef Name="SupplierInvoice"/><PropertyRef Name="FiscalYear"/></Key>
    ${PROPERTIES.map(([n, t]) => `<Property Name="${n}" Type="${t === 'Edm.DateTime' ? 'Edm.Date' : t}"/>`).join('\n    ')}
   </EntityType>
   <EntityContainer Name="Container">
    <EntitySet Name="A_SupplierInvoice" EntityType="com.sap.gateway.srvd_a2x.api_supplierinvoice.v0001.A_SupplierInvoiceType"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`;

// ---------------------------------------------------------------- $filter evaluation

type Predicate = (row: MockInvoice) => boolean;

const splitTopLevel = (expr: string, keyword: 'and' | 'or'): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  const token = ` ${keyword} `;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === "'") inQuote = !inQuote;
    else if (!inQuote && ch === '(') depth += 1;
    else if (!inQuote && ch === ')') depth -= 1;
    else if (!inQuote && depth === 0 && expr.startsWith(token, i)) {
      parts.push(expr.slice(start, i));
      start = i + token.length;
      i += token.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim());
};

const stripParens = (expr: string) => {
  let e = expr.trim();
  while (e.startsWith('(') && e.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < e.length; i += 1) {
      if (e[i] === '(') depth += 1;
      else if (e[i] === ')') depth -= 1;
      if (depth === 0 && i < e.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    e = e.slice(1, -1).trim();
  }
  return e;
};

const parseLiteral = (raw: string): string | number | Date => {
  const v = raw.trim();
  let m = /^(?:datetimeoffset|datetime)'([^']+)'$/.exec(v);
  if (m) return new Date(/Z|[+-]\d{2}:\d{2}$/.test(m[1]) ? m[1] : `${m[1]}Z`);
  m = /^'((?:[^']|'')*)'$/.exec(v);
  if (m) return m[1].replace(/''/g, "'");
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v)) return new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  throw new Error(`Unsupported literal ${v}`);
};

const compare = (a: unknown, b: string | number | Date) => {
  const left = a instanceof Date ? a.getTime() : typeof b === 'number' ? Number(a) : String(a);
  const right = b instanceof Date ? b.getTime() : b;
  return left < right ? -1 : left > right ? 1 : 0;
};

export const compileFilter = (expr: string): Predicate => {
  const e = stripParens(expr);
  const ands = splitTopLevel(e, 'and');
  if (ands.length > 1) {
    const preds = ands.map(compileFilter);
    return (row) => preds.every((p) => p(row));
  }
  const ors = splitTopLevel(e, 'or');
  if (ors.length > 1) {
    const preds = ors.map(compileFilter);
    return (row) => preds.some((p) => p(row));
  }
  const m = /^(\w+)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/.exec(e);
  if (!m) throw new Error(`Unsupported filter clause: ${e}`);
  const [, field, op, literal] = m;
  const value = parseLiteral(literal);
  return (row) => {
    const c = compare((row as unknown as Record<string, unknown>)[field], value);
    return { eq: c === 0, ne: c !== 0, gt: c > 0, ge: c >= 0, lt: c < 0, le: c <= 0 }[op as 'eq'];
  };
};

// ---------------------------------------------------------------- server

const V2_ROOT = '/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV';
const V4_ROOT = '/sap/opu/odata4/sap/api_supplierinvoice/srvd_a2x/sap/supplierinvoice/0001';

const toV2 = (row: MockInvoice) => ({
  __metadata: { type: 'API_SUPPLIERINVOICE_PROCESS_SRV.A_SupplierInvoiceType' },
  ...Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v instanceof Date ? (k === 'LastChangeDateTime' ? `/Date(${v.getTime()}+0000)/` : `/Date(${v.getTime()})/`) : v]),
  ),
  to_SupplierInvoiceTax: { __deferred: { uri: 'x' } },
});

const toV4 = (row: MockInvoice) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v instanceof Date ? (k === 'PostingDate' || k === 'DocumentDate' ? v.toISOString().slice(0, 10) : v.toISOString()) : v]),
  );

export class MockSapServer {
  readonly invoices: MockInvoice[];
  readonly requests: { method: string; url: string; headers: IncomingMessage['headers'] }[] = [];
  /** Fault injection: next N data requests answer 429 (Retry-After: 0) / 503. */
  throttleNext = 0;
  failNext = 0;
  tokensIssued = 0;
  private server: http.Server | null = null;
  private tokens = new Map<string, number>();
  private auth: MockAuth;
  private serverPageSize: number | null;

  constructor(private readonly options: MockSapOptions = {}) {
    this.invoices = buildInvoices(options.invoiceCount ?? 25);
    this.auth = options.auth ?? { type: 'none' };
    this.serverPageSize = options.serverPageSize === undefined ? null : options.serverPageSize;
  }

  get url() {
    const address = this.server?.address() as AddressInfo | null;
    return `http://localhost:${address?.port ?? 0}`;
  }

  get v2ServicePath() {
    return V2_ROOT;
  }

  get v4ServicePath() {
    return V4_ROOT;
  }

  /** Simulates a change in SAP: patches a document and bumps its change timestamp. */
  update(supplierInvoice: string, patch: Partial<MockInvoice>, changedAt = new Date()) {
    const row = this.invoices.find((r) => r.SupplierInvoice === supplierInvoice);
    if (!row) throw new Error(`No mock invoice ${supplierInvoice}`);
    Object.assign(row, patch, { LastChangeDateTime: changedAt });
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => this.send(res, 500, { error: { message: String(err) } }));
    });
    await new Promise<void>((resolve) => this.server!.listen(this.options.port ?? 0, resolve));
    return this;
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'application/xml' : 'application/json', ...headers });
    res.end(text);
  }

  private authorized(req: IncomingMessage) {
    const header = req.headers.authorization ?? '';
    switch (this.auth.type) {
      case 'none':
        return true;
      case 'basic':
        return header === `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`;
      case 'api-key':
        return req.headers[this.auth.headerName.toLowerCase()] === this.auth.apiKey;
      case 'oauth': {
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        const expires = this.tokens.get(token);
        return expires !== undefined && expires > Date.now();
      }
    }
  }

  private async readBody(req: IncomingMessage) {
    let body = '';
    for await (const chunk of req) body += chunk;
    return body;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    this.requests.push({ method: req.method ?? 'GET', url: req.url ?? '', headers: req.headers });

    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      if (this.auth.type !== 'oauth') return this.send(res, 404, { error: 'not enabled' });
      const form = new URLSearchParams(await this.readBody(req));
      const basic = req.headers.authorization?.startsWith('Basic ')
        ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':').map(decodeURIComponent)
        : [form.get('client_id'), form.get('client_secret')];
      if (form.get('grant_type') !== 'client_credentials' || basic[0] !== this.auth.clientId || basic[1] !== this.auth.clientSecret) {
        return this.send(res, 401, { error: 'invalid_client', error_description: 'Bad client credentials' });
      }
      this.tokensIssued += 1;
      const token = `mock-token-${this.tokensIssued}`;
      const lifetime = this.auth.tokenLifetimeSeconds ?? 3600;
      this.tokens.set(token, Date.now() + lifetime * 1000);
      return this.send(res, 200, { access_token: token, token_type: 'bearer', expires_in: lifetime });
    }

    const version = url.pathname.startsWith(V2_ROOT) ? 'v2' : url.pathname.startsWith(V4_ROOT) ? 'v4' : null;
    if (!version) return this.send(res, 404, { error: { message: 'Unknown service' } });
    if (!this.authorized(req)) return this.send(res, 401, { error: { message: 'Unauthorized' } }, { 'WWW-Authenticate': 'Bearer' });

    const resource = url.pathname.slice((version === 'v2' ? V2_ROOT : V4_ROOT).length);
    if (resource === '/$metadata') return this.send(res, 200, metadataXml(version));
    if (resource !== '/A_SupplierInvoice') return this.send(res, 404, { error: { message: `Resource ${resource} not found` } });

    if (this.throttleNext > 0) {
      this.throttleNext -= 1;
      return this.send(res, 429, { error: { message: 'Rate limit exceeded' } }, { 'Retry-After': '0' });
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      return this.send(res, 503, { error: { message: 'Service temporarily unavailable' } });
    }

    let rows = [...this.invoices];
    const filter = url.searchParams.get('$filter');
    if (filter) {
      try {
        rows = rows.filter(compileFilter(filter));
      } catch (err) {
        return this.send(res, 400, { error: { message: String(err) } });
      }
    }
    const orderBy = url.searchParams.get('$orderby');
    if (orderBy) {
      const keys = orderBy.split(',').map((s) => s.trim().split(/\s+/)) as [keyof MockInvoice, string?][];
      rows.sort((a, b) => {
        for (const [k, dir] of keys) {
          const c = compare(a[k], b[k] instanceof Date ? (b[k] as Date) : String(b[k]));
          if (c !== 0) return dir === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    const skip = Number(url.searchParams.get('$skip') ?? 0);
    const top = url.searchParams.has('$top') ? Number(url.searchParams.get('$top')) : Number.POSITIVE_INFINITY;
    const size = Math.min(top, this.serverPageSize ?? Number.POSITIVE_INFINITY);
    const page = rows.slice(skip, skip + size);
    const hasMore = this.serverPageSize !== null && skip + page.length < Math.min(rows.length, skip + top) && page.length === size;

    let next: string | undefined;
    if (hasMore) {
      const nextUrl = new URL(url.toString());
      nextUrl.searchParams.set('$skip', String(skip + page.length));
      nextUrl.searchParams.set('$top', String(top === Number.POSITIVE_INFINITY ? this.serverPageSize : top - page.length));
      next = `${this.url}${nextUrl.pathname}${nextUrl.search}`;
    }
    if (version === 'v2') return this.send(res, 200, { d: { results: page.map(toV2), ...(next ? { __next: next } : {}) } });
    return this.send(res, 200, { '@odata.context': '$metadata#A_SupplierInvoice', value: page.map(toV4), ...(next ? { '@odata.nextLink': next } : {}) });
  }
}
