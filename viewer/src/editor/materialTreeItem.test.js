import { describe, test, expect } from 'vitest';
import { buildMaterialTreeItem } from './materialTreeItem.js';

// Minimal DOM stand-in: the suite runs in the node environment.
function fakeDoc() {
  const make = () => ({
    className: '', dataset: {}, style: {}, textContent: '', innerHTML: undefined, children: [],
    append(...c) { this.children.push(...c); },
  });
  return { createElement: make };
}

describe('buildMaterialTreeItem', () => {
  test('sets a hostile name as text, not HTML', () => {
    const item = buildMaterialTreeItem({ id: 'mat-x', name: '<img src=x onerror=alert(1)>' }, fakeDoc());
    const nameEl = item.children[1];
    expect(nameEl.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(item.innerHTML).toBeUndefined();
  });

  test('replaces an invalid colour rather than injecting it into the style', () => {
    const item = buildMaterialTreeItem({ id: 'mat-x', name: 'X', colour_hex: 'red;background:url(//evil)' }, fakeDoc());
    expect(item.children[0].style.background).toBe('#888888');
  });

  test('keeps a valid colour and falls back to the id for a missing name', () => {
    const item = buildMaterialTreeItem({ id: 'mat-brick', colour_hex: '#c4693a' }, fakeDoc());
    expect(item.dataset.id).toBe('mat-brick');
    expect(item.children[0].style.background).toBe('#C4693A');
    expect(item.children[1].textContent).toBe('mat-brick');
  });
});
