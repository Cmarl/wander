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

export type VehicleClass = "truck" | "bike" | "rover" | "chopper" | "plane";

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
  /**
   * How fast steering authority falls off with speed.
   *
   * Tuned for wheels, where going faster must make the steering calmer or the
   * truck is undrivable. An aircraft is the opposite: it turns BETTER with
   * airspeed, and the wheeled value throttled the plane to a crawl of a turn
   * at cruise. Lower means speed costs you less.
   */
  turnFalloff?: number;
  /** How quickly the climb/descend command takes effect. Higher is snappier. */
  pitchRate?: number;
  /** Collision circles along the spine. */
  bodyR: number;
  bodyOffset: number;
  /** Where the driver sits, and where a dog sits beside them. */
  seat: [number, number, number];
  dogSeat: [number, number, number];
  /**
   * Flight.
   *
   * `lift` is the climb rate while you hold the jump input and `sink` is how
   * fast it comes down when you don't. There is no stall and no crash: a plane
   * that slows down sinks faster, and touching the ground is a landing at any
   * speed. A landing that can fail would be a fail state, and this game has
   * none of those.
   */
  flies?: boolean;
  lift?: number;
  sink?: number;
  /** Plane only: how much of the sink rate airspeed cancels. */
  wing?: number;
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
  chopper: {
    cls: "chopper", label: "Helicopter",
    // Unhurried, and it can stop in mid-air, which nothing else can.
    top: 42, accel: 16, brake: 18, drag: 0.42, reverse: 9,
    jump: 0, gradePull: 0, turn: 2.0,
    bodyR: 1.1, bodyOffset: 1.3,
    seat: [-0.44, 1.46, 0.3], dogSeat: [0.58, 1.3, 0.0],
    flies: true, lift: 11, sink: 6,
  },
  plane: {
    cls: "plane", label: "Aeroplane",
    /**
     * Clyde, after the controls fix: "sick - plane much better. should climb
     * and fall faster. plane should overall be much faster and manuever
     * faster too."
     *
     * So: half again the top speed, twice the climb, and a turn that does not
     * evaporate with airspeed. Fast is fine; twitchy is not, which is why the
     * steering input is still eased into — the response got quicker, not
     * jumpier.
     */
    top: 150, accel: 44, brake: 16, drag: 0.24, reverse: 4,
    jump: 0, gradePull: 2.4, turn: 2.2, turnFalloff: 0.01, pitchRate: 3.4,
    bodyR: 1.2, bodyOffset: 1.6,
    seat: [0, 1.5, 0.5], dogSeat: [0, 1.4, -0.3],
    flies: true, lift: 26, sink: 15, wing: 0.9,
  },
};

export const CLASSES = Object.keys(SPECS) as VehicleClass[];

/**
 * Which way a turn leans.
 *
 * Clyde: "the steering is maybe backwards" in the plane. The heading is right
 * — the machine goes where you point it — but the BANK was inverted, and a
 * roll that disagrees with the turn is read by the eye as the turn itself
 * being wrong.
 *
 * Working it through: steer > 0 decreases heading, forward is (sin h, cos h),
 * so decreasing heading swings forward toward -x, which is left. A left turn
 * leans left: the right wing comes up, and rotating about +z carries +x
 * toward +y, so a left lean is POSITIVE z. The code had it negated.
 */
const bank = (steer: number, speed: number, at: number, amount: number) =>
  steer * Math.min(1, Math.abs(speed) / at) * amount;

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
      root.rotation.z = bank(steer, speed, 18, 0.42) + lean;
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

/** A helicopter. The rotor is the whole silhouette and it never stops. */
function makeChopper(paint: number): Vehicle {
  const body = mat(paint);
  const dark = mat(0x26292e);
  const metal = mat(0x7a8088);
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fc0cc, flatShading: true });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });

  const root = new THREE.Group();

  const pod = box(1.7, 1.5, 2.6, body);
  pod.position.set(0, 1.5, 0.3);
  root.add(pod);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.82, 10, 7), glass);
  nose.scale.set(1, 0.9, 0.85);
  nose.position.set(0, 1.5, 1.6);
  root.add(nose);

  const boom = box(0.3, 0.3, 3.4, body);
  boom.position.set(0, 1.74, -2.4);
  root.add(boom);
  const fin = box(0.12, 1.0, 0.6, body);
  fin.position.set(0, 2.3, -3.9);
  root.add(fin);

  // Skids, so it reads as something that sets down rather than parks.
  for (const sx of [-0.85, 0.85]) {
    const skid = box(0.1, 0.1, 2.6, metal);
    skid.position.set(sx, 0.12, 0.3);
    root.add(skid);
    for (const sz of [0.9, -0.5]) {
      const strut = box(0.08, 0.72, 0.08, metal);
      strut.position.set(sx, 0.5, sz);
      root.add(strut);
    }
  }

  const mast = box(0.18, 0.5, 0.18, metal);
  mast.position.set(0, 2.45, 0.3);
  root.add(mast);
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.72, 0.3);
  for (let i = 0; i < 4; i++) {
    const blade = box(0.2, 0.045, 8.2, dark);
    blade.rotation.y = (i / 4) * Math.PI * 2;
    rotor.add(blade);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 8), metal);
  rotor.add(hub);
  root.add(rotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.2, 2.3, -4.0);
  for (let i = 0; i < 3; i++) {
    const blade = box(0.04, 1.5, 0.14, dark);
    blade.rotation.z = (i / 3) * Math.PI * 2;
    tailRotor.add(blade);
  }
  root.add(tailRotor);

  const light = box(0.2, 0.16, 0.1, lamp);
  light.position.set(0, 0.95, 1.7);
  root.add(light);

  const paintable = [pod, boom, fin];
  return {
    root,
    animate(dt, speed, steer) {
      // Always turning. A helicopter with a still rotor is a helicopter that
      // has fallen out of the sky, which is not a state this game has.
      rotor.rotation.y += dt * 26;
      tailRotor.rotation.x += dt * 38;
      // Nose down as it moves off, and bank into the turn.
      root.rotation.x = Math.min(0.16, Math.abs(speed) / 42 * 0.16);
      root.rotation.z = bank(steer, speed, 20, 0.3);
    },
    setPaint(hex) {
      for (const m of paintable) (m.material as THREE.MeshLambertMaterial).color.setHex(hex);
    },
    dent(force) {
      const t = paintable[Math.floor(Math.random() * paintable.length)];
      t.scale.y = Math.max(0.86, t.scale.y - Math.min(0.04, force * 0.005));
    },
    setLights(on) {
      (light.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xfff0c0 : 0x5a5346);
    },
  };
}

