/**
 * Answer the editors' in-app dialogs (src/ui/dialog.js) in a Playwright test, in place of page.on('dialog').
 *
 *   const answer = await autoAnswerDialogs(page);       // before page.goto
 *   await page.goto('editor.html');
 *   await answer({ name: 'First floor', z: '3000' });    // the next form: fields by name
 *   await answer('Secondary grid');                      // a one-field dialog
 *   await answer(false);                                 // cancel the next dialog
 *
 * A dialog with no answer queued is accepted as it stands (its defaults, or OK for a confirm or a message).
 * `dialogLog(page)` returns what was asked: [{ kind, fields, answer }].
 */
export async function autoAnswerDialogs(page) {
  await page.addInitScript(() => {
    window.__dialogAnswers = [];
    window.__dialogLog = [];
    document.addEventListener('oebf-dialog', (e) => {
      const { dialog, kind, fields } = e.detail;
      const a = window.__dialogAnswers.shift();
      window.__dialogLog.push({ kind, fields, answer: a ?? null, text: dialog.textContent.trim().slice(0, 200) });
      setTimeout(() => {
        if (a === false) { dialog.querySelector('button[value=cancel]')?.click(); return; }
        if (kind === 'form' && a !== undefined) {
          const values = typeof a === 'object' ? a : { [fields[0]]: a };
          for (const [name, v] of Object.entries(values)) {
            const el = dialog.querySelector(`[name="${name}"]`);
            if (!el) { window.__dialogLog.push({ error: `no field "${name}" in ${fields.join(', ')}` }); continue; }
            el.value = String(v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        dialog.querySelector('button[type=submit]').click();
      }, 0);
    });
  });
  return (...answers) => page.evaluate((as) => { window.__dialogAnswers.push(...as); }, answers);
}

export const dialogLog = (page) => page.evaluate(() => window.__dialogLog);
