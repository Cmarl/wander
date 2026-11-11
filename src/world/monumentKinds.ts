import * as THREE from "three";
import { box, merge, strut } from "./geom";
import {
  CASTLE, COLOSSUS, LIGHT, LIGHT_TOP, TOWER, TOWER_ROOF, TURBINE,
  padsOf, type MPad, type MonumentKind,
} from "./monuments";

/**
 * What the monuments are made of.
 *
 * Everything you can stand on comes from the pad table in world/monuments —
 * `padGeometry` below turns each pad into the slab, the earth bank or the
 * flight of steps that it is. What is added here by hand is only what you
 * cannot stand on: columns, walls, battlements, a crane.
 */

export interface Part {
  geo: THREE.BufferGeometry;
  colour: number;
  /**
   * "lamp" glows warm after dark, "beacon" is a red light that blinks, "eyes"
   * are cold and steady. None of them is lit until you have woken the place.
   */
  glow?: "lamp" | "beacon" | "eyes";
  /** The castle's flag: not flown until you raise it, and then in your colour. */
  banner?: boolean;
}

/**
 * A block whose top follows a pad's plane.
 *
 * Flat-bottomed for earth and masonry, which go down into the ground, and
 * parallel-bottomed for a slab, which is the same thickness everywhere.
 */
function prism(p: MPad, thick: number, flatBottom: boolean, inset = 0): THREE.BufferGeometry {
  const w = p.halfW - inset;
  const l = p.halfL - inset;
  const sx = p.slopeX ?? 0;
  const sz = p.slopeZ ?? 0;
  const h = (x: number, z: number) => p.top + sx * x + sz * z;
  const low = Math.min(h(-w, -l), h(w, -l), h(-w, l), h(w, l)) - thick;
  const c = [[-w, -l], [w, -l], [w, l], [-w, l]].map(([x, z]) => ({
    x: p.lx + x,
    z: p.lz + z,
    t: h(x, z),
    b: flatBottom ? low : h(x, z) - thick,
  }));
  const v: number[] = [];
  const quad = (a: number[], b: number[], cc: number[], d: number[]) => v.push(...a, ...b, ...cc, ...a, ...cc, ...d);
  const T = c.map((k) => [k.x, k.t, k.z]);
  const B = c.map((k) => [k.x, k.b, k.z]);
  quad(T[0], T[3], T[2], T[1]); // top
  quad(B[0], B[1], B[2], B[3]); // bottom
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(T[i], T[j], B[j], B[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  // merge() wants every part to carry the same attributes as a BoxGeometry.
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((v.length / 3) * 2), 2));
  return g;
}

/**
 * A flight of steps along a sloped pad.
 *
 * Risers come out at about 17 cm whatever the flight, because the count is
 * derived from the rise rather than chosen — a stair sized off a person, which
 * is the standing rule for anything in this game you climb.
 */
function steps(p: MPad): THREE.BufferGeometry[] {
  const alongX = Math.abs(p.slopeX ?? 0) > Math.abs(p.slopeZ ?? 0);
  const slope = alongX ? p.slopeX! : p.slopeZ!;
  const half = alongX ? p.halfW : p.halfL;
  const across = alongX ? p.halfL : p.halfW;
  const rise = Math.abs(slope) * half * 2;
  const n = Math.max(2, Math.round(rise / 0.17));
  const tread = (half * 2) / n;
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const at = -half + (i + 0.5) * tread;
    const top = p.top + slope * at + rise / n / 2;
    const g = alongX ? box(tread, 0.36, across * 2) : box(across * 2, 0.36, tread);
    g.translate(p.lx + (alongX ? at : 0), top - 0.18, p.lz + (alongX ? 0 : at));
    out.push(g);
  }
  return out;
}

/** Everything in a kind's pad table that has a `draw`, grouped by material. */
function padParts(kind: MonumentKind, colours: { slab: number; stair: number; earth: number; stone: number }): Part[] {
  const groups: Record<string, THREE.BufferGeometry[]> = { slab: [], stair: [], earth: [], stone: [] };
  for (const p of padsOf(kind)) {
    if (!p.draw) continue;
    if (p.draw === "stair") groups.stair.push(...steps(p));
    else if (p.draw === "slab" || p.draw === "plank") groups.slab.push(prism(p, p.thick ?? 0.3, false));
    else if (p.draw === "earth") groups.earth.push(prism(p, 5, true));
    else groups.stone.push(prism(p, p.thick ?? 6, true));
  }
  const out: Part[] = [];
  for (const k of ["slab", "stair", "earth", "stone"] as const) {
    if (groups[k].length) out.push({ geo: merge(groups[k]), colour: colours[k] });
  }
  return out;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
  g.translate(x, y, z);
  return g;
};

