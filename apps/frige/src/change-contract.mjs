/**
 * Change contracts — `stex.frige.change-contract.v1`.
 *
 * A change contract is the inspectable record of one proposed change to
 * canonical manuscript source: what was asked, why the director proposes it,
 * exactly which text would replace which, what the director was shown, what
 * accepting it affects, and how it can be rolled back.
 *
 * This module is pure: it builds and interprets contract records and performs
 * no input or output. `ProjectStore` owns persistence, locking and every
 * manuscript write. Keeping the rules here lets them be tested without a
 * manuscript on disk and keeps the store's serialized write path small.
 *
 * Owner: Frige (`apps/frige`). Contract documentation: `protocol/frige/README.md`.
 */

/** Contract name written into every schema-3 record. */
export const CHANGE_CONTRACT = 'stex.frige.change-contract.v1';

/** Record schema. Schema 2 is the earlier change set, which carries no provenance. */
export const CONTRACT_SCHEMA_VERSION = 3;

const CONTRACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_REQUEST = 12_000;
const MAX_COMMENTARY = 12_000;
const MAX_SUMMARY_REQUEST = 280;

/**
 * Where a piece of context offered to the director came from. Categories are
 * recorded separately so that canonical source, reviewed references and
 * generated text are never merged into one undifferentiated authority.
 *
 * @typedef {'canonical-source' | 'approved-reference'} ContextCategory
 */

/**
 * Lifecycle of one change inside a contract.
 *
 * - `pending`     proposed; nothing written.
 * - `accepted`    written to the manuscript through the base-hash check.
 * - `rejected`    declined by the author; nothing written.
 * - `stale`       not written: the piece changed after the proposal.
 * - `failed`      not written: the write itself failed.
 * - `superseded`  replaced by a newer proposal before it was decided.
 * - `reverted`    accepted, then rolled back to the prior text.
 *
 * @typedef {'pending' | 'accepted' | 'rejected' | 'stale' | 'failed' | 'superseded' | 'reverted'} ChangeStatus
 */

/**
 * Line counts for one change. `added` and `removed` compare the two texts as
 * multisets of lines, so a moved line counts as neither. The exact change is
 * always the stored `before` and `source` texts; these counts only summarize it.
 *
 * @typedef {object} LineStats
 * @property {number} before   Lines in the prior text.
 * @property {number} after    Lines in the proposed text.
 * @property {number} added    Lines present in the proposed text only.
 * @property {number} removed  Lines present in the prior text only.
 */

/**
 * One proposed replacement of a manuscript piece.
 *
 * @typedef {object} ContractChange
 * @property {'replace-node-source'} kind
 * @property {string} nodeId
 * @property {string} relativePath  Path below `manuscript/`.
 * @property {string} title
 * @property {string} baseHash      SHA-256 of `before`; the write refuses any other current text.
 * @property {string} afterHash     SHA-256 of `source`; rollback requires the piece to still hold it.
 * @property {string} before        Exact prior text.
 * @property {string} source        Exact proposed text.
 * @property {string} summary       The director's one-line description.
 * @property {LineStats} lines
 * @property {ChangeStatus} status
 * @property {string} [decidedAt]
 * @property {string} [revertedAt]
 * @property {string} [supersededBy]  Id of the contract that replaced this change.
 * @property {string} [error]         Why an accept or rollback did not write.
 */

/**
 * A source the director was shown for this turn.
 *
 * @typedef {object} OfferedSource
 * @property {string} nodeId
 * @property {string} relativePath
 * @property {string} title
 * @property {string} [kind]
 * @property {string} hash
 * @property {string} source
 */

/**
 * Facts about the turn that produced a proposal, supplied by the server.
 *
 * @typedef {object} ContractProvenance
 * @property {string} [request]      The author's message or answer summary.
 * @property {string | null} [userTurnId]
 * @property {string | null} [model]
 * @property {string | null} [transport]  As the gateway reported it, for example `fake` or `remote`. Recorded, not interpreted.
 * @property {Array<{ nodeId: string, title: string }>} [withheld]  In scope but too large to offer.
 * @property {Array<{ id: string, name: string }>} [references]     Author-approved excerpts offered.
 * @property {string | null} [designHash]  Publication profile in force when proposed.
 */

