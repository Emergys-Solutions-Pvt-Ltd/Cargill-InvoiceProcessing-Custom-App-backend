/**
 * Attachment layout in the bucket (and on local disk):
 *   [prefix/]<App folder>/<YYYY>/<Mon>/<file name>
 *   e.g. GPP/2026/Nov/Invoice-123.pdf
 * App folder comes from the invoice's application (S3_APP_FOLDERS, e.g. GP -> GPP); year and
 * three-letter English month from the upload date in STORAGE_FOLDER_TIMEZONE. File names keep the
 * uploaded name (made safe for S3 keys / file systems); a name already used in that month gets a
 * suffix: Invoice-123.pdf, Invoice-123-2.pdf ... Invoice-123-5.pdf, then Invoice-123-<random>.pdf.
 */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const MAX_NAME = 150;

/** Keeps letters, digits, dot, dash and underscore; other runs become "-". Keeps the extension. */
export const sanitizeFileName = (name: string): string => {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!cleaned) return 'attachment';
  if (cleaned.length <= MAX_NAME) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return `${cleaned.slice(0, MAX_NAME - ext.length)}${ext}`;
};

/** Invoice-123.pdf + "2" -> Invoice-123-2.pdf (no suffix = the name itself). */
export const withSuffix = (fileName: string, suffix?: string | null): string => {
  if (!suffix) return fileName;
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? `${fileName.slice(0, dot)}-${suffix}${fileName.slice(dot)}` : `${fileName}-${suffix}`;
};

/**
 * Name variants tried when a file name is already taken in the month folder: the name itself,
 * then -2 ... -5, then short random suffixes (so very common names do not need many lookups).
 */
export const NUMBERED_VARIANTS = 5;
export const nameSuffix = (attempt: number, random: () => string): string | null =>
  attempt <= 1 ? null : attempt <= NUMBERED_VARIANTS ? String(attempt) : random();

/** Year + three-letter month of `date` in an IANA time zone. */
export const yearMonth = (date: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { year: String(parts.year), month: MONTHS[Number(parts.month) - 1] };
};

const folderSegment = (value: string) => value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');

/** Folder of an application code: configured name, else the code in upper case. */
export const appFolder = (applicationCode: string, folders: Record<string, string>) =>
  folderSegment(folders[applicationCode] ?? folders[applicationCode.toUpperCase()] ?? applicationCode.toUpperCase()) || 'OTHER';

export interface KeyParts {
  prefix: string;
  appFolder: string;
  date: Date;
  timeZone: string;
  fileName: string;
  suffix?: string | null;
}

export const attachmentKey = ({ prefix, appFolder: app, date, timeZone, fileName, suffix }: KeyParts): string => {
  const { year, month } = yearMonth(date, timeZone);
  const root = prefix.split('/').map(folderSegment).filter(Boolean);
  return [...root, app, year, month, withSuffix(sanitizeFileName(fileName), suffix)].join('/');
};
