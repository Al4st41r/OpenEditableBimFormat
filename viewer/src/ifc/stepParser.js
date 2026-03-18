/**
 * stepParser.js — Minimal ISO 10303-21 STEP file parser for IFC files.
 *
 * Parses the DATA section into a Map<entityId, {type, attrs}> where:
 *   entityId — integer from the #ID part
 *   type     — uppercase IFC type string (e.g. 'IFCWALL')
 *   attrs    — array of parsed attribute values
 *
 * Attribute value types:
 *   null                        — $ (unset)
 *   number                      — numeric literal
 *   string                      — quoted string (with '' → ' unescaping)
 *   {type:'ref', id:number}     — entity reference #123
 *   {type:'enum', value:string} — enumeration .VALUE.
 *   array                       — list (...)
 */
export function parseStep(text) {
  const dataMatch = text.match(/DATA;([\s\S]*?)ENDSEC;/);
  if (!dataMatch) return new Map();

  const dataSection = dataMatch[1];
  const entities = new Map();

  let i = 0;
  while (i < dataSection.length) {
    const hashPos = dataSection.indexOf('#', i);
    if (hashPos === -1) break;

    const idMatch = dataSection.slice(hashPos).match(/^#(\d+)\s*=\s*([A-Z][A-Z0-9]*)\s*\(/);
    if (!idMatch) { i = hashPos + 1; continue; }

    const entityId   = parseInt(idMatch[1]);
    const entityType = idMatch[2];
    const attrStart  = hashPos + idMatch[0].length;

    // Find the matching closing paren (depth-aware, string-aware)
    let depth = 1;
    let inStr = false;
    let j = attrStart;
    while (j < dataSection.length && depth > 0) {
      const ch = dataSection[j];
      if (inStr) {
        if (ch === "'") {
          if (dataSection[j + 1] === "'") { j += 2; continue; }
          inStr = false;
        }
        j++;
        continue;
      }
      if (ch === "'") { inStr = true; j++; continue; }
      if (ch === '(') depth++;
      if (ch === ')') { depth--; if (depth === 0) break; }
      j++;
    }

    const rawAttrs = dataSection.slice(attrStart, j);
    entities.set(entityId, { type: entityType, attrs: _parseAttrList(rawAttrs) });
    i = j + 1;
  }

  return entities;
}

function _parseAttrList(raw) {
  return _splitTopLevel(raw).map(_parseValue);
}

function _splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let start = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (ch === "'" && str[i + 1] === "'") { i++; continue; }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") { inStr = true; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(str.slice(start).trim());
  return parts;
}

function _parseValue(token) {
  token = token.trim();
  if (token === '$' || token === '' || token === '*') return null;
  if (token.startsWith('#')) return { type: 'ref', id: parseInt(token.slice(1)) };
  if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
  if (token.startsWith('.')) return { type: 'enum', value: token.slice(1, -1) };
  if (token.startsWith('(')) {
    const inner = token.slice(1, -1);
    if (inner.trim() === '') return [];
    return _splitTopLevel(inner).map(_parseValue);
  }
  // Typed value: TYPE(...)
  const typedMatch = token.match(/^([A-Z][A-Z0-9]*)\((.+)\)$/s);
  if (typedMatch) {
    // Return the inner value (string, number, etc.) unwrapped
    return _parseValue(typedMatch[2]);
  }
  const num = parseFloat(token);
  if (!isNaN(num) && token.trim() !== '') return num;
  return token;
}
