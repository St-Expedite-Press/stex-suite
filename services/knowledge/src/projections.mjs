// stex.knowledge.projections.v1: derived provenance, never engine state.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA = 'stex.knowledge.projections.v1';
const MAX_EVENTS = 10000;
const MAX_BYTES = 8_000_000;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const copy = (value) => structuredClone(value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeText = (value, max = 300) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const projectRef = (value) => typeof value === 'string' && /^stex:\/\/(frige|seaxneat)\/project\/[a-z0-9][a-z0-9-]{0,62}$/.test(value);
const entityRef = (value) => projectRef(value) || (typeof value === 'string' && /^stex:\/\/knowledge\/(concept|preference|commitment)\/[a-z0-9][a-z0-9-]{0,79}$/.test(value));
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(value);

function sourceMetadata(value, project) {
  if (!value || !/^[a-z][a-z0-9-]{0,80}$/.test(value.id || '') || value.reference !== `${project.reference}#source=${encodeURIComponent(value.id)}` || !hash(value.revision) || !safeText(value.title) || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || !['text/plain', 'text/markdown', 'text/css'].includes(value.mediaType)) throw fail(400, 'INVALID_SOURCE', 'A source requires canonical identity, revision and provenance.');
  if (value.originRevision !== undefined && !/^[a-f0-9]{40,64}$/.test(value.originRevision)) throw fail(400, 'INVALID_SOURCE', 'The owner revision must be a Git object identity.');
  return { id: value.id, reference: value.reference, revision: value.revision, title: value.title, bytes: value.bytes, mediaType: value.mediaType, ...(value.originRevision ? { originRevision: value.originRevision } : {}) };
}

function revisionEvent(value) {
  if (!value || !validId(value.id) || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !safeText(value.occurredAt, 40) || !Number.isFinite(Date.parse(value.occurredAt)) || !projectRef(value.project?.reference) || !safeText(value.project.title) || !Array.isArray(value.sources) || value.sources.length > 50) throw fail(400, 'INVALID_EVENT', 'A revision event requires an owner identity, sequence, project and sources.');
  const match = /^stex:\/\/(frige|seaxneat)\/project\/(.+)$/.exec(value.project.reference);
  if (value.project.application !== match[1] || value.project.id !== match[2]) throw fail(400, 'INVALID_EVENT', 'The engine project identity does not match its reference.');
  const project = { application: match[1], id: match[2], reference: value.project.reference, title: value.project.title };
  const sources = value.sources.map((source) => sourceMetadata(source, project)).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(sources.map((source) => source.id)).size !== sources.length) throw fail(400, 'INVALID_EVENT', 'Duplicate source identities are not permitted.');
  return { id: value.id, sequence: value.sequence, occurredAt: value.occurredAt, project, sources };
}

