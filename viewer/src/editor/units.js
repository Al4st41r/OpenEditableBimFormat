/**
 * units.js — User-facing unit configuration.
 *
 * OEBF always stores geometry in metres.
 * This module converts between metres and the display unit for UI labels and inputs.
 *
 * Supported units: 'mm' (default), 'm'
 */

let _unit = 'mm';

/** Set the active display unit. @param {'mm'|'m'} u */
export function setUnit(u) { _unit = u; }

/** Get the active display unit. @returns {'mm'|'m'} */
export function getUnit() { return _unit; }

/** Convert metres to display value. */
export function toDisplay(metres) {
  if (_unit === 'mm') {
    const raw = metres * 1000;
    return Math.round(raw * 1e6) / 1e6;
  }
  return metres;
}

/** Convert display value to metres. */
export function fromDisplay(value) {
  return _unit === 'mm' ? value / 1000 : value;
}

/** Current unit label string. @returns {'mm'|'m'} */
export function unitLabel() { return _unit; }
