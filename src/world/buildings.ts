import * as THREE from "three";
import { box, merge, type Layer } from "./geom";
import type { Form } from "./settlements";

/**
 * The building kit, shared by lone steadings and by settlements.
 *
 * Extracted so there is exactly one cabin in the project. A settlement built
 * from its own copy of the same forms would drift away from the steadings the
 * first time either was touched, and a hamlet whose buildings don't match the
 * lone cabin on the next hill is a world with two different vernaculars in it.
 */

/**
 * Walls, a doorway and a pitched roof — the shape every form shares.
 *
 * Every building also gets a PLINTH running well below the floor. Landmarks
 * sit at a single height, so on a slope the downhill wall floats and the
 * uphill one buries itself — which is most of what "jank, esp if not on flat
 * ground" was. The plinth is four metres deep and the ground hides whatever
 * it does not need, so a building meets the hill instead of hovering over it.
 */
function shell(w: number, d: number, h: number, pitch: number, door: number) {
  const walls: THREE.BufferGeometry[] = [];
  const t = 0.22;

  const plinth = box(w + 0.5, 4.4, d + 0.5);
  plinth.translate(0, -2.2 + 0.18, 0);
  walls.push(plinth);
  for (const [ox, oz, ww, dd] of [
    [0, -d / 2, w, t],
    [-w / 2, 0, t, d],
    [w / 2, 0, t, d],
  ] as [number, number, number, number][]) {
    const wall = box(ww, h, dd);
    wall.translate(ox, h / 2, oz);
    walls.push(wall);
  }
  // The front wall is two piers and a lintel, which is what leaves a doorway.
  const side = (w - door) / 2;
  for (const sx of [-1, 1]) {
    const pier = box(side, h, t);
    pier.translate((sx * (door + side)) / 2, h / 2, d / 2);
    walls.push(pier);
  }
  const lintel = box(door, h * 0.26, t);
  lintel.translate(0, h - h * 0.13, d / 2);
  walls.push(lintel);

  /**
   * A proper gable: two slabs meeting at a ridge, with triangles closing the
   * ends.
   *
   * What was here was a three-sided cylinder SCALED ON ITS RADIUS AXIS to
   * reach the wall width — 2.23x on the barn — which ballooned it into a huge
   * dark wedge hanging far past the building. Clyde's screenshot is mostly
   * roof. Geometry that has to be scaled to fit was the wrong geometry.
   */
  const over = 0.45;
  const span = w / 2 + over;
  const rise = pitch * 0.95;
  const slope = Math.hypot(span, rise);
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const slab = box(slope, 0.2, d + over * 2);
    slab.translate(0, -0.1, 0);
    slab.rotateZ(-sx * Math.atan2(rise, span));
    slab.translate((sx * span) / 2, h + rise / 2, 0);
    parts.push(slab);
  }
  // Gable ends, so you cannot see straight into the roof void.
  const tri = new THREE.Shape();
  tri.moveTo(-w / 2, 0);
  tri.lineTo(w / 2, 0);
  tri.lineTo(0, rise);
  tri.closePath();
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.18, bevelEnabled: false });
  gable.translate(0, h, d / 2 - 0.09);
  parts.push(gable);
  const back = gable.clone();
  back.translate(0, 0, -d + 0.18);
  parts.push(back);

  return { walls: merge(walls), roof: merge(parts) };
}

/**
 * What is inside. One room, and simply there — no loading, no second scene,
 * nothing that happens when you cross the threshold. You can see it through
 * the doorway from outside, which is most of what makes a building feel like
 * somewhere rather than a prop.
 */
