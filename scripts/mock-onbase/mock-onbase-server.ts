import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Mock Hyland OnBase (IdP + API Server) for local development and automated tests.
 *   POST /identityprovider/connect/token         password grant (client, user, tenant, scope)
 *   GET  /apiserver/onbase/core/document-types   ?systemName= | ?id=
 *   GET  /apiserver/onbase/core/keyword-types    ?systemName= | ?id= (repeatable)
 *   POST /apiserver/onbase/core/documents/queries          -> { id }
 *   GET  /apiserver/onbase/core/documents/queries/{id}/results -> { items: [...] }
 *   GET  /apiserver/onbase/core/documents/{id}/keywords    -> { items: [{ keywords: [...] }] }
 *   GET  /apiserver/onbase/core/documents/{id}/revisions/latest/renditions/default/content -> PDF
 * Sets an FB_LB affinity cookie and counts API calls made without it.
 */
export interface MockOnBaseOptions {
  port?: number;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  tenant?: string;
  documentCount?: number;
}

interface MockDocument {
  id: string;
  name: string;
  typeId: number;
  documentDate: string; // YYYY-MM-DD
  keywords: Record<number, string>;
}

const DOCUMENT_TYPES = [
  { id: 101, name: 'AP - Invoice', systemName: 'AP - Invoice' },
  { id: 102, name: 'AP - SJO Invoice', systemName: 'AP - SJO Invoice' },
];

const KEYWORD_TYPES = [
  { id: 1, name: 'Invoice Number', systemName: 'Invoice Number' },
  { id: 2, name: 'Vendor Name', systemName: 'Vendor Name' },
  { id: 3, name: 'CUIT', systemName: 'CUIT' },
  { id: 4, name: 'Invoice Amount', systemName: 'Invoice Amount' },
  { id: 5, name: 'Invoice Date', systemName: 'Invoice Date' },
  { id: 6, name: 'Currency', systemName: 'Currency' },
  { id: 7, name: 'Company Code', systemName: 'Company Code' },
  { id: 8, name: 'Invoice Status', systemName: 'Invoice Status' },
];

const VENDORS = [
  ['Molinos Agro S.A.', '30-50001234-9'],
  ['Vicentin S.A.I.C.', '30-61234567-2'],
  ['Terminal Quequén S.A.', '30-71122334-5'],
] as const;

