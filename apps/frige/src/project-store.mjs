/** Frige publishing engine source that owns compatibility page, proposal and proof records. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, copyFile, access, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

/** Returns a string value in the form expected by this boundary. */
const text = (strings, ...values) => String.raw({ raw: strings.raw }, ...values);

const DEFAULT_BOOK = {
  title: 'Untitled book',
  author: 'Author',
  design: 'A clean literary page with generous margins and calm typography.',
  pages: [{ id: 'page-001', title: 'Opening page' }],
};

const DEFAULT_PAGE = text`\section*{Opening page}

Begin here. This page is the canonical source for the first printable page of your book.
`;

/** Computes the exact source revision digest. */
export const sourceHash = (source) => createHash('sha256').update(source, 'utf8').digest('hex');

/** Checks the format accepted for a publishing page identifier. */
function validPageId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(id);
}

/** Requires a valid page identifier before resolving a path. */
export function requirePageId(id) {
  if (!validPageId(id)) throw new Error('Invalid page id.');
  return id;
}

/** Checks whether the requested local path is accessible. */
async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Persists the value through a same-directory temporary replacement. */
export async function writeAtomic(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  try {
    // OneDrive and antivirus scanners can briefly hold the destination open on
    // Windows.  Keep the atomic replacement, but give that transient lock time
    // to clear rather than failing a vault refresh.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await rename(temporary, file);
        return;
      } catch (error) {
        const retryable = ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code);
        if (!retryable || attempt === 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(500, 25 * (2 ** attempt))));
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export class BookStore {
  /** Binds compatibility publishing operations to one local book directory. */
  constructor(root) {
    this.root = path.resolve(root);
    this.pagesDirectory = path.join(this.root, 'pages');
    this.stateDirectory = path.join(this.root, '.texgraph');
    this.conversationsDirectory = path.join(this.stateDirectory, 'conversations');
    this.proposalsDirectory = path.join(this.stateDirectory, 'proposals');
    this.buildsDirectory = path.join(this.stateDirectory, 'builds');
  }

  /** Resolves the editable page in the project workspace. */
  pagePath(id) {
    return path.join(this.pagesDirectory, `${requirePageId(id)}.tex`);
  }

  /** Resolves a proposal record within the local book. */
  proposalPath(id) {
    return path.join(this.proposalsDirectory, `${requirePageId(id)}.json`);
  }

  /** Resolves the turn journal within the store's state area. */
  conversationPath(id) {
    return path.join(this.conversationsDirectory, `${requirePageId(id)}.jsonl`);
  }

  /** Prepares the store and loads or creates the required derived state. */
  async initialize() {
    await mkdir(this.pagesDirectory, { recursive: true });
    await mkdir(this.conversationsDirectory, { recursive: true });
    await mkdir(this.proposalsDirectory, { recursive: true });
    await mkdir(this.buildsDirectory, { recursive: true });
    const bookPath = path.join(this.root, 'book.json');
    if (!(await exists(bookPath))) await writeAtomic(bookPath, `${JSON.stringify(DEFAULT_BOOK, null, 2)}\n`);
    if (!(await exists(this.pagePath('page-001')))) await writeAtomic(this.pagePath('page-001'), DEFAULT_PAGE);
  }

  /** Reads the current book record and page ordering. */
  async book() {
    const book = JSON.parse(await readFile(path.join(this.root, 'book.json'), 'utf8'));
    if (!Array.isArray(book.pages) || !book.pages.every((page) => validPageId(page.id))) {
      throw new Error('The book manifest has an invalid page list.');
    }
    return book;
  }

  /** Refuses operations on a page absent from the book. */
  async assertKnownPage(id) {
    const book = await this.book();
    const page = book.pages.find((item) => item.id === requirePageId(id));
    if (!page) throw new Error('Page not found.');
    return page;
  }

  /** Adds a new source page to the compatibility book. */
  async createPage(title) {
    const book = await this.book();
    const position = book.pages.length + 1;
    const id = `page-${String(position).padStart(3, '0')}`;
    const pageTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : `Page ${position}`;
    if (book.pages.some((page) => page.id === id)) throw new Error('A page with that identifier already exists.');
    book.pages.push({ id, title: pageTitle });
    await writeAtomic(path.join(this.root, 'book.json'), `${JSON.stringify(book, null, 2)}\n`);
    await writeAtomic(this.pagePath(id), `% ${pageTitle}\n\n`);
    return this.page(id);
  }

  /** Reads a page source and its current revision. */
  async page(id) {
    const page = await this.assertKnownPage(id);
    const source = await readFile(this.pagePath(id), 'utf8');
    return { ...page, source, hash: sourceHash(source) };
  }

  /** Saves a compatibility page revision. */
  async updatePage(id, source, baseHash) {
    if (typeof source !== 'string' || source.length > 200_000) throw new Error('Source must be text under 200 KB.');
    const current = await this.page(id);
    if (baseHash && baseHash !== current.hash) {
      const error = new Error('This page changed before your edit was saved. Reload it before trying again.');
      error.code = 'STALE_SOURCE';
      throw error;
    }
    await writeAtomic(this.pagePath(id), source);
    return this.page(id);
  }

  /** Appends the accepted turn to the local conversation history. */
  async appendTurn(id, turn) {
    await this.assertKnownPage(id);
    const safeTurn = { id: randomUUID(), at: new Date().toISOString(), ...turn };
    await mkdir(this.conversationsDirectory, { recursive: true });
    await writeFile(this.conversationPath(id), `${JSON.stringify(safeTurn)}\n`, { encoding: 'utf8', flag: 'a' });
    return safeTurn;
  }

  /** Reads the conversation history for the requested target. */
  async turns(id, limit = 12) {
    await this.assertKnownPage(id);
    try {
      const lines = (await readFile(this.conversationPath(id), 'utf8')).trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /** Records an offered page revision for later review. */
  async createProposal(id, proposal) {
    const page = await this.page(id);
    if (typeof proposal.source !== 'string' || proposal.source.length > 200_000) throw new Error('Proposal source is invalid.');
    const record = {
      id: randomUUID(),
      pageId: id,
      createdAt: new Date().toISOString(),
      baseHash: page.hash,
      beforeHash: page.hash,
      afterHash: sourceHash(proposal.source),
      commentary: String(proposal.commentary || ''),
      source: proposal.source,
      status: 'pending',
    };
    await writeAtomic(this.proposalPath(id), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }

  /** Reads the requested proposal from the compatibility store. */
  async proposal(id) {
    try {
      return JSON.parse(await readFile(this.proposalPath(id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Applies an accepted proposal when its source revision is current. */
  async acceptProposal(id, proposalId) {
    const proposal = await this.proposal(id);
    if (!proposal || proposal.id !== proposalId || proposal.status !== 'pending') throw new Error('Pending proposal not found.');
    const current = await this.page(id);
    if (current.hash !== proposal.baseHash) {
      const error = new Error('The proposal is stale because the source has changed.');
      error.code = 'STALE_PROPOSAL';
      throw error;
    }
    await this.updatePage(id, proposal.source, proposal.baseHash);
    proposal.status = 'accepted';
    proposal.acceptedAt = new Date().toISOString();
    await writeAtomic(this.proposalPath(id), `${JSON.stringify(proposal, null, 2)}\n`);
    await this.appendTurn(id, { role: 'system', kind: 'proposal-accepted', proposalId: proposal.id, beforeHash: proposal.beforeHash, afterHash: proposal.afterHash });
    return this.page(id);
  }

  /** Records the decision to reject a proposal. */
  async rejectProposal(id, proposalId) {
    const proposal = await this.proposal(id);
    if (!proposal || proposal.id !== proposalId || proposal.status !== 'pending') throw new Error('Pending proposal not found.');
    proposal.status = 'rejected';
    proposal.rejectedAt = new Date().toISOString();
    await writeAtomic(this.proposalPath(id), `${JSON.stringify(proposal, null, 2)}\n`);
    return proposal;
  }

  /** Resolves the build artifact directory for the selected project or page. */
  buildDirectory(id) {
    return path.join(this.buildsDirectory, requirePageId(id));
  }

  /** Reads the current proof status and its revision markers. */
  async buildStatus(id) {
    try {
      return JSON.parse(await readFile(path.join(this.buildDirectory(id), 'last.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Records a proof attempt and its current compiler result. */
  async recordBuild(id, result, hash) {
    const lastSuccessful = await exists(this.previewPath(id));
    const record = {
      pageId: requirePageId(id),
      sourceHash: hash,
      completedAt: new Date().toISOString(),
      lastSuccessful,
      ...result,
      log: String(result.log || '').slice(-60_000),
    };
    await writeAtomic(path.join(this.buildDirectory(id), 'last.json'), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }

  /** Resolves a mounted preview path without allowing traversal. */
  previewPath(id) {
    return path.join(this.buildDirectory(id), 'current.pdf');
  }

  /** Promotes an accepted proof result to the current preview. */
  async activateBuild(id, buildDirectory) {
    const destination = path.join(this.buildDirectory(id), 'current');
    const staged = `${destination}.${randomUUID()}`;
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(buildDirectory, 'document.pdf'), `${staged}.pdf`);
    await writeAtomic(`${staged}.json`, `${JSON.stringify({ builtAt: new Date().toISOString() }, null, 2)}\n`);
    await rename(`${staged}.pdf`, `${destination}.pdf`);
    await rename(`${staged}.json`, `${destination}.json`);
  }
}