/**
 * Another undecided contract that proposes a change to the same piece.
 *
 * @typedef {object} ContractConflict
 * @property {string} contractId
 * @property {string} scopeId
 * @property {string | null} nodeId  The piece, when the other change is to a piece's text or own layout.
 * @property {string} [target]       What both would change (`changeTarget`); absent in contracts made before layout changes.
 */

/**
 * The proof that typeset every accepted change of a contract.
 *
 * @typedef {object} ContractProof
 * @property {string} completedAt
 * @property {string | null} scopeId           Scope the proof was built for.
 * @property {string | null} mode              `prefix` (book order) or `isolated`.
 * @property {boolean} paginationVerified      Whether the page map is compiler-verified.
 * @property {string | null} designHash
 * @property {Record<string, string>} sourceHashes  Accepted pieces and the hashes that were typeset.
 */

/**
 * A contract as a history listing returns it: every field except manuscript text.
 *
 * @typedef {object} ContractSummary
 * @property {number} schemaVersion  `2` for a change set from before contracts.
 * @property {string | null} contract
 * @property {string} id
 * @property {string} scopeId
 * @property {{ id: string, kind: string, title: string } | null} scope
 * @property {string | null} createdAt
 * @property {string} status
 * @property {string} request  At most 280 characters.
 * @property {{ userTurnId: string | null, model: string | null, transport: string | null } | null} origin
 * @property {ContractConflict[]} conflicts
 * @property {ContractProof | null} proof
 * @property {Array<{
 *   kind: string, nodeId: string | null, title: string, status: string, baseHash: string, afterHash: string,
 *   decidedAt: string | null, revertedAt: string | null,
 *   relativePath?: string, lines?: LineStats | null,
 *   level?: 'section' | 'node', target?: string, before?: object | null, after?: object | null,
 * }>} changes  A text change carries `relativePath` and `lines`; a layout change carries `level`, `target`, `before` and `after`.
 */

/**
 * A stored change contract (record schema 3).
 *
 * @typedef {object} ChangeContract
 * @property {3} schemaVersion
 * @property {typeof CHANGE_CONTRACT} contract
 * @property {string} id
 * @property {string} scopeId
 * @property {{ id: string, kind: string, title: string }} scope
 * @property {string} createdAt
 * @property {string} request     Proposed action, in the author's words.
 * @property {string} commentary  The director's reason.
 * @property {{ userTurnId: string | null, model: string | null, transport: string | null }} origin
 * @property {{
 *   offered: Array<{ nodeId: string, relativePath: string, hash: string, category: ContextCategory }>,
 *   withheld: Array<{ nodeId: string, title: string }>,
 *   references: Array<{ id: string, name: string, category: ContextCategory }>,
 *   designHash: string | null,
 * }} context
 * @property {'pending' | 'resolved'} status
 * @property {Array<ContractChange | LayoutChange>} changes  Text changes, or exactly one layout change.
 * @property {Array<{ nodeId: string, reason: string }>} dropped
 * @property {Array<{ code: string, message: string }>} effects
 * @property {ContractConflict[]} conflicts  As found when the contract was proposed; not updated afterwards.
 * @property {{ required: 'author', granularity: 'per-change' }} approval
 * @property {{ strategy: 'restore-before', requires: 'current-hash-equals-after-hash' }} rollback
 * @property {ContractProof | null} proof  The strongest successful build that typeset every accepted change; cleared when a further change is accepted or one is rolled back.
 */

/**
 * Reduces an untrusted provenance value to a short label. The gateway's reply
 * is not trusted to send strings, so anything else is recorded as absent.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function label(value) {
  return typeof value === 'string' && value ? value.slice(0, 120) : null;
}

/**
 * Whether two texts differ in more than their line-ending convention. A reply
 * that only re-ends lines proposes nothing an author asked for.
 *
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function sameTextIgnoringLineEndings(left, right) {
  const unified = (text) => text.replace(/\r\n/g, '\n');
  return unified(left) === unified(right);
}

/**
 * Whether a value read from disk is a usable contract record for the given id.
 * State files can be damaged or edited by hand, and a rollback writes a
 * record's `before` text into the manuscript, so a record is trusted only if
 * it is stored under its own id and every change has the fields the store acts on.
 *
 * @param {unknown} record
 * @param {string} id  The id the record was looked up by.
 * @returns {boolean}
 */
