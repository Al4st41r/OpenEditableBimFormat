/**
 * nodeUtils.js — Pure helper for path node position editing.
 *
 * Extracted from editor.js so it can be unit-tested without DOM or Three.js.
 */

/**
 * Update a single axis of a path node and keep adjacent segments consistent.
 *
 * Mirrors the adjacency logic used during PathEditTool drag:
 *   - If role === 'start' and segIdx > 0, the previous segment's end is also updated.
 *   - If role === 'end' and segIdx < segs.length-1, the next segment's start is also updated.
 *
 * @param {object[]} segments  — path.segments array (mutated in place)
 * @param {number}   segIdx   — index of the segment whose node is being edited
 * @param {'start'|'end'} role
 * @param {'x'|'y'|'z'} axis
 * @param {number}   metres   — new value in metres
 * @returns {object[]} the same mutated segments array
 */
export function updateNodeAxis(segments, segIdx, role, axis, metres) {
  const seg = segments[segIdx];
  seg[role][axis] = metres;

  if (role === 'start' && segIdx > 0) {
    segments[segIdx - 1].end[axis] = metres;
  }
  if (role === 'end' && segIdx < segments.length - 1) {
    segments[segIdx + 1].start[axis] = metres;
  }

  return segments;
}