/** Battlements along a line: a low wall with teeth. */
function crenels(x0: number, z0: number, x1: number, z1: number, y: number, out: THREE.BufferGeometry[]) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const wall = alongX ? box(len, 1.0, 0.6) : box(0.6, 1.0, len);
  out.push(at(wall, (x0 + x1) / 2, y + 0.5, (z0 + z1) / 2));
  const n = Math.max(1, Math.floor(len / 2.8));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const m = alongX ? box(1.4, 0.9, 0.6) : box(0.6, 0.9, 1.4);
    out.push(at(m, x0 + (x1 - x0) * t, y + 1.45, z0 + (z1 - z0) * t));
  }
}

// --- tower -------------------------------------------------------------------

function tower(): Part[] {
  const T = TOWER;
  const parts = padParts("tower", { slab: 0xb7b3a9, stair: 0x98958c, earth: 0x77705f, stone: 0xa39f93 });
  const frame: THREE.BufferGeometry[] = [];
  const H = TOWER_ROOF;
  for (let i = -2; i <= 2; i++) {
    for (const s of [-1, 1]) {
      frame.push(at(box(1.0, H, 1.0), i * 6.5, H / 2, s * T.half));
      if (Math.abs(i) < 2) frame.push(at(box(1.0, H, 1.0), s * T.half, H / 2, i * 6.5));
    }
  }
  // The core walls, carried a little above the roof like a stair head.
  const coreH = H + 3.2;
  const coreL = T.wellE - T.wellW + 1.1;
  const coreX = (T.wellW + T.wellE + 1.1) / 2;
  for (const s of [-1, 1]) frame.push(at(box(coreL, coreH, 0.5), coreX, coreH / 2, s * (T.wellHalf + 0.5)));
  frame.push(at(box(0.5, coreH, T.wellHalf * 2 + 1.5), T.wellE + 0.6, coreH / 2, 0));
  parts.push({ geo: merge(frame), colour: 0xa6a299 });

  // Cladding got as far as the twenty-second floor.
  const clad: THREE.BufferGeometry[] = [];
  for (let f = 1; f <= 22; f++) {
    const y = T.plinth + f * T.storey + 0.55;
    // Whoever was fitting it stopped part way round the last few floors.
    const sides = f < 18 ? 4 : f < 21 ? 3 : 1;
    if (sides > 0) clad.push(at(box(T.half * 2, 1.1, 0.22), 0, y, T.half + 0.4));
    if (sides > 1) clad.push(at(box(0.22, 1.1, T.half * 2), T.half + 0.4, y, 0));
    if (sides > 2) clad.push(at(box(T.half * 2, 1.1, 0.22), 0, y, -T.half - 0.4));
    if (sides > 3) clad.push(at(box(0.22, 1.1, T.half * 2), -T.half - 0.4, y, 0));
  }
  parts.push({ geo: merge(clad), colour: 0x5f7f8f });

  // Starter bars standing out of the roof columns, for the floor never poured.
  const rust: THREE.BufferGeometry[] = [];
  for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) {
    for (const [ox, oz] of [[-0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]) {
      rust.push(at(box(0.07, 2.6, 0.07), i * 6.5 + ox, H + 1.3, s * T.half + oz));
    }
  }
  parts.push({ geo: merge(rust), colour: 0x7d4a2f });

  // The crane that was going to finish the job.
  const crane: THREE.BufferGeometry[] = [];
  const cx = -8, cz = 8, mastH = 36;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    crane.push(strut([cx + sx, H, cz + sz], [cx + sx, H + mastH, cz + sz], 0.16));
  }
  for (let y = 0; y < mastH; y += 4) {
    crane.push(strut([cx - 1, H + y, cz - 1], [cx + 1, H + y + 4, cz - 1], 0.08));
    crane.push(strut([cx + 1, H + y, cz + 1], [cx - 1, H + y + 4, cz + 1], 0.08));
    crane.push(strut([cx + 1, H + y, cz - 1], [cx + 1, H + y + 4, cz + 1], 0.08));
    crane.push(strut([cx - 1, H + y, cz + 1], [cx - 1, H + y + 4, cz - 1], 0.08));
  }
  const top = H + mastH;
  // Jib one way, counter-jib the other, a tie from the tower head to each.
  crane.push(at(box(52, 0.5, 0.7), cx + 26, top, cz));
  crane.push(at(box(52, 0.12, 0.12), cx + 26, top + 1.4, cz));
  for (let x = 0; x < 52; x += 4) crane.push(strut([cx + x, top, cz], [cx + x + 2, top + 1.4, cz], 0.07));
  crane.push(at(box(16, 0.6, 1.2), cx - 8, top, cz));
  crane.push(at(box(4, 2.6, 2.2), cx - 13, top - 1.2, cz));
  crane.push(at(box(1.2, 7, 1.2), cx, top + 3.5, cz));
  crane.push(strut([cx, top + 7, cz], [cx + 50, top + 0.4, cz], 0.07));
  crane.push(strut([cx, top + 7, cz], [cx - 15, top + 0.4, cz], 0.07));
  crane.push(at(box(2.2, 2.0, 2.0), cx + 1.8, top - 1.4, cz + 1.4));
  // The hook, still hanging where the last lift left it.
  crane.push(at(box(0.08, 24, 0.08), cx + 38, top - 12, cz));
  crane.push(at(box(0.9, 1.1, 0.5), cx + 38, top - 24.5, cz));
  parts.push({ geo: merge(crane), colour: 0xd49b1e });
  parts.push({ geo: at(box(0.9, 0.9, 0.9), cx, top + 7.5, cz), colour: 0xff3a2a, glow: "beacon" });
  return parts;
}

