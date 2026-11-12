import { test, expect } from 'vitest';
import { fitSelectToChoice, SELECT_CHROME_PX } from './selectWidth.js';

function fakeSelect(texts, selectedIndex = 0) {
  const listeners = {};
  return {
    options: texts.map((textContent) => ({ textContent })),
    selectedIndex,
    style: {},
    dataset: {},
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    fire: (type) => listeners[type]?.forEach((fn) => fn()),
  };
}
const measure = (text) => text.length * 7;   // 7 px a character

test('the select is as wide as its chosen option plus the arrow and padding', () => {
  const sel = fakeSelect(['Materials (no overlay)', 'Fire strategy']);
  fitSelectToChoice(sel, measure);
  expect(sel.style.width).toBe(`${22 * 7 + SELECT_CHROME_PX}px`);
});

test('it follows a change of choice, listening once however often it is fitted', () => {
  const sel = fakeSelect(['Materials (no overlay)', 'Fire strategy']);
  fitSelectToChoice(sel, measure);
  fitSelectToChoice(sel, measure);
  sel.selectedIndex = 1;
  sel.fire('change');
  expect(sel.style.width).toBe(`${13 * 7 + SELECT_CHROME_PX}px`);
});

test('an empty select takes only its chrome', () => {
  const sel = fakeSelect([], -1);
  fitSelectToChoice(sel, measure);
  expect(sel.style.width).toBe(`${SELECT_CHROME_PX}px`);
});
