import { signedAttachmentUrl } from '../../../core/utils/file-url.js';
import { toDisplayDateTime } from '../../../core/utils/format.js';
import type { AttachmentRow } from './attachments.models.js';

// ---- DTOs: attachment rows as the API returns them ----

const formatSize = (bytes: number | null) => {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const toAttachment = (att: AttachmentRow) => ({
  id: att.id,
  fileName: att.fileName,
  url: signedAttachmentUrl(att.appSchema, att.id),
  title: att.title,
  type: att.mimeType,
  size: formatSize(att.sizeBytes),
  category: att.category,
  isPrimary: att.isPrimary,
  uploadedAt: toDisplayDateTime(att.uploadedAt),
});
