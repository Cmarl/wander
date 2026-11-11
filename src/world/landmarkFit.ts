import type { Fit, Layer } from "./geom";
import type { LandmarkKind } from "./landmarks";

/**
 * How each kind of landmark meets the ground, layer by layer.
 *
 * The default for a kind is the first entry; a number picks out one layer by
 * its position in the builder's list. Builders that set their own anchors —
 * the arch — are left alone whatever this says.
 *
 * The reasoning is the same every time. Is it one built object with a level
 * top (a tower, a mast)? Then its feet stretch to the ground: `foot`. Is it a
 * collection of separate things (stones, trees, boulders)? Then each stands
 * on its own patch: `scatter`. Is it level by nature (water, ice, a boat that
 * has settled)? Then `rigid`.
 */
const FIT: Record<LandmarkKind, { all: Fit; layers?: Record<number, Fit> }> = {
  // Legs and bracing reach down; the cabin stays level on top of them. The
  // collapsed variant is a heap, and a heap lies on the ground.
  lookout: { all: { foot: 10 }, layers: { 2: "rigid", 3: "scatter" } },
  arch: { all: "scatter" },
  // The guy anchors are fifteen metres out and each wants its own ground.
  mast: { all: { foot: 9 } },
  // The mound is one piece and its pool is level; the boulders and the dead
  // trees round it are not part of it.
  spring: { all: "rigid", layers: { 0: "scatter", 3: "scatter" } },
  lonetree: { all: { foot: 2.5 } },
  wreck: { all: "block", layers: { 3: "scatter" } },
  // Buildings are placed on the highest ground under them and stand on their
  // own foundations, so they stay rigid. The water tower has legs.
  steading: { all: "rigid", layers: { 0: { foot: 6 } } },
  shipwreck: { all: "rigid" },
  stones: { all: "scatter" },
  adit: { all: "rigid", layers: { 0: { foot: 8 }, 3: "scatter" } },
  windpump: { all: { foot: 6 }, layers: { 1: "rigid", 2: "block" } },
  sinkhole: { all: "scatter", layers: { 2: "rigid" } },
  bonefield: { all: "scatter" },
  orchard: { all: "scatter" },
  frozenlake: { all: "scatter", layers: { 2: "rigid" } },
  dock: { all: "rigid" },
  airfield: { all: "rigid" },
  cave: { all: "rigid", layers: { 0: "scatter", 1: "scatter" } },
};

export function fitFor(kind: LandmarkKind, index: number, layer: Layer): Fit {
  return layer.fit ?? FIT[kind].layers?.[index] ?? FIT[kind].all;
}

/**
 * Layers that are not in your way: water, ice, the dark of a pit, the inside
 * of a tunnel. Everything else you can see, you can bump into.
 */
const NOT_SOLID: Partial<Record<LandmarkKind, number[]>> = {
  spring: [1, 2, 4, 5, 6, 7, 8],
  adit: [2, 5, 6],
  cave: [2, 3, 4],
  stones: [4],
};

export function isSolid(kind: LandmarkKind, index: number, layer: Layer): boolean {
  if (layer.solid !== undefined) return layer.solid;
  if (layer.unlit) return false;
  return !(NOT_SOLID[kind] ?? []).includes(index);
}
