/**
 * Frige editorial sessions: the pure rules of a scope's named conversations.
 *
 * Purpose: every book, section and piece scope holds several named
 * conversations, each an editorial session with the D-027 lifecycle, a
 * revisioned summary and "continue". This module holds only the rules that
 * need no I/O: identifiers, the lifecycle transition table, validation and
 * normalization of the per-scope index and of summaries, and the bounded
 * choice of saved summaries a turn may offer the model. The store
 * (`project-store-vault.mjs`) owns persistence, locking and the records
 * drafts are built from.
 *
 * Invariants (D-027):
 *  - States are `active`, `paused`, `awaiting-review`, `completed`, `abandoned`.
 *    Archive is a separate flag. Frige conversations are never deleted.
 *  - Closing a session never decides a proposal; nothing here touches contracts.
 *  - A summary is author-saved context. It is revisioned, saved only against
 *    its base revision, and offered to a model as labelled data, never as
 *    instructions. A draft is never stored.
 *  - A damaged index is an error (`SESSIONS_UNAVAILABLE`), never an empty one.
 *
 * Contracts: protocol/frige/README.md (editorial sessions), protocol/texgraph
 * (`sessionSummaries`).
 */

/** Id of the scope's first conversation: the legacy single-thread journal, read in place. */
export const MAIN_CONVERSATION = 'main';
/** Conversation ids: the first conversation, or `c-` and sixteen hex digits. */
const CONVERSATION_ID = /^(?:main|c-[a-f0-9]{16})$/;
/** Whether a value is a well-formed conversation id (not whether it exists). */
export const isConversationId = (value) => typeof value === 'string' && CONVERSATION_ID.test(value);

/** The five lifecycle states of D-027. */
export const LIFECYCLES = Object.freeze(['active', 'paused', 'awaiting-review', 'completed', 'abandoned']);
/** States that refuse a new message (`409 SESSION_CLOSED`). */
export const CLOSED_LIFECYCLES = Object.freeze(['completed', 'abandoned']);
/** States in which a message resumes the session, recording the resume as a transition. */
export const RESUMING_LIFECYCLES = Object.freeze(['paused', 'awaiting-review']);

/**
 * Allowed transitions (D-027): `active` to any other state; `paused` or
 * `awaiting-review` to `active`, `completed` or `abandoned`; a closed state
 * back to `active` (reopen). A transition to the current state is not allowed.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const TRANSITIONS = Object.freeze({
  active: ['paused', 'awaiting-review', 'completed', 'abandoned'],
  paused: ['active', 'completed', 'abandoned'],
  'awaiting-review': ['active', 'completed', 'abandoned'],
  completed: ['active'],
  abandoned: ['active'],
});

/** Longest conversation title, in UTF-16 units. */
export const MAX_TITLE = 120;
/** Longest transition reason, in UTF-16 units. */
export const MAX_REASON = 500;
/** Longest summary text, in UTF-16 units (D-027). */
export const MAX_SUMMARY_TEXT = 4000;
/** Most entries in each summary list, and the longest entry (D-027). */
export const MAX_LIST_ITEMS = 20;
export const MAX_LIST_ITEM = 300;
/** Most summary revisions and transition events kept for one conversation. */
export const MAX_REVISIONS = 100;
export const MAX_TRANSITIONS = 1000;
/** Most conversations one scope keeps (archived ones included). */
export const MAX_CONVERSATIONS = 200;
/** Most saved summaries a turn offers, and their total UTF-8 budget. */
export const MAX_OFFERED_SUMMARIES = 3;
export const SUMMARY_BUDGET_BYTES = 12_000;
/** The structured summary list fields, in storage order. */
export const SUMMARY_LISTS = Object.freeze(['decisions', 'openQuestions', 'outstandingProposals', 'sources']);

/**
 * Builds an error the HTTP layer classifies by `code` (see `STATUS_BY_CODE` in the server).
 *
 * @param {string} code
 * @param {string} message  Safe to show to the author.
 * @returns {Error & { code: string }}
 */
