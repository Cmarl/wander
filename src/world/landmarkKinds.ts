import * as THREE from "three";
import { box, merge, rock, strut, type Layer } from "./geom";

/**
 * The eight kinds added in the world pass.
 *
 * Six nouns was genuinely thin. Each of these earns its slot by unlocking
 * either a silhouette the others don't have or a biome that had nothing of its
 * own: shorelines, arid country and tundra were all previously furnished out
 * of the same inland kit.
 *
 * Variants are used where they change the object meaningfully. Where a kind
 * reads as one thing — a sinkhole, a frozen lake — its layers carry no `on`
 * and show for every variant, and wear does the differentiating instead.
 */

/** A hull aground on the shore, broken open. */
export function shipwreck(): Layer[] {
  const hull: THREE.BufferGeometry[] = [];
  const rib: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];

  // Tapered at both ends, so it reads as a boat rather than a container.
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const w = 4.6 * Math.sin(Math.PI * (0.18 + t * 0.64));
    const seg = box(w, 4.2, 2.9);
    seg.translate(0, 2.1, (t - 0.5) * 22);
    hull.push(seg);
  }
  const keel = box(1.5, 1.1, 24);
  keel.translate(0, 0.4, 0);
  hull.push(keel);

  // Ribs standing clear where the planking has gone.
  for (let i = 0; i < 7; i++) {
    const z = -8 + i * 2.8;
    for (const sx of [-1, 1]) {
      const r = new THREE.CylinderGeometry(0.22, 0.3, 5.6, 5);
      r.rotateZ(sx * 0.34);
      r.translate(sx * 2.4, 3.1, z);
      rib.push(r);
    }
  }

  const mast = new THREE.CylinderGeometry(0.3, 0.46, 13, 6);
  mast.rotateZ(0.26);
  mast.translate(-1.9, 8.4, -1.5);
  metal.push(mast);
  const spar = box(8.4, 0.26, 0.26);
  spar.rotateZ(0.26);
  spar.translate(-3.2, 12.6, -1.5);
  metal.push(spar);
  const house = box(4.2, 2.6, 4.4);
  house.translate(0, 5.5, -5.2);
  metal.push(house);

  // Aground at an angle. A boat sitting level on a beach looks parked.
  const lean = (parts: THREE.BufferGeometry[]) => {
    const g = merge(parts);
    g.rotateZ(0.17);
    g.rotateX(-0.06);
    return g;
  };

  return [
    // 0 hull largely whole · 1 broken open, ribs bare · 2 just the skeleton
    { geo: lean(hull), colour: 0x5e6b6e, on: [0, 1] },
    { geo: lean(rib), colour: 0x6b5a46, on: [1, 2] },
    { geo: lean(metal), colour: 0x7a7266, on: [0, 1] },
  ];
}

/** Standing stones: human but ancient, a different register from "built". */
export function stones(): Layer[] {
  const ring: THREE.BufferGeometry[] = [];
  const avenue: THREE.BufferGeometry[] = [];
  const fallen: THREE.BufferGeometry[] = [];

  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const h = 3.4 + (i % 4) * 1.15;
    const s = box(1.5 + (i % 3) * 0.3, h, 0.85);
    s.rotateY(a + 0.1 * Math.sin(i * 2.7));
    s.rotateZ(Math.sin(i * 1.9) * 0.055);
    s.translate(Math.cos(a) * 9.5, h / 2, Math.sin(a) * 9.5);
    ring.push(s);
  }
  // Two lintels, which is what makes a ring read as deliberate.
  for (const i of [0, 4]) {
    const a = ((i + 0.5) / 9) * Math.PI * 2;
    const l = box(3.6, 0.7, 1.0);
    l.rotateY(a);
    l.translate(Math.cos(a) * 9.5, 5.1, Math.sin(a) * 9.5);
    ring.push(l);
  }

  // Variant 1: a straight avenue instead of a ring.
  for (let i = 0; i < 12; i++) {
    const h = 2.8 + (i % 3) * 1.3;
    for (const sx of [-1, 1]) {
      const s = box(1.3, h, 0.8);
      s.rotateY(0.08 * i * sx);
      s.translate(sx * 3.4, h / 2, -15 + i * 2.8);
      avenue.push(s);
    }
  }

  // Variant 2: the ring after a few thousand more years.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const down = i % 3 !== 0;
    const h = 3.4 + (i % 4) * 1.15;
    const s = box(1.5, h, 0.85);
    if (down) {
      s.rotateX(Math.PI / 2 - 0.1);
      s.rotateY(a * 1.4);
      s.translate(Math.cos(a) * 9.5, 0.45, Math.sin(a) * 9.5);
    } else {
      s.rotateY(a);
      s.rotateZ(0.21);
      s.translate(Math.cos(a) * 9.5, h / 2, Math.sin(a) * 9.5);
    }
    fallen.push(s);
  }

  return [
    // 0 ring · 1 avenue · 2 mostly fallen
    { geo: merge(ring), colour: 0x8e8b82, on: [0] },
    { geo: merge(avenue), colour: 0x8e8b82, on: [1] },
    { geo: merge(fallen), colour: 0x87847b, on: [2] },
  ];
}

