// Generated workspaces are untrusted code. Their install, build and preview
// processes receive an allow-list of the variables pnpm, Next and Git need to
// run, never Seaxneat's own environment: no STEX_* settings, inference or
// provider credentials, npm/Corepack tokens, or anything else a developer
// happened to export. This narrows what generated code can read; it is not an
// OS isolation boundary (the process still runs as the same user).
const ALLOWED = new Set([
  // Locating programs and the operating system.
  'path', 'pathext', 'systemroot', 'systemdrive', 'windir', 'comspec',
  'programdata', 'programfiles', 'programfiles(x86)', 'commonprogramfiles', 'commonprogramfiles(x86)',
  // Home, temporary and cache directories (pnpm store, Corepack, Next cache).
  'home', 'userprofile', 'homedrive', 'homepath', 'appdata', 'localappdata',
  'temp', 'tmp', 'tmpdir', 'xdg_cache_home', 'xdg_config_home', 'xdg_data_home', 'xdg_state_home',
  'corepack_home', 'pnpm_home',
  // Locale and terminal.
  'lang', 'language', 'lc_all', 'lc_ctype', 'lc_messages', 'tz', 'term',
  // Network settings an install needs behind a proxy or private CA.
  'http_proxy', 'https_proxy', 'no_proxy', 'node_extra_ca_certs', 'ssl_cert_file', 'ssl_cert_dir',
]);

/** The allow-listed subset of `source`, plus `extra` (which wins). */
export function childEnvironment(extra = {}, source = process.env) {
  const environment = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string' && ALLOWED.has(name.toLowerCase())) environment[name] = value;
  }
  return { ...environment, ...extra };
}

/** The environment of a project's install, build and preview processes (local-first: no Next telemetry). */
export function workspaceEnvironment(projectId, source = process.env) {
  return childEnvironment({ NEXT_BASE_PATH: `/seaxneat/api/projects/${projectId}/preview`, NEXT_TELEMETRY_DISABLED: '1' }, source);
}