/** A high-wing light aircraft — the kind that can land on a field. */
function makePlane(paint: number): Vehicle {
  const body = mat(paint);
  const dark = mat(0x26292e);
  const metal = mat(0x7a8088);
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fc0cc, flatShading: true });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });

  const root = new THREE.Group();

  const fuselage = box(1.1, 1.2, 5.6, body);
  fuselage.position.set(0, 1.5, 0);
  root.add(fuselage);
  const canopy = box(1.0, 0.6, 1.6, glass);
  canopy.position.set(0, 2.2, 0.6);
  root.add(canopy);
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.9, 10), body);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, 1.55, 3.1);
  root.add(cowl);

  // High wing with struts, which is what lets one of these use a meadow.
  const wing = box(11.5, 0.18, 1.75, body);
  wing.position.set(0, 2.5, 0.5);
  root.add(wing);
  for (const sx of [-1, 1]) {
    const strut = box(0.08, 1.1, 0.1, metal);
    strut.rotation.z = sx * 0.55;
    strut.position.set(sx * 1.6, 1.95, 0.5);
    root.add(strut);
    const tip = box(0.3, 0.14, 0.9, body);
    tip.position.set(sx * 5.65, 2.5, 0.5);
    root.add(tip);
  }

  const tail = box(3.4, 0.14, 0.9, body);
  tail.position.set(0, 1.9, -2.7);
  root.add(tail);
  const rudder = box(0.12, 1.3, 1.0, body);
  rudder.position.set(0, 2.4, -2.8);
  root.add(rudder);

  const prop = new THREE.Group();
  prop.position.set(0, 1.55, 3.6);
  for (let i = 0; i < 2; i++) {
    const blade = box(0.14, 2.6, 0.06, dark);
    blade.rotation.z = (i / 2) * Math.PI;
    prop.add(blade);
  }
  root.add(prop);

  const wheels: THREE.Mesh[] = [];
  for (const [sx, sz, r] of [[-1.1, 0.9, 0.34], [1.1, 0.9, 0.34], [0, -2.5, 0.2]] as [number, number, number][]) {
    const g = new THREE.CylinderGeometry(r, r, 0.16, 10);
    g.rotateZ(Math.PI / 2);
    const w = new THREE.Mesh(g, dark);
    w.position.set(sx, r, sz);
    root.add(w);
    wheels.push(w);
    if (sz > 0) {
      const leg = box(0.09, 0.9, 0.09, metal);
      leg.rotation.z = -sx * 0.3;
      leg.position.set(sx * 0.8, 0.8, sz);
      root.add(leg);
    }
  }

  const light = box(0.18, 0.14, 0.1, lamp);
  light.position.set(0, 1.9, 3.5);
  root.add(light);

  const paintable = [fuselage, wing, tail, rudder, cowl];
  return {
    root,
    animate(dt, speed, steer) {
      prop.rotation.z += dt * (14 + Math.abs(speed) * 0.5);
      for (const w of wheels) w.rotation.x -= (speed / 0.34) * 0.016;
      // Banks hard, because that is how an aeroplane turns.
      root.rotation.z = bank(steer, speed, 34, 0.62);
      root.rotation.x = Math.min(0.1, Math.abs(speed) / 96 * 0.1);
    },
    setPaint(hex) {
      for (const m of paintable) (m.material as THREE.MeshLambertMaterial).color.setHex(hex);
    },
    dent(force) {
      const t = paintable[Math.floor(Math.random() * paintable.length)];
      t.scale.y = Math.max(0.88, t.scale.y - Math.min(0.03, force * 0.004));
    },
    setLights(on) {
      (light.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xfff0c0 : 0x5a5346);
    },
  };
}

export function makeFor(cls: VehicleClass, paint: number): Vehicle {
  if (cls === "bike") return makeBike(paint);
  if (cls === "rover") return makeRover(paint);
  if (cls === "chopper") return makeChopper(paint);
  if (cls === "plane") return makePlane(paint);
  return makeVehicle(paint);
}