function room(opts: {
  w: number;
  d: number;
  /** Stove or hearth position. Null for a barn, which has neither. */
  stove: [number, number] | null;
  bed: boolean;
  table: boolean;
  bales: boolean;
}): { timber: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const timber: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];

  const floor = box(opts.w - 0.5, 0.1, opts.d - 0.5);
  floor.translate(0, 0.05, 0);
  timber.push(floor);

  if (opts.stove) {
    const [sx, sz] = opts.stove;
    const body = box(0.85, 0.95, 0.85);
    body.translate(sx, 0.52, sz);
    dark.push(body);
    const plate = box(1.0, 0.1, 1.0);
    plate.translate(sx, 1.03, sz);
    dark.push(plate);
    const flue = new THREE.CylinderGeometry(0.11, 0.11, 1.6, 6);
    flue.translate(sx, 1.85, sz);
    dark.push(flue);
  }

  if (opts.bed) {
    const frame = box(1.85, 0.3, 0.95);
    frame.translate(opts.w / 2 - 1.3, 0.3, -opts.d / 2 + 0.8);
    timber.push(frame);
    const bedding = box(1.75, 0.22, 0.88);
    bedding.translate(opts.w / 2 - 1.3, 0.54, -opts.d / 2 + 0.8);
    timber.push(bedding);
  }

  if (opts.table) {
    const top = box(1.5, 0.08, 0.85);
    top.translate(0, 0.78, opts.d / 2 - 1.5);
    timber.push(top);
    for (const [ox, oz] of [[-0.65, -0.33], [0.65, -0.33], [-0.65, 0.33], [0.65, 0.33]] as [number, number][]) {
      const leg = box(0.08, 0.76, 0.08);
      leg.translate(ox, 0.38, opts.d / 2 - 1.5 + oz);
      timber.push(leg);
    }
    const stool = new THREE.CylinderGeometry(0.21, 0.21, 0.44, 7);
    stool.translate(-1.1, 0.22, opts.d / 2 - 1.5);
    timber.push(stool);
    const shelf = box(1.6, 0.07, 0.34);
    shelf.translate(-opts.w / 2 + 1.1, 1.7, -opts.d / 2 + 0.4);
    timber.push(shelf);
  }

  if (opts.bales) {
    for (let i = 0; i < 7; i++) {
      const bale = box(1.0, 0.7, 0.7);
      bale.rotateY(i * 0.3);
      bale.translate(-opts.w / 2 + 1.2 + (i % 3) * 1.15, 0.37 + Math.floor(i / 3) * 0.72, -opts.d / 2 + 1.0 + (i % 2) * 0.8);
      timber.push(bale);
    }
  }

  return { timber: merge(timber), dark: merge(dark) };
}

function cabinLayers(): Layer[] {
  const s = shell(6.6, 5.2, 3.0, 2.0, 1.3);
  // A stone chimney is what makes a cabin a home rather than a shed, and it is
  // where the smoke goes.
  const stack: THREE.BufferGeometry[] = [];
  const flue = box(1.0, 4.4, 1.0);
  flue.translate(-3.5, 2.2, -1.1);
  stack.push(flue);
  const cap = box(1.3, 0.3, 1.3);
  cap.translate(-3.5, 4.5, -1.1);
  stack.push(cap);

  const panes: THREE.BufferGeometry[] = [];
  for (const [ox, oz] of [[-2.1, 2.62], [2.1, 2.62], [3.33, -1.1]] as [number, number][]) {
    const vertical = Math.abs(oz) > 2;
    const pane = box(vertical ? 1.1 : 0.08, 0.85, vertical ? 0.08 : 1.1);
    pane.translate(ox, 1.85, oz);
    panes.push(pane);
  }

  const inside = room({ w: 6.6, d: 5.2, stove: [-2.4, -1.1], bed: true, table: true, bales: false });

  return [
    { geo: s.walls, colour: 0x8a7050 },
    { geo: s.roof, colour: 0x5a4a3e },
    { geo: merge(stack), colour: 0x8a8880 },
    { geo: merge(panes), colour: 0x9fc4d4 },
    { geo: inside.timber, colour: 0x7b6950 },
    { geo: inside.dark, colour: 0x3c3c40 },
  ];
}

function barnLayers(): Layer[] {
  const s = shell(10.4, 7.2, 4.8, 2.9, 3.0);
  const inside = room({ w: 10.4, d: 7.2, stove: null, bed: false, table: false, bales: true });
  return [
    { geo: s.walls, colour: 0x7a4f42 },
    { geo: s.roof, colour: 0x6b7076 },
    { geo: inside.timber, colour: 0x9a8457 },
  ];
}

function shackLayers(): Layer[] {
  const s = shell(4.2, 3.8, 2.5, 1.3, 1.1);
  // A tin stovepipe instead of a chimney: the same idea, built cheaper.
  const pipe = new THREE.CylinderGeometry(0.16, 0.18, 2.0, 6);
  pipe.translate(-1.5, 3.3, -0.9);
  const pane = box(0.8, 0.62, 0.08);
  pane.translate(1.2, 1.5, 1.95);
  const inside = room({ w: 4.2, d: 3.8, stove: [-1.3, -0.9], bed: true, table: false, bales: false });
  return [
    { geo: s.walls, colour: 0x938068 },
    { geo: s.roof, colour: 0x6f6257 },
    { geo: pipe, colour: 0x767c82 },
    { geo: pane, colour: 0x9fc4d4 },
    { geo: inside.timber, colour: 0x857258 },
    { geo: inside.dark, colour: 0x3c3c40 },
  ];
}

