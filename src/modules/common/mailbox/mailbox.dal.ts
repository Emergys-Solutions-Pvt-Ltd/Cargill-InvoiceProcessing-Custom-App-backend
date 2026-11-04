import { callFunction, callFunctionSingle } from '../../../core/db/procedures.js';
import type { GraphMessage } from './graph/graph-mail.client.js';
import type { Mailbox, MailboxAttachment, MailboxEmail, MailboxEmailStatus, StoredFile } from './mailbox.models.js';

// app.udt_mailbox_result / app.udt_mailbox_email_result / app.udt_mailbox_attachment_result
interface MailboxResult {
  id: number;
  address: string;
  folder: string;
  module_id: number;
  delta_link: string | null;
  last_polled_at: Date | null;
  last_error: string | null;
}

interface MailboxEmailResult {
  id: number;
  mailbox_id: number;
  graph_message_id: string;
  subject: string;
  from_address: string | null;
  received_at: Date;
  has_attachments: boolean;
  status: MailboxEmailStatus;
  invoice_id: number | null;
  is_new: boolean;
  attachments_pending: boolean;
}

interface MailboxAttachmentResult {
  id: number;
  mailbox_email_id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  is_inline: boolean;
  created_at: Date;
  storage_provider: 'local' | 's3' | null;
  storage_bucket: string | null;
  content_sha256: string | null;
  storage_etag: string | null;
}

const toMailbox = (r: MailboxResult): Mailbox => ({
  id: r.id,
  address: r.address,
  folder: r.folder,
  moduleId: r.module_id,
  deltaLink: r.delta_link,
  lastPolledAt: r.last_polled_at,
  lastError: r.last_error,
});

const toEmail = (r: MailboxEmailResult): MailboxEmail => ({
  id: r.id,
  mailboxId: r.mailbox_id,
  graphMessageId: r.graph_message_id,
  subject: r.subject,
  fromAddress: r.from_address,
  receivedAt: r.received_at,
  hasAttachments: r.has_attachments,
  status: r.status,
  invoiceId: r.invoice_id,
  isNew: r.is_new,
  attachmentsPending: r.attachments_pending,
});

const toAttachment = (r: MailboxAttachmentResult): MailboxAttachment => ({
  id: r.id,
  mailboxEmailId: r.mailbox_email_id,
  fileName: r.file_name,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  storagePath: r.storage_path,
  isInline: r.is_inline,
  createdAt: r.created_at,
  storageProvider: r.storage_provider ?? 'local',
  storageBucket: r.storage_bucket ?? null,
  contentSha256: r.content_sha256 ? r.content_sha256.trim() : null,
  storageEtag: r.storage_etag ?? null,
});

const addressList = (list?: { emailAddress: { address?: string } }[]) =>
  (list ?? []).map((r) => r.emailAddress.address).filter(Boolean).join(', ');

/** Active mailboxes the poller should read, with their saved Graph delta link. */
export const getActiveMailboxes = async (): Promise<Mailbox[]> =>
  (await callFunction<MailboxResult>('usp_mailbox_get_active')).map(toMailbox);

/** Stores one Graph message (email + plain-text body); isNew = false when it was already stored. */
export const upsertEmail = async (mailboxId: number, m: GraphMessage): Promise<MailboxEmail> =>
  toEmail(
    await callFunctionSingle<MailboxEmailResult>('usp_mailbox_email_upsert', {
      p_mailbox_id: mailboxId,
      p_graph_message_id: m.id,
      p_internet_message_id: m.internetMessageId ?? null,
      p_from_name: m.from?.emailAddress.name ?? null,
      p_from_address: m.from?.emailAddress.address ?? null,
      p_to_addresses: addressList(m.toRecipients),
      p_cc_addresses: addressList(m.ccRecipients),
      p_subject: m.subject ?? '',
      p_body_text: m.body?.content ?? null,
      p_received_at: m.receivedDateTime,
      p_has_attachments: m.hasAttachments,
    }),
  );

/** Registers a stored file; returns the existing row when this Graph attachment was registered before. */
export const addAttachment = async (mailboxEmailId: number, graphAttachmentId: string, file: StoredFile): Promise<MailboxAttachment> =>
  toAttachment(
    await callFunctionSingle<MailboxAttachmentResult>('usp_mailbox_attachment_add', {
      p_mailbox_email_id: mailboxEmailId,
      p_graph_attachment_id: graphAttachmentId,
      p_file_name: file.fileName,
      p_mime_type: file.mimeType,
      p_size_bytes: file.sizeBytes,
      p_storage_path: file.storagePath,
      p_is_inline: file.isInline,
      p_storage_provider: file.storageProvider,
      p_storage_bucket: file.storageBucket,
      p_content_sha256: file.contentSha256,
      p_storage_etag: file.storageEtag,
    }),
  );

/** Records that the attachment loop of an email finished (gap G1); an error text marks the email Failed. Raises CA404. */
export const markAttachmentsDone = async (mailboxEmailId: number, error: string | null = null): Promise<void> => {
  await callFunctionSingle('usp_mailbox_attachments_done', { p_mailbox_email_id: mailboxEmailId, p_error: error });
};

/**
 * Stores the outcome of one poll. Success: (id, newDeltaLink, null). Failure: (id, null, message), the
 * old link is kept. Expired link: (id, null, message, true), the next poll does a full sync. Raises CA404.
 */
export const setCursor = async (mailboxId: number, deltaLink: string | null, error: string | null, reset = false): Promise<void> => {
  await callFunctionSingle('usp_mailbox_set_cursor', {
    p_mailbox_id: mailboxId,
    p_delta_link: deltaLink,
    p_error: error,
    p_reset: reset,
  });
};