// --- castle ------------------------------------------------------------------

function castle(): Part[] {
  const C = CASTLE;
  const parts = padParts("castle", { slab: 0x8a8375, stair: 0x8a8375, earth: 0x77705f, stone: 0x9a9280 });
  const stone: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const slate: THREE.BufferGeometry[] = [];
  const DEEP = 12;
  const wallH = C.wallTop + DEEP;
  const wy = C.wallTop - wallH / 2;
  const full = C.wall * 2 + C.thick;
  // Three whole walls, and the fourth in two halves either side of the gate.
  stone.push(at(box(full, wallH, C.thick), 0, wy, -C.wall));
  stone.push(at(box(C.thick, wallH, full), C.wall, wy, 0));
  stone.push(at(box(C.thick, wallH, full), -C.wall, wy, 0));
  const half = (full / 2 - C.gate) / 2;
  for (const s of [-1, 1]) stone.push(at(box(half * 2, wallH, C.thick), s * (C.gate + half), wy, C.wall));
  // Over the gate: the arch, and the passage dark beneath it.
  const lintel = C.wallTop - 5.6;
  stone.push(at(box(C.gate * 2, lintel, C.thick), 0, C.wallTop - lintel / 2, C.wall));
  // Gate towers standing proud of the wall either side.
  for (const s of [-1, 1]) {
    stone.push(at(box(4.4, C.wallTop + 5 + DEEP, 5.4), s * (C.gate + 2.4), (C.wallTop + 5 - DEEP) / 2, C.wall + 1.4));
    crenels(s * (C.gate + 2.4) - 2.2, C.wall + 4.1, s * (C.gate + 2.4) + 2.2, C.wall + 4.1, C.wallTop + 5, stone);
  }
  // Battlements on the outer edge of every wall walk.
  const e = C.wall + C.thick / 2 - 0.3;
  const b = C.wall - C.bastion;
  crenels(-b, -e, b, -e, C.wallTop, stone);
  crenels(-b, e, -C.gate - 4.6, e, C.wallTop, stone);
  crenels(C.gate + 4.6, e, b, e, C.wallTop, stone);
  crenels(e, -b, e, b, C.wallTop, stone);
  crenels(-e, -b, -e, b, C.wallTop, stone);

  for (const s of [-1, 1]) for (const u of [-1, 1]) {
    const bx = s * C.wall, bz = u * C.wall, B = C.bastion;
    stone.push(at(box(B * 2, wallH, B * 2), bx, wy, bz));
    crenels(bx - B, bz + u * (B - 0.3), bx + B, bz + u * (B - 0.3), C.wallTop, stone);
    crenels(bx + s * (B - 0.3), bz - B, bx + s * (B - 0.3), bz + B, C.wallTop, stone);
    // A round turret on each, under a slate cap.
    stone.push(at(new THREE.CylinderGeometry(2.6, 2.9, 8, 9), bx, C.wallTop + 4, bz));
    slate.push(at(new THREE.ConeGeometry(3.4, 5, 9), bx, C.wallTop + 10.5, bz));
    dark.push(at(box(0.5, 1.6, 0.5), bx + s * 2.7, C.wallTop + 5, bz));
  }

  // The keep.
  const K = C.keepHalf, kz = C.keepZ, kt = C.keepTop;
  stone.push(at(box(K * 2, kt + DEEP, K * 2), 0, (kt - DEEP) / 2, kz));
  crenels(-K, kz - K + 0.3, K, kz - K + 0.3, kt, stone);
  crenels(-K, kz + K - 0.3, K, kz + K - 0.3, kt, stone);
  crenels(K - 0.3, kz - K, K - 0.3, kz + K, kt, stone);
  // The west side is left open where the stair arrives.
  // A corner turret on the roof with the flag on it.
  stone.push(at(new THREE.CylinderGeometry(2.2, 2.2, 6, 8), K - 2.6, kt + 3, kz - K + 2.6));
  slate.push(at(new THREE.ConeGeometry(2.9, 4.4, 8), K - 2.6, kt + 8.2, kz - K + 2.6));
  dark.push(at(box(0.16, 9, 0.16), K - 2.6, kt + 14.5, kz - K + 2.6));
  // The door, and the buttresses that make a tall box read as a building.
  dark.push(at(box(2.2, 3.4, 0.4), 0, 1.7, kz + K + 0.1));
  for (const s of [-1, 1]) for (const u of [-1, 1]) {
    stone.push(at(box(1.6, kt * 0.7, 1.6), s * (K - 0.4), kt * 0.35, kz + u * (K - 0.4)));
  }
  // A well in the yard, and somewhere there used to be a stable.
  stone.push(at(new THREE.CylinderGeometry(1.5, 1.5, 1.1, 10), 14, 0.55, 14));
  dark.push(at(new THREE.CylinderGeometry(1.1, 1.1, 1.14, 10), 14, 0.56, 14));
  for (const x of [18, 22, 26]) dark.push(at(box(0.3, 3.2, 0.3), x, 1.6, -22));
  dark.push(at(box(9, 0.25, 4.6), 22, 3.3, -24.2));

  parts.push({ geo: merge(stone), colour: 0x938b7b });
  parts.push({ geo: merge(dark), colour: 0x3b3833 });
  parts.push({ geo: merge(slate), colour: 0x49525e });

  // Windows. Dark slits by day, and after dark somebody is home.
  const win: THREE.BufferGeometry[] = [];
  for (const y of [9, 15, 21]) {
    for (const x of [-4, 0, 4]) {
      win.push(at(box(0.7, 1.9, 0.3), x, y, kz + K + 0.05));
      win.push(at(box(0.7, 1.9, 0.3), x, y, kz - K - 0.05));
      win.push(at(box(0.3, 1.9, 0.7), K + 0.05, y, kz + x));
    }
  }
  parts.push({ geo: merge(win), colour: 0x23242a, glow: "lamp" });
  // The banner.
  parts.push({ geo: at(box(3.6, 2.2, 0.08), K - 0.7, kt + 17.6, kz - K + 2.6), colour: 0xa83a2c, banner: true });
  return parts;
}

