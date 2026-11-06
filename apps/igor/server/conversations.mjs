// The stex.igor.conversations.v1 operations and the reply lifecycle
// (protocol/igor/README.md). Every check-and-mutate step runs synchronously,
// so concurrent requests cannot both pass an idempotency or pending check.
import { IgorError } from './http.mjs';
import { TurnFailure, turnRequest } from './inference.mjs';
import { autoTitle, conversationSummary, newMessageId } from './store.mjs';

// services/inference keeps at most 6,000 characters per message; longer input is refused, never truncated.
const MESSAGE_CHARS = 6_000;
const TITLE_CHARS = 120;
const now = () => new Date().toISOString();

function idempotencyKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) throw new IgorError(400, 'INVALID_REQUEST', 'idempotencyKey must be 8 to 80 letters, digits, "-" or "_".');
  return value;
}

function messageText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new IgorError(400, 'INVALID_REQUEST', `Write a ${field} for Igor first.`);
  if (text.length > MESSAGE_CHARS) throw new IgorError(400, 'INVALID_REQUEST', `Keep messages to ${MESSAGE_CHARS.toLocaleString('en')} characters or fewer.`);
  return text;
}

const reused = () => new IgorError(409, 'CONFLICT', 'That idempotencyKey was already used for a different request.');

export function createConversations({ store, inference, log = console }) {
  // Turns run one at a time in arrival order: the inference service admits one
  // remote turn by default, and a second conversation must wait, not fail.
  let queue = Promise.resolve();
  const running = new Map(); // conversation id -> AbortController of its turn

  function find(id) {
    const conversation = store.conversations.get(id);
    if (!conversation) throw new IgorError(404, 'NOT_FOUND', 'That conversation does not exist.');
    return conversation;
  }

  function addExchange(conversation, content) {
    const at = now();
    if (conversation.titleSource === 'auto' && !conversation.messages.some((message) => message.role === 'user')) conversation.title = autoTitle(content);
    const user = { id: newMessageId(), role: 'user', content, createdAt: at, status: 'complete' };
    const assistant = { id: newMessageId(), role: 'assistant', content: '', createdAt: at, status: 'pending', replyTo: user.id };
    conversation.messages.push(user, assistant);
    conversation.updatedAt = at;
    return assistant;
  }

  // Persist first, then start exactly one background turn. A reply that cannot
  // be saved as pending is failed instead, so the conversation never sticks.
  async function accept(conversation, assistant) {
    try { await store.save(); }
    catch (error) {
      log.error(`Igor could not save conversation ${conversation.id}: ${error.code || error.message}`);
      Object.assign(assistant, { status: 'failed', error: { code: 'STORAGE_FAILED', message: 'Igor could not save this conversation. Retry to ask again.' } });
      throw new IgorError(500, 'STORAGE_FAILED', 'Igor could not save this conversation.');
    }
    queue = queue.then(() => runTurn(conversation, assistant.id)).catch(() => log.error(`Igor turn ${assistant.id} stopped unexpectedly.`));
  }

  async function runTurn(conversation, assistantId) {
    const assistant = conversation.messages.find((message) => message.id === assistantId);
    // A conversation deleted while its turn waited in the queue is never sent.
    if (assistant?.status !== 'pending' || store.conversations.get(conversation.id) !== conversation) return;
    const controller = new AbortController();
    running.set(conversation.id, controller);
    let outcome;
    try { outcome = { status: 'complete', ...(await inference.turn(turnRequest(conversation, assistant), { cancel: controller.signal })) }; }
    catch (error) {
      if (!(error instanceof TurnFailure)) log.error(`Igor turn ${assistantId} failed unexpectedly.`);
      outcome = { status: 'failed', error: error instanceof TurnFailure ? { code: error.code, message: error.message } : { code: 'UPSTREAM_ERROR', message: 'Igor could not answer.' } };
    }
    finally { running.delete(conversation.id); }
    // A conversation deleted while its turn ran keeps no trace of the result.
    if (store.conversations.get(conversation.id) !== conversation || assistant.status !== 'pending') return;
    if (outcome.status === 'complete') Object.assign(assistant, { status: 'complete', content: outcome.text, transport: outcome.transport });
    else Object.assign(assistant, { status: 'failed', error: outcome.error });
    conversation.updatedAt = now();
    await store.save().catch((error) => log.error(`Igor could not save a reply for ${conversation.id}: ${error.code || error.message}`));
  }

  return {
    list() {
      const conversations = [...store.conversations.values()].map(conversationSummary)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      return { conversations };
    },

    get(id) { return find(id); },

    async create(body) {
      const key = idempotencyKey(body.idempotencyKey);
      const content = body.message === undefined || body.message === null ? null : messageText(body.message, 'message');
      const known = store.keys.get(key);
      if (known) {
        if (known.scope !== 'create') throw reused();
        return { status: 200, conversation: find(known.conversationId) };
      }
      const at = now();
      const conversation = { id: store.newConversationId(), title: 'New conversation', titleSource: 'auto', createdAt: at, updatedAt: at, archived: false, messages: [] };
      store.conversations.set(conversation.id, conversation);
      store.rememberKey(key, { scope: 'create', conversationId: conversation.id });
      if (content) await accept(conversation, addExchange(conversation, content));
      else await store.save();
      return { status: 201, conversation };
    },

    async post(id, body) {
      const key = idempotencyKey(body.idempotencyKey);
      const content = messageText(body.content, 'message');
      const conversation = find(id);
      const known = store.keys.get(key);
      if (known) {
        if (known.scope !== 'message' || known.conversationId !== id) throw reused();
        return { status: 200, conversation };
      }
      if (conversation.messages.some((message) => message.status === 'pending')) throw new IgorError(409, 'CONFLICT', 'Igor is still answering. Wait for the reply before sending another message.');
      store.rememberKey(key, { scope: 'message', conversationId: id });
      await accept(conversation, addExchange(conversation, content));
      return { status: 202, conversation };
    },

    // The same assistant message and requestId are reused, so the inference
    // service sends the same Idempotency-Key upstream.
    async retry(id, messageId) {
      const conversation = find(id);
      const latest = conversation.messages.at(-1);
      if (latest?.id !== messageId || latest.role !== 'assistant' || latest.status !== 'failed') throw new IgorError(409, 'CONFLICT', 'Only the latest failed reply can be retried.');
      latest.status = 'pending'; latest.content = ''; delete latest.error; delete latest.transport;
      conversation.updatedAt = now();
      await accept(conversation, latest);
      return conversation;
    },

    async update(id, body) {
      const conversation = find(id);
      let title; let archived;
      if (body.title !== undefined) {
        title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
        if (!title || title.length > TITLE_CHARS) throw new IgorError(400, 'INVALID_REQUEST', `A title is 1 to ${TITLE_CHARS} characters.`);
      }
      if (body.archived !== undefined) {
        if (typeof body.archived !== 'boolean') throw new IgorError(400, 'INVALID_REQUEST', 'archived must be true or false.');
        archived = body.archived;
      }
      if (title === undefined && archived === undefined) throw new IgorError(400, 'INVALID_REQUEST', 'Send a title or archived value to change.');
      if (title !== undefined) Object.assign(conversation, { title, titleSource: 'user' });
      if (archived !== undefined) conversation.archived = archived;
      conversation.updatedAt = now();
      await store.save();
      return conversation;
    },

    async remove(id) {
      find(id);
      store.conversations.delete(id);
      running.get(id)?.abort(); // stop spending on a reply nobody will see
      await store.save();
    },
  };
}
