import { describe, test, expect } from 'vitest';
import { parseDimension } from './dimension.js';

const mm = (t) => parseDimension(t, { unit: 'mm' });
const m = (t) => parseDimension(t, { unit: 'm' });
const close = (a, b) => expect(a).toBeCloseTo(b, 9);

describe('plain numbers use the display unit', () => {
  test('mm', () => { close(mm('2400'), 2.4); close(mm('12.5'), 0.0125); close(mm('0'), 0); });
  test('m', () => { close(m('2.4'), 2.4); close(m('0.5'), 0.5); });
  test('the unit defaults to mm', () => { close(parseDimension('1000'), 1); });
});

describe('explicit units override the display unit', () => {
  test('mm, cm and m suffixes, with or without a space, any case', () => {
    close(m('2400mm'), 2.4); close(m('240 cm'), 2.4); close(mm('2.4m'), 2.4); close(mm('2.4 M'), 2.4); close(mm('50MM'), 0.05);
  });
});

describe('arithmetic', () => {
  test('addition and subtraction', () => { close(mm('1200+300'), 1.5); close(mm('1200 - 300'), 0.9); });
  test('mixed units', () => { close(mm('1.2m+300'), 1.5); close(m('1+300mm'), 1.3); close(mm('2m - 500mm'), 1.5); });
  test('multiplication and division by a plain number', () => { close(mm('2*1200'), 2.4); close(mm('1200*2'), 2.4); close(mm('4800/2'), 2.4); close(mm('2.4m/2'), 1.2); close(mm('3*0.8m'), 2.4); });
  test('precedence and brackets', () => { close(mm('100+2*50'), 0.2); close(mm('(100+2)*50'), 5.1); close(mm('2*(100+50)'), 0.3); });
  test('negative numbers and unary signs', () => { close(mm('-300'), -0.3); close(mm('1000+-300'), 0.7); close(mm('-(100+50)'), -0.15); close(mm('+250'), 0.25); });
  test('decimals and whitespace', () => { close(mm('  1 200 '.replace(/ /g, '')), 1.2); close(mm(' 12.5 + 0.5 '), 0.013); });
});

describe('invalid input returns null and never throws', () => {
  test.each(['', '   ', 'abc', '12abc', '1200+', '+', '*3', '(1+2', '1+2)', '1..2', '2m3', '1200 mm mm', '--5', '1/0', '0/0', '5%2', 'NaN', 'Infinity', '1e999'])('%j', (t) => {
    expect(mm(t)).toBeNull();
  });
  test('non-strings are rejected', () => {
    for (const v of [null, undefined, 5, {}, []]) expect(mm(v)).toBeNull();
  });
});

describe('it is a parser, not eval', () => {
  test('code is not executed', () => {
    globalThis.__pwned = false;
    for (const t of ['globalThis.__pwned=true', '(()=>{globalThis.__pwned=true})()', 'constructor', 'process.exit()', '__proto__', '1+alert(1)']) expect(mm(t)).toBeNull();
    expect(globalThis.__pwned).toBe(false);
  });
  test('very long input is handled', () => {
    expect(mm('1+'.repeat(5000) + '1')).toBeCloseTo(5.001, 9);
    expect(mm('('.repeat(5000) + '1' + ')'.repeat(5000))).toBeNull();   // nesting limit, not a stack overflow
  });
});
