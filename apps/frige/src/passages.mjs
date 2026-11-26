/**
 * stex.frige.passages.v1: read-only passages of author-approved attachment excerpts.
 *
 * Purpose: let a reader find and cite an exact passage of a document the
 * author has approved for context, without widening the shared
 * `stex.project.context.v1` export (which lists manuscript pieces only).
 *
 * Ownership: Frige. Passages are derived on every read from the approved
 * excerpt; nothing is stored. Scope is deliberately narrow: only attachments
 * whose review state is `approved` and whose current excerpt bytes still hash
 * to the author's `approvalHash`. Bytes beyond the approved excerpt are never
 * searched or returned.
 *
 * Citation: `{attachmentId, originalSha256, excerptHash, start, end,
 * passageSha256}` where start/end are UTF-8 byte offsets into the approved
 * excerpt and passageSha256 hashes exactly those bytes. Segments are
 * deterministic (paragraphs, long ones split at whitespace), so a citation
 * names one segment and can be re-verified later.
 *
 * Failure behaviour: anything not approved or missing is 404 (no existence
 * leak beyond Frige's own project access); a changed excerpt or a range that
 * no longer names a segment with the same bytes is 409 STALE_PASSAGE.
 */
import { createHash } from 'node:crypto';
import { readAttachmentManifest } from './attachment-manifest.mjs';

export const PASSAGES_SCHEMA = 'stex.frige.passages.v1';
/** Longest segment, in UTF-16 units, before a paragraph is split at whitespace. */
const SEGMENT_CHARS = 1200;
const MAX_RESULTS = 20;
const SNIPPET_CHARS = 240;
const MAX_QUERY_CHARS = 200;

/** Builds the module's failure shape. */
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
/** SHA-256 of a string's UTF-8 bytes. */
const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/**
 * Splits an excerpt into deterministic segments with UTF-8 byte offsets.
 *
 * @param {string} excerpt  The approved excerpt text.
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function segmentExcerpt(excerpt) {
  const segments = [];
  /** Adds one non-blank piece found at character index `from`. */
  const add = (from, text) => {
    const trimmed = text.replace(/\s+$/u, '');
    const lead = trimmed.length - trimmed.trimStart().length;
    const body = trimmed.slice(lead);
    if (!body) return;
    const start = Buffer.byteLength(excerpt.slice(0, from + lead), 'utf8');
    segments.push({ start, end: start + Buffer.byteLength(body, 'utf8'), text: body });
  };
  const paragraph = /\n[ \t]*\n/g;
  let cursor = 0;
  for (const boundary of [...excerpt.matchAll(paragraph), { index: excerpt.length, 0: '' }]) {
    const text = excerpt.slice(cursor, boundary.index);
    // Long paragraphs are split at the last whitespace before the limit.
    let offset = 0;
    while (text.length - offset > SEGMENT_CHARS) {
      const window = text.slice(offset, offset + SEGMENT_CHARS);
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
      let size = cut > SEGMENT_CHARS / 2 ? cut + 1 : SEGMENT_CHARS;
      // Never split a surrogate pair: an astral character (emoji, CJK extension) stays whole.
      const last = text.charCodeAt(offset + size - 1);
      if (last >= 0xd800 && last <= 0xdbff) size -= 1;
      add(cursor + offset, text.slice(offset, offset + size));
      offset += size;
    }
    add(cursor + offset, text.slice(offset));
    cursor = boundary.index + boundary[0].length;
  }
  return segments;
}

/** Lowercased search terms of at least two letters or digits (at most eight). */
function terms(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_CHARS) throw failure(400, 'INVALID_REQUEST', 'Search for 1 to 200 characters.');
  const found = [...new Set(query.toLocaleLowerCase('en').match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 8);
  if (!found.length) throw failure(400, 'INVALID_REQUEST', 'Search for at least one word.');
  return found;
}

