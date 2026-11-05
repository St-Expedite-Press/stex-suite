import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Shared harness for the browser verifiers: drives an installed Chrome or Edge
// over the DevTools protocol with Node's built-in WebSocket (no npm packages).
// Set STEX_BROWSER to a Chrome/Edge executable if it is not found automatically.

const browserCandidates = [process.env.STEX_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);

export function outDirectoryFromArgs(fallbackName) {
  const index = process.argv.indexOf('--out');
  return path.resolve(index > 0 ? process.argv[index + 1] : path.join(os.tmpdir(), fallbackName));
}

/** Resolves with the first regex match in a child's output, or rejects after 15 s. */
export function started(child, pattern, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not start.`)), 15_000);
    const listen = (data) => { const match = pattern.exec(data.toString()); if (match) { clearTimeout(timer); resolve(match); } };
    child.stdout?.on('data', listen); child.stderr?.on('data', listen); child.once('error', reject);
  });
}

class DevTools {
  constructor(url) { this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); this.listeners = new Set(); }
  async open() {
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id); this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method, sessionId) {
    return new Promise((resolve) => { const listener = (message) => { if (message.method === method && message.sessionId === sessionId) { this.listeners.delete(listener); resolve(message.params); } }; this.listeners.add(listener); });
  }
}

/** Launches a headless browser; returns { devtools, close }. */
export async function launchBrowser() {
  const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
  if (!browserPath) throw new Error('No Chrome or Edge found; set STEX_BROWSER.');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'stex-verify-browser-'));
  const browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio']);
  const [, endpoint] = await started(browser, /DevTools listening on (ws:\/\/\S+)/, 'Browser');
  const devtools = new DevTools(endpoint); await devtools.open();
  const close = async () => { browser.kill(); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}); };
  return { devtools, browserPath, close };
}

/** Opens a page in a fresh browser context (isolated storage). */
export async function page(devtools) {
  const { browserContextId } = await devtools.send('Target.createBrowserContext');
  const { targetId } = await devtools.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => devtools.send(method, params, sessionId);
  await send('Page.enable');
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const go = async (url) => { const loaded = devtools.once('Page.loadEventFired', sessionId); await send('Page.navigate', { url }); await loaded; };
  const key = async (key, code, keyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  };
  const close = () => devtools.send('Target.disposeBrowserContext', { browserContextId });
  return { send, evaluate, go, key, close };
}
