const pad = (n: number) => String(n).padStart(2, '0');

/** DATE column -> "YYYY-MM-DD" (db/pool.ts parses DATE as a UTC midnight Date). */
export const toIsoDate = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

/** DATETIME2 -> "YYYY-MM-DD hh:mm AM" as shown in the Invoices grid. */
export const toDisplayDateTime = (value: Date | null | undefined): string | null => {
  if (!value) return null;
  const hours = value.getUTCHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${toIsoDate(value)} ${pad(h12)}:${pad(value.getUTCMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
};

/** DATETIME2 -> "DD/MM/YYYY HH:mm" as shown on Invoice Detail. */
export const toDayFirstDateTime = (value: Date | null | undefined): string | null => {
  if (!value) return null;
  return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
};

/**
 * Accepts "YYYY-MM-DD", "YYYY-MM-DD hh:mm AM|PM" or any ISO-8601 string.
 * Values are treated as UTC wall-clock time, matching how they are rendered back.
 */
export const parseDateTime = (value: string): Date | null => {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, y, m, d, hh = '0', mm = '0', ss = '0', meridiem] = match;
  let hours = Number(hh);
  if (meridiem) {
    const isPm = meridiem.toUpperCase() === 'PM';
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
  }
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), hours, Number(mm), Number(ss)));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** DECIMAL columns arrive as numbers; the UI expects fixed 2-dp strings. */
export const toMoney = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : Number(value).toFixed(2);

/** Plain numeric string without trailing zeros (CCPP / line item quantities). */
export const toNumberString = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : String(Number(value));
