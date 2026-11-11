import * as THREE from "three";
import { worldLit } from "./worldMaterial";
import { monumentParts, turbineRotor, turbineTower } from "./monumentKinds";
import { LIGHT, LIGHT_TOP, TURBINE, monumentsNear, turbinesOf, type Monument } from "./monuments";

/**
 * Drawing the monuments.
 *
 * There is at most a handful of these in the whole visible world, so unlike
 * the landmarks they are not instanced: each is a small group of ordinary
 * meshes, built when it comes within range and thrown away when it leaves.
 *
 * THE AIR IS THINNER FOR THEM. The world's haze takes everything to the sky
 * colour by about twenty kilometres, which is right for hills and would make
 * a monument a thing you only ever bump into. They are drawn through roughly
 * half the haze, so one hangs pale on the horizon the way a far mountain
 * does — still plainly distant, but there. That one number is what turns
 * "something I found" into "something I went to".
 */
const HAZE = 0.5;
/** Just inside the camera's far plane. */
const LOAD_RANGE = 38000;

const mats = new Map<number, THREE.Material>();
function lit(colour: number): THREE.Material {
  let m = mats.get(colour);
  if (!m) {
    m = worldLit(new THREE.MeshLambertMaterial({ color: colour, flatShading: true }), 0, HAZE);
    mats.set(colour, m);
  }
  return m;
}

interface Loaded {
  m: Monument;
  group: THREE.Group;
  rotors: { mesh: THREE.Mesh; rate: number }[];
  beam: THREE.Object3D | null;
}

export class MonumentField {
  readonly group = new THREE.Group();
  loaded: Loaded[] = [];

  /** Warm windows and lamps: dark by day, lit after dark. */
  private lamp = new THREE.MeshBasicMaterial({ color: 0x23242a });
  /** Red obstruction lights, which blink. */
  private beacon = new THREE.MeshBasicMaterial({ color: 0x401512 });
  private beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff0c2,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  private since = 99;
  private towerGeo: THREE.BufferGeometry | null = null;
  private rotorGeo: THREE.BufferGeometry | null = null;

  /** Monuments close enough to walk on or into. */
  near(x: number, z: number, range: number): Monument[] {
    const out: Monument[] = [];
    for (const l of this.loaded) {
      if (Math.hypot(l.m.x - x, l.m.z - z) < range) out.push(l.m);
    }
    return out;
  }

  update(dt: number, px: number, pz: number, elapsed: number, sunY: number) {
    this.since += dt;
    if (this.since > 1.2) {
      this.since = 0;
      this.refresh(px, pz);
    }

    const night = THREE.MathUtils.smoothstep(-sunY, -0.06, 0.1);
    this.lamp.color.setRGB(0.02 + night * 1.0, 0.02 + night * 0.78, 0.025 + night * 0.42);
    // On for a beat, off for two: the rhythm every mast light has.
    const blink = (elapsed % 2.4) < 0.9 ? 1 : 0.12;
    this.beacon.color.setRGB((0.25 + night * 0.75) * blink + 0.05, 0.04 * blink, 0.03 * blink);
    this.beamMat.opacity = night * 0.11;
    for (const l of this.loaded) {
      for (const r of l.rotors) r.mesh.rotation.z += dt * r.rate;
      if (l.beam) {
        l.beam.visible = night > 0.02;
        l.beam.rotation.y = elapsed * 0.42;
      }
    }
  }

  private refresh(px: number, pz: number) {
    // Nearest first, because only one is built per refresh and the one you
    // are standing next to must not be waiting behind four on the horizon.
    const want = monumentsNear(px, pz, 1)
      .filter((m) => Math.hypot(m.x - px, m.z - pz) < LOAD_RANGE)
      .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    for (let i = this.loaded.length - 1; i >= 0; i--) {
      if (want.some((m) => m.id === this.loaded[i].m.id)) continue;
      this.group.remove(this.loaded[i].group);
      this.loaded.splice(i, 1);
    }
    for (const m of want) {
      if (this.loaded.some((l) => l.m.id === m.id)) continue;
      // One a refresh. Building a tower is a few tens of milliseconds, and
      // two arriving in the same frame would be a hitch you could feel.
      this.loaded.push(this.build(m));
      break;
    }
  }

  private build(m: Monument): Loaded {
    const group = new THREE.Group();
    const rotors: Loaded["rotors"] = [];
    let beam: THREE.Object3D | null = null;

    if (m.kind === "windfarm") {
      this.towerGeo ??= turbineTower();
      this.rotorGeo ??= turbineRotor();
      // Every turbine faces the same wind.
      const yaw = (m.gx * 1.7 + m.gz * 0.9) % (Math.PI * 2);
      for (const t of turbinesOf(m)) {
        const one = new THREE.Group();
        one.position.set(t.x, t.y - 1, t.z);
        one.rotation.y = yaw;
        one.add(new THREE.Mesh(this.towerGeo, lit(0xe7e8ea)));
        const rotor = new THREE.Mesh(this.rotorGeo, lit(0xdcdee2));
        rotor.position.set(0, TURBINE.hub + 1.2, 7.4);
        rotor.rotation.z = t.phase;
        one.add(rotor);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), this.beacon);
        lamp.position.set(0, TURBINE.hub + 3.8, -2);
        one.add(lamp);
        rotors.push({ mesh: rotor, rate: t.rate });
        group.add(one);
      }
    } else {
      group.position.set(m.x, m.y, m.z);
      group.rotation.y = m.rot;
      for (const part of monumentParts(m.kind)) {
        const mat = part.glow === "lamp" ? this.lamp : part.glow === "beacon" ? this.beacon : lit(part.colour);
        group.add(new THREE.Mesh(part.geo, mat));
      }
      if (m.kind === "lighthouse") {
        /**
         * The beam: two shafts opposite each other, turning.
         *
         * This is the only thing in the world that tells you where it is
         * after dark, which is worth more than its height. Unhazed and
         * additive, so from twenty kilometres it is a faint line sweeping the
         * horizon and from the gallery it goes over your head.
         */
        beam = new THREE.Group();
        const len = 2600;
        for (const s of [-1, 1]) {
          const cone = new THREE.ConeGeometry(70, len, 10, 1, true);
          // Point of the cone at the lamp, opening outward along x.
          cone.translate(0, -len / 2, 0);
          cone.rotateZ(s * (Math.PI / 2));
          const shaft = new THREE.Mesh(cone, this.beamMat);
          shaft.frustumCulled = false;
          beam.add(shaft);
        }
        beam.position.set(0, LIGHT_TOP + LIGHT.lamp - 2.2, 0);
        beam.visible = false;
        group.add(beam);
      }
    }
    this.group.add(group);
    return { m, group, rotors, beam };
  }
}