/** Smallest valid one-page PDF with a line of text. */
export const samplePdf = (label: string) => {
  const stream = `BT /F1 18 Tf 72 720 Td (${label.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export const buildDocuments = (count: number): MockDocument[] =>
  Array.from({ length: count }, (_, i) => {
    const [vendor, cuit] = VENDORS[i % VENDORS.length];
    const date = daysAgo(count - i); // oldest first, up to yesterday
    return {
      id: String(70001 + i),
      name: `AP Invoice ${String(1000 + i)}`,
      typeId: i % 5 === 4 ? 102 : 101,
      documentDate: date,
      keywords: {
        1: `0001-${String(88000 + i).padStart(8, '0')}`,
        2: vendor,
        3: cuit,
        4: (15_000 + i * 512.5).toFixed(2),
        5: date,
        6: 'ARS',
        7: i % 3 === 2 ? '2020' : '1010',
        8: 'Received',
      },
    };
  });

const OPS: Record<string, (a: string, b: string) => boolean> = {
  Equal: (a, b) => a === b,
  NotEqual: (a, b) => a !== b,
  LessThan: (a, b) => a < b,
  LessThanEqual: (a, b) => a <= b,
  GreaterThan: (a, b) => a > b,
  GreaterThanEqual: (a, b) => a >= b,
};

export class MockOnBaseServer {
  readonly documents: MockDocument[];
  readonly requests: { method: string; url: string; cookie: string | undefined }[] = [];
  apiCallsWithoutAffinity = 0;
  tokensIssued = 0;
  failContentFor = new Set<string>();
  private readonly queries = new Map<string, MockDocument[]>();
  private readonly tokens = new Set<string>();
  private server: http.Server | null = null;
  private readonly opts: Required<Omit<MockOnBaseOptions, 'port' | 'documentCount'>>;

  constructor(private readonly options: MockOnBaseOptions = {}) {
    this.documents = buildDocuments(options.documentCount ?? 12);
    this.opts = {
      clientId: options.clientId ?? 'mock-onbase-client',
      clientSecret: options.clientSecret ?? 'mock-onbase-secret',
      username: options.username ?? 'svc_invoices',
      password: options.password ?? 'mock-password',
      tenant: options.tenant ?? 'OnBase',
    };
  }

  get url() {
    return `http://localhost:${(this.server?.address() as AddressInfo | null)?.port ?? 0}`;
  }

  get apiServerUrl() {
    return `${this.url}/apiserver`;
  }

  get tokenUrl() {
    return `${this.url}/identityprovider/connect/token`;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => this.json(res, 500, { message: String(err) }));
    });
    await new Promise<void>((resolve) => this.server!.listen(this.options.port ?? 0, resolve));
    return this;
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  private async body(req: IncomingMessage) {
    let text = '';
    for await (const chunk of req) text += chunk;
    return text;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    this.requests.push({ method: req.method ?? 'GET', url: req.url ?? '', cookie: req.headers.cookie });

    if (url.pathname === '/identityprovider/connect/token' && req.method === 'POST') {
      const form = new URLSearchParams(await this.body(req));
      const ok =
        form.get('grant_type') === 'password' && form.get('client_id') === this.opts.clientId &&
        form.get('client_secret') === this.opts.clientSecret && form.get('username') === this.opts.username &&
        form.get('password') === this.opts.password && form.get('tenant') === this.opts.tenant &&
        (form.get('scope') ?? '').split(' ').includes('evolution');
      if (!ok) return this.json(res, 400, { error: 'invalid_grant', error_description: 'Invalid user, client, tenant or scope' });
      this.tokensIssued += 1;
      const token = `onbase-token-${this.tokensIssued}`;
      this.tokens.add(token);
      return this.json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600 }, { 'Set-Cookie': `FB_LB=node-${this.tokensIssued}; Path=/; HttpOnly` });
    }

    const prefix = '/apiserver/onbase/core';
    if (!url.pathname.startsWith(prefix)) return this.json(res, 404, { message: 'Not found' });
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.tokens.has(bearer)) return this.json(res, 401, { message: 'Unauthorized' });
    if (!/FB_LB=/.test(req.headers.cookie ?? '')) this.apiCallsWithoutAffinity += 1;
    const path = url.pathname.slice(prefix.length);

    const lookup = (list: { id: number; name: string; systemName: string }[]) => {
      const ids = url.searchParams.getAll('id').map(Number);
      const names = url.searchParams.getAll('systemName');
      return { items: list.filter((t) => ids.includes(t.id) || names.includes(t.systemName)) };
    };
    if (path === '/document-types') return this.json(res, 200, lookup(DOCUMENT_TYPES));
    if (path === '/keyword-types') return this.json(res, 200, lookup(KEYWORD_TYPES));

    if (path === '/documents/queries' && req.method === 'POST') {
      const q = JSON.parse(await this.body(req)) as {
        queryType: { ids: number[] }[];
        queryKeywordCollection: { typeId: number; value: string; operator: string }[];
        documentDateRangeCollection: { start?: string; end?: string }[];
        maxResults: number;
      };
      const typeIds = q.queryType.flatMap((t) => t.ids);
      const range = q.documentDateRangeCollection[0] ?? {};
      const matches = this.documents
        .filter((d) => typeIds.includes(d.typeId))
        .filter((d) => (!range.start || d.documentDate >= range.start) && (!range.end || d.documentDate <= range.end))
        .filter((d) => q.queryKeywordCollection.every((k) => (OPS[k.operator] ?? OPS.Equal)(d.keywords[k.typeId] ?? '', k.value)))
        .slice(0, q.maxResults);
      const id = `q${this.queries.size + 1}`;
      this.queries.set(id, matches);
      return this.json(res, 201, { id });
    }

    let m = /^\/documents\/queries\/([^/]+)\/results$/.exec(path);
    if (m) {
      const docs = this.queries.get(m[1]);
      if (!docs) return this.json(res, 404, { message: 'Query not found' });
      return this.json(res, 200, { items: docs.map((d) => ({ id: d.id, name: d.name, typeId: d.typeId, documentDate: d.documentDate })) });
    }

    m = /^\/documents\/([^/]+)\/keywords$/.exec(path);
    if (m) {
      const doc = this.documents.find((d) => d.id === m![1]);
      if (!doc) return this.json(res, 404, { message: 'Document not found' });
      return this.json(res, 200, {
        items: [{ keywords: Object.entries(doc.keywords).map(([typeId, value]) => ({ typeId: Number(typeId), values: [{ value, formattedValue: value }] })) }],
      });
    }

    m = /^\/documents\/([^/]+)\/revisions\/latest\/renditions\/default\/content$/.exec(path);
    if (m) {
      const doc = this.documents.find((d) => d.id === m![1]);
      if (!doc) return this.json(res, 404, { message: 'Document not found' });
      if (this.failContentFor.has(doc.id)) return this.json(res, 500, { message: 'Rendition unavailable' });
      const pdf = samplePdf(`${doc.name} - ${doc.keywords[2]} - ${doc.keywords[4]}`);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(pdf.length) });
      return res.end(pdf);
    }

    return this.json(res, 404, { message: `Unknown resource ${path}` });
  }
}