/** Mine adit: a timber portal into the hillside, and its spoil heap. */
export function adit(): Layer[] {
  const timber: THREE.BufferGeometry[] = [];
  const spoil: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];

  // The portal frame, stepped back twice so it reads as having depth.
  for (let step = 0; step < 3; step++) {
    const z = -step * 2.1;
    const s = 1 - step * 0.09;
    for (const sx of [-1, 1]) {
      const post = box(0.5 * s, 3.4 * s, 0.45);
      post.translate(sx * 1.6 * s, 1.7 * s, z);
      timber.push(post);
    }
    const head = box(4.1 * s, 0.55 * s, 0.45);
    head.translate(0, 3.5 * s, z);
    timber.push(head);
  }
  /**
   * The drift itself — a tunnel you stand in rather than a dark box you look
   * at. Terrain is a pure function and cannot be excavated, so the workings
   * are built: floor, two walls and a roof running back into the hill, closed
   * off at the far end. From the portal, and from inside, it reads as a hole
   * in the ground because every direction you can look is rock.
   */
  const D = 22;
  const W = 1.6;
  const H = 2.9;
  const floor = box(W * 2, 0.3, D);
  floor.translate(0, 0.15, -D / 2 - 1);
  dark.push(floor);
  const roof = box(W * 2 + 0.6, 0.4, D);
  roof.translate(0, H, -D / 2 - 1);
  dark.push(roof);
  for (const sx of [-1, 1]) {
    const wall = box(0.5, H, D);
    wall.translate(sx * (W + 0.25), H / 2, -D / 2 - 1);
    dark.push(wall);
  }
  const face = box(W * 2 + 1, H + 0.5, 0.6);
  face.translate(0, H / 2, -D - 1);
  dark.push(face);

  // Timber sets at intervals, receding — the thing that gives a tunnel depth.
  for (let i = 1; i <= 6; i++) {
    const z = -3.4 - i * 3.0;
    for (const sx of [-1, 1]) {
      const post = box(0.3, H - 0.3, 0.3);
      post.translate(sx * W, (H - 0.3) / 2, z);
      timber.push(post);
    }
    const cap = box(W * 2 + 0.4, 0.3, 0.3);
    cap.translate(0, H - 0.3, z);
    timber.push(cap);
  }

  // Rails running in, and a cart stopped partway down.
  for (const sx of [-0.55, 0.55]) {
    const rail = box(0.1, 0.1, D - 2);
    rail.translate(sx, 0.32, -D / 2 - 1);
    metal.push(rail);
  }
  const inCart = box(1.4, 0.95, 2.0);
  inCart.translate(0, 0.85, -12);
  metal.push(inCart);

  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 7 + (i % 5) * 1.7;
    const s = rock(0.75 + (i % 4) * 0.33, 0.55, i);
    s.translate(Math.cos(a) * r * 0.8, 0.3, 5 + Math.sin(a) * r * 0.5);
    spoil.push(s);
  }

  // Rails running out onto the heap, and a cart left on them.
  for (const sx of [-0.55, 0.55]) {
    const rail = box(0.1, 0.1, 15);
    rail.translate(sx, 0.18, 4);
    metal.push(rail);
  }
  const cart = box(1.5, 1.0, 2.1);
  cart.translate(0, 0.8, 7.4);
  metal.push(cart);

  /**
   * The seam, at the far end. This is the payoff for walking in: the one thing
   * down there that is not grey, catching what little light reaches it.
   */
  const seam: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.IcosahedronGeometry(0.12 + (i % 4) * 0.05, 0);
    g.translate(
      (i % 2 ? -1 : 1) * (W - 0.15),
      0.7 + (i % 5) * 0.42,
      -D - 0.7 + ((i % 3) - 1) * 0.5
    );
    seam.push(g);
  }
  // A lamp left hanging on the first timber set, which is what makes the
  // inside legible at all once you are past the daylight.
  const lamp = new THREE.IcosahedronGeometry(0.17, 0);
  lamp.translate(1.2, 1.9, -4.2);

  return [
    { geo: merge(timber), colour: 0x6f5a42 },
    { geo: merge(dark), colour: 0x15171a },
    { geo: merge(spoil), colour: 0x7e7a70 },
    { geo: merge(metal), colour: 0x6d7378 },
    { geo: merge(seam), colour: 0x7fe3c8, unlit: true },
    { geo: lamp, colour: 0xffcf8a, unlit: true },
  ];
}

