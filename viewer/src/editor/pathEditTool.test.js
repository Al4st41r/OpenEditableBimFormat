import { describe, test, expect } from 'vitest';

// Pure path manipulation functions extracted for testability
function insertNode(segments, segIdx) {
  const seg = segments[segIdx];
  const mid = {
    x: (seg.start.x + seg.end.x) / 2,
    y: (seg.start.y + seg.end.y) / 2,
    z: (seg.start.z ?? 0 + (seg.end.z ?? 0)) / 2,
  };
  const newSeg = { type: 'line', start: { ...mid }, end: { ...seg.end } };
  seg.end = { ...mid };
  segments.splice(segIdx + 1, 0, newSeg);
}

function deleteNode(segments, segIdx, role) {
  if (segments.length <= 1) return;
  if (role === 'start' && segIdx === 0) {
    segments.shift();
  } else if (role === 'end' && segIdx === segments.length - 1) {
    segments.pop();
  } else if (role === 'end') {
    if (segIdx + 1 < segments.length) segments[segIdx + 1].start = { ...segments[segIdx].start };
    segments.splice(segIdx, 1);
  } else {
    segments[segIdx].start = { ...segments[segIdx - 1].start };
    segments.splice(segIdx - 1, 1);
  }
}

function makeSeg(x1, y1, x2, y2) {
  return { type: 'line', start: { x: x1, y: y1, z: 0 }, end: { x: x2, y: y2, z: 0 } };
}

// ── Minimal stub replicating PathEditTool's onEditCommitted wiring ────────────
// PathEditTool cannot be imported directly in node environment (Three.js
// requires DOM/WebGL), so we replicate only the relevant callback logic.
class PathEditToolStub {
  constructor() {
    this.onEditCommitted = null;
    this._pathData = null;
    this._adapter  = null;
    this._pathId   = null;
  }
  _buildHandles() {}
  async _save() { /* no-op for tests */ }
  async _insertNode(midIdx) {
    const { segIdx, midPos } = this._midHandles[midIdx];
    const seg = this._pathData.segments[segIdx];
    const newSeg = { type: 'line', start: { ...midPos }, end: { ...seg.end } };
    seg.end = { ...midPos };
    this._pathData.segments.splice(segIdx + 1, 0, newSeg);
    this._buildHandles();
    await this._save();
    this.onEditCommitted?.();
  }
}

describe('pathEditTool — onEditCommitted callback', () => {
  test('onEditCommitted is called after _insertNode', async () => {
    const tool = new PathEditToolStub();
    let callCount = 0;
    tool.onEditCommitted = () => { callCount += 1; };
    tool._pathData = {
      segments: [
        { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 } },
      ],
    };
    tool._midHandles = [
      { segIdx: 0, midPos: { x: 2, y: 0, z: 0 } },
    ];
    await tool._insertNode(0);
    expect(callCount).toBe(1);
    expect(tool._pathData.segments.length).toBe(2); // confirms insert happened
  });

  test('onEditCommitted is not required (null is safe)', async () => {
    const tool = new PathEditToolStub();
    tool._pathData = {
      segments: [
        { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 } },
      ],
    };
    tool._midHandles = [
      { segIdx: 0, midPos: { x: 2, y: 0, z: 0 } },
    ];
    // Should not throw when onEditCommitted is null
    await expect(tool._insertNode(0)).resolves.toBeUndefined();
  });
});

describe('pathEditTool — node manipulation', () => {
  test('insertNode splits segment at midpoint', () => {
    const segs = [makeSeg(0, 0, 4, 0)];
    insertNode(segs, 0);
    expect(segs.length).toBe(2);
    expect(segs[0].end.x).toBe(2); // midpoint
    expect(segs[1].start.x).toBe(2);
    expect(segs[1].end.x).toBe(4);
  });

  test('insertNode on second segment of two-segment path', () => {
    const segs = [makeSeg(0,0,4,0), makeSeg(4,0,4,3)];
    insertNode(segs, 1);
    expect(segs.length).toBe(3);
    expect(segs[1].end.y).toBeCloseTo(1.5);
    expect(segs[2].start.y).toBeCloseTo(1.5);
  });

  test('deleteNode removes first segment', () => {
    const segs = [makeSeg(0,0,4,0), makeSeg(4,0,4,3)];
    deleteNode(segs, 0, 'start');
    expect(segs.length).toBe(1);
    expect(segs[0].start.x).toBe(4);
  });

  test('deleteNode removes last segment', () => {
    const segs = [makeSeg(0,0,4,0), makeSeg(4,0,4,3)];
    deleteNode(segs, 1, 'end');
    expect(segs.length).toBe(1);
    expect(segs[0].end.x).toBe(4);
  });

  test('deleteNode on only segment does nothing', () => {
    const segs = [makeSeg(0,0,4,0)];
    deleteNode(segs, 0, 'start');
    expect(segs.length).toBe(1);
  });

  test('deleteNode middle-end heals gap', () => {
    const segs = [makeSeg(0,0,2,0), makeSeg(2,0,4,0), makeSeg(4,0,4,3)];
    deleteNode(segs, 1, 'end'); // remove end of seg 1 (middle node at x=4,y=0)
    expect(segs.length).toBe(2);
    expect(segs[1].start.x).toBe(2);
  });
});
