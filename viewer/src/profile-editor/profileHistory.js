/**
 * profileHistory.js — Undo, redo and the unsaved-changes flag for the profile on screen. Pure: it holds snapshots
 * (plain objects of the profile's editable state) and compares them as JSON.
 *
 *   h.reset(snap)        a profile was opened or created: one step, counted as saved (or not, for a new profile)
 *   h.record(snap)       after an edit; ignored when nothing changed
 *   h.undo() / h.redo()  the snapshot to show, or null
 *   h.markSaved()        the snapshot on screen is the one on disk
 *   h.dirty              the snapshot on screen differs from the saved one
 */

const LIMIT = 200;

export class ProfileHistory {
  constructor() {
    this._steps = [];
    this._at = -1;
    this._saved = null;
  }

  /**
   * @param {object} snap
   * @param {{ saved?: boolean }} [opts] - saved: false for a profile that has never been written
   */
  reset(snap, { saved = true } = {}) {
    this._steps = [JSON.stringify(snap)];
    this._at = 0;
    this._saved = saved ? this._steps[0] : null;
  }

  /** @returns {boolean} whether a step was added */
  record(snap) {
    if (this._at < 0) { this.reset(snap); return false; }
    const s = JSON.stringify(snap);
    if (s === this._steps[this._at]) return false;
    this._steps.splice(this._at + 1);
    this._steps.push(s);
    if (this._steps.length > LIMIT) this._steps.shift();
    this._at = this._steps.length - 1;
    return true;
  }

  get canUndo() { return this._at > 0; }
  get canRedo() { return this._at >= 0 && this._at < this._steps.length - 1; }

  undo() {
    if (!this.canUndo) return null;
    this._at -= 1;
    return JSON.parse(this._steps[this._at]);
  }

  redo() {
    if (!this.canRedo) return null;
    this._at += 1;
    return JSON.parse(this._steps[this._at]);
  }

  markSaved() { if (this._at >= 0) this._saved = this._steps[this._at]; }

  /** Nothing is open, or the open profile is as saved. */
  get dirty() { return this._at >= 0 && this._steps[this._at] !== this._saved; }

  clear() { this._steps = []; this._at = -1; this._saved = null; }
}