/**
 * Windpump. The only landmark that moves, and that is the point — a turning
 * thing visible for miles pulls you across a plain the way nothing static does.
 */
export function windpump(): Layer[] {
  const tower: THREE.BufferGeometry[] = [];
  const blades: THREE.BufferGeometry[] = [];
  const tank: THREE.BufferGeometry[] = [];
  const H = 11.5;
  const corners: [number, number][] = [[-1.3, -1.3], [1.3, -1.3], [1.3, 1.3], [-1.3, 1.3]];

  for (const [sx, sz] of corners) {
    const leg = strut([sx * 1.55, 0, sz * 1.55], [sx * 0.34, H, sz * 0.34], 0.1, 4);
    tower.push(leg);
  }
  for (const y of [2.6, 5.6, 8.6]) {
    const t = 1 - y / (H * 1.32);
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      tower.push(strut([a[0] * t * 1.55, y, a[1] * t * 1.55], [c[0] * t * 1.55, y, c[1] * t * 1.55], 0.06));
      tower.push(strut([a[0] * t * 1.55, y, a[1] * t * 1.55], [c[0] * t * 1.55, y + 2.6, c[1] * t * 1.55], 0.05));
    }
  }

  // The fan, built about the origin so a per-frame Y spin turns it on its own
  // axis. The hub sits forward of the tower top, where the instance puts it.
  const hub = new THREE.CylinderGeometry(0.4, 0.4, 0.5, 8);
  hub.rotateX(Math.PI / 2);
  blades.push(hub);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const vane = box(0.42, 2.5, 0.07);
    vane.rotateZ(a);
    vane.rotateY(0.34);
    vane.translate(Math.sin(a) * -2.1, Math.cos(a) * 2.1, 0);
    blades.push(vane);
  }
  const rim = new THREE.TorusGeometry(3.25, 0.07, 4, 20);
  blades.push(rim);

  // Tail vane, which is what keeps a real one pointed into the wind.
  const tail = box(0.08, 1.7, 2.6);
  tail.translate(0, H + 0.2, 3.3);
  tower.push(tail);
  const boom = box(0.14, 0.14, 3.4);
  boom.translate(0, H + 0.2, 1.8);
  tower.push(boom);

  const body = new THREE.CylinderGeometry(2.2, 2.2, 2.4, 12);
  body.translate(5.5, 1.2, 1.5);
  tank.push(body);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const leg = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 4);
    leg.translate(5.5 + Math.cos(a) * 1.9, 0.3, 1.5 + Math.sin(a) * 1.9);
    tank.push(leg);
  }

  return [
    { geo: merge(tower), colour: 0x767c82 },
    // Hub at the tower top; the spin is applied per frame, not baked in.
    { geo: merge(blades), colour: 0x9aa0a6, spin: 1 },
    { geo: merge(tank), colour: 0x6c7a62 },
  ];
}

/**
 * Sinkhole. Everything else in the world is additive; this is the one thing
 * that reads as absence.
 */
export function sinkhole(): Layer[] {
  const rim: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const R = 13;

  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const s = rock(1.5 + (i % 5) * 0.5, 0.52, i);
    s.translate(Math.cos(a) * R, -0.3 + (i % 3) * 0.35, Math.sin(a) * R);
    rim.push(s);
  }
  // A stack of narrowing discs going down. Terrain is a pure function so there
  // is no hole to cut; what sells it is that the inside is much darker than
  // anything else in the world and gets darker with depth.
  for (let i = 0; i < 5; i++) {
    const d = new THREE.CylinderGeometry(R * (1 - i * 0.12), R * (1 - (i + 1) * 0.12), 3.4, 18, 1, true);
    d.translate(0, -1 - i * 3.3, 0);
    dark.push(d);
  }
  const floor = new THREE.CylinderGeometry(R * 0.42, R * 0.42, 0.3, 18);
  floor.translate(0, -17.5, 0);
  dark.push(floor);

  return [
    { geo: merge(rim), colour: 0x9b9384 },
    { geo: merge(dark), colour: 0x1b1d22, unlit: true },
  ];
}