// --- lighthouse --------------------------------------------------------------

function lighthouse(): Part[] {
  const L = LIGHT;
  const parts = padParts("lighthouse", { slab: 0x3c4148, stair: 0x4a5058, earth: 0x77705f, stone: 0x8d8a82 });
  const H = LIGHT_TOP;
  const white: THREE.BufferGeometry[] = [];
  const red: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  // The shaft, in bands, so it reads as a lighthouse from ten kilometres.
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const g = at(box(L.half * 2, H / bands, L.half * 2), 0, (i + 0.5) * (H / bands), 0);
    (i % 2 ? red : white).push(g);
  }
  // A handrail down the outside of every flight.
  const c = L.half + L.lane - 0.08;
  for (let i = 0; i < L.flights; i++) {
    const side = i % 4;
    const y0 = i * L.rise + 1.05;
    const y1 = y0 + L.rise;
    const a = -L.half, bb = L.half;
    const ends: [number, number, number][][] = [
      [[a, y0, -c], [bb, y1, -c]],
      [[c, y0, a], [c, y1, bb]],
      [[bb, y0, c], [a, y1, c]],
      [[-c, y0, bb], [-c, y1, a]],
    ];
    const [p, q] = ends[side];
    iron.push(strut(p, q, 0.05));
    for (const t of [0, 0.5, 1]) {
      const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t;
      iron.push(at(box(0.07, 1.05, 0.07), x, y - 0.52, z));
    }
  }
  // The gallery rail.
  const G = L.gallery - 0.1;
  for (const [x0, z0, x1, z1] of [[-G, -G, G, -G], [G, -G, G, G], [G, G, -G, G], [-G, G, -G, -G]]) {
    iron.push(strut([x0, H + 1.05, z0], [x1, H + 1.05, z1], 0.05));
    iron.push(strut([x0, H + 0.55, z0], [x1, H + 0.55, z1], 0.035));
    for (let t = 0; t <= 1.001; t += 0.125) {
      iron.push(at(box(0.07, 1.05, 0.07), x0 + (x1 - x0) * t, H + 0.52, z0 + (z1 - z0) * t));
    }
  }
  // Brackets under the gallery, which is most of what a gallery looks like.
  for (const s of [-1, 1]) for (const u of [-1, 1]) {
    iron.push(strut([s * L.half, H - 4, u * L.half], [s * G, H - 0.2, u * G], 0.14));
  }
  // The lamp room: a cage of glazing bars under a cap.
  white.push(at(new THREE.CylinderGeometry(2.9, 2.9, 1.2, 10), 0, H + 0.6, 0));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    iron.push(at(box(0.12, 3.6, 0.12), Math.cos(a) * 2.75, H + 3.0, Math.sin(a) * 2.75));
  }
  iron.push(at(new THREE.CylinderGeometry(2.95, 2.95, 0.25, 10), 0, H + 4.9, 0));
  red.push(at(new THREE.ConeGeometry(3.3, 2.6, 10), 0, H + 6.3, 0));
  iron.push(at(box(0.12, 2.2, 0.12), 0, H + 8.4, 0));
  // A door at the foot, facing the stair.
  iron.push(at(box(1.5, 2.3, 0.2), 0, 1.15, -L.half - 0.05));

  parts.push({ geo: merge(white), colour: 0xe6e1d6 });
  parts.push({ geo: merge(red), colour: 0xb03a2e });
  parts.push({ geo: merge(iron), colour: 0x343a41 });
  parts.push({ geo: at(new THREE.IcosahedronGeometry(1.25, 1), 0, H + L.lamp - 2.2, 0), colour: 0x8c8a78, glow: "lamp" });
  return parts;
}

