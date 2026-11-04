import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGateway, validateParts } from '../src/gateway.mjs';
import { createModelSettings, validateSettings } from '../src/model-settings.mjs';

const config = { sharedSecret: 'test-token', openRouterKey: 'or-key', model: 'example/model', baseUrl: 'https://openrouter.test/api/v1', appName: 'STEX test', maxInputTokens: 5000, timeoutMs: 1000, maxRetries: 2 };
const completion = (content, extra = {}) => new Response(JSON.stringify({ model: 'example/model', choices: [{ message: { content, ...extra } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } }), { status: 200 });
const gatewayWith = (respond, overrides = {}) => { const calls = []; return { calls, gateway: createGateway({ config: { ...config, ...overrides }, sleep: async () => {}, fetchImpl: async (url, options = {}) => { calls.push({ url: String(url), options }); return respond(calls.length, url, options); } }) }; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('rejects callers without the shared token and says what configuration is missing', async () => {
  const { gateway, calls } = gatewayWith(() => { throw new Error('must not call OpenRouter'); });
  await assert.rejects(() => gateway.handle({ token: 'wrong', kind: 'scope-turn', body: { message: 'hello' } }), { status: 401, code: 'UNAUTHORIZED' });
  const unconfigured = gatewayWith(() => { throw new Error('must not call OpenRouter'); }, { model: '' }).gateway;
  await assert.rejects(() => unconfigured.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'hello' } }), { status: 503, code: 'UNCONFIGURED', message: /OPENROUTER_MODEL/ });
  assert.deepEqual(await unconfigured.health(), { ok: true, provider: 'openrouter', model: null, stack: [], configured: false, missing: ['a director model (Configure models, or OPENROUTER_MODEL)'] });
  assert.equal(calls.length, 0);
});

