/**
 * renderScheduler.js — Draw the editor's scene only when something has changed (issue #165).
 *
 * `request()` asks for one frame; any number of requests before the next animation frame give a single draw.
 * `afterInput()` is for pointer and key events: it asks for a frame now, for what the input changed at once, and for
 * one more a short while after the last input, for what an input changes once its awaited work is done (a file read,
 * a re-swept wall). Nothing is drawn while the editor is idle.
 *
 * No DOM or WebGL: the frame and timer functions are passed in, so the tests can drive it.
 */

/**
 * @param {() => void} draw - renders the scene once
 * @param {object} [opts]
 * @param {(cb: () => void) => any} [opts.raf] - requestAnimationFrame
 * @param {(cb: () => void, ms: number) => any} [opts.setTimer]
 * @param {(id: any) => void} [opts.clearTimer]
 * @param {number} [opts.trailingMs] - the delay of the extra frame after the last input
 */
export function createRenderScheduler(draw, {
  raf = (cb) => requestAnimationFrame(cb),
  setTimer = (cb, ms) => setTimeout(cb, ms),
  clearTimer = (id) => clearTimeout(id),
  trailingMs = 400,
} = {}) {
  let pending = false;
  let trailing = null;
  let frames = 0;

  function frame() {
    pending = false;
    frames++;
    draw();
  }

  function request() {
    if (pending) return;
    pending = true;
    raf(frame);
  }

  function afterInput() {
    request();
    if (trailing !== null) clearTimer(trailing);
    trailing = setTimer(() => { trailing = null; request(); }, trailingMs);
  }

  return { request, afterInput, get frames() { return frames; } };
}

/**
 * Ask for a frame whenever an object is added to or removed from `root` or anything below it, now or later: models
 * load, tools add previews and managers add overlays without telling the scene. Three dispatches 'childadded' and
 * 'childremoved' on the parent only, so each object gets the listeners as it arrives.
 *
 * @param {import('three').Object3D} root
 * @param {() => void} onChange
 */
export function watchSceneGraph(root, onChange) {
  const onAdded = (e) => { onChange(); watch(e.child); };
  function watch(obj) {
    obj.addEventListener('childadded', onAdded);      // the dispatcher ignores a listener it already has
    obj.addEventListener('childremoved', onChange);
    for (const c of obj.children) watch(c);
  }
  watch(root);
}
