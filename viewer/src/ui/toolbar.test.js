import { test, expect } from 'vitest';
import { edgeSeparators } from './toolbar.js';

const b = (mid) => ({ sep: false, mid });
const s = (mid) => ({ sep: true, mid });

test('a separator between two buttons on one row stays', () => {
  expect(edgeSeparators([b(13), s(13), b(13)])).toEqual([false, false, false]);
});

test('a separator that wrapped to the start of the second row is hidden', () => {
  expect(edgeSeparators([b(13), b(13), s(45), b(45)])).toEqual([false, false, true, false]);
});

test('a separator left at the end of the first row is hidden', () => {
  expect(edgeSeparators([b(13), s(13), b(45)])).toEqual([false, true, false]);
});

test('separators first or last in the toolbar are hidden', () => {
  expect(edgeSeparators([s(13), b(13), s(13)])).toEqual([true, false, true]);
});

test('items of different heights in one row count as one row', () => {
  expect(edgeSeparators([b(14), s(12), b(15)])).toEqual([false, false, false]);
});

test('two separators together look past each other to the buttons', () => {
  expect(edgeSeparators([b(13), s(13), s(13), b(13)])).toEqual([false, false, false, false]);
});
