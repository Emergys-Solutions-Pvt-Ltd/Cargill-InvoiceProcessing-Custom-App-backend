import { getAccessToken } from './graph-auth.js';

/** Read-only Microsoft Graph mail calls: messages (with plain-text body), delta changes and attachments. */
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

type GraphEmailAddress = { emailAddress: { name?: string; address?: string } };

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  ccRecipients?: GraphEmailAddress[];
  receivedDateTime: string;
  hasAttachments: boolean;
  body?: { contentType: string; content: string };
};

export type GraphAttachment = {
  '@odata.type': string;
  id: string;
  name: string;
  contentType?: string;
  size: number;
  isInline: boolean;
  contentBytes?: string;
};

type GraphList<T> = { value: T[]; '@odata.nextLink'?: string };

type GraphDeltaPage = {
  value: (GraphMessage & { '@removed'?: { reason: string } })[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
};

export interface DeltaPage {
  messages: GraphMessage[];
  nextLink: string | null;
  deltaLink: string | null;
}

export class GraphError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

const MESSAGE_FIELDS = 'id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,body';

async function graphGet<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  if (!response.ok) {
    const text = await response.text();
    throw new GraphError(response.status, `Graph GET failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

/** Latest messages of the inbox (diagnostics / scripts; the poller uses listMessagesDelta). */
export async function listMessages(mailbox: string, top = 10) {
  const params = new URLSearchParams({ $top: String(top), $orderby: 'receivedDateTime desc', $select: MESSAGE_FIELDS });
  const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?${params}`;
  const data = await graphGet<GraphList<GraphMessage>>(url, { Prefer: 'outlook.body-content-type="text"' });
  return { messages: data.value, nextLink: data['@odata.nextLink'] };
}

export async function listAttachments(mailbox: string, messageId: string): Promise<GraphAttachment[]> {
  const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`;
  return (await graphGet<GraphList<GraphAttachment>>(url)).value;
}

/**
 * Reads ONE page of changes from a mail folder.
 * - link = null: start a full sync of the folder (first poll, or after a reset)
 * - link = a saved nextLink/deltaLink: continue from there
 * Keep calling with nextLink until deltaLink comes back; then save deltaLink.
 */
export async function listMessagesDelta(mailbox: string, link: string | null, folder = 'inbox'): Promise<DeltaPage> {
  const url =
    link ??
    `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/mailFolders/${encodeURIComponent(folder)}/messages/delta?$select=${MESSAGE_FIELDS}`;

  // The bearer token must only ever go to Graph, even if the stored link was tampered with
  if (!url.startsWith(`${GRAPH_BASE_URL}/`)) throw new Error('Delta link does not point to Microsoft Graph');

  const page = await graphGet<GraphDeltaPage>(url, { Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50' });
  return {
    messages: page.value.filter((m) => !m['@removed']), // new or changed items
    nextLink: page['@odata.nextLink'] ?? null, // more pages in this round
    deltaLink: page['@odata.deltaLink'] ?? null, // round finished: save this
  };
}
