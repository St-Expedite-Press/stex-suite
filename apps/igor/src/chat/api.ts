// HTTP client for stex.igor.conversations.v1 (protocol/igor/README.md).
// The browser only ever talks to Igor's own API under /igor/api.

import type { Conversation, ConversationSummary, Health } from './types';

const API_BASE = '/igor/api';

export class IgorApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'IgorApiError';
    this.status = status;
    this.code = code;
  }
}

export const isConflict = (error: unknown): boolean =>
  error instanceof IgorApiError && error.status === 409;

export const isNotFound = (error: unknown): boolean =>
  error instanceof IgorApiError && error.status === 404;

export const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Something went wrong.';

/** One key per user submission; reused only when that same submission is retried. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type RequestOptions = {
  body?: unknown;
  /** Repeat once on a network failure. Only for requests that carry an idempotency key or are otherwise safe to repeat. */
  retryOnNetworkError?: boolean;
};

async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json' } };
  if (method !== 'GET') {
    init.headers = { accept: 'application/json', 'content-type': 'application/json' };
    init.body = JSON.stringify(options.body ?? {});
  }

  const attempts = options.retryOnNetworkError ? 2 : 1;
  let response: Response | undefined;
  for (let attempt = 0; attempt < attempts && !response; attempt += 1) {
    try {
      response = await fetch(`${API_BASE}${path}`, init);
    } catch {
      // Network failure: the same request (same idempotency key) may be repeated once.
    }
  }
  if (!response) throw new IgorApiError('Igor could not be reached.', 0, 'NETWORK');

  if (response.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const body = (data ?? {}) as { error?: unknown; code?: unknown };
    const message = typeof body.error === 'string' && body.error ? body.error : `Igor request failed (${response.status}).`;
    const code = typeof body.code === 'string' ? body.code : 'HTTP_ERROR';
    throw new IgorApiError(message, response.status, code);
  }
  if (data === null) throw new IgorApiError('Igor returned an unreadable response.', response.status, 'MALFORMED');
  return data as T;
}

const conversationPath = (id: string) => `/conversations/${encodeURIComponent(id)}`;

export const getHealth = () => request<Health>('GET', '/health');

export const listConversations = () =>
  request<{ conversations: ConversationSummary[] }>('GET', '/conversations');

export const getConversation = (id: string) =>
  request<{ conversation: Conversation }>('GET', conversationPath(id));

export const createConversation = (idempotencyKey: string, message: string) =>
  request<{ conversation: Conversation; route: string }>('POST', '/conversations', {
    body: { idempotencyKey, message },
    retryOnNetworkError: true,
  });

export const sendMessage = (id: string, idempotencyKey: string, content: string) =>
  request<{ conversation: Conversation }>('POST', `${conversationPath(id)}/messages`, {
    body: { idempotencyKey, content },
    retryOnNetworkError: true,
  });

export const retryMessage = (id: string, messageId: string) =>
  request<{ conversation: Conversation }>(
    'POST',
    `${conversationPath(id)}/messages/${encodeURIComponent(messageId)}/retry`,
    { body: {} },
  );

export const updateConversation = (id: string, patch: { title?: string; archived?: boolean }) =>
  request<{ conversation: Conversation }>('PATCH', conversationPath(id), { body: patch });

export const deleteConversation = (id: string) =>
  request<void>('DELETE', conversationPath(id), { body: {} });
