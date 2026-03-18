/**
 * stepParser.test.js
 *
 * Tests for parseStep — the minimal ISO 10303-21 STEP parser.
 */

import { describe, it, expect } from 'vitest';
import { parseStep } from './stepParser.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrap(dataContent) {
  return `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n${dataContent}\nENDSEC;\nEND-ISO-10303-21;`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseStep — basic entity parsing', () => {
  it('returns a Map with the correct entity id, type, and attr count', () => {
    const text = wrap(`#1=IFCWALL('abc123',$,'My Wall',$,$,$,$,$,$);`);
    const map = parseStep(text);
    expect(map.has(1)).toBe(true);
    const e = map.get(1);
    expect(e.type).toBe('IFCWALL');
    expect(Array.isArray(e.attrs)).toBe(true);
  });

  it('parses multiple entities and keys them by integer id', () => {
    const text = wrap(
      `#10=IFCPROJECT('proj-1',$,'Test Project',$,$,$,$,$,$);\n` +
      `#20=IFCSITE('site-1',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$);`
    );
    const map = parseStep(text);
    expect(map.size).toBe(2);
    expect(map.get(10).type).toBe('IFCPROJECT');
    expect(map.get(20).type).toBe('IFCSITE');
  });
});

describe('parseStep — attribute value types', () => {
  it('parses a quoted string attribute', () => {
    const text = wrap(`#1=IFCMATERIAL('Concrete',$,$);`);
    const e = parseStep(text).get(1);
    expect(e.attrs[0]).toBe('Concrete');
  });

  it('unescapes doubled single-quotes inside strings', () => {
    const text = wrap(`#1=IFCMATERIAL('Rock''n''Roll',$,$);`);
    const e = parseStep(text).get(1);
    expect(e.attrs[0]).toBe("Rock'n'Roll");
  });

  it('parses a reference attribute as {type:"ref", id:number}', () => {
    const text = wrap(`#5=IFCWALL('w',$,'Wall',$,$,$,#99,$,$);`);
    const e = parseStep(text).get(5);
    const repRef = e.attrs[6];
    expect(repRef).toEqual({ type: 'ref', id: 99 });
  });

  it('parses an enum attribute as {type:"enum", value:string}', () => {
    const text = wrap(`#1=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);
    const e = parseStep(text).get(1);
    expect(e.attrs[1]).toEqual({ type: 'enum', value: 'LENGTHUNIT' });
    expect(e.attrs[3]).toEqual({ type: 'enum', value: 'METRE' });
  });

  it('parses a numeric attribute as a JS number', () => {
    const text = wrap(`#1=IFCEXTRUDEDAREASOLID(#2,#3,#4,3.5);`);
    const e = parseStep(text).get(1);
    expect(e.attrs[3]).toBe(3.5);
  });

  it('parses a null/unset attribute ($) as null', () => {
    const text = wrap(`#1=IFCWALL('id',$,'Wall',$,$,$,$,$,$);`);
    const e = parseStep(text).get(1);
    expect(e.attrs[1]).toBeNull();
  });

  it('parses a flat list attribute as an array', () => {
    const text = wrap(`#1=IFCUNITASSIGNMENT((#10,#20,#30));`);
    const e = parseStep(text).get(1);
    const list = e.attrs[0];
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ type: 'ref', id: 10 });
    expect(list[2]).toEqual({ type: 'ref', id: 30 });
  });

  it('parses nested lists', () => {
    const text = wrap(`#1=IFCCARTESIANPOINT((1.,2.,3.));`);
    const e = parseStep(text).get(1);
    const coords = e.attrs[0];
    expect(Array.isArray(coords)).toBe(true);
    expect(coords[0]).toBe(1.0);
    expect(coords[1]).toBe(2.0);
    expect(coords[2]).toBe(3.0);
  });

  it('parses an empty list as an empty array', () => {
    const text = wrap(`#1=IFCPRODUCTDEFINITIONSHAPE($,$,());`);
    const e = parseStep(text).get(1);
    expect(e.attrs[2]).toEqual([]);
  });
});

describe('parseStep — edge cases', () => {
  it('returns an empty Map when there is no DATA section', () => {
    const map = parseStep('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;');
    expect(map.size).toBe(0);
  });

  it('returns an empty Map for a DATA section with no entities', () => {
    const map = parseStep(wrap(''));
    expect(map.size).toBe(0);
  });

  it('parses a realistic multi-entity file fragment', () => {
    const text = wrap(
      `#1=IFCPROJECT('0rJn$oJzj4nPFMFfETkHoe',$,'Terraced House',$,$,$,$,(#2),#3);\n` +
      `#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);\n` +
      `#4=IFCAXIS2PLACEMENT3D(#5,$,$);\n` +
      `#5=IFCCARTESIANPOINT((0.,0.,0.));`
    );
    const map = parseStep(text);
    expect(map.size).toBe(4);

    const project = map.get(1);
    expect(project.type).toBe('IFCPROJECT');
    expect(project.attrs[2]).toBe('Terraced House');

    const ctx = map.get(2);
    expect(ctx.attrs[1]).toBe('Model');
    expect(ctx.attrs[2]).toBe(3);

    const pt = map.get(5);
    const coords = pt.attrs[0];
    expect(coords[0]).toBe(0.0);
  });
});