export function isContractRecord(record, id) {
  if (!record || typeof record !== 'object' || !isContractId(id)) return false;
  const { id: recordId, scopeId, changes } = /** @type {Record<string, unknown>} */ (record);
  if (recordId !== id || typeof scopeId !== 'string' || !Array.isArray(changes)) return false;
  const text = (value) => typeof value === 'string';
  const override = (value) => value === null || (typeof value === 'object' && !Array.isArray(value));
  return changes.every((change) => {
    if (!change || typeof change !== 'object') return false;
    // A layout change acts on the profile: its before and after are override objects, or null for none.
    if (change.kind === LAYOUT_CHANGE) {
      return ['section', 'node'].includes(change.level) && ['target', 'status', 'baseHash', 'afterHash'].every((field) => text(change[field]))
        && override(change.before) && override(change.after);
    }
    return ['nodeId', 'status', 'baseHash', 'afterHash', 'before', 'source'].every((field) => text(change[field]));
  });
}

// ---------------------------------------------------------------------------
// Layout changes (program Wave 3b)
//
// A contract may instead hold exactly one layout change: setting or clearing
// one section's or one piece's override in the publication profile. Its
// `baseHash` and `afterHash` are hashes of the whole profile, so acceptance
// and rollback refuse to act on a profile that has changed since, exactly as
// text changes refuse a piece that has changed.
// ---------------------------------------------------------------------------

/** The `kind` of a change to the publication profile. */
export const LAYOUT_CHANGE = 'set-layout';

/**
 * One proposed change to a section's or a piece's own layout settings.
 *
 * @typedef {object} LayoutChange
 * @property {'set-layout'} kind
 * @property {'section' | 'node'} level
 * @property {string} target          Section folder, or node id.
 * @property {string | null} nodeId   The piece, for a piece's override; `null` for a section.
 * @property {string} title           What the author sees the change is about.
 * @property {object | null} before   The target's own override before; `null` for none.
 * @property {object | null} after    The proposed override; `null` clears it.
 * @property {string} baseHash        Profile hash the change was proposed against.
 * @property {string} afterHash       Profile hash once accepted; rollback requires it.
 * @property {string[]} pieces        Pieces in the reading order the override applies to, when proposed; a proof must typeset all of them.
 * @property {{ fontSize: string, leading: string, sizeFrom: string, opensRecto: boolean, headText: string | null }} inherited
 *   What applies to the target without its own override. `headText` is `null` for a piece.
 * @property {string} summary
 * @property {ChangeStatus} status
 */

/**
 * The thing a change acts on, for conflict detection: a piece's text, or one
 * target's layout override.
 *
 * @param {{ kind?: string, nodeId?: string | null, level?: string, target?: string }} change
 * @returns {string}
 */
export function changeTarget(change) {
  return change.kind === LAYOUT_CHANGE ? `layout:${change.level}:${change.target}` : String(change.nodeId);
}

/**
 * Whether a value is a well-formed contract id. Ids become file names, so the
 * store checks this before building any path.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isContractId(value) {
  return typeof value === 'string' && CONTRACT_ID.test(value);
}

/**
 * Summarizes the size of a change as line counts.
 *
 * @param {string} before
 * @param {string} after
 * @returns {LineStats}
 */
export function lineStats(before, after) {
  const linesOf = (text) => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
  const prior = linesOf(before);
  const next = linesOf(after);
  /** @type {Map<string, number>} */
  const unmatched = new Map();
  for (const line of prior) unmatched.set(line, (unmatched.get(line) || 0) + 1);
  let added = 0;
  for (const line of next) {
    const remaining = unmatched.get(line) || 0;
    if (remaining > 0) unmatched.set(line, remaining - 1);
    else added += 1;
  }
  let removed = 0;
  for (const remaining of unmatched.values()) removed += remaining;
  return { before: prior.length, after: next.length, added, removed };
}

/**
 * Builds one contract change from an offered source and its proposed text.
 *
 * @param {OfferedSource} base        The source exactly as it was offered.
 * @param {string} source             The proposed replacement, already in the file's line-ending convention.
 * @param {string} afterHash          SHA-256 of `source`.
 * @param {unknown} summary           The director's description, untrusted.
 * @returns {ContractChange}
 */
export function buildChange(base, source, afterHash, summary) {
  return {
    kind: 'replace-node-source',
    nodeId: base.nodeId,
    relativePath: base.relativePath,
    title: base.title,
    baseHash: base.hash,
    afterHash,
    before: base.source,
    source,
    summary: String(summary || '').slice(0, 500),
    lines: lineStats(base.source, source),
    status: 'pending',
  };
}