// --- wind turbine ------------------------------------------------------------

/** One turbine's tower and nacelle, standing at the origin, hub on +z. */
export function turbineTower(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(new THREE.CylinderGeometry(1.5, 2.6, TURBINE.hub, 12), 0, TURBINE.hub / 2, 0));
  parts.push(at(box(4.2, 4.2, 11), 0, TURBINE.hub + 1.2, 0.5));
  parts.push(at(new THREE.CylinderGeometry(3.4, 3.4, 0.5, 12), 0, 0.25, 0));
  return merge(parts);
}

/** Three blades and a hub, turning about z, centred on the hub. */
export function turbineRotor(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.ConeGeometry(1.9, 4, 10);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.CylinderGeometry(0.35, 1.7, TURBINE.blade, 5);
    blade.scale(1, 1, 0.22);
    blade.translate(0, TURBINE.blade / 2 + 0.6, 0);
    blade.rotateZ((i / 3) * Math.PI * 2);
    parts.push(blade);
  }
  return merge(parts);
}

// --- colossus ----------------------------------------------------------------

function colossus(): Part[] {
  const stone: THREE.BufferGeometry[] = [];
  const moss: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const tilt = (g: THREE.BufferGeometry, rx: number, rz: number) => {
    g.rotateX(rx);
    g.rotateZ(rz);
    return g;
  };
  // Buried to the ribs. Whatever it is standing on is a long way down.
  stone.push(at(box(20, 34, 11), 0, 13, 0));
  stone.push(at(box(13, 8, 11.6), 0, 21, 0.3));
  stone.push(at(box(29, 6.5, 12.5), 0, 30, 0));
  stone.push(at(box(6.5, 4.5, 6.5), 0, 35, 0.6));
  // The head, turned a little and tipped back to look at something.
  const head = tilt(box(10.5, 11.5, 10.5), -0.16, 0.07);
  stone.push(at(head, 0.4, 42.5, 1.2));
  const brow = tilt(box(11.1, 1.6, 2.2), -0.16, 0.07);
  stone.push(at(brow, 0.4, 45, 6.3));
  const nose = tilt(box(1.9, 4.2, 1.8), -0.16, 0.07);
  stone.push(at(nose, 0.4, 42.2, 6.9));
  const eyes: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const eye = tilt(box(2.3, 1.3, 0.8), -0.16, 0.07);
    eyes.push(at(eye, 0.4 + s * 2.6, 43.4, 6.4));
  }
  const mouth = tilt(box(4.6, 0.7, 0.8), -0.16, 0.07);
  dark.push(at(mouth, 0.4, 39.2, 6.0));

  // The right arm raised, fist against the sky.
  const upper = box(6.4, 17, 6.4);
  upper.rotateZ(0.5);
  stone.push(at(upper, -18.5, 36, 0));
  const fore = box(5.4, 16, 5.4);
  fore.rotateZ(0.12);
  stone.push(at(fore, -23.6, 50.5, 0));
  stone.push(at(box(7, 7, 7), -24.6, COLOSSUS.height - 3.5, 0));
  // The left one broke off at the shoulder a long time ago.
  const stump = box(6.4, 8, 6.4);
  stump.rotateZ(-0.7);
  stone.push(at(stump, 16.5, 27, 0));
  // And lies where it fell: forearm, palm, and fingers you can walk up.
  stone.push(at(box(5.6, 5.2, 19), 30, 2.2, 29));
  stone.push(at(box(10, 4.4, 11), 30, 1.2, 14));
  for (let i = 0; i < 4; i++) {
    stone.push(prism({ lx: 26.4 + i * 2.4, lz: 4.5, halfW: 1.05, halfL: 4, top: 1.7, slopeZ: 3.4 / 8 }, 2.4, true));
  }
  const thumb = box(2.2, 2.4, 6);
  thumb.rotateY(0.5);
  stone.push(at(thumb, 36.2, 2.0, 11));

  // Moss on everything that faces the rain, and two trees that took root.
  moss.push(at(box(29.4, 0.5, 12.9), 0, 33.3, 0));
  moss.push(at(tilt(box(10.9, 0.5, 10.9), -0.16, 0.07), 0.4, 48.3, 0.3));
  moss.push(at(box(10.2, 0.4, 11.2), 30, 3.5, 14));
  for (const [x, z, h] of [[9, -2, 5.5], [-6, 2.5, 4.2]]) {
    dark.push(at(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 5), x, 34.2, z));
    moss.push(at(new THREE.ConeGeometry(1.5, h, 7), x, 35 + h / 2, z));
  }
  return [
    { geo: merge(stone), colour: 0x8c897f },
    { geo: merge(moss), colour: 0x5f7046 },
    { geo: merge(dark), colour: 0x34332f },
    { geo: merge(eyes), colour: 0x1d1e20, glow: "eyes" },
  ];
}

const built = new Map<MonumentKind, Part[]>();
/** Built once per kind and shared: there is only ever one of each in sight. */
export function monumentParts(kind: MonumentKind): Part[] {
  let p = built.get(kind);
  if (!p) {
    p = kind === "tower" ? tower() : kind === "castle" ? castle() : kind === "lighthouse" ? lighthouse() : kind === "colossus" ? colossus() : [];
    built.set(kind, p);
  }
  return p;
}
