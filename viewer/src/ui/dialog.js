/**
 * dialog.js — In-app dialogs shared by the three editors, in place of window.prompt, alert and confirm.
 *
 * A form dialog checks its fields as you type: the OK button stays disabled and the problem is shown under the field
 * until every field is valid. Enter accepts, Esc cancels. Each function returns a promise.
 *
 *   const v = await askForm({ title: 'Add storey', fields: [
 *     { name: 'name', label: 'Name', value: 'New storey', required: true },
 *     { name: 'z', label: 'Floor level (mm)', type: 'number', value: '0' },
 *   ] });                                   // → { name, z } as strings, or null if cancelled
 *   const name = await ask('Guide name', 'Guide');          // → string or null
 *   if (await confirmDialog('Remove guide "A"?', { ok: 'Remove', danger: true })) …
 *   await notify('Could not load the library: …');
 *
 * When a dialog opens, a 'oebf-dialog' event is sent on document with { dialog, kind, fields }, so that end-to-end
 * tests can answer it (tests/e2e/dialogAnswers.js).
 */

/**
 * @typedef {object} Field
 * @property {string} name
 * @property {string} label
 * @property {'text'|'number'|'select'} [type='text']
 * @property {string|number} [value]
 * @property {{ value: string, label: string }[]} [options] - for type 'select'
 * @property {boolean} [required] - a blank value is refused
 * @property {string} [hint] - a line of help under the field
 * @property {string} [placeholder]
 * @property {(value: string, all: Record<string, string>) => string|null|undefined} [validate] - a problem, or nothing
 */

/**
 * The problem with each field, if any. Pure.
 *
 * @param {Field[]} fields
 * @param {Record<string, string>} values
 * @returns {Record<string, string>} field name → message; empty when everything is valid
 */
export function checkFields(fields, values) {
  const errors = {};
  for (const f of fields) {
    const v = String(values[f.name] ?? '');
    if (f.required && v.trim() === '') { errors[f.name] = `${f.label} is needed.`; continue; }
    if (f.type === 'number' && v.trim() !== '' && !Number.isFinite(Number(v))) { errors[f.name] = `${f.label} must be a number.`; continue; }
    const msg = f.validate?.(v, values);
    if (msg) errors[f.name] = msg;
  }
  return errors;
}

/** A validator for an entity id: lowercase letters, numbers and hyphens, not already taken. Pure. */
export function idValidator(taken = () => false) {
  return (v) => {
    const id = v.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return 'Use lowercase letters, numbers and hyphens, starting with a letter or number.';
    if (taken(id)) return `"${id}" is already used. Pick another.`;
    return null;
  };
}

const CSS = `
.oebf-dialog { margin: auto; background: #222; color: #ddd; border: 1px solid #555; border-radius: 6px; padding: 16px 18px; min-width: 300px; max-width: 480px; font: 13px 'Barlow', system-ui, sans-serif; }
.oebf-dialog::backdrop { background: rgba(0,0,0,0.5); }
.oebf-dialog h3 { margin: 0 0 10px; font-size: 14px; font-weight: 700; color: #fff; }
.oebf-dialog .oebf-dialog-message { margin: 0 0 10px; white-space: pre-line; line-height: 1.4; color: #ccc; }
.oebf-dialog label { display: block; font-size: 12px; color: #bbb; margin: 10px 0 4px; }
.oebf-dialog input, .oebf-dialog select { width: 100%; box-sizing: border-box; background: #2a2a2a; color: #eee; border: 1px solid #555; border-radius: 3px; padding: 6px 8px; font: inherit; }
.oebf-dialog input:focus, .oebf-dialog select:focus { outline: 2px solid #6e8ec8; outline-offset: 0; }
.oebf-dialog input[aria-invalid=true] { border-color: #e8b04a; }
.oebf-dialog .oebf-dialog-hint { font-size: 12px; color: #aaa; margin-top: 3px; }
.oebf-dialog .oebf-dialog-error { font-size: 12px; color: #f0c060; margin-top: 3px; min-height: 0; }
.oebf-dialog .oebf-dialog-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.oebf-dialog button { padding: 6px 14px; cursor: pointer; background: #333; color: #ddd; border: 1px solid #555; border-radius: 3px; font: inherit; }
.oebf-dialog button:hover:not(:disabled) { background: #444; }
.oebf-dialog button:disabled { opacity: 0.5; cursor: default; }
.oebf-dialog button.primary { background: #2a4a6a; border-color: #4a6a8a; color: #fff; }
.oebf-dialog button.primary:hover:not(:disabled) { background: #3a5a7a; }
.oebf-dialog button.danger { background: #6a2a2a; border-color: #8a4a4a; color: #fff; }
.oebf-dialog button.danger:hover:not(:disabled) { background: #7a3a3a; }
`;

