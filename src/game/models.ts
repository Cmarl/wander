import * as THREE from "three";

const mat = (hex: number, rough = true) =>
  new THREE.MeshLambertMaterial({ color: hex, flatShading: rough });

function box(w: number, h: number, d: number, m: THREE.Material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
}

// --- character ---------------------------------------------------------------

export interface Character {
  root: THREE.Group;
  /** Advance the walk cycle. `speed` in m/s, `airborne` freezes the legs. */
  animate(dt: number, speed: number, airborne: boolean): void;
  setPalette(p: CharacterPalette): void;
}

export interface CharacterPalette {
  coat: number;
  trousers: number;
  skin: number;
  pack: number;
  hat: number;
}

export const DEFAULT_PALETTE: CharacterPalette = {
  coat: 0xb4643c,
  trousers: 0x3c4458,
  skin: 0xd8a882,
  pack: 0x5a6b4a,
  hat: 0x2f3744,
};

export function makeCharacter(palette: CharacterPalette = DEFAULT_PALETTE): Character {
  const coat = mat(palette.coat);
  const trousers = mat(palette.trousers);
  const skin = mat(palette.skin);
  const pack = mat(palette.pack);
  const hat = mat(palette.hat);

  const root = new THREE.Group();

  const hips = new THREE.Group();
  hips.position.y = 0.86;
  root.add(hips);

  const torso = box(0.52, 0.66, 0.3, coat);
  torso.position.y = 0.33;
  hips.add(torso);

  const head = box(0.3, 0.3, 0.3, skin);
  head.position.y = 0.82;
  hips.add(head);

  const brim = box(0.42, 0.06, 0.42, hat);
  brim.position.y = 0.96;
  hips.add(brim);
  const crown = box(0.3, 0.14, 0.3, hat);
  crown.position.y = 1.05;
  hips.add(crown);

  const bag = box(0.4, 0.46, 0.22, pack);
  bag.position.set(0, 0.36, -0.24);
  hips.add(bag);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.44, 6), pack);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 0.6, -0.26);
  hips.add(roll);

  const limb = (m: THREE.Material, w: number, h: number) => {
    const g = new THREE.Group();
    const mesh = box(w, h, w, m);
    mesh.position.y = -h / 2;
    g.add(mesh);
    return g;
  };

  const armL = limb(coat, 0.15, 0.6);
  armL.position.set(-0.33, 0.6, 0);
  hips.add(armL);
  const armR = limb(coat, 0.15, 0.6);
  armR.position.set(0.33, 0.6, 0);
  armR.name = "armR"; // so a remote wave can find it
  hips.add(armR);

  const legL = limb(trousers, 0.18, 0.86);
  legL.position.set(-0.14, 0, 0);
  hips.add(legL);
  const legR = limb(trousers, 0.18, 0.86);
  legR.position.set(0.14, 0, 0);
  hips.add(legR);

  let phase = 0;

  return {
    root,
    animate(dt, speed, airborne) {
      const stride = Math.min(speed / 4.5, 1.4);
      phase += dt * (3.0 + speed * 1.9);

      if (airborne) {
        legL.rotation.x = -0.5;
        legR.rotation.x = 0.25;
        armL.rotation.x = -1.1;
        armR.rotation.x = -1.1;
        return;
      }

      const s = Math.sin(phase) * stride;
      const c = Math.cos(phase);
      legL.rotation.x = s * 0.8;
      legR.rotation.x = -s * 0.8;
      armL.rotation.x = -s * 0.65;
      armR.rotation.x = s * 0.65;
      // Slight bob and counter-sway so idle doesn't read as a statue.
      hips.position.y = 0.86 + Math.abs(c) * 0.035 * stride;
      hips.rotation.y = -s * 0.09;
      torso.rotation.x = stride * 0.12;
    },
    setPalette(p) {
      coat.color.setHex(p.coat);
      trousers.color.setHex(p.trousers);
      skin.color.setHex(p.skin);
      pack.color.setHex(p.pack);
      hat.color.setHex(p.hat);
    },
  };
}

// --- vehicle -----------------------------------------------------------------

export interface Vehicle {
  root: THREE.Group;
  /** Spin the wheels and turn the fronts. */
  animate(dt: number, speed: number, steer: number): void;
  setPaint(hex: number): void;
  /**
   * Knock a panel out of true. Purely cosmetic and never repaired — the truck
   * ends up wearing a record of your driving, with no damage model, no penalty
   * and nothing to fix.
   */
  dent(force: number): void;
  /** The light bar on the roof. Off by day, worth having after dusk. */
  setLights(on: boolean): void;
}