/** Whale bones on a shore. Unmistakable at distance, and slightly eerie. */
export function bonefield(): Layer[] {
  const bone: THREE.BufferGeometry[] = [];

  // Two rows of ribs, arcing toward each other.
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const h = 5.2 * Math.sin(Math.PI * (0.25 + t * 0.6));
    for (const sx of [-1, 1]) {
      const r = new THREE.CylinderGeometry(0.17, 0.26, h, 5);
      r.translate(0, h / 2, 0);
      r.rotateZ(sx * (0.55 + t * 0.2));
      r.translate(sx * 2.0, 0.2, -9 + i * 2.3);
      bone.push(r);
    }
  }
  // Spine, running the length.
  for (let i = 0; i < 15; i++) {
    const v = rock(0.52 - i * 0.012, 0.8, i);
    v.translate(0, 0.5, -10 + i * 1.5);
    bone.push(v);
  }
  // Skull, which is what makes it legible as an animal and not a wreck.
  const skull = box(2.3, 1.5, 5.0);
  skull.rotateX(0.12);
  skull.translate(0, 0.8, 11.5);
  bone.push(skull);
  for (const sx of [-1, 1]) {
    const jaw = new THREE.CylinderGeometry(0.28, 0.2, 5.6, 5);
    jaw.rotateX(Math.PI / 2);
    jaw.rotateY(sx * 0.14);
    jaw.translate(sx * 1.2, 0.35, 12.4);
    bone.push(jaw);
  }

  return [{ geo: merge(bone), colour: 0xd8d2c0 }];
}

/** An old orchard. Rows read instantly as something somebody planted. */
export function orchard(): Layer[] {
  const bark: THREE.BufferGeometry[] = [];
  const leaf: THREE.BufferGeometry[] = [];
  const wall: THREE.BufferGeometry[] = [];

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 6; col++) {
      // Planted on a grid, grown unevenly — a perfect lattice reads as a game
      // object, and a random scatter loses the only thing that says "planted".
      const jx = Math.sin(row * 7.1 + col * 3.3) * 0.9;
      const jz = Math.cos(row * 4.7 + col * 5.9) * 0.9;
      const x = (col - 2.5) * 6.2 + jx;
      const z = (row - 2) * 6.6 + jz;
      const h = 3.1 + ((row * 6 + col) % 4) * 0.42;

      const trunk = new THREE.CylinderGeometry(0.19, 0.3, h, 5);
      trunk.translate(x, h / 2, z);
      bark.push(trunk);
      const crown = new THREE.IcosahedronGeometry(1.75, 0);
      crown.scale(1, 0.8, 1);
      crown.rotateY(col * 1.3 + row);
      crown.translate(x, h + 1.0, z);
      leaf.push(crown);
    }
  }

  // A dry-stone wall down two sides, half fallen.
  for (let i = 0; i < 22; i++) {
    if (i % 7 === 3) continue;
    const s = rock(0.6, 0.6, i);
    s.translate(-18.5, 0.35 + (i % 2) * 0.45, -16 + i * 1.5);
    wall.push(s);
    const t = rock(0.6, 0.6, i + 3);
    t.translate(-18 + i * 1.7, 0.35 + (i % 3) * 0.4, -16.5);
    wall.push(t);
  }

  return [
    { geo: merge(bark), colour: 0x6b543c },
    { geo: merge(leaf), colour: 0x56703a },
    { geo: merge(wall), colour: 0x8e8b82 },
  ];
}

/** A frozen lake: a flat mirror in a world made of slopes. */
export function frozenLake(): Layer[] {
  const ice: THREE.BufferGeometry[] = [];
  const snow: THREE.BufferGeometry[] = [];
  const R = 34;

  const sheet = new THREE.CylinderGeometry(R, R, 0.5, 26);
  sheet.scale(1, 1, 0.74);
  ice.push(sheet);
  // Pressure ridges, which is the only thing that stops a disc reading as a
  // decal — ice buckles where it refreezes.
  for (let i = 0; i < 7; i++) {
    const a = i * 1.7;
    const ridge = box(R * 1.1, 0.42, 0.7);
    ridge.rotateY(a);
    ridge.translate(Math.cos(a) * 5, 0.3, Math.sin(a) * 4);
    ice.push(ridge);
  }

  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const s = rock(1.5 + (i % 4) * 0.7, 0.42, i);
    s.translate(Math.cos(a) * R * 1.03, 0.1, Math.sin(a) * R * 0.77);
    snow.push(s);
  }

  return [
    { geo: merge(ice), colour: 0xbcd4de },
    { geo: merge(snow), colour: 0xe4e9ec },
  ];
}
