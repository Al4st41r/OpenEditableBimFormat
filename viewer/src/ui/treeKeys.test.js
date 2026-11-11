import { test, expect } from 'vitest';
import { moveIndex } from './treeKeys.js';

test('down and up move one row and stop at the ends', () => {
  expect(moveIndex(0, 3, 'ArrowDown')).toBe(1);
  expect(moveIndex(2, 3, 'ArrowDown')).toBe(2);
  expect(moveIndex(1, 3, 'ArrowUp')).toBe(0);
  expect(moveIndex(0, 3, 'ArrowUp')).toBe(0);
});

test('home and end go to the first and last rows', () => {
  expect(moveIndex(1, 5, 'Home')).toBe(0);
  expect(moveIndex(1, 5, 'End')).toBe(4);
});

test('with no row focused, down picks the first and up the last', () => {
  expect(moveIndex(-1, 4, 'ArrowDown')).toBe(0);
  expect(moveIndex(-1, 4, 'ArrowUp')).toBe(3);
});

test('other keys and empty lists are not moves', () => {
  expect(moveIndex(0, 3, 'Enter')).toBeNull();
  expect(moveIndex(0, 0, 'ArrowDown')).toBeNull();
});
