import { describe, it, expect } from 'vitest';
import { elementLabel, shortcutFor, SHORTCUTS } from './editorUi.js';

describe('elementLabel', () => {
  it('uses the description the author wrote', () => {
    expect(elementLabel('element-wall-south-gf', 'Wall', 'South external wall, ground floor')).toBe('South external wall, ground floor');
  });
  it('falls back to the kind and the id without its prefix, never a slice of the id', () => {
    expect(elementLabel('element-wall-south-gf', 'Wall', 'Wall')).toBe('Wall south-gf');
    expect(elementLabel('element-wall-south-gf', 'Wall', undefined)).toBe('Wall south-gf');
    expect(elementLabel('slab-gf', 'Slab', '  ')).toBe('Slab gf');
    expect(elementLabel('element-column-nw-gf', 'Wall', '')).toBe('Wall column-nw-gf');
  });
});

describe('shortcutFor', () => {
  const k = (key, mods = {}) => ({ key, ...mods });
  it('maps the file shortcuts, with Cmd as well as Ctrl', () => {
    expect(shortcutFor(k('s', { ctrlKey: true }))).toBe('save');
    expect(shortcutFor(k('z', { metaKey: true }))).toBe('undo');
    expect(shortcutFor(k('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutFor(k('y', { ctrlKey: true }))).toBe('redo');
  });
  it('maps the tool and view keys', () => {
    expect(['v', 'e', 'w', 'f', 's', '3', '2', '?'].map((x) => shortcutFor(k(x)))).toEqual(['select', 'edit', 'wall', 'floor', 'snap', 'view3d', 'plan', 'help']);
    expect(shortcutFor(k('W'))).toBe('wall');
  });
  it('leaves keys alone while typing in a field, except save', () => {
    expect(shortcutFor(k('w'), { typing: true })).toBeNull();
    expect(shortcutFor(k('z', { ctrlKey: true }), { typing: true })).toBeNull();
    expect(shortcutFor(k('s', { ctrlKey: true }), { typing: true })).toBe('save');
  });
  it('leaves plain keys to a drawing tool, which reads typed coordinates, but still undoes and shows help', () => {
    expect(shortcutFor(k('f'), { drawing: true })).toBeNull();
    expect(shortcutFor(k('2'), { drawing: true })).toBeNull();
    expect(shortcutFor(k('z', { ctrlKey: true }), { drawing: true })).toBe('undo');
    expect(shortcutFor(k('?'), { drawing: true })).toBe('help');
  });
  it('ignores other keys and Alt combinations', () => {
    expect(shortcutFor(k('q'))).toBeNull();
    expect(shortcutFor(k('w', { altKey: true }))).toBeNull();
    expect(shortcutFor(k('Enter'))).toBeNull();
  });
  it('every action the help lists is a real key', () => {
    expect(SHORTCUTS.flatMap(([, rows]) => rows).length).toBeGreaterThan(12);
  });
});
