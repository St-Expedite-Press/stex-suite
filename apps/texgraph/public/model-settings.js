import { element } from './thread.js';

// Settings → Configure models. The agent roster and each role's model stack live in
// the inference gateway; this dialog edits a copy and saves it whole. The first model
// in a stack is used; the rest are tried in order when a model is unavailable.

const button = (className, text, onClick, label) => { const node = element('button', className, text); node.type = 'button'; if (label) node.setAttribute('aria-label', label); node.addEventListener('click', onClick); return node; };
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'r-$1').slice(0, 40);

// OpenRouter prices are dollars per token; shown per million.
function price(model) {
  const prompt = Number(model?.pricing?.prompt); const completion = Number(model?.pricing?.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return 'price varies';
  if (prompt === 0 && completion === 0) return 'free';
  const perMillion = (value) => `$${(value * 1e6).toFixed(value * 1e6 < 1 ? 2 : 1).replace(/\.0$/, '')}`;
  return `${perMillion(prompt)} in · ${perMillion(completion)} out per M`;
}
const context = (model) => (model?.contextLength ? `${Math.round(model.contextLength / 1000)}k context` : '');

export function createModelSettings({ request, onSaved }) {
  const dialog = element('dialog', 'model-settings');
  dialog.setAttribute('aria-labelledby', 'model-settings-title');
  document.body.append(dialog);
  let draft = null; let catalog = { available: false, models: [] }; let byId = new Map(); let errors = []; let status = ''; let saving = false;

  function modelRow(role, model, index) {
    const known = byId.get(model);
    const row = element('li', 'stack-model');
    const rank = element('span', 'stack-rank', index === 0 ? 'Primary' : `Fallback ${index}`);
    const name = element('span', 'stack-name'); name.append(element('code', '', model));
    if (known && known.name !== model) name.append(element('span', 'stack-detail', known.name));
    const detail = element('span', 'stack-detail', known ? [context(known), price(known)].filter(Boolean).join(' · ') : catalog.available ? 'Not in the OpenRouter catalog' : '');
    if (!known && catalog.available) detail.classList.add('warn');
    const move = (offset) => { const stack = role.stack; [stack[index], stack[index + offset]] = [stack[index + offset], stack[index]]; render(); };
    const actions = element('span', 'stack-actions');
    const up = button('quiet-button', '↑', () => move(-1), `Move ${model} up`); up.disabled = index === 0;
    const down = button('quiet-button', '↓', () => move(1), `Move ${model} down`); down.disabled = index === role.stack.length - 1;
    actions.append(up, down, button('quiet-button', 'Remove', () => { role.stack.splice(index, 1); render(); }, `Remove ${model}`));
    row.append(rank, name, actions, detail);
    return row;
  }

  function roleCard(role) {
    const builtIn = draft.builtIn.includes(role.id);
    const card = element('section', 'role-card');
    const header = element('header');
    const title = element('div', 'role-title');
    if (builtIn) title.append(element('h3', '', role.name));
    else {
      const name = element('input', 'role-name'); name.value = role.name; name.maxLength = 60; name.setAttribute('aria-label', 'Role name');
      name.addEventListener('input', () => { role.name = name.value; });
      title.append(name);
    }
    title.append(element('code', 'role-id', role.id));
    const usedBy = draft.usedBy[role.id];
    header.append(title, element('span', `role-use ${usedBy ? 'live' : ''}`, usedBy ? `Used by ${usedBy.join(', ')}` : 'Not used yet'));
    card.append(header);
    if (role.description) card.append(element('p', 'role-description', role.description));

    const list = element('ol', 'stack-list');
    role.stack.forEach((model, index) => list.append(modelRow(role, model, index)));
    if (!role.stack.length) {
      const fallback = role.id === 'director' && draft.environmentModel;
      list.append(element('li', 'stack-empty', fallback ? `No stack set; using OPENROUTER_MODEL (${draft.environmentModel}) from the environment.` : 'No models yet.'));
    }
    card.append(list);

    const add = element('form', 'stack-add');
    const input = element('input'); input.type = 'search'; input.setAttribute('list', 'model-catalog'); input.setAttribute('aria-label', `Add a model to ${role.name}`);
    input.placeholder = catalog.available ? 'Search OpenRouter models…' : 'vendor/model';
    const addButton = element('button', 'quiet-button', 'Add model'); addButton.type = 'submit'; addButton.disabled = role.stack.length >= 6;
    add.append(input, addButton);
    add.addEventListener('submit', (event) => {
      event.preventDefault();
      const id = input.value.trim(); if (!id) return;
      if (!role.stack.includes(id)) role.stack.push(id);
      render(); dialog.querySelector(`[aria-label="Add a model to ${CSS.escape(role.name)}"]`)?.focus();
    });
    card.append(add);

    const tuning = element('div', 'role-tuning');
    const field = (label, key, attributes) => {
      const wrap = element('label', '', label); const control = element('input');
      Object.assign(control, attributes); control.value = role[key] ?? ''; control.placeholder = 'Model default';
      control.addEventListener('input', () => { role[key] = control.value === '' ? null : Number(control.value); });
      wrap.append(control); return wrap;
    };
    tuning.append(field('Temperature', 'temperature', { type: 'number', min: 0, max: 2, step: 0.1 }), field('Max output tokens', 'maxOutputTokens', { type: 'number', min: 1, max: 64000, step: 1 }));
    if (!builtIn) tuning.append(button('reject', 'Remove role', () => { draft.roles = draft.roles.filter((entry) => entry !== role); render(); }));
    card.append(tuning);
    return card;
  }

  function render() {
    const focused = document.activeElement?.getAttribute?.('aria-label');
    dialog.replaceChildren();
    const head = element('header', 'settings-head');
    head.append(element('h2', '', 'Configure models'), button('quiet-button', 'Close', () => dialog.close(), 'Close model settings'));
    head.querySelector('h2').id = 'model-settings-title';
    dialog.append(head);
    if (!draft) { dialog.append(element('p', 'settings-state', status || 'Loading…')); return; }
    const lead = element('p', 'settings-note', catalog.available
      ? `Each role uses its first model and falls back down the stack when a model is unavailable. ${catalog.models.length} OpenRouter models available.`
      : 'Each role uses its first model and falls back down the stack when a model is unavailable. The OpenRouter catalog could not be loaded, so model ids are not checked.');
    dialog.append(lead);

    const datalist = element('datalist'); datalist.id = 'model-catalog';
    for (const model of catalog.models) { const option = element('option'); option.value = model.id; option.label = `${model.name} · ${price(model)}`; datalist.append(option); }
    dialog.append(datalist);

    const roles = element('div', 'role-list');
    for (const role of draft.roles) roles.append(roleCard(role));
    dialog.append(roles);

    const newRole = element('form', 'role-add');
    const name = element('input'); name.placeholder = 'New agent role, e.g. Copy editor'; name.maxLength = 60; name.setAttribute('aria-label', 'New agent role name');
    const addRole = element('button', 'quiet-button', 'Add agent role'); addRole.type = 'submit'; addRole.disabled = draft.roles.length >= 24;
    newRole.append(name, addRole);
    newRole.addEventListener('submit', (event) => {
      event.preventDefault();
      const label = name.value.trim(); const id = slug(label);
      if (!label || id.length < 2) { errors = ['Give the role a name with letters or digits.']; render(); return; }
      if (draft.roles.some((role) => role.id === id)) { errors = [`A role with id ${id} already exists.`]; render(); return; }
      errors = []; draft.roles.push({ id, name: label, description: '', stack: [], temperature: null, maxOutputTokens: null }); render();
    });
    dialog.append(newRole);

    const foot = element('footer', 'settings-foot');
    if (errors.length) { const list = element('ul', 'settings-errors'); list.setAttribute('role', 'alert'); for (const error of errors) list.append(element('li', '', error)); foot.append(list); }
    const actions = element('div', 'settings-actions');
    const save = button('', saving ? 'Saving…' : 'Save models', saveSettings); save.disabled = saving;
    actions.append(element('span', 'settings-state', status), button('quiet-button', 'Cancel', () => dialog.close()), save);
    foot.append(actions);
    dialog.append(foot);
    if (focused) dialog.querySelector(`[aria-label="${CSS.escape(focused)}"]`)?.focus();
  }

  async function saveSettings() {
    saving = true; errors = []; status = ''; render();
    try {
      const saved = await request('/api/settings/models', { method: 'PUT', body: JSON.stringify({ roles: draft.roles.map(({ id, name, description, stack, temperature, maxOutputTokens }) => ({ id, name, description, stack, temperature, maxOutputTokens })) }) });
      draft = structuredClone(saved); status = saved.catalogChecked ? 'Saved.' : 'Saved; model ids were not checked against OpenRouter.';
      onSaved?.();
    } catch (error) { errors = error.errors?.length ? error.errors : [error.message]; }
    finally { saving = false; render(); }
  }

  return {
    async open() {
      draft = null; errors = []; status = ''; render(); dialog.showModal();
      try {
        const [settings, list] = await Promise.all([request('/api/settings/models'), request('/api/settings/model-catalog').catch(() => ({ available: false, models: [] }))]);
        draft = structuredClone(settings); catalog = list; byId = new Map(list.models.map((model) => [model.id, model]));
      } catch (error) { status = `Model settings could not be loaded: ${error.message}`; }
      render();
    },
  };
}
