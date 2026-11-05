// stex.projects.summary.v1 (protocol/projects): read-only summaries for Pantheon,
// mapped from store summaries. Labels are specific; state never relies on colour.
// Provisioning is reported through project.status, not a running operation.
const operationLabels = { build: 'Building', apply: 'Applying edit', restore: 'Restoring' };

export function projectStatus(project) {
  const operation = project.operation || {};
  if (operation.state === 'running') return { state: 'working', label: operationLabels[operation.kind] || 'Working' };
  if (operation.state === 'failed') return { state: 'failed', label: operation.kind === 'provision' ? 'Setup failed' : 'Build failed' };
  if (operation.state === 'needs_attention') return { state: 'attention', label: 'Needs attention' };
  if (project.status === 'provisioning') return { state: 'working', label: 'Setting up' };
  if (project.status === 'failed') return { state: 'failed', label: 'Setup failed' };
  return { state: 'ready', label: 'Build ready' };
}

export function projectSummaries(projects) {
  return {
    schemaVersion: 'stex.projects.summary.v1',
    application: 'seaxneat',
    projects: projects.map((project) => ({ reference: project.ref, id: project.id, title: project.title, kind: 'website', updatedAt: project.updatedAt || null, status: projectStatus(project), openPath: `/?project=${encodeURIComponent(project.id)}` })),
  };
}
