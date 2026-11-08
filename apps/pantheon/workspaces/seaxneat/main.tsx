import React, { FormEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Revision = { id: string; kind: string; createdAt: string; sourceHash: string };
type Project = { id: string; title: string; ref: string; revisionCount: number; hasPendingProposal: boolean; lastValidatedRevision: string | null; revisions: Revision[]; operation: { state: string; detail?: string } };
type Proposal = { id: string; request: string; path: string; source: string; baseHash: string };
const endpoint = '/seaxneat/api/stex/workspace/v1';
async function api<T>(route: string, payload?: object): Promise<T> {
  const response = await fetch(endpoint + route, { method: payload ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(390_000), ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Seaxneat could not complete the request.');
  if (value.schemaVersion !== 'stex.seaxneat.workspace.v1') throw new Error('Seaxneat returned an incompatible response.');
  return value.result as T;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Seaxneat is unavailable.';
function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [notice, setNotice] = useState('Loading projects…');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [diff, setDiff] = useState('');
  const select = async (project: Project | null) => {
    setSelected(project); setProposal(null); setPreview(''); setDiff('');
    const url = new URL(location.href);
    if (project) url.searchParams.set('project', project.id); else url.searchParams.delete('project');
    history.replaceState(null, '', url);
    if (project?.hasPendingProposal) setProposal(await api<Proposal>('/projects/' + project.id + '/proposal'));
  };
  const refresh = async (wanted?: string) => {
    const list = await api<Project[]>('/projects'); setProjects(list);
    const current = wanted ? list.find((project) => project.id === wanted) || null : null;
    if (wanted) setSelected(current);
    return { list, current };
  };
  useEffect(() => {
    let active = true;
    api<Project[]>('/projects').then(async (list) => {
      if (!active) return;
      setProjects(list); setNotice('');
      const wanted = new URLSearchParams(location.search).get('project');
      if (wanted) {
        const current = list.find((project) => project.id === wanted) || null;
        setSelected(current);
        if (!current) setNotice('The selected project was not found.');
        if (current?.hasPendingProposal) {
          const pending = await api<Proposal>('/projects/' + current.id + '/proposal');
          if (active) setProposal(pending);
        }
      }
    }).catch((error) => { if (active) setNotice(message(error)); });
    return () => { active = false; };
  }, []);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setNotice('Working in Seaxneat…');
    try { await operation(); }
    catch (error) {
      setNotice(message(error) + ' Inspect project state before retrying.');
      if (selected) await refresh(selected.id).catch(() => {});
    } finally { setBusy(false); }
  };
  const create = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const project = await api<Project>('/projects', { title }); setTitle('');
    await refresh(); await select(project);
    setNotice(project.lastValidatedRevision ? 'Project built and ready.' : 'Setup failed. No validated revision is available; inspect the operation detail.');
  }); };
  const propose = (event: FormEvent) => { event.preventDefault(); if (!selected) return; void run(async () => {
    setProposal(await api<Proposal>('/projects/' + selected.id + '/proposal', { message: request }));
    setRequest(''); await refresh(selected.id); setNotice('Simulated proposal ready for review.');
  }); };
  const apply = () => { if (!selected || !proposal) return; void run(async () => {
    await api('/projects/' + selected.id + '/apply', { proposalId: proposal.id });
    setProposal(null); setPreview(''); setDiff(''); await refresh(selected.id); setNotice('Validated edit applied.');
  }); };
  const dismiss = () => { if (!selected || !proposal) return; void run(async () => {
    await api('/projects/' + selected.id + '/dismiss', { proposalId: proposal.id });
    setProposal(null); await refresh(selected.id); setNotice('Proposal dismissed.');
  }); };
  const startPreview = () => { if (!selected) return; void run(async () => {
    const result = await api<{ path: string }>('/projects/' + selected.id + '/preview', {});
    if (result.path !== '/seaxneat/api/projects/' + selected.id + '/preview/') throw new Error('Invalid preview path.');
    setPreview(result.path); await refresh(selected.id); setNotice('Preview is starting after a successful build. Use Reload preview if it is still starting.');
  }); };
  const viewDiff = (revision: string) => { if (!selected) return; void run(async () => {
    const result = await api<{ diff: string }>('/projects/' + selected.id + '/diff?revision=' + encodeURIComponent(revision));
    setDiff(result.diff || '(No source differences from this revision.)'); setNotice('Revision diff loaded.');
  }); };
  const restore = (revision: string) => { if (!selected || !confirm('Restore revision ' + revision + '? This creates a new validated revision.')) return; void run(async () => {
    const project = await api<Project>('/projects/' + selected.id + '/restore', { revision });
    await refresh(selected.id); await select(project); setNotice('Restored as a new validated revision.');
  }); };
  return <div className="development-workspace" aria-busy={busy}>
    <div className="workspace-heading"><p className="eyebrow">Seaxneat</p><h1>Website workspace</h1><p className="stex-meta">Edits are simulated proposals. Apply explicitly to build and validate a revision.</p></div>
    <p className="workspace-notice" role="status">{notice}</p>
    <div className="workspace-layout">
      <aside aria-label="Website projects">
        <form onSubmit={create}><label htmlFor="project-title">New project</label><input id="project-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required disabled={busy}/><button className="stex-button stex-button--secondary" type="submit" disabled={busy}>Create project</button></form>
        <h2>Projects</h2><ul>{projects.map((project) => <li key={project.id}><button className="stex-button stex-button--secondary" type="button" aria-pressed={selected?.id === project.id} disabled={busy} onClick={() => void run(async () => { await select(project); setNotice(''); })}>{project.title}<small>{project.lastValidatedRevision ? project.revisionCount + ' revisions' : 'No validated build'}</small></button></li>)}</ul>
        <button className="stex-button stex-button--secondary" type="button" disabled={busy} onClick={() => void run(async () => { const { current } = await refresh(selected?.id); setProposal(current?.hasPendingProposal ? await api<Proposal>('/projects/' + current.id + '/proposal') : null); setNotice('Project state refreshed.'); })}>Refresh projects</button>
      </aside>
      <section className="workspace-project" aria-label="Selected website">
        {selected ? <>
          <p className="workspace-reference">{selected.ref}</p><h2>{selected.title}</h2>
          <a className="stex-button stex-button--secondary" href={'/igor/new?project=' + encodeURIComponent(selected.ref)}>Discuss this project with Igor</a>
          <a className="stex-button stex-button--secondary" href={'/graph/?project=' + encodeURIComponent(selected.ref)}>Project knowledge</a>
          <p>Operation: {selected.operation.state}. Last validated revision: <code>{selected.lastValidatedRevision?.slice(0, 12) || 'None'}</code></p>
          {selected.operation.detail && <p className="workspace-notice">{selected.operation.detail}</p>}
          <button className="stex-button stex-button--secondary" type="button" disabled={busy} onClick={startPreview}>Build and start local preview</button>
          {preview && <section aria-label="Website preview"><button className="stex-button stex-button--secondary" type="button" onClick={() => { const frame = document.querySelector<HTMLIFrameElement>('.workspace-preview'); if (frame) frame.src = preview; }}>Reload preview</button><iframe className="workspace-preview" title={selected.title + ' preview'} src={preview} sandbox="allow-scripts" referrerPolicy="no-referrer" /></section>}
          <form onSubmit={propose}><label htmlFor="heading-request">Propose a heading with the deterministic simulator</label><textarea id="heading-request" value={request} onChange={(event) => setRequest(event.target.value)} maxLength={800} required disabled={busy}/><button className="stex-button stex-button--secondary" type="submit" disabled={busy}>Prepare edit</button></form>
          {proposal && <section className="workspace-proposal" aria-label="Review proposal"><h3>Review simulated proposal</h3><p>{proposal.request}</p><p>Target: <code>{proposal.path}</code> · base <code>{proposal.baseHash.slice(0, 12)}</code></p><details><summary>Proposed source</summary><pre>{proposal.source}</pre></details><div className="workspace-actions"><button className="stex-button stex-button--secondary" type="button" disabled={busy} onClick={apply}>Apply and validate</button><button className="stex-button stex-button--secondary" type="button" disabled={busy} onClick={dismiss}>Dismiss proposal</button></div></section>}
          <section className="workspace-revisions" aria-label="Revision history"><h3>Revision history</h3>{selected.revisions.map((revision) => <div key={revision.id}><code>{revision.id}</code><span>{revision.kind}</span><button className="stex-button stex-button--secondary" type="button" disabled={busy} onClick={() => viewDiff(revision.id)} aria-label={'Diff from ' + revision.id}>Diff</button><button className="stex-button stex-button--secondary" type="button" disabled={busy} onClick={() => restore(revision.id)} aria-label={'Restore ' + revision.id}>Restore</button></div>)}</section>
          {diff && <pre className="workspace-diff" aria-label="Source diff">{diff}</pre>}
        </> : <p>Create or select a local website project.</p>}
      </section>
    </div>
  </div>;
}
createRoot(document.getElementById('development-workspace')!).render(<Workspace />);
