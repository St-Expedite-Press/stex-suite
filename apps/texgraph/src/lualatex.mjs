import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SAFE_SOURCE = /\\(?:documentclass|usepackage|input|include|openout|read|write|write18|directlua|catcode|newcommand|def|csname)\b/i;

export function validatePageSource(source) {
  if (SAFE_SOURCE.test(source)) return 'Page source cannot contain document setup, file access, command definitions, or Lua execution.';
  return null;
}

export async function buildPage(store, page) {
  const invalid = validatePageSource(page.source);
  if (invalid) return { ok: false, error: invalid, log: invalid };

  const directory = path.join(store.buildDirectory(page.id), `run-${Date.now()}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const document = String.raw`\documentclass[11pt]{article}
\usepackage{fontspec}
\usepackage{microtype}
\setmainfont{Latin Modern Roman}
\pagestyle{empty}
\begin{document}
\input{page.tex}
\end{document}
`;
  await writeFile(path.join(directory, 'document.tex'), document, 'utf8');
  await writeFile(path.join(directory, 'page.tex'), page.source, 'utf8');

  const result = await runLuaLaTex(directory);
  try {
    if (!result.ok) return result;
    await store.activateBuild(page.id, directory);
    return { ok: true, builtAt: new Date().toISOString(), log: result.log };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runLuaLaTex(directory) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const process = spawn('lualatex', ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', '-output-directory', directory, 'document.tex'], { cwd: directory, windowsHide: true });
    process.stdout.on('data', (chunk) => { output += chunk; });
    process.stderr.on('data', (chunk) => { output += chunk; });
    process.on('error', (error) => finish({ ok: false, error: 'LuaLaTeX is unavailable. Install TeX Live or MiKTeX and ensure lualatex is on PATH.', log: `${output}\n${error.message}` }));
    const timer = setTimeout(() => {
      process.kill('SIGKILL');
      finish({ ok: false, error: 'LuaLaTeX exceeded the 30-second build limit.', log: output });
    }, 30_000);
    process.on('close', async (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) return finish({ ok: false, error: 'LuaLaTeX could not build this page.', log: output });
      try {
        await readFile(path.join(directory, 'document.pdf'));
        finish({ ok: true, log: output });
      } catch {
        finish({ ok: false, error: 'LuaLaTeX exited without producing a PDF.', log: output });
      }
    });
  });
}
