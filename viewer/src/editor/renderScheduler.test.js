import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createRenderScheduler, watchSceneGraph } from './renderScheduler.js';

/** A frame queue and a timer queue the test runs by hand. */
function fakeClock() {
  const frames = [], timers = new Map();
  let next = 1;
  return {
    raf: (cb) => frames.push(cb),
    setTimer: (cb, ms) => { const id = next++; timers.set(id, { cb, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    runFrames: () => { const fs = frames.splice(0); fs.forEach((f) => f()); },
    runTimers: () => { const ts = [...timers.values()]; timers.clear(); ts.forEach((t) => t.cb()); },
    get pendingFrames() { return frames.length; },
    get pendingTimers() { return timers.size; },
  };
}

describe('createRenderScheduler (#165)', () => {
  it('draws nothing until asked', () => {
    const clock = fakeClock();
    let draws = 0;
    createRenderScheduler(() => draws++, clock);
    clock.runFrames(); clock.runTimers();
    expect(draws).toBe(0);
  });

  it('draws once for any number of requests before the next frame', () => {
    const clock = fakeClock();
    let draws = 0;
    const s = createRenderScheduler(() => draws++, clock);
    s.request(); s.request(); s.request();
    expect(clock.pendingFrames).toBe(1);
    clock.runFrames();
    expect(draws).toBe(1);
    s.request(); clock.runFrames();
    expect(draws).toBe(2);
    expect(s.frames).toBe(2);
  });

  it('after input draws now and once more after the last input, then stops', () => {
    const clock = fakeClock();
    let draws = 0;
    const s = createRenderScheduler(() => draws++, clock);
    s.afterInput(); s.afterInput(); s.afterInput();   // eg a burst of pointer moves
    expect(clock.pendingTimers).toBe(1);               // the trailing frame is pushed back, not stacked
    clock.runFrames();
    expect(draws).toBe(1);
    clock.runTimers(); clock.runFrames();
    expect(draws).toBe(2);
    clock.runTimers(); clock.runFrames();
    expect(draws).toBe(2);                             // idle again
  });
});

describe('watchSceneGraph (#165)', () => {
  it('asks for a frame when objects are added or removed at any depth, including below later additions', () => {
    const root = new THREE.Scene();
    const existing = new THREE.Group();
    root.add(existing);
    let changes = 0;
    watchSceneGraph(root, () => changes++);

    existing.add(new THREE.Object3D());
    expect(changes).toBe(1);

    const later = new THREE.Group();
    root.add(later);
    expect(changes).toBe(2);
    const leaf = new THREE.Mesh();
    later.add(leaf);
    expect(changes).toBe(3);
    later.remove(leaf);
    expect(changes).toBe(4);
  });
});
