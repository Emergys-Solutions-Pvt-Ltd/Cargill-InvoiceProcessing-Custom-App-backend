import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Attachment PDFs are rendered by the browser in an <iframe>/<a download>, which cannot
 * send the Bearer token. Instead every API response hands out a short-lived HMAC-signed URL.
 * Attachment ids are unique per app, so the URL names the app schema (gpp, sjo, rospbu) too.
 */
const sign = (appSchema: string, attachmentId: number, expires: number) =>
  crypto.createHmac('sha256', env.FILE_URL_SECRET).update(`${appSchema}:${attachmentId}:${expires}`).digest('base64url');

export const signedAttachmentUrl = (appSchema: string, attachmentId: number): string => {
  const expires = Math.floor(Date.now() / 1000) + env.FILE_URL_TTL_SECONDS;
  return `/api/files/attachments/${appSchema}/${attachmentId}?expires=${expires}&sig=${sign(appSchema, attachmentId, expires)}`;
};

export const verifyAttachmentSignature = (appSchema: string, attachmentId: number, expires: number, sig: string): boolean => {
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(appSchema, attachmentId, expires));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};