/**
 * A store. The false front is the whole point — a tall square facade on a
 * small building is the one silhouette that says commerce rather than home,
 * and it is what makes four buildings read as a settlement.
 */
function storeLayers(): Layer[] {
  const s = shell(7.4, 6.0, 3.4, 2.1, 2.2);
  const trim: THREE.BufferGeometry[] = [];
  const facade = box(7.8, 5.3, 0.3);
  facade.translate(0, 2.65, 3.05);
  trim.push(facade);
  const cornice = box(8.2, 0.34, 0.6);
  cornice.translate(0, 5.1, 3.2);
  trim.push(cornice);

  // A porch over the boardwalk.
  const canopy = box(8.0, 0.18, 2.2);
  canopy.translate(0, 3.0, 4.2);
  trim.push(canopy);
  for (const sx of [-3.4, 0, 3.4]) {
    const post = new THREE.CylinderGeometry(0.11, 0.11, 2.9, 5);
    post.translate(sx, 1.45, 5.15);
    trim.push(post);
  }
  const boards = box(8.0, 0.16, 2.3);
  boards.translate(0, 0.1, 4.2);
  trim.push(boards);

  const panes: THREE.BufferGeometry[] = [];
  for (const sx of [-2.0, 2.0]) {
    const pane = box(1.9, 1.5, 0.08);
    pane.translate(sx, 1.9, 2.9);
    panes.push(pane);
  }

  return [
    { geo: s.walls, colour: 0x8f7a5c },
    { geo: s.roof, colour: 0x5e5248 },
    { geo: merge(trim), colour: 0xa2906f },
    { geo: merge(panes), colour: 0x9fc4d4 },
  ];
}

/**
 * A water tower. Tall, visible over the roofs, and the thing that tells you
 * from a kilometre out that what you are looking at is a settlement and not a
 * scatter of sheds.
 */
function towerLayers(): Layer[] {
  const frame: THREE.BufferGeometry[] = [];
  const H = 7.6;
  const corners: [number, number][] = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]];
  for (const [sx, sz] of corners) {
    const leg = new THREE.CylinderGeometry(0.13, 0.17, H, 5);
    leg.translate(0, H / 2, 0);
    leg.rotateZ(-Math.sign(sx) * 0.06);
    leg.rotateX(Math.sign(sz) * 0.06);
    leg.translate(sx, 0, sz);
    frame.push(leg);
  }
  for (const y of [2.4, 5.0]) {
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      const tie = box(Math.abs(c[0] - a[0]) || 0.09, 0.09, Math.abs(c[1] - a[1]) || 0.09);
      tie.translate((a[0] + c[0]) / 2, y, (a[1] + c[1]) / 2);
      frame.push(tie);
    }
  }

  const tank: THREE.BufferGeometry[] = [];
  const barrel = new THREE.CylinderGeometry(2.3, 2.3, 3.2, 12);
  barrel.translate(0, H + 1.6, 0);
  tank.push(barrel);
  const lid = new THREE.ConeGeometry(2.45, 0.9, 12);
  lid.translate(0, H + 3.6, 0);
  tank.push(lid);
  for (const y of [H + 0.4, H + 2.8]) {
    const band = new THREE.TorusGeometry(2.33, 0.07, 4, 14);
    band.rotateX(Math.PI / 2);
    band.translate(0, y, 0);
    tank.push(band);
  }

  return [
    { geo: merge(frame), colour: 0x7a6a56 },
    { geo: merge(tank), colour: 0x6f7a6a },
  ];
}

const KIT: Record<Form, () => Layer[]> = {
  cabin: cabinLayers,
  barn: barnLayers,
  shack: shackLayers,
  store: storeLayers,
  tower: towerLayers,
};

/** Built once at startup and shared — these are pure geometry. */
export const FORM_LAYERS: Record<Form, Layer[]> = {
  cabin: KIT.cabin(),
  barn: KIT.barn(),
  shack: KIT.shack(),
  store: KIT.store(),
  tower: KIT.tower(),
};

/**
 * The three builds a lone steading can be, as variant-gated layers.
 *
 * Settlements draw the same forms as separate meshes; a steading is one kind
 * with three variants, so its layers carry `on` and the unused ones collapse
 * to a zero-scale matrix.
 */
export function steadingLayers(): Layer[] {
  // 0 cabin · 1 barn · 2 line shack — and the naming grammar matches.
  return [
    ...FORM_LAYERS.cabin.map((l) => ({ ...l, on: [0] })),
    ...FORM_LAYERS.barn.map((l) => ({ ...l, on: [1] })),
    ...FORM_LAYERS.shack.map((l) => ({ ...l, on: [2] })),
  ];
}
