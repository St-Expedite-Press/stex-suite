// Data shapes of stex.igor.conversations.v1 (protocol/igor/README.md).
// The server (server/*.mjs) produces exactly these; the UI never sees Hermes payloads.

export type Transport = 'fake' | 'remote';

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: 'complete' | 'pending' | 'failed';
  replyTo?: string;
  transport?: Transport;
  error?: { code: string; message: string };
};

export type Conversation = {
  id: string;
  title: string;
  titleSource: 'auto' | 'user';
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messages: Message[];
};

export type ConversationSummary = Pick<Conversation, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'archived'> & {
  state: 'idle' | 'pending' | 'failed';
  messageCount: number;
};

export type Health = { ok: boolean; transport: Transport | 'unavailable' };

export type ApiError = { error: string; code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | string };