export function makeVehicle(paint = 0xd8c04a): Vehicle {
  const body = mat(paint);
  const dark = mat(0x2a2d33);
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fc0cc, flatShading: true });
  const rack = mat(0x4a4e55);
  const crate1 = mat(0x8a5a3c);
  const crate2 = mat(0x3f6b55);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });

  const root = new THREE.Group();

  const chassis = box(1.9, 0.62, 4.1, body);
  chassis.position.y = 0.92;
  root.add(chassis);

  const cab = box(1.72, 0.72, 1.9, body);
  cab.position.set(0, 1.56, -0.25);
  root.add(cab);

  const windshield = box(1.6, 0.5, 0.08, glass);
  windshield.position.set(0, 1.62, 0.68);
  windshield.rotation.x = -0.22;
  root.add(windshield);
  const sideL = box(0.06, 0.42, 1.5, glass);
  sideL.position.set(-0.86, 1.62, -0.3);
  root.add(sideL);
  const sideR = sideL.clone();
  sideR.position.x = 0.86;
  root.add(sideR);

  const bed = box(1.78, 0.34, 1.5, body);
  bed.position.set(0, 1.4, -1.4);
  root.add(bed);

  // Roof rack with mismatched cargo — the overlanding silhouette.
  const rails = box(1.74, 0.08, 2.0, rack);
  rails.position.set(0, 1.96, -0.3);
  root.add(rails);
  const c1 = box(0.7, 0.36, 0.62, crate1);
  c1.position.set(-0.4, 2.18, -0.1);
  c1.rotation.y = 0.08;
  root.add(c1);
  const c2 = box(0.58, 0.3, 0.54, crate2);
  c2.position.set(0.45, 2.15, -0.7);
  c2.rotation.y = -0.12;
  root.add(c2);
  const duffel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 7), mat(0xb8b2a0));
  duffel.rotation.z = Math.PI / 2;
  duffel.position.set(-0.2, 2.12, -0.95);
  root.add(duffel);

  const bar = box(1.5, 0.12, 0.14, rack);
  bar.position.set(0, 2.08, 0.6);
  root.add(bar);
  for (const x of [-0.5, -0.17, 0.17, 0.5]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 8), lamp);
    l.rotation.x = Math.PI / 2;
    l.position.set(x, 2.08, 0.68);
    root.add(l);
  }

  const bumper = box(2.0, 0.26, 0.3, dark);
  bumper.position.set(0, 0.82, 2.0);
  root.add(bumper);
  const rearBumper = bumper.clone();
  rearBumper.position.z = -2.0;
  root.add(rearBumper);

  const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.26, 10), dark);
  spare.rotation.x = Math.PI / 2;
  spare.position.set(0, 1.35, -2.1);
  root.add(spare);

  const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.38, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.4, 8);
  hubGeo.rotateZ(Math.PI / 2);

  const wheels: THREE.Group[] = [];
  const fronts: THREE.Group[] = [];
  for (const [x, z, isFront] of [
    [-0.95, 1.35, true],
    [0.95, 1.35, true],
    [-0.95, -1.35, false],
    [0.95, -1.35, false],
  ] as [number, number, boolean][]) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(x, 0.56, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(wheelGeo, dark));
    const hub = new THREE.Mesh(hubGeo, mat(0xa8a496));
    spin.add(hub);
    steerPivot.add(spin);
    root.add(steerPivot);
    wheels.push(spin);
    if (isFront) fronts.push(steerPivot);
  }

  // Two beams from the roof bar. Narrow and long, so they pick out the ground
  // ahead without lighting the whole hillside.
  const beams: THREE.SpotLight[] = [];
  const aim = new THREE.Object3D();
  aim.position.set(0, -2, 34);
  root.add(aim);
  for (const x of [-0.42, 0.42]) {
    const beam = new THREE.SpotLight(0xfff0cc, 0, 90, 0.42, 0.55, 1.2);
    beam.position.set(x, 2.08, 0.7);
    beam.target = aim;
    root.add(beam);
    beams.push(beam);
  }
  let lightsOn = false;

  const panels = [chassis, cab, bed, bumper, rearBumper, rails];
  let dents = 0;

  return {
    root,
    setLights(on) {
      if (on === lightsOn) return;
      lightsOn = on;
      for (const beam of beams) beam.intensity = on ? 90 : 0;
      lamp.color.setHex(on ? 0xfff6dd : 0x8e8873);
    },
    dent(force) {
      if (dents > 14) return; // a wreck, not a sculpture
      dents++;
      const panel = panels[Math.floor(Math.random() * panels.length)];
      const k = 0.02 + force * 0.07;
      panel.position.x += (Math.random() - 0.5) * k * 2;
      panel.position.y += (Math.random() - 0.5) * k;
      panel.rotation.z += (Math.random() - 0.5) * k * 0.9;
      panel.rotation.x += (Math.random() - 0.5) * k * 0.6;
      // Scuffed paint goes a little duller each time.
      body.color.offsetHSL(0, -0.012 * force, -0.008 * force);
    },
    animate(dt, speed, steer) {
      const spin = (speed / 0.52) * dt;
      for (const w of wheels) w.rotation.x -= spin;
      for (const f of fronts) f.rotation.y = THREE.MathUtils.lerp(f.rotation.y, -steer * 0.5, 0.2);
    },
    setPaint(hex) {
      body.color.setHex(hex);
    },
  };
}