function relationRecord(value) {
  if (!value || !validId(value.id) || !['assertion', 'inference'].includes(value.kind) || !entityRef(value.subject) || !safeText(value.predicate, 120) || !safeText(value.object, 1000) || !Array.isArray(value.evidence) || value.evidence.length > 10) throw fail(400, 'INVALID_RELATION', 'A relationship requires an identity, kind, subject, predicate, object and evidence list.');
  const evidence = value.evidence.map((entry) => {
    if (!entry || typeof entry.reference !== 'string' || !/^stex:\/\/(frige|seaxneat)\/project\/[a-z0-9][a-z0-9-]{0,62}#source=[a-z][a-z0-9-]{0,80}$/.test(entry.reference) || !hash(entry.revision)) throw fail(400, 'INVALID_RELATION', 'Evidence must reference an exact engine source revision.');
    return { reference: entry.reference, revision: entry.revision };
  });
  if (value.kind === 'inference' && (!evidence.length || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) throw fail(400, 'INVALID_RELATION', 'An inferred relationship requires evidence and confidence between zero and one.');
  return { id: value.id, kind: value.kind, subject: value.subject, predicate: value.predicate, object: value.object, evidence, ...(value.kind === 'inference' ? { confidence: value.confidence } : {}), status: value.kind === 'assertion' ? 'accepted' : 'proposed' };
}

function initial(generation = randomUUID()) { return { schemaVersion: SCHEMA, generation, events: [] }; }
function token(document) { return `${document.generation}:${document.events.length}`; }
function renewsConsent(previous, identity, value) {
  return previous?.consent === false && previous.eventId === value.id && previous.sequence === value.sequence && identity === digest(value);
}

// Rebuilt from the accepted journal on each mutation; no second persisted database.
export function rebuildKnowledge(document) {
  if (document?.schemaVersion !== SCHEMA || typeof document.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(document.generation) || !Array.isArray(document.events) || document.events.length > MAX_EVENTS) throw fail(503, 'INVALID_JOURNAL', 'The knowledge journal is unreadable; it has been preserved.');
  const projects = new Map(); const relations = new Map(); const identities = new Map(); const keys = new Map();
  for (let i = 0; i < document.events.length; i += 1) {
    const event = document.events[i];
    if (event?.number !== i + 1 || !validId(event.key) || !hash(event.fingerprint) || keys.has(event.key)) throw fail(503, 'INVALID_JOURNAL', 'The knowledge journal has invalid ordering or identities.');
    keys.set(event.key, event.fingerprint);
    if (event.kind === 'revision') {
      const value = revisionEvent(event.value); const previous = projects.get(value.project.reference);
      const priorIdentity = identities.get(value.id);
      const renewal = renewsConsent(previous, priorIdentity, value);
      if (previous && value.sequence <= previous.sequence && !renewal) throw fail(503, 'INVALID_JOURNAL', 'The knowledge journal contains a stale revision.');
      if (priorIdentity && !renewal) throw fail(503, 'INVALID_JOURNAL', 'The knowledge journal repeats an engine event identity.');
      identities.set(value.id, digest(value));
      projects.set(value.project.reference, { ...value.project, sequence: value.sequence, eventId: value.id, occurredAt: value.occurredAt, consent: true, sources: value.sources });
    } else if (event.kind === 'revoke') {
      if (!projectRef(event.value)) throw fail(503, 'INVALID_JOURNAL', 'Invalid revocation.');
      const previous = projects.get(event.value);
      if (!previous) throw fail(503, 'INVALID_JOURNAL', 'Revocation has no project.');
      projects.set(event.value, { ...previous, consent: false, sources: [] });
    } else if (event.kind === 'relation') {
      const value = relationRecord(event.value);
      if (relations.has(value.id)) throw fail(503, 'INVALID_JOURNAL', 'Repeated relationship identity.');
      relations.set(value.id, { ...value, createdAt: event.at, updatedAt: event.at });
    } else if (event.kind === 'revise') {
      const previous = relations.get(event.value?.id);
      if (!previous || !['accepted', 'rejected'].includes(event.value.status) || (event.value.object !== undefined && !safeText(event.value.object, 1000))) throw fail(503, 'INVALID_JOURNAL', 'Invalid relationship correction.');
      const object = event.value.object === undefined ? previous.object : event.value.object;
      relations.set(previous.id, { ...previous, object, status: event.value.status, updatedAt: event.at, corrected: object !== previous.object || previous.corrected || false });
    } else throw fail(503, 'INVALID_JOURNAL', 'The knowledge journal contains an unknown event.');
  }
  const sources = [...projects.values()].flatMap((project) => project.sources.map((source) => ({ ...source, project: project.reference, eventId: project.eventId, occurredAt: project.occurredAt })));
  const available = new Map(sources.map((source) => [source.reference, source.revision]));
  const links = [...relations.values()].map((relation) => ({ ...relation, evidenceState: relation.evidence.every((entry) => available.get(entry.reference) === entry.revision) ? 'current' : 'unavailable' }));
  return { version: token(document), knowledge: { sources }, graph: { projects: [...projects.values()].map(({ sources, ...project }) => ({ ...project, sourceCount: sources.length })), relations: links }, keys, identities };
}

async function atomicWrite(file, document) {
  const raw = `${JSON.stringify(document)}\n`;
  if (Buffer.byteLength(raw) > MAX_BYTES) throw fail(413, 'KNOWLEDGE_LIMIT', 'Export or delete knowledge before adding more journal data.');
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(raw, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try {
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temporary, file); break; }
      catch (error) { if (!['EACCES', 'EPERM', 'EBUSY'].includes(error.code) || attempt >= 5) throw error; await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt)); }
    }
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}

