/**
 * starters.js — The example bundles the editor offers as starting points (issue #118).
 *
 * Each is a packed .oebfz served beside the app (public/). Opening one loads it in memory, so nothing is
 * written to disk until the user saves.
 */

export const STARTERS = [
  {
    id: 'terraced-house',
    title: 'Terraced house',
    description: 'One storey: four cavity walls, a slab, a front door, junctions with a reusable corner detail.',
    file: 'terraced-house.oebfz',
  },
  {
    id: 'nmb-two-storey',
    title: 'Two-storey timber building',
    description: 'Ground and first floor on a structural and a secondary grid, with about forty detailed junctions.',
    file: 'nmb-two-storey.oebfz',
  },
];

export const DEFAULT_STARTER = STARTERS[0].id;

/** The starter named by a ?demo=<id> value; anything unknown (or no value) gives the default. */
export function starterFor(id) {
  return STARTERS.find((s) => s.id === id) ?? STARTERS.find((s) => s.id === DEFAULT_STARTER);
}
