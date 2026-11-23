/** Suite browser harness source that drives Chrome or Edge through the DevTools protocol. */
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

/** Resolves the requested output directory or a disposable default. */
export function outDirectoryFromArgs(fallbackName) {
  const index = process.argv.indexOf('--out');
  return path.resolve(index > 0 ? process.argv[index + 1] : path.join(os.tmpdir(), fallbackName));
}

/** Resolves with the first regex match in a child's output, or rejects after 15 s. */
export function started(child, pattern, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not start.`)), 15_000);
    /** Resolves startup when a child output chunk matches the expected readiness line. */
    const listen = (data) => { const match = pattern.exec(data.toString()); if (match) { clearTimeout(timer); resolve(match); } };
    child.stdout?.on('data', listen); child.stderr?.on('data', listen); child.once('error', reject);
  });
}

class DevTools {
  /** Holds the browser WebSocket URL for later connection. */
  constructor(url) { this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); this.listeners = new Set(); }
  /** Opens a DevTools connection and routes replies to pending command requests. */
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
  /** Sends a numbered browser command and awaits the matching reply. */
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  /** Registers a listener for one occurrence of a DevTools event. */
  once(method, sessionId) {
    return new Promise((resolve) => { /** Resolves the awaited event and removes the matching listener. */ const listener = (message) => { if (message.method === method && message.sessionId === sessionId) { this.listeners.delete(listener); resolve(message.params); } }; this.listeners.add(listener); });
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
  /** Stops the browser process and removes its temporary profile. */
  const close = async () => { browser.kill(); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}); };
  return { devtools, browserPath, close };
}

/** Opens a page in a fresh browser context (isolated storage). */
export async function page(devtools) {
  const { browserContextId } = await devtools.send('Target.createBrowserContext');
  const { targetId } = await devtools.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true });
  /** Sends a DevTools command scoped to the attached page. */
  const send = (method, params) => devtools.send(method, params, sessionId);
  await send('Page.enable');
  /** Evaluates JavaScript in the page and returns its serialized result. */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  /** Navigates the attached page and waits for its load event. */
  const go = async (url) => { const loaded = devtools.once('Page.loadEventFired', sessionId); await send('Page.navigate', { url }); await loaded; };
  /** Dispatches an input key event through DevTools. */
  const key = async (key, code, keyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  };
  /** Closes this DevTools page target. */
  const close = () => devtools.send('Target.disposeBrowserContext', { browserContextId });
  return { send, evaluate, go, key, close };
}
