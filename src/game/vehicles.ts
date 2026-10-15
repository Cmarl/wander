import * as THREE from "three";
import { box, mat, makeVehicle, type Vehicle } from "./models";

/**
 * Ways to get around.
 *
 * The truck was hard-coded into the player, physics constants and all. Each
 * class now carries its own numbers, so a motorcycle is not a truck with a
 * different mesh — it accelerates harder, turns tighter, struggles on a climb
 * and has a much smaller footprint to squeeze between trees.
 *
 * None of them are better. A rover is slow and a bike is fragile on rough
 * ground, and which one you want depends on where you are going, which is the
 * only kind of choice this game is interested in. Nothing is a tier.
 */

export type VehicleClass = "truck" | "bike" | "rover";

export interface VehicleSpec {
  cls: VehicleClass;
  label: string;
  /** Flat-out speed, m/s. */
  top: number;
  accel: number;
  brake: number;
  /** Steady state is accel/drag, which must clear `top` or it feels capped. */
  drag: number;
  reverse: number;
  jump: number;
  /**
   * How hard a slope pulls it back. Lower climbs better — this is what makes
   * a rover worth taking up a mountain and a bike miserable on one.
   */
  gradePull: number;
  /** Steering authority at a standstill. */
  turn: number;
  /** Collision circles along the spine. */
  bodyR: number;
  bodyOffset: number;
  /** Where the driver sits, and where a dog sits beside them. */
  seat: [number, number, number];
  dogSeat: [number, number, number];
}

export const SPECS: Record<VehicleClass, VehicleSpec> = {
  truck: {
    cls: "truck", label: "Truck",
    top: 48, accel: 27, brake: 30, drag: 0.5, reverse: 13,
    jump: 10.5, gradePull: 9.0, turn: 1.6,
    bodyR: 1.15, bodyOffset: 1.25,
    seat: [-0.42, 1.52, 0.25], dogSeat: [0.62, 0.82, -0.15],
  },
  bike: {
    cls: "bike", label: "Motorcycle",
    // Quickest thing in the world and the worst at hills, which is the trade.
    top: 62, accel: 40, brake: 26, drag: 0.58, reverse: 6,
    jump: 12, gradePull: 11.5, turn: 2.3,
    bodyR: 0.5, bodyOffset: 0.7,
    seat: [0, 1.22, -0.1], dogSeat: [0, 1.0, -0.62],
  },
  rover: {
    cls: "rover", label: "Rover",
    // Slow, but a slope barely notices it.
    top: 33, accel: 24, brake: 34, drag: 0.62, reverse: 11,
    jump: 9, gradePull: 5.2, turn: 1.9,
    bodyR: 0.95, bodyOffset: 1.0,
    seat: [-0.38, 1.44, 0.1], dogSeat: [0.52, 0.86, -0.3],
  },
};

export const CLASSES = Object.keys(SPECS) as VehicleClass[];

const wheel = (r: number, w: number, m: THREE.Material) => {
  const g = new THREE.CylinderGeometry(r, r, w, 12);
  g.rotateZ(Math.PI / 2);
  return new THREE.Mesh(g, m);
};

/**
 * A motorcycle.
 *
 * No panels to speak of, so `dent` leans the bars instead of knocking a wing
 * out of true — a bike that has been dropped sits crooked, which is the same
 * idea expressed in the only way this shape can express it.
 */
