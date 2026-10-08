/**
 * dimension.js
 *
 * Parse a typed dimension such as "2400", "2.4m", "1200+300" or "(100+50)*2"
 * into metres. A small recursive-descent parser: no eval, no identifiers, no
 * exponents. Returns null for anything it cannot read, and never throws.
 *
 *   numbers     1200   12.5   (a bare number is in the display unit)
 *   units       mm  cm  m     (suffix, optional space, any case)
 *   operators   + - * /  and brackets, with unary + and -
 *
 * A number with a unit is a length; a bare number is in the display unit. "2*1200"
 * is 2400 in the display unit, "3*0.8m" is 2.4 m, and a length times a length is
 * refused as meaningless.
 */

const UNIT_M = { mm: 0.001, cm: 0.01, m: 1 };
const MAX_DEPTH = 100;

/** @param {string} text @param {{ unit?: 'mm'|'m' }} [options] @returns {number|null} metres */
export function parseDimension(text, { unit = 'mm' } = {}) {
  if (typeof text !== 'string') return null;
  const src = text.trim();
  if (src === '') return null;
  const bareScale = UNIT_M[unit] ?? 0.001;

  let i = 0;
  let depth = 0;
  const fail = Symbol('fail');

  const skip = () => { while (src[i] === ' ' || src[i] === '\t') i++; };
  const peek = () => { skip(); return src[i]; };

  // value: { v, bare }  v is raw for bare values, metres for lengths
  const toMetres = (x) => (x.bare ? x.v * bareScale : x.v);
  const combineAdd = (a, b, sign) => (a.bare && b.bare
    ? { v: a.v + sign * b.v, bare: true }
    : { v: toMetres(a) + sign * toMetres(b), bare: false });

  function number() {
    skip();
    const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (!m) throw fail;
    i += m[0].length;
    let v = parseFloat(m[0]);
    const u = /^\s*(mm|cm|m)(?![a-z0-9])/i.exec(src.slice(i));
    if (u) { i += u[0].length; return { v: v * UNIT_M[u[1].toLowerCase()], bare: false }; }
    return { v, bare: true };
  }

  function factor() {
    if (++depth > MAX_DEPTH) throw fail;
    const c = peek();
    let out;
    if (c === '-' || c === '+') {
      i++;
      const c2 = peek();
      if (c2 === '-' || c2 === '+') throw fail;          // one unary sign only
      const f = c2 === '(' ? group() : number();
      out = { v: c === '-' ? -f.v : f.v, bare: f.bare };
    } else if (c === '(') out = group();
    else out = number();
    depth--;
    return out;
  }

  function group() {
    i++;                                                   // (
    const e = expr();
    if (peek() !== ')') throw fail;
    i++;
    return e;
  }

  function term() {
    let a = factor();
    for (;;) {
      const op = peek();
      if (op !== '*' && op !== '/') return a;
      i++;
      const b = factor();
      if (!a.bare && !b.bare) throw fail;                  // length * length or length / length
      if (op === '/') {
        if (!b.bare || b.v === 0) throw fail;              // only "length / number" or "number / number"
        a = { v: a.v / b.v, bare: a.bare };
      } else {
        a = { v: a.v * b.v, bare: a.bare && b.bare };      // number * number stays a bare number
      }
    }
  }

  function expr() {
    let a = term();
    for (;;) {
      const op = peek();
      if (op !== '+' && op !== '-') return a;
      i++;
      a = combineAdd(a, term(), op === '+' ? 1 : -1);
    }
  }

  try {
    const result = expr();
    skip();
    if (i < src.length) return null;
    const metres = toMetres(result);
    return Number.isFinite(metres) ? metres : null;
  } catch (e) {
    if (e === fail) return null;
    return null;
  }
}