/**
 * Assembles a new pending contract.
 *
 * @param {object} input
 * @param {string} input.id
 * @param {string} input.createdAt                ISO timestamp.
 * @param {{ id: string, kind: string, title: string }} input.scope
 * @param {unknown} input.commentary              The director's reason, untrusted.
 * @param {ContractChange[]} input.changes        Validated changes, at least one.
 * @param {Array<{ nodeId: string, reason: string }>} input.dropped  Proposed changes that were refused.
 * @param {OfferedSource[]} input.offered         Every source offered this turn.
 * @param {ContractProvenance} [input.provenance]
 * @param {ContractConflict[]} [input.conflicts]
 * @returns {ChangeContract}
 */
export function buildContract({ id, createdAt, scope, commentary, changes, dropped, offered, provenance = {}, conflicts = [] }) {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contract: CHANGE_CONTRACT,
    id,
    scopeId: scope.id,
    scope: { id: scope.id, kind: scope.kind, title: scope.title },
    createdAt,
    request: String(provenance.request || '').slice(0, MAX_REQUEST),
    commentary: String(commentary || '').slice(0, MAX_COMMENTARY),
    origin: {
      userTurnId: label(provenance.userTurnId),
      model: label(provenance.model),
      transport: label(provenance.transport),
    },
    context: {
      offered: offered.map(({ nodeId, relativePath, hash }) => ({ nodeId, relativePath, hash, category: 'canonical-source' })),
      withheld: (provenance.withheld || []).map(({ nodeId, title }) => ({ nodeId, title })),
      references: (provenance.references || []).map(({ id: referenceId, name }) => ({ id: referenceId, name, category: 'approved-reference' })),
      designHash: label(provenance.designHash),
    },
    status: 'pending',
    changes,
    dropped,
    effects: [changes.some((change) => change.kind === LAYOUT_CHANGE)
      ? { code: 'proof-stale', message: 'Accepting changes the publication profile. Every proof is stale until it is typeset again, and pagination may move.' }
      : { code: 'proof-stale', message: 'Accepting changes canonical source. Any proof that includes these pieces is stale until it is typeset again, and pagination may move.' }],
    conflicts,
    approval: { required: 'author', granularity: 'per-change' },
    rollback: { strategy: 'restore-before', requires: 'current-hash-equals-after-hash' },
    proof: null,
  };
}

/**
 * Whether a record still has a change awaiting the author's decision.
 *
 * @param {{ changes?: Array<{ status: string }> } | null | undefined} record
 * @returns {boolean}
 */
export function hasPending(record) {
  return Boolean(record?.changes?.some((change) => change.status === 'pending'));
}

/**
 * Marks a record's undecided changes as replaced by a newer contract. The
 * record is kept, so a proposal the author never decided remains readable.
 *
 * @param {{ status: string, changes: Array<Partial<ContractChange> & { status: string }> }} record  Mutated in place.
 * @param {string} byContractId
 * @param {string} at  ISO timestamp.
 * @returns {Array<Partial<ContractChange> & { status: string }>}  The changes that were superseded.
 */
export function supersede(record, byContractId, at) {
  const replaced = record.changes.filter((change) => change.status === 'pending');
  for (const change of replaced) {
    change.status = 'superseded';
    change.decidedAt = at;
    change.supersededBy = byContractId;
  }
  record.status = 'resolved';
  return replaced;
}

/**
 * Finds undecided changes in other contracts that target the same pieces.
 * A conflict does not block a proposal: whichever is accepted first makes the
 * other stale. It is recorded so the author sees the overlap before deciding.
 *
 * @param {Array<{ id: string, scopeId: string, changes?: Array<{ nodeId?: string | null, status: string }> }>} records
 * @param {Array<{ kind?: string, nodeId?: string | null, level?: string, target?: string }>} changes  The new contract's changes.
 * @param {string} exceptScopeId   The new contract's own scope, whose earlier proposal is superseded instead.
 * @returns {ContractConflict[]}  `target` names what both would change (see `changeTarget`).
 */
export function conflictsWith(records, changes, exceptScopeId) {
  const targets = new Set(changes.map(changeTarget));
  const conflicts = [];
  for (const record of records) {
    if (record.scopeId === exceptScopeId) continue;
    for (const change of record.changes || []) {
      if (change.status === 'pending' && targets.has(changeTarget(change))) {
        conflicts.push({ contractId: record.id, scopeId: record.scopeId, nodeId: change.nodeId ?? null, target: changeTarget(change) });
      }
    }
  }
  return conflicts;
}