test('a scope turn runs the director on OpenRouter and returns validated parts', async () => {
  const reply = {
    commentary: 'Two directions.',
    parts: [
      { type: 'text', text: 'Here is a **sketch**.' },
      { type: 'artifact', kind: 'code', title: 'Stanza helper', language: 'js', content: 'export const x = 1;' },
      { type: 'choice', id: 'tone', prompt: 'Which tone?', options: [{ id: 'dark', label: 'Darker' }, { id: 'light', label: 'Lighter' }] },
      { type: 'form', id: 'facts', fields: [{ id: 'title', label: 'Title', kind: 'text', required: true }, { id: 'trim', label: 'Trim', kind: 'select', options: ['6 × 9 in'] }] },
      { type: 'choice', id: 'tone', prompt: 'Duplicate id', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      { type: 'script', content: 'alert(1)' },
    ],
    changes: [{ nodeId: 'node-a', source: '# A\n\nNew.', summary: 'Cut a line.' }],
  };
  const { gateway, calls } = gatewayWith(() => completion(`\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``, { images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } }] }));
  const result = await gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'Tighten this section.', scope: { id: 'scope-node-a', kind: 'section', title: 'One' }, scopeSources: [{ nodeId: 'node-a', source: '# A\n\nOld.' }], turns: [{ role: 'user', message: 'Earlier.' }] } });
  assert.deepEqual(result.parts.map((part) => part.type + (part.kind ? `:${part.kind}` : '')), ['text', 'artifact:code', 'choice', 'form', 'artifact:image']);
  assert.deepEqual(result.droppedParts.map((entry) => entry.index), [4, 5]);
  assert.deepEqual(result.changes, [{ nodeId: 'node-a', source: '# A\n\nNew.', summary: 'Cut a line.' }]);
  assert.equal(result.commentary, 'Two directions.'); assert.equal(result.meta.model, 'example/model'); assert.equal(result.meta.usage.cost, 0.0001);
  const request = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://openrouter.test/api/v1/chat/completions');
  assert.equal(calls[0].options.headers.authorization, 'Bearer or-key'); assert.equal(calls[0].options.headers['x-title'], 'STEX test');
  assert.equal(request.model, 'example/model');
  assert.match(request.messages[0].content, /You are Hermes/); assert.match(request.messages[0].content, /director-kit\.v3/);
  assert.deepEqual(request.messages[1], { role: 'user', content: 'Earlier.' });
  assert.match(request.messages.at(-1).content, /"scopeSources":\[\{"nodeId":"node-a"/); assert.match(request.messages.at(-1).content, /Tighten this section\./);
});

test('validates every part type and keeps at most twelve', () => {
  const { parts, dropped } = validateParts([
    { type: 'artifact', kind: 'image', mediaType: 'image/svg+xml', content: PNG },
    { type: 'artifact', kind: 'image', mediaType: 'image/png', content: '<svg onload=x>' },
    { type: 'form', id: 'f', fields: [{ id: 'k', label: 'Kind', kind: 'select' }] },
    { type: 'choice', id: 'c', prompt: 'One option', options: [{ id: 'a', label: 'A' }] },
    { type: 'text', text: '   ' },
    ...Array.from({ length: 13 }, (_, index) => ({ type: 'text', text: `t${index}` })),
  ]);
  assert.equal(parts.length, 12); assert.equal(dropped.length, 6);
  assert.deepEqual(dropped.slice(0, 5).map((entry) => entry.index), [0, 1, 2, 3, 4]);
});

test('a reply that is not JSON is kept as commentary text', async () => {
  const { gateway } = gatewayWith(() => completion('Just prose from the model.'));
  const result = await gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'Hi' } });
  assert.deepEqual([result.commentary, result.noChange, result.parts], ['Just prose from the model.', true, [{ type: 'text', text: 'Just prose from the model.' }]]);
});

test('page turns keep the v1 reply shape and ignore parts and changes', async () => {
  const { gateway } = gatewayWith(() => completion(JSON.stringify({ commentary: 'Revised.', proposal: { source: '# A' }, changes: 'junk', parts: 'junk' })));
  assert.deepEqual(await gateway.handle({ token: 'test-token', kind: 'page-turn', body: { message: 'revise' } }), { commentary: 'Revised.', noChange: false, proposal: { source: '# A' }, graphSuggestions: [], ticketUpdates: null });
});

test('provider failures map to specific codes, retrying only what can recover', async () => {
  const status = (code) => () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: code });
  for (const [code, expected] of [[401, 'PROVIDER_AUTH'], [402, 'PROVIDER_CREDITS'], [400, 'PROVIDER_REJECTED']]) {
    const { gateway, calls } = gatewayWith(status(code));
    await assert.rejects(() => gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }), { code: expected });
    assert.equal(calls.length, 1, `${code} is not retried`);
  }
  const flaky = gatewayWith((call) => (call < 3 ? new Response('', { status: 503 }) : completion('{"commentary":"ok"}')));
  assert.equal((await flaky.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } })).commentary, 'ok'); assert.equal(flaky.calls.length, 3);
  const down = gatewayWith(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(() => down.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }), { status: 502, code: 'PROVIDER_UNREACHABLE' }); assert.equal(down.calls.length, 3);
  const malformed = gatewayWith(() => completion(JSON.stringify({ commentary: 'Oops', changes: [{ nodeId: 'a', source: 3 }] })));
  await assert.rejects(() => malformed.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }), { code: 'PROVIDER_MALFORMED' });
  const large = gatewayWith(() => completion('{}'));
  await assert.rejects(() => large.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x', scopeSources: [{ source: 'x'.repeat(40_000) }] } }), { status: 413, code: 'CONTEXT_TOO_LARGE' }); assert.equal(large.calls.length, 0);
});

test('the health probe checks the key without spending tokens', async () => {
  for (const [respond, expected] of [[() => new Response('{}', { status: 200 }), 'reachable'], [() => new Response('{}', { status: 401 }), 'key-rejected'], [() => { throw new TypeError('fetch failed'); }, 'unreachable']]) {
    const { gateway, calls } = gatewayWith(respond);
    assert.equal((await gateway.health({ probe: true })).provider_status, expected);
    assert.equal(calls[0].url, 'https://openrouter.test/api/v1/key');
  }
});

test('a failed turn clears the cached probe so health stops reporting reachable', async () => {
  let up = true;
  const { gateway, calls } = gatewayWith((call, url) => { if (!up) throw new TypeError('fetch failed'); return String(url).endsWith('/key') ? new Response('{}', { status: 200 }) : completion('{"commentary":"ok"}'); });
  assert.equal((await gateway.health({ probe: true })).provider_status, 'reachable');
  up = false;
  await assert.rejects(() => gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }), { code: 'PROVIDER_UNREACHABLE' });
  const before = calls.length;
  assert.equal((await gateway.health({ probe: true })).provider_status, 'unreachable');
  assert.equal(calls.length, before + 1, 'the probe ran again instead of using the cache');
});

test('paid calls are bounded: whole-exchange timeout, no retry once billable, output cap, retries can be off', async () => {
  // Headers arrive, the body never does: the timeout still ends the call.
  const stalled = gatewayWith((call, url, options) => new Response(new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))); } }), { status: 200 }), { timeoutMs: 50 });
  const started = Date.now();
  await assert.rejects(() => stalled.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }), { code: 'PROVIDER_TIMEOUT' });
  assert.ok(Date.now() - started < 1000); assert.equal(stalled.calls.length, 1, 'a timed-out call may have been billed, so it is not retried');
  for (const status of [500, 504, 408]) {
    const failing = gatewayWith(() => new Response('{}', { status }));
    await assert.rejects(() => failing.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }));
    assert.equal(failing.calls.length, 1, `${status} is not retried`);
  }
  const noRetries = gatewayWith(() => new Response('', { status: 503 }), { maxRetries: 0 });
  await assert.rejects(() => noRetries.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }), { code: 'PROVIDER_UNAVAILABLE' });
  assert.equal(noRetries.calls.length, 1);
  const capped = gatewayWith(() => completion('{"commentary":"ok"}'));
  await capped.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } });
  assert.equal(JSON.parse(capped.calls[0].options.body).max_tokens, 4096);
});

test('the gateway never relays the key, shares probes, refuses reserved ids and ignores malformed turns', async () => {
  const echo = gatewayWith(() => new Response(JSON.stringify({ error: { message: 'bad request for key or-key and sk-or-v1-abcdef123456' } }), { status: 400 }));
  const error = await echo.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }).catch((failure) => failure);
  assert.equal(error.code, 'PROVIDER_REJECTED'); assert.doesNotMatch(error.message, /or-key|sk-or-v1/);
  const probes = gatewayWith(() => new Response('{}', { status: 200 }));
  await Promise.all(Array.from({ length: 20 }, () => probes.gateway.health({ probe: true })));
  assert.equal(probes.calls.length, 1);
  assert.deepEqual(validateParts([{ type: 'form', id: '__proto__', fields: [{ id: 'a', label: 'A', kind: 'text' }] }, { type: 'form', id: 'f', fields: [{ id: 'constructor', label: 'C', kind: 'number' }] }]).parts, []);
  const tolerant = gatewayWith(() => completion('{"commentary":"ok"}'));
  assert.equal((await tolerant.gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x', turns: [null, 7, { role: 'user', message: 'hi' }] } })).commentary, 'ok');
});

const roster = (stacks, extra = {}) => ({ roles: [['director', stacks.director || []], ['worker-general', []], ['worker-visual', []], ['embedding', []]].map(([id, stack]) => ({ id, name: id, stack, ...(extra[id] || {}) })) });

test('model settings keep built-in roles, accept custom ones and refuse bad or unknown model ids', () => {
  assert.equal(validateSettings(roster({ director: ['vendor/model:free'] })).errors.length, 0);
  const custom = roster({}); custom.roles.push({ id: 'proofreader', name: 'Proofreader', stack: ['vendor/model'] });
  assert.equal(validateSettings(custom).settings.roles.at(-1).id, 'proofreader');
  const removed = roster({}); removed.roles = removed.roles.filter((role) => role.id !== 'director');
  assert.match(validateSettings(removed).errors.join(' '), /cannot be removed/);
  assert.match(validateSettings(roster({ director: ['not a model'] })).errors.join(' '), /not an OpenRouter model id/);
  assert.match(validateSettings(roster({ director: ['vendor/ghost'] }), { knownModels: new Set(['vendor/model']) }).errors.join(' '), /no model vendor.ghost/);
  assert.match(validateSettings(roster({}, { director: { temperature: 3 } })).errors.join(' '), /temperature/);
  const twice = roster({}); twice.roles.push({ ...twice.roles[0] });
  assert.match(validateSettings(twice).errors.join(' '), /appears twice/);
});

test('a role walks its model stack on model failures and applies its own settings', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'stex-models-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const models = createModelSettings({ file: path.join(directory, 'models.json'), envModel: 'env/model' });
  await models.load();
  assert.deepEqual(models.profile('director').stack, ['env/model'], 'OPENROUTER_MODEL is the director fallback');
  const { calls, gateway } = (() => { const calls = []; return { calls, gateway: createGateway({ config: { ...config, maxOutputTokens: 2000 }, models, sleep: async () => {}, fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'vendor/gone' }, { id: 'vendor/busy' }, { id: 'vendor/works', name: 'Works', context_length: 8000, pricing: { prompt: '0.000001', completion: '0.000002' }, architecture: { output_modalities: ['text'] } }] }), { status: 200 });
    const model = JSON.parse(options.body).model;
    if (model === 'vendor/gone') return new Response(JSON.stringify({ error: { message: 'No such model' } }), { status: 404 });
    if (model === 'vendor/busy') return new Response('', { status: 503 });
    return new Response(JSON.stringify({ model, choices: [{ message: { content: '{"commentary":"ok"}' } }] }), { status: 200 });
  } }) }; })();
  await assert.rejects(() => gateway.saveModels({ token: 'wrong', body: {} }), { code: 'UNAUTHORIZED' });
  await assert.rejects(() => gateway.saveModels({ token: 'test-token', body: roster({ director: ['vendor/ghost'] }) }), { code: 'INVALID_SETTINGS' });
  const saved = await gateway.saveModels({ token: 'test-token', body: roster({ director: ['vendor/gone', 'vendor/busy', 'vendor/works'] }, { director: { temperature: 0.4, maxOutputTokens: 9000 } }) });
  assert.equal(saved.catalogChecked, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'models.json'), 'utf8')).roles[0].stack, ['vendor/gone', 'vendor/busy', 'vendor/works']);
  const result = await gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } });
  assert.equal(result.meta.model, 'vendor/works');
  assert.deepEqual(result.meta.skipped.map((entry) => entry.model), ['vendor/gone', 'vendor/busy']);
  const final = calls.filter((call) => call.body?.model === 'vendor/works').at(-1).body;
  assert.equal(final.temperature, 0.4); assert.equal(final.max_tokens, 2000, 'a role cannot raise the gateway output cap');
  const catalog = await gateway.catalog({ token: 'test-token' });
  assert.deepEqual(catalog.models.find((entry) => entry.id === 'vendor/works'), { id: 'vendor/works', name: 'Works', contextLength: 8000, pricing: { prompt: '0.000001', completion: '0.000002' }, input: [], output: ['text'] });
  assert.equal(calls.filter((call) => call.url.endsWith('/models')).length, 1, 'the catalog is cached');
  const reloaded = createModelSettings({ file: path.join(directory, 'models.json'), envModel: 'env/model' }); await reloaded.load();
  assert.equal(reloaded.profile('director').stack[0], 'vendor/gone');
});

test('credit, key and timeout failures end the turn instead of falling back', async () => {
  for (const [status, code] of [[402, 'PROVIDER_CREDITS'], [401, 'PROVIDER_AUTH']]) {
    const used = [];
    const gateway = createGateway({ config, models: { profile: () => ({ stack: ['vendor/a', 'vendor/b'], temperature: null, maxOutputTokens: null }) }, sleep: async () => {}, fetchImpl: async (url, options) => { used.push(JSON.parse(options.body).model); return new Response('{}', { status }); } });
    await assert.rejects(() => gateway.handle({ token: 'test-token', kind: 'scope-turn', body: { message: 'x' } }), { code });
    assert.deepEqual(used, ['vendor/a']);
  }
});

test('saved settings survive new built-in roles, invalid files are ignored, and saves do not interleave', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'stex-models-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'models.json');
  // A file written before the embedding role existed keeps its stacks.
  await writeFile(file, JSON.stringify({ version: 1, roles: roster({ director: ['vendor/kept'] }).roles.filter((role) => role.id !== 'embedding') }));
  const older = createModelSettings({ file }); await older.load();
  assert.equal(older.profile('director').stack[0], 'vendor/kept');
  assert.ok(older.get().roles.some((role) => role.id === 'embedding'));
  await writeFile(file, '{ not json');
  const warnings = []; context.mock.method(console, 'warn', (message) => warnings.push(message));
  const broken = createModelSettings({ file, envModel: 'env/model' }); await broken.load();
  assert.deepEqual(broken.profile('director').stack, ['env/model']); assert.equal(warnings.length, 1);
  const models = createModelSettings({ file });
  await Promise.all(['vendor/one', 'vendor/two', 'vendor/three'].map((model) => models.save(roster({ director: [model] }))));
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).roles[0].stack, ['vendor/three']);
});