function ensureStyle() {
  if (document.getElementById('oebf-dialog-style')) return;
  const style = document.createElement('style');
  style.id = 'oebf-dialog-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Open a dialog and settle with whatever `onClose` makes of how it was closed.
 * @returns {Promise<any>}
 */
function open({ kind, title, message, fields = [], ok = 'OK', cancel = 'Cancel', danger = false }) {
  ensureStyle();
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'oebf-dialog', 'data-kind': kind, 'aria-label': title ?? message ?? kind });
    const form = el('form', { method: 'dialog', novalidate: '' });
    if (title) form.appendChild(el('h3', {}, title));
    if (message) form.appendChild(el('p', { class: 'oebf-dialog-message' }, message));

    const inputs = {};
    const errorEls = {};
    fields.forEach((f, i) => {
      const id = `oebf-dlg-${Date.now().toString(36)}-${i}`;
      form.appendChild(el('label', { for: id }, f.label));
      let input;
      if (f.type === 'select') {
        input = el('select', { id, name: f.name });
        for (const o of f.options ?? []) input.appendChild(el('option', { value: o.value }, o.label));
        if (f.value != null) input.value = String(f.value);
      } else {
        input = el('input', { id, name: f.name, type: 'text', inputmode: f.type === 'number' ? 'decimal' : null, placeholder: f.placeholder, autocomplete: 'off', spellcheck: 'false' });
        input.value = f.value != null ? String(f.value) : '';
      }
      inputs[f.name] = input;
      form.appendChild(input);
      if (f.hint) form.appendChild(el('div', { class: 'oebf-dialog-hint' }, f.hint));
      const err = el('div', { class: 'oebf-dialog-error', id: `${id}-err`, role: 'alert' });
      input.setAttribute('aria-describedby', `${id}-err`);
      errorEls[f.name] = err;
      form.appendChild(err);
    });

    const buttons = el('div', { class: 'oebf-dialog-buttons' });
    const cancelBtn = cancel ? el('button', { type: 'button', value: 'cancel' }, cancel) : null;
    const okBtn = el('button', { type: 'submit', value: 'ok', class: danger ? 'danger' : 'primary' }, ok);
    if (cancelBtn) buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);
    form.appendChild(buttons);
    dlg.appendChild(form);

    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    const touched = new Set();
    const refresh = () => {
      const errors = checkFields(fields, values());
      for (const f of fields) {
        const msg = touched.has(f.name) ? (errors[f.name] ?? '') : '';
        errorEls[f.name].textContent = msg;
        inputs[f.name].setAttribute('aria-invalid', msg ? 'true' : 'false');
      }
      okBtn.disabled = Object.keys(errors).length > 0;
      return errors;
    };
    for (const [name, input] of Object.entries(inputs)) {
      const mark = () => { touched.add(name); refresh(); };
      input.addEventListener('input', mark);
      input.addEventListener('change', mark);
    }

    let result = null;
    const finish = (r) => { result = r; dlg.close(); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const f of fields) touched.add(f.name);
      if (Object.keys(refresh()).length) return;
      finish({ ok: true, values: values() });
    });
    cancelBtn?.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    // Keys typed in a dialog are not editor shortcuts.
    dlg.addEventListener('keydown', (e) => e.stopPropagation());

    document.body.appendChild(dlg);
    refresh();
    dlg.showModal();
    const first = Object.values(inputs)[0];
    if (first) { first.focus(); first.select?.(); } else okBtn.focus();
    document.dispatchEvent(new CustomEvent('oebf-dialog', { detail: { dialog: dlg, kind, fields: fields.map((f) => f.name) } }));
  });
}

/**
 * A form of one or more fields.
 * @param {{ title: string, message?: string, fields: Field[], ok?: string, cancel?: string }} spec
 * @returns {Promise<Record<string, string>|null>} the values, trimmed, or null if cancelled
 */
export async function askForm(spec) {
  const r = await open({ kind: 'form', ...spec });
  if (!r) return null;
  return Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
}

/**
 * One text field. The label is the title.
 * @param {string} label
 * @param {string} [value]
 * @param {Partial<Field> & { title?: string, message?: string, ok?: string }} [opts]
 * @returns {Promise<string|null>}
 */
export async function ask(label, value = '', opts = {}) {
  const { title, message, ok, ...field } = opts;
  const r = await askForm({ title: title ?? label, message, ok, fields: [{ name: 'value', label, value, required: true, ...field }] });
  return r ? r.value : null;
}

/**
 * Yes or no.
 * @param {string} message
 * @param {{ title?: string, ok?: string, cancel?: string, danger?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export async function confirmDialog(message, opts = {}) {
  const r = await open({ kind: 'confirm', message, ok: opts.ok ?? 'OK', cancel: opts.cancel ?? 'Cancel', title: opts.title, danger: opts.danger });
  return !!r;
}

/**
 * A message with one button.
 * @param {string} message
 * @param {{ title?: string, ok?: string }} [opts]
 * @returns {Promise<void>}
 */
export async function notify(message, opts = {}) {
  await open({ kind: 'notify', message, title: opts.title, ok: opts.ok ?? 'OK', cancel: null });
}
