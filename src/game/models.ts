import * as THREE from "three";

export const mat = (hex: number, rough = true) =>
  new THREE.MeshLambertMaterial({ color: hex, flatShading: rough });

export function box(w: number, h: number, d: number, m: THREE.Material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
}

// --- character ---------------------------------------------------------------

export interface Character {
  root: THREE.Group;
  /** Advance the walk cycle. `speed` in m/s, `airborne` freezes the legs. */
  animate(dt: number, speed: number, airborne: boolean): void;
  setPalette(p: CharacterPalette): void;
  /**
   * Out of the aeroplane. 0 on the ground, 1 falling, 2 under canopy —
   * the same three states Player keeps, because they are three completely
   * different pictures and not degrees of one.
   */
  setSky(state: 0 | 1 | 2): void;
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

  /**
   * The canopy.
   *
   * Clyde: "no visible parachute.." — he was floating down under nothing at
   * all, which makes the best moment in the game read as a bug.
   *
   * Sized off the person, like everything else here: a round canopy for one
   * adult is about seven metres across, and the lines are about four and a
   * half long. Pick those two numbers right and it needs no art.
   *
   * Eight gores in two alternating colours, because that is what makes a dome
   * read instantly as a PARACHUTE rather than a mushroom — the radial seams
   * are the whole silhouette. DoubleSide matters: you spend the descent
   * looking up into it from underneath.
   */
  const chute = new THREE.Group();
  chute.visible = false;
  // Named so the scene graph can be asked about it from outside — the chute
  // has to be measured in metres and checked against the camera frustum, and
  // neither is possible if the only handle on it is a closure variable.
  chute.name = "chute";
  root.add(chute);

  const CANOPY_R = 3.5;
  const LINES = 4.4;
  const canopy = new THREE.Group();
  canopy.position.y = 0.95 + LINES;
  chute.add(canopy);

  /**
   * Silk, with a floor under the shading.
   *
   * You spend the whole descent looking UP at the inside of this, which is the
   * face pointed away from the sun — so lit by nothing but the sky term, it
   * came out very nearly black. The emissive is not a cheat: a canopy with the
   * sun on it genuinely glows from underneath, because thin fabric transmits.
   * Without it the one thing he is looking at is a dark hole.
   */
  const silk = [
    new THREE.MeshLambertMaterial({ color: 0xd8d2c0, emissive: 0x565349, flatShading: true, side: THREE.DoubleSide }),
    new THREE.MeshLambertMaterial({ color: 0xc2563c, emissive: 0x4e241a, flatShading: true, side: THREE.DoubleSide }),
  ];
  const GORES = 8;
  for (let i = 0; i < GORES; i++) {
    const gore = new THREE.SphereGeometry(
      CANOPY_R, 3, 4,
      (i / GORES) * Math.PI * 2, (Math.PI * 2) / GORES,
      // A vent at the apex, and a skirt that stops short of the equator so the
      // dome is flattened rather than a full half-sphere.
      0.12, Math.PI * 0.44
    );
    // Squashed, which is the shape a canopy under load actually takes.
    gore.scale(1, 0.62, 1);
    canopy.add(new THREE.Mesh(gore, silk[i % 2]));
  }