export const sessionError = (code, message) => Object.assign(new Error(message), { code });

/**
 * One saved revision of a conversation's summary.
 *
 * @typedef {object} SummaryRevision
 * @property {number} revision         1-based, consecutive.
 * @property {string} text             At most {@link MAX_SUMMARY_TEXT} characters.
 * @property {string[]} decisions
 * @property {string[]} openQuestions
 * @property {string[]} outstandingProposals
 * @property {string[]} sources
 * @property {string | null} throughTurnId  The last turn the summary covers.
 * @property {string} author           Actor id that saved it.
 * @property {string} updatedAt        ISO time.
 */

/**
 * One lifecycle transition event.
 *
 * @typedef {object} TransitionEvent
 * @property {string} at
 * @property {string} from
 * @property {string} to
 * @property {string} actor   Actor id.
 * @property {string} [reason]
 */

/**
 * A conversation's record in its scope's index.
 *
 * @typedef {object} IndexEntry
 * @property {string} id
 * @property {string} title
 * @property {string} lifecycle
 * @property {boolean} archived
 * @property {string | null} createdAt
 * @property {string | null} createdBy     `null` for the first conversation, which predates attribution.
 * @property {{ conversationId: string, summaryRevision: number } | null} continuedFrom
 * @property {SummaryRevision[]} summaries
 * @property {TransitionEvent[]} transitions
 */

/**
 * Checks and trims a conversation title.
 *
 * @param {unknown} value
 * @returns {string}  1 to {@link MAX_TITLE} characters, well-formed Unicode.
 * @throws `INVALID_SESSION_REQUEST` otherwise.
 */
export function validateTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || title.length > MAX_TITLE || !title.isWellFormed()) throw sessionError('INVALID_SESSION_REQUEST', `A title is 1 to ${MAX_TITLE} characters.`);
  return title;
}

/**
 * Checks an optional transition reason.
 *
 * @param {unknown} value
 * @returns {string | undefined}  The trimmed reason, or `undefined` when none was given.
 * @throws `INVALID_SESSION_REQUEST` when not a string of at most {@link MAX_REASON} characters.
 */
export function validateReason(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_REASON || !value.isWellFormed()) throw sessionError('INVALID_SESSION_REQUEST', `A reason is at most ${MAX_REASON} characters.`);
  return value.trim() || undefined;
}

/**
 * Applies a lifecycle transition to an entry, appending its event.
 *
 * @param {IndexEntry} entry  Mutated in place.
 * @param {string} to
 * @param {string} actor  Actor id.
 * @param {string | undefined} reason
 * @param {string} at     ISO time.
 * @throws `INVALID_SESSION_REQUEST` for an unknown state, `INVALID_TRANSITION` (409)
 *   for a transition the lifecycle forbids, `SESSION_HISTORY_FULL` (409) past the event cap.
 */
export function transition(entry, to, actor, reason, at) {
  if (!LIFECYCLES.includes(to)) throw sessionError('INVALID_SESSION_REQUEST', `A lifecycle is one of: ${LIFECYCLES.join(', ')}.`);
  if (!TRANSITIONS[entry.lifecycle].includes(to)) throw sessionError('INVALID_TRANSITION', `A ${entry.lifecycle} conversation cannot become ${to}.`);
  if (entry.transitions.length >= MAX_TRANSITIONS) throw sessionError('SESSION_HISTORY_FULL', 'This conversation has recorded as many state changes as Frige keeps.');
  entry.transitions.push({ at, from: entry.lifecycle, to, actor, ...(reason ? { reason } : {}) });
  entry.lifecycle = to;
}