/** A single local writer, with an advisory process lock and atomic journal. */
export async function openKnowledge({ directory = '' } = {}) {
  if (!directory) {
    const unavailable = async () => { throw fail(503, 'KNOWLEDGE_DISABLED', 'Knowledge integration is disabled.'); };
    const view = () => ({ enabled: false, version: null, knowledge: { sources: [] }, graph: { projects: [], relations: [] } });
    return { enabled: false, view, export: view, async close() {}, accept: unavailable, revoke: unavailable, relation: unavailable, revise: unavailable, erase: unavailable };
  }
  const root = path.resolve(directory); await mkdir(root, { recursive: true });
  const file = path.join(root, 'knowledge.v1.json'); const lock = path.join(root, 'knowledge.lock');
  const nonce = randomUUID();
  let lockHandle;
  try { lockHandle = await open(lock, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A separate exclusive recovery claim prevents two starters from both
    // removing a dead writer's lock and admitting themselves as writers.
    const recovery = path.join(root, 'knowledge.recovery');
    let claim; try { claim = await open(recovery, 'wx'); }
    catch { throw fail(503, 'KNOWLEDGE_LOCKED', 'Knowledge writer recovery is already in progress.'); }
    try {
      await claim.writeFile(JSON.stringify({ pid: process.pid, nonce })); await claim.close();
      let previous; try { previous = JSON.parse(await readFile(lock, 'utf8')); } catch { throw fail(503, 'KNOWLEDGE_LOCKED', 'The knowledge writer lock is unreadable.'); }
      if (!Number.isInteger(previous.pid) || previous.pid < 1) throw fail(503, 'KNOWLEDGE_LOCKED', 'The knowledge writer lock is invalid.');
      let alive = true; try { process.kill(previous.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
      if (alive) throw fail(503, 'KNOWLEDGE_LOCKED', 'Another knowledge writer is active.');
      await rm(lock); lockHandle = await open(lock, 'wx');
    } finally { await claim.close().catch(() => {}); await rm(recovery, { force: true }); }
  }
  await lockHandle.writeFile(JSON.stringify({ pid: process.pid, nonce })); await lockHandle.close();
  let document; let closed = false; let closing = false; let queue = Promise.resolve();
  const unlock = async () => { const value = JSON.parse(await readFile(lock, 'utf8')); if (value.nonce === nonce) await rm(lock); };
  try {
    let raw;
    try {
      if ((await stat(file)).size > MAX_BYTES) throw fail(503, 'INVALID_JOURNAL', 'The knowledge journal exceeds its size limit.');
      raw = await readFile(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (raw !== undefined && Buffer.byteLength(raw) > MAX_BYTES) throw fail(503, 'INVALID_JOURNAL', 'The knowledge journal exceeds its size limit.');
    document = raw === undefined ? initial() : JSON.parse(raw);
    rebuildKnowledge(document);
  } catch (error) { await unlock(); throw error; }

  const current = () => rebuildKnowledge(document);
  const view = () => { const { keys, identities, ...value } = current(); return copy({ enabled: true, ...value }); };
  function write(body, kind, normalize, check = () => {}) {
    if (closed || closing) return Promise.reject(fail(503, 'KNOWLEDGE_CLOSED', 'The knowledge writer is closed.'));
    const operation = queue.then(async () => {
      if (closed) throw fail(503, 'KNOWLEDGE_CLOSED', 'The knowledge writer is closed.');
      if (!body || !validId(body.idempotencyKey)) throw fail(400, 'INVALID_REQUEST', 'An idempotency key of 8 to 80 safe characters is required.');
      const value = normalize(body); const identity = digest({ kind, value }); const state = current();
      if (state.keys.has(body.idempotencyKey)) {
        if (state.keys.get(body.idempotencyKey) !== identity) throw fail(409, 'KEY_CONFLICT', 'That key was used for a different knowledge operation.');
        return { ...view(), replayed: true };
      }
      if (body.expectedVersion !== state.version) throw fail(409, 'STALE_KNOWLEDGE', 'Knowledge changed. Refresh before applying this operation.');
      if (document.events.length >= MAX_EVENTS) throw fail(413, 'KNOWLEDGE_LIMIT', 'The knowledge journal is full.');
      check(value, state);
      const next = { ...document, events: [...document.events, { number: document.events.length + 1, key: body.idempotencyKey, fingerprint: identity, kind, value, at: new Date().toISOString() }] };
      rebuildKnowledge(next); await atomicWrite(file, next); document = next;
      return { ...view(), replayed: false };
    });
    queue = operation.catch(() => {}); return operation;
  }
  return {
    enabled: true, view,
    accept(body) { return write(body, 'revision', (input) => revisionEvent(input.event), (value, state) => {
      const previous = state.graph.projects.find((project) => project.reference === value.project.reference);
      const renewal = renewsConsent(previous, state.identities.get(value.id), value);
      if (state.identities.has(value.id) && !renewal) throw fail(409, 'EVENT_CONFLICT', 'That engine event has already been accepted. Replay its original idempotency key.');
      if (previous && value.sequence <= previous.sequence && !renewal) throw fail(409, 'STALE_EVENT', 'An older engine event cannot replace newer context.');
    }); },
    revoke(body) { return write(body, 'revoke', (input) => { if (!projectRef(input.project)) throw fail(400, 'INVALID_REQUEST', 'Choose a known project reference.'); return input.project; }, (value, state) => { if (!state.graph.projects.some((project) => project.reference === value)) throw fail(404, 'NOT_FOUND', 'That knowledge project does not exist.'); }); },
    relation(body) { return write(body, 'relation', (input) => relationRecord(input.relation), (value, state) => {
      if (state.graph.relations.some((relation) => relation.id === value.id)) throw fail(409, 'RELATION_CONFLICT', 'That relationship already exists.');
      const sources = new Map(state.knowledge.sources.map((source) => [source.reference, source.revision]));
      if (value.evidence.some((entry) => sources.get(entry.reference) !== entry.revision)) throw fail(409, 'STALE_EVIDENCE', 'Relationship evidence is no longer in the accepted projection.');
      if (projectRef(value.subject) && !state.graph.projects.some((project) => project.reference === value.subject && project.consent)) throw fail(409, 'STALE_EVIDENCE', 'The relationship project is not accepted.');
    }); },
    revise(body) { return write(body, 'revise', (input) => {
      if (!validId(input.id) || !['accepted', 'rejected'].includes(input.status) || (input.object !== undefined && !safeText(input.object, 1000))) throw fail(400, 'INVALID_REQUEST', 'Provide the relationship id, status and optional corrected object.');
      return { id: input.id, status: input.status, ...(input.object === undefined ? {} : { object: input.object }) };
    }, (value, state) => { if (!state.graph.relations.some((relation) => relation.id === value.id)) throw fail(404, 'NOT_FOUND', 'That relationship does not exist.'); }); },
    export() { return copy({ ...view(), journal: document }); },
    erase(body) {
      if (closed || closing) return Promise.reject(fail(503, 'KNOWLEDGE_CLOSED', 'The knowledge writer is closed.'));
      const operation = queue.then(async () => {
        if (closed) throw fail(503, 'KNOWLEDGE_CLOSED', 'The knowledge writer is closed.');
        if (body?.confirmation !== 'delete-knowledge' || body.expectedVersion !== token(document)) throw fail(409, 'STALE_KNOWLEDGE', 'Confirm deletion against the current knowledge version.');
        const next = initial(); await atomicWrite(file, next); document = next; return view();
      }); queue = operation.catch(() => {}); return operation;
    },
    async close() { if (closed || closing) return; closing = true; await queue; closed = true; await unlock(); },
  };
}