  // Rigging. Eight lines from the skirt down to the harness at the shoulders.
  const cord = mat(0xe2ddcf);
  for (let i = 0; i < GORES; i++) {
    const a = ((i + 0.5) / GORES) * Math.PI * 2;
    const ex = Math.cos(a) * CANOPY_R * 0.92;
    const ez = Math.sin(a) * CANOPY_R * 0.92;
    const top = new THREE.Vector3(ex, 0.95 + LINES + CANOPY_R * 0.62 * 0.35, ez);
    const bot = new THREE.Vector3(0, 1.5, 0);
    const line = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, top.distanceTo(bot), 3),
      cord
    );
    line.position.copy(top).add(bot).multiplyScalar(0.5);
    // Point the cylinder's own axis along the line it has to span.
    line.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      top.clone().sub(bot).normalize()
    );
    chute.add(line);
  }

  let phase = 0;
  let sky: 0 | 1 | 2 = 0;
  /** Seconds since the canopy was pulled, which is what drives the snap open. */
  let opened = 0;

  return {
    root,
    setSky(state) {
      if (state === sky) return;
      // Restarted on each deployment rather than only on the first, so a
      // second jump opens as sharply as the first.
      if (state === 2) opened = 0;
      sky = state;
      chute.visible = state === 2;
    },
    animate(dt, speed, airborne) {
      const stride = Math.min(speed / 4.5, 1.4);
      phase += dt * (3.0 + speed * 1.9);

      /**
       * Falling, with or without the canopy.
       *
       * Two quite different pictures. In free-fall you are flat and spread —
       * arms out and wide, legs apart, chest down — which is the pose that
       * makes a tiny figure against the ground read as skydiving rather than
       * as falling off something. Under canopy you hang: arms up on the risers
       * and legs together underneath.
       */
      if (sky > 0) {
        phase += dt * 1.1;
        hips.position.y = 0.86;
        hips.rotation.y = 0;
        if (sky === 1) {
          /**
           * Signs matter here and I had them backwards.
           *
           * A limb hangs down its own -y, and rotateZ sends (0,-1) to
           * (sin t, -cos t). So POSITIVE z swings a limb to the player's
           * RIGHT — which put the left arm across the chest and the left leg
           * over the right one. Spread means left arm negative, right arm
           * positive. The render is how I found it.
           */
          torso.rotation.x = 1.15;
          armL.rotation.x = -0.4; armL.rotation.z = -1.4;
          armR.rotation.x = -0.4; armR.rotation.z = 1.4;
          legL.rotation.x = 0.55; legL.rotation.z = -0.32;
          legR.rotation.x = 0.55; legR.rotation.z = 0.32;
          // A slow roll, so a long fall is never a frozen frame.
          hips.rotation.z = Math.sin(phase * 1.7) * 0.12;
          return;
        }
        opened += dt;

        torso.rotation.x = 0.1;
        hips.rotation.z = 0;
        // Hands UP on the risers, not held out sideways: past a right angle,
        // so the arms angle above the shoulders towards where the lines go.
        armL.rotation.x = -0.1; armL.rotation.z = -2.05;
        armR.rotation.x = -0.1; armR.rotation.z = 2.05;
        legL.rotation.x = 0.2; legL.rotation.z = -0.07;
        legR.rotation.x = 0.2; legR.rotation.z = 0.07;

        /**
         * The snap open, then the sway.
         *
         * It grows from a bundle to full in about a third of a second and goes
         * a little past full on the way, because a canopy catching air
         * overshoots and that overshoot is the entire feeling of the thing
         * working. After that it is a slow pendulum on two periods that do not
         * divide into each other, so the drift never loops.
         */
        const k = Math.min(opened / 0.34, 1);
        // The overshoot outlasts the growth, or it is over before the canopy
        // has finished arriving and nobody ever sees it.
        const pop = 1 + Math.sin(Math.min(opened / 0.75, 1) * Math.PI) * 0.16;
        chute.scale.setScalar((0.18 + 0.82 * k * k * (3 - 2 * k)) * pop);
        chute.rotation.z = Math.sin(opened * 0.9) * 0.065;
        chute.rotation.x = Math.sin(opened * 0.63 + 1.1) * 0.05;
        // The silk breathes a little without the lines changing length.
        canopy.scale.set(1 + Math.sin(opened * 1.4) * 0.025, 1, 1 + Math.cos(opened * 1.2) * 0.025);
        return;
      }

      if (airborne) {
        legL.rotation.x = -0.5;
        legR.rotation.x = 0.25;
        armL.rotation.x = -1.1;
        armR.rotation.x = -1.1;
        return;
      }
      // Back on the ground: undo everything the sky poses set on the other
      // axes, or a landed walker keeps their arms out sideways forever.
      armL.rotation.z = 0; armR.rotation.z = 0;
      legL.rotation.z = 0; legR.rotation.z = 0;
      hips.rotation.z = 0;

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
  /**
   * Spin the wheels and turn the fronts.
   *
   * `climb` is vertical speed in metres per second, so anything that flies can
   * put its nose where it is actually going. Optional, because a truck has no
   * use for it.
   */
  animate(dt: number, speed: number, steer: number, climb?: number): void;
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