/**
 * Validates and normalizes a summary the author is saving.
 *
 * @param {unknown} input  Untrusted request body.
 * @returns {{ text: string, decisions: string[], openQuestions: string[], outstandingProposals: string[], sources: string[] }}
 *   Entries trimmed; blank entries dropped.
 * @throws `INVALID_SUMMARY` (400) when the text is blank or over its limit, or a list is not
 *   an array of at most {@link MAX_LIST_ITEMS} strings of at most {@link MAX_LIST_ITEM} characters.
 */
export function validateSummary(input) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? /** @type {Record<string, unknown>} */ (input) : {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_SUMMARY_TEXT || !text.isWellFormed()) throw sessionError('INVALID_SUMMARY', `A summary needs text of 1 to ${MAX_SUMMARY_TEXT} characters.`);
  const result = { text };
  for (const field of SUMMARY_LISTS) {
    const raw = body[field] ?? [];
    if (!Array.isArray(raw)) throw sessionError('INVALID_SUMMARY', `${field} must be a list.`);
    const items = raw.map((item) => (typeof item === 'string' ? item.trim() : null));
    if (items.some((item) => item === null || item.length > MAX_LIST_ITEM || !item.isWellFormed())) throw sessionError('INVALID_SUMMARY', `Each ${field} entry is text of at most ${MAX_LIST_ITEM} characters.`);
    const kept = items.filter(Boolean);
    if (kept.length > MAX_LIST_ITEMS) throw sessionError('INVALID_SUMMARY', `${field} holds at most ${MAX_LIST_ITEMS} entries.`);
    result[field] = kept;
  }
  return /** @type {any} */ (result);
}

/**
 * Cuts text to a list-entry length without splitting a surrogate pair.
 *
 * @param {string} text
 * @returns {string}
 */
export function clipItem(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= MAX_LIST_ITEM) return flat;
  const cut = flat.slice(0, MAX_LIST_ITEM - 1);
  return `${cut.isWellFormed() ? cut : cut.slice(0, -1)}…`;
}

/**
 * A fresh index entry.
 *
 * @param {{ id: string, title: string, createdAt: string | null, createdBy: string | null, continuedFrom?: IndexEntry['continuedFrom'] }} fields
 * @returns {IndexEntry}
 */
export const newEntry = ({ id, title, createdAt, createdBy, continuedFrom = null }) => ({
  id, title, lifecycle: 'active', archived: false, createdAt, createdBy, continuedFrom, summaries: [], transitions: [],
});

/** Whether a value is an ISO-parsable time string. */
const isTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
/** Whether a value is a plain object. */
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Validates a stored index entry against everything the writer guarantees.
 *
 * @param {unknown} entry
 * @param {string} id  The key it is stored under.
 * @returns {boolean}
 */
function validEntry(entry, id) {
  if (!isObject(entry)) return false;
  const e = /** @type {Record<string, any>} */ (entry);
  if (e.id !== id || !isConversationId(id) || typeof e.title !== 'string' || !e.title || e.title.length > MAX_TITLE) return false;
  if (!LIFECYCLES.includes(e.lifecycle) || typeof e.archived !== 'boolean') return false;
  if (e.createdAt !== null && !isTime(e.createdAt)) return false;
  if (e.createdBy !== null && typeof e.createdBy !== 'string') return false;
  if (e.continuedFrom !== null && !(isObject(e.continuedFrom) && isConversationId(e.continuedFrom.conversationId) && Number.isInteger(e.continuedFrom.summaryRevision) && e.continuedFrom.summaryRevision >= 1)) return false;
  if (!Array.isArray(e.transitions) || e.transitions.length > MAX_TRANSITIONS) return false;
  if (!e.transitions.every((event) => isObject(event) && isTime(event.at) && LIFECYCLES.includes(event.from) && LIFECYCLES.includes(event.to) && typeof event.actor === 'string' && (event.reason === undefined || typeof event.reason === 'string'))) return false;
  if (!Array.isArray(e.summaries) || e.summaries.length > MAX_REVISIONS) return false;
  return e.summaries.every((summary, index) => isObject(summary) && summary.revision === index + 1
    && typeof summary.text === 'string' && summary.text.length <= MAX_SUMMARY_TEXT
    && SUMMARY_LISTS.every((field) => Array.isArray(summary[field]) && summary[field].length <= MAX_LIST_ITEMS && summary[field].every((item) => typeof item === 'string' && item.length <= MAX_LIST_ITEM))
    && (summary.throughTurnId === null || typeof summary.throughTurnId === 'string')
    && typeof summary.author === 'string' && isTime(summary.updatedAt));
}

