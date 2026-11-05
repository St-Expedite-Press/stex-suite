import assert from 'node:assert/strict';
import test from 'node:test';
import { projectStatus, projectSummaries } from '../src/project-summary.mjs';

const project = (overrides) => ({ id: 'site', title: 'Site', ref: 'stex://seaxneat/project/site', updatedAt: '2026-11-04T00:00:00.000Z', status: 'ready', operation: { state: 'idle' }, ...overrides });

test('maps store summaries to stex.projects.summary.v1', () => {
  assert.deepEqual(projectSummaries([project({})]), {
    schemaVersion: 'stex.projects.summary.v1', application: 'seaxneat',
    projects: [{ reference: 'stex://seaxneat/project/site', id: 'site', title: 'Site', kind: 'website', updatedAt: '2026-11-04T00:00:00.000Z', status: { state: 'ready', label: 'Build ready' }, openPath: '/?project=site' }],
  });
  assert.deepEqual(projectSummaries([]).projects, []);
});

test('reports real operation and project states with specific labels', () => {
  const cases = [
    [{ operation: { state: 'running', kind: 'build' } }, { state: 'working', label: 'Building' }],
    [{ operation: { state: 'running', kind: 'apply' } }, { state: 'working', label: 'Applying edit' }],
    [{ operation: { state: 'failed', kind: 'build' } }, { state: 'failed', label: 'Build failed' }],
    [{ operation: { state: 'failed', kind: 'provision' } }, { state: 'failed', label: 'Setup failed' }],
    [{ operation: { state: 'needs_attention' } }, { state: 'attention', label: 'Needs attention' }],
    [{ status: 'provisioning' }, { state: 'working', label: 'Setting up' }],
    [{ status: 'failed' }, { state: 'failed', label: 'Setup failed' }],
  ];
  for (const [overrides, expected] of cases) assert.deepEqual(projectStatus(project(overrides)), expected, JSON.stringify(overrides));
});
