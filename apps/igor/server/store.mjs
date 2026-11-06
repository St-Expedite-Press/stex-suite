// Igor's conversation records: one JSON document in the ignored data directory,
// written atomically through a single in-process queue.
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export const STORE_VERSION = 'stex.igor.store.v1';
export const IDEMPOTENCY_KEYS = 1_000;
export const INTERRUPTED = Object.freeze({ code: 'INTERRUPTED', message: 'Igor was restarted before this reply finished. Retry to ask again.' });
const TITLE_CHARS = 60;

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const randomText = (length) => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
// Message ids double as Hermes requestIds (^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$).
export const newMessageId = () => `m_${randomText(20)}`;

/** First line, whitespace collapsed, cut at a word boundary to at most 60 characters. */
export function autoTitle(text) {
  const line = String(text || '').trim().split(/\r?\n/)[0].replace(/\s+/g, ' ').trim();
  if (!line) return 'New conversation';
  const characters = Array.from(line);
  if (characters.length <= TITLE_CHARS) return line;
  const head = characters.slice(0, TITLE_CHARS - 1).join('');
  if (/\s/.test(characters[TITLE_CHARS - 1])) return `${head.trimEnd()}…`;
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

export function conversationSummary(conversation) {
  const { id, title, createdAt, updatedAt, archived, messages } = conversation;
  const state = messages.some((message) => message.status === 'pending') ? 'pending' : messages.at(-1)?.status === 'failed' ? 'failed' : 'idle';
  return { id, title, createdAt, updatedAt, archived, state, messageCount: messages.length };
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  // Flushed to disk before the rename, so a power loss cannot leave a partial store.
  const handle = await open(temporary, 'w');
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { await rename(temporary, file); return; }
      catch (error) {
        if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code) || attempt === 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(500, 25 * (2 ** attempt))));
      }
    }
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}

export class ConversationStore {
  constructor(directory) {
    this.file = path.join(directory, 'conversations.json');
    this.conversations = new Map();
    this.keys = new Map(); // idempotencyKey -> { scope: 'create' | 'message', conversationId }, oldest first
    this.queue = Promise.resolve();
  }

  /** Loads the document; a reply left pending by a previous process becomes INTERRUPTED and is never replayed. */
  async load() {
    let raw;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') return this; throw error; }
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    // An unreadable document is user data: fail closed rather than overwrite it.
    if (data?.schemaVersion !== STORE_VERSION || !Array.isArray(data.conversations) || !Array.isArray(data.idempotencyKeys)) {
      throw new Error(`Igor's data file is not a readable ${STORE_VERSION} document: ${this.file}`);
    }
    let interrupted = false;
    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (message.status !== 'pending') continue;
        message.status = 'failed'; message.error = { ...INTERRUPTED }; interrupted = true;
      }
      this.conversations.set(conversation.id, conversation);
    }
    for (const [key, value] of data.idempotencyKeys) this.keys.set(key, value);
    if (interrupted) await this.save();
    return this;
  }

  newConversationId() {
    let id;
    do id = randomText(12); while (this.conversations.has(id));
    return id;
  }

  rememberKey(key, value) {
    this.keys.delete(key); this.keys.set(key, value);
    while (this.keys.size > IDEMPOTENCY_KEYS) this.keys.delete(this.keys.keys().next().value);
  }

  // Each write serializes the state at the moment it runs, so the last queued
  // write always carries the newest state.
  save() {
    const run = this.queue.then(() => atomicWrite(this.file, `${JSON.stringify({ schemaVersion: STORE_VERSION, conversations: [...this.conversations.values()], idempotencyKeys: [...this.keys] })}\n`));
    this.queue = run.catch(() => {});
    return run;
  }
}