function makeBike(paint: number): Vehicle {
  const body = mat(paint);
  const dark = mat(0x23262b);
  const chrome = mat(0x8e949b);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });

  const root = new THREE.Group();

  const frame = box(0.24, 0.3, 1.5, body);
  frame.position.set(0, 0.72, 0);
  root.add(frame);
  const tank = box(0.38, 0.32, 0.66, body);
  tank.position.set(0, 0.95, 0.12);
  root.add(tank);
  const seat = box(0.3, 0.14, 0.66, dark);
  seat.position.set(0, 0.98, -0.52);
  root.add(seat);
  const engine = box(0.42, 0.34, 0.5, dark);
  engine.position.set(0, 0.62, 0.02);
  root.add(engine);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 6), chrome);
  pipe.rotation.x = Math.PI / 2 - 0.12;
  pipe.position.set(0.19, 0.46, -0.45);
  root.add(pipe);

  // Front end, which is the part that steers.
  const fork = new THREE.Group();
  fork.position.set(0, 0.86, 0.78);
  for (const sx of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.86, 6), chrome);
    leg.rotation.x = 0.28;
    leg.position.set(sx, -0.2, 0.06);
    fork.add(leg);
  }
  const bars = box(0.76, 0.055, 0.055, dark);
  bars.position.set(0, 0.2, -0.02);
  fork.add(bars);
  const light = box(0.2, 0.2, 0.1, lamp);
  light.position.set(0, 0.08, 0.14);
  fork.add(light);
  const front = wheel(0.38, 0.14, dark);
  front.position.set(0, -0.48, 0.2);
  fork.add(front);
  root.add(fork);

  const rear = wheel(0.4, 0.18, dark);
  rear.position.set(0, 0.4, -0.72);
  root.add(rear);

  const paintable = [frame, tank];
  let lean = 0;

  return {
    root,
    animate(_dt, speed, steer) {
      front.rotation.x -= (speed / 0.38) * 0.016;
      rear.rotation.x -= (speed / 0.4) * 0.016;
      fork.rotation.y = steer * 0.5;
      // Counter-steer lean, which is most of why a bike reads as a bike.
      root.rotation.z = -steer * Math.min(1, Math.abs(speed) / 18) * 0.42 + lean;
    },
    setPaint(hex) {
      for (const m of paintable) (m.material as THREE.MeshLambertMaterial).color.setHex(hex);
    },
    dent(force) {
      lean += Math.min(0.1, force * 0.012) * (Math.random() < 0.5 ? 1 : -1);
      lean = THREE.MathUtils.clamp(lean, -0.2, 0.2);
    },
    setLights(on) {
      (light.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xfff0c0 : 0x5a5346);
    },
  };
}

/** A rover: short, wide, caged, and happiest pointing uphill. */
function makeRover(paint: number): Vehicle {
  const body = mat(paint);
  const dark = mat(0x26292e);
  const cage = mat(0x4a4e55);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });

  const root = new THREE.Group();

  const tub = box(1.8, 0.56, 2.9, body);
  tub.position.y = 0.86;
  root.add(tub);
  const nose = box(1.7, 0.34, 0.7, body);
  nose.position.set(0, 1.08, 1.5);
  root.add(nose);
  const seats = box(1.5, 0.4, 0.8, dark);
  seats.position.set(0, 1.22, -0.1);
  root.add(seats);

  // Roll cage. On an open vehicle it is the silhouette.
  for (const sx of [-0.84, 0.84]) {
    for (const sz of [0.5, -1.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), cage);
      post.position.set(sx, 1.65, sz);
      root.add(post);
    }
    const rail = box(0.07, 0.07, 1.8, cage);
    rail.position.set(sx, 2.18, -0.35);
    root.add(rail);
  }
  for (const sz of [0.5, -1.2]) {
    const hoop = box(1.76, 0.07, 0.07, cage);
    hoop.position.set(0, 2.18, sz);
    root.add(hoop);
  }
  const bar = box(1.3, 0.12, 0.12, cage);
  bar.position.set(0, 2.3, 0.45);
  root.add(bar);
  const lamps: THREE.Mesh[] = [];
  for (const sx of [-0.42, 0.42]) {
    const l = box(0.26, 0.2, 0.12, lamp);
    l.position.set(sx, 2.3, 0.56);
    root.add(l);
    lamps.push(l);
  }

  // Big soft tyres, which is the other half of climbing anything.
  const fronts: THREE.Mesh[] = [];
  const all: THREE.Mesh[] = [];
  for (const sx of [-1.0, 1.0]) {
    for (const sz of [1.08, -1.08]) {
      const w = wheel(0.55, 0.38, dark);
      w.position.set(sx, 0.55, sz);
      root.add(w);
      all.push(w);
      if (sz > 0) fronts.push(w);
    }
  }

  const paintable = [tub, nose];
  return {
    root,
    animate(_dt, speed, steer) {
      for (const w of all) w.rotation.x -= (speed / 0.55) * 0.016;
      for (const w of fronts) w.rotation.y = steer * 0.45;
    },
    setPaint(hex) {
      for (const m of paintable) (m.material as THREE.MeshLambertMaterial).color.setHex(hex);
    },
    dent(force) {
      const t = paintable[Math.floor(Math.random() * paintable.length)];
      t.scale.y = Math.max(0.82, t.scale.y - Math.min(0.05, force * 0.006));
    },
    setLights(on) {
      for (const l of lamps) (l.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xfff0c0 : 0x5a5346);
    },
  };
}

export function makeFor(cls: VehicleClass, paint: number): Vehicle {
  if (cls === "bike") return makeBike(paint);
  if (cls === "rover") return makeRover(paint);
  return makeVehicle(paint);
}