/**
 * Decides whether a recorded build is a proof of a contract: a successful
 * build that typeset every accepted change at exactly its accepted text.
 *
 * @param {{ changes?: Array<{ nodeId: string, status: string, afterHash: string }> }} record
 * @param {{
 *   ok?: boolean,
 *   completedAt?: string,
 *   targetScope?: { id?: string } | null,
 *   sourceHashes?: Record<string, string>,
 *   pageMap?: { mode?: string, designHash?: string, pagination?: { verified?: boolean } } | null,
 * }} build
 * @param {{ readingOrder?: string[] }} [book]  The book's current reading order,
 *   when known: a layout change then requires only its pieces still in the book.
 * @returns {ContractProof | null}  `null` when the build does not prove the contract.
 */
export function proofFor(record, build, { readingOrder = null } = {}) {
  if (!build?.ok || !build.completedAt) return null;
  const accepted = (record.changes || []).filter((change) => change.status === 'accepted');
  if (!accepted.length) return null;
  const typeset = build.sourceHashes || {};
  // A text change is proved by its piece's typeset hash. A layout change is
  // proved by a build that typeset every piece the override applies to, under
  // exactly the profile the change produced; a build of other pieces under that
  // profile proves nothing about this target.
  // A piece that has since left the table of contents can no longer be typeset,
  // so it no longer has to be; pieces added since the proposal are not required.
  const required = (change) => (Array.isArray(change.pieces) ? change.pieces : []).filter((id) => !readingOrder || readingOrder.includes(id));
  const proved = (change) => (change.kind === LAYOUT_CHANGE
    ? build.pageMap?.designHash === change.afterHash && required(change).length > 0 && required(change).every((id) => Object.hasOwn(typeset, id))
    : typeset[change.nodeId] === change.afterHash);
  if (!accepted.every(proved)) return null;
  return {
    completedAt: build.completedAt,
    scopeId: build.targetScope?.id || null,
    mode: build.pageMap?.mode || null,
    paginationVerified: build.pageMap?.pagination?.verified === true,
    designHash: build.pageMap?.designHash || null,
    sourceHashes: Object.fromEntries(accepted.filter((change) => change.kind !== LAYOUT_CHANGE).map((change) => [change.nodeId, change.afterHash])),
  };
}

/**
 * Ranks a proof: a compiler-verified page map outranks an unverified one, and
 * within that a book-order proof outranks a piece typeset alone.
 *
 * @param {ContractProof | null | undefined} proof
 * @returns {number}  Higher is stronger; `-1` for no proof.
 */
export function proofStrength(proof) {
  if (!proof) return -1;
  return (proof.paginationVerified ? 2 : 0) + (proof.mode === 'prefix' ? 1 : 0);
}

/**
 * Reduces a contract to what a history list needs. Manuscript text is left
 * out: a listing of every contract must not carry every prior version of
 * every piece.
 *
 * @param {Partial<ChangeContract> & { id: string, scopeId: string, changes: Array<Partial<ContractChange>> }} record
 * @returns {ContractSummary}
 */
export function summarizeContract(record) {
  return {
    schemaVersion: record.schemaVersion ?? 2,
    contract: record.contract || null,
    id: record.id,
    scopeId: record.scopeId,
    scope: record.scope || null,
    createdAt: record.createdAt || null,
    status: record.status || 'resolved',
    request: String(record.request || '').slice(0, MAX_SUMMARY_REQUEST),
    origin: record.origin || null,
    conflicts: record.conflicts || [],
    proof: record.proof || null,
    changes: record.changes.map((change) => ({
      kind: change.kind || 'replace-node-source',
      nodeId: change.nodeId ?? null,
      title: change.title,
      status: change.status,
      baseHash: change.baseHash,
      afterHash: change.afterHash,
      decidedAt: change.decidedAt || null,
      revertedAt: change.revertedAt || null,
      // Settings are not manuscript text, so a layout change is listed in full.
      ...(change.kind === LAYOUT_CHANGE
        ? { level: change.level, target: change.target, before: change.before, after: change.after }
        : { relativePath: change.relativePath, lines: change.lines || null }),
    })),
  };
}