/** A bounded, whitespace-collapsed snippet around the first match. */
function snippet(text, first) {
  const collapsed = text.replace(/\s+/gu, ' ');
  const at = Math.max(0, collapsed.toLocaleLowerCase('en').indexOf(first) - 60);
  const piece = collapsed.slice(at, at + SNIPPET_CHARS);
  return `${at > 0 ? '…' : ''}${piece}${at + SNIPPET_CHARS < collapsed.length ? '…' : ''}`;
}

/**
 * The approved attachments whose current excerpt is exactly what the author approved.
 *
 * @param {object} store  Frige's selected project store.
 * @returns {Promise<{ record: object, excerpt: string, hash: string }[]>}
 */
async function approvedExcerpts(store) {
  const manifest = await readAttachmentManifest(store.root);
  const approved = [];
  for (const record of manifest) {
    if (record.contextState !== 'approved' || typeof record.approvalHash !== 'string') continue;
    const preview = await store.attachmentExcerpt(record);
    if (preview && preview.hash === record.approvalHash) approved.push({ record, excerpt: preview.excerpt, hash: preview.hash });
  }
  return approved;
}

/** Citation fields shared by search hits and reads. */
const citation = (project, { record, hash }, segment) => ({
  reference: `${project.reference}#attachment=${record.id}`,
  attachmentId: record.id,
  title: record.name,
  originalSha256: typeof record.sourceSha256 === 'string' ? record.sourceSha256 : null,
  excerptHash: hash,
  start: segment.start,
  end: segment.end,
  passageSha256: sha256(segment.text),
});

/**
 * Searches approved excerpts.
 *
 * @param {object} store  The project store.
 * @param {{ application: string, id: string, reference: string, title: string }} project
 * @param {string} query  Words to find (all must occur).
 * @returns {Promise<object>}  `{schemaVersion, project, passages, truncated}`.
 */
export async function searchPassages(store, project, query) {
  const wanted = terms(query);
  const hits = [];
  for (const entry of await approvedExcerpts(store)) {
    for (const segment of segmentExcerpt(entry.excerpt)) {
      const lower = segment.text.toLocaleLowerCase('en');
      if (!wanted.every((term) => lower.includes(term))) continue;
      const score = wanted.reduce((total, term) => total + lower.split(term).length - 1, 0);
      hits.push({ score, passage: { ...citation(project, entry, segment), snippet: snippet(segment.text, wanted[0]) } });
    }
  }
  // Highest score first; ties keep document then position order, so results are stable.
  hits.sort((a, b) => b.score - a.score);
  return { schemaVersion: PASSAGES_SCHEMA, project, passages: hits.slice(0, MAX_RESULTS).map((hit) => hit.passage), truncated: hits.length > MAX_RESULTS };
}

/**
 * Reads one cited passage after re-verifying every citation field.
 *
 * @param {object} store  The project store.
 * @param {object} project  The project descriptor.
 * @param {string} attachmentId  16 hex digits.
 * @param {URLSearchParams} params  `excerpt`, `start`, `end`, `passage`.
 * @returns {Promise<object>}  `{schemaVersion, project, passage: {..citation, text}}`.
 */
export async function readPassage(store, project, attachmentId, params) {
  const excerptHash = params.get('excerpt') || ''; const passageHash = params.get('passage') || '';
  const start = Number(params.get('start')); const end = Number(params.get('end'));
  if (!/^[a-f0-9]{64}$/.test(excerptHash) || !/^[a-f0-9]{64}$/.test(passageHash) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) throw failure(400, 'INVALID_REQUEST', 'Name an exact passage citation.');
  const entry = (await approvedExcerpts(store)).find((candidate) => candidate.record.id === attachmentId);
  if (!entry) throw failure(404, 'NOT_FOUND', 'That approved document is not available.');
  const segment = entry.hash === excerptHash ? segmentExcerpt(entry.excerpt).find((candidate) => candidate.start === start && candidate.end === end) : null;
  if (!segment || sha256(segment.text) !== passageHash) throw failure(409, 'STALE_PASSAGE', 'The cited passage changed or is no longer approved. Search again.');
  return { schemaVersion: PASSAGES_SCHEMA, project, passage: { ...citation(project, entry, segment), text: segment.text } };
}