/**
 * Validates a parsed per-scope index file.
 *
 * @param {unknown} raw  Parsed JSON.
 * @returns {Record<string, IndexEntry>}  The conversations by id.
 * @throws `SESSIONS_UNAVAILABLE` (503) when the shape is not exactly what this module writes:
 *   damage fails closed rather than reading as "no conversations".
 */
export function normalizeIndex(raw) {
  const damaged = () => sessionError('SESSIONS_UNAVAILABLE', 'This scope’s conversation index could not be read or is damaged, so its conversations cannot be listed. Nothing was changed.');
  if (!isObject(raw) || raw.schemaVersion !== 1 || !isObject(raw.conversations)) throw damaged();
  const entries = /** @type {Record<string, IndexEntry>} */ (raw.conversations);
  for (const [id, entry] of Object.entries(entries)) if (!validEntry(entry, id)) throw damaged();
  return entries;
}

/**
 * The summary revision an entry currently stands at (0 when none was saved).
 *
 * @param {IndexEntry} entry
 * @returns {number}
 */
export const latestRevision = (entry) => entry.summaries.length;

/**
 * Chooses the saved summaries a turn may offer the model (D-027, "Continue").
 *
 * Order: first the summary the conversation was continued from (the exact
 * revision it continued from), then the most recent completed, unarchived
 * conversations of the same scope that have a saved summary (their latest
 * revision), at most {@link MAX_OFFERED_SUMMARIES} in all. Whole items are
 * dropped, oldest last, until the serialized list fits
 * {@link SUMMARY_BUDGET_BYTES} UTF-8 bytes. No transcript is ever included.
 *
 * @param {IndexEntry[]} entries  Every conversation of the scope, including the current one.
 * @param {string} currentId      The conversation the turn is in; never offered to itself.
 * @returns {Array<{ conversationId: string, title: string, lifecycle: string, summaryRevision: number, text: string, decisions: string[], openQuestions: string[], outstandingProposals: string[] }>}
 */
export function selectSessionSummaries(entries, currentId) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const offer = (entry, revision) => {
    const saved = entry.summaries[revision - 1];
    return saved && {
      conversationId: entry.id, title: entry.title, lifecycle: entry.lifecycle, summaryRevision: revision, text: saved.text,
      decisions: saved.decisions, openQuestions: saved.openQuestions, outstandingProposals: saved.outstandingProposals,
    };
  };
  const chosen = [];
  const current = byId.get(currentId);
  const from = current?.continuedFrom;
  const source = from && byId.get(from.conversationId);
  const first = source && offer(source, from.summaryRevision);
  if (first) chosen.push(first);
  /** When a conversation last became `completed`, for recency. */
  const completedAt = (entry) => entry.transitions.findLast((event) => event.to === 'completed')?.at ?? '';
  const recent = entries
    .filter((entry) => entry.id !== currentId && entry.id !== from?.conversationId && entry.lifecycle === 'completed' && !entry.archived && entry.summaries.length)
    .sort((left, right) => completedAt(right).localeCompare(completedAt(left)));
  for (const entry of recent) {
    if (chosen.length >= MAX_OFFERED_SUMMARIES) break;
    chosen.push(offer(entry, latestRevision(entry)));
  }
  while (chosen.length && Buffer.byteLength(JSON.stringify(chosen), 'utf8') > SUMMARY_BUDGET_BYTES) chosen.pop();
  return chosen;
}
