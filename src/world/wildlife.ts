import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { heightAt, slopeAt, moistureAt, temperatureAt, slotRandom } from "./field";
import { blobGeometry, blobMaterial } from "./shadows";

/**
 * Herds, flocks and the odd solitary animal.
 *
 * The single thing that most makes a world feel inhabited rather than
 * generated — and the one place where the game looks back at you. Graze, lift
 * a head when you get close, scatter if you keep coming.
 *
 * Nothing here can hurt you and nothing can be hunted. They're scenery that
 * happens to notice you, which is the whole point: the reward for finding a
 * seal is having seen a seal.
 *
 * Placed by hashing a cell grid like everything else, so a world full of
 * animals costs nothing to store. Only the handful near you is simulated.
 */

const HERD_CELL = 900;
const SIM_RANGE = 460;
const PER_SPECIES = 26;

/** Noticing something with the naked eye, versus through the glass. */
const SIGHT_NEAR = 70;
const SIGHT_GLASSED = 430;

export type Species =
  | "deer" | "ibex" | "hare" | "bison" | "fox" | "crane" | "ptarmigan" | "seal";

interface SpeciesSpec {
  /** How the journal names it. */
  label: string;
  tint: number;
  /** Wander and bolt speeds. */
  graze: number;
  flee: number;
  /** Distances at which it looks up, and at which it leaves. */
  alertAt: number;
  fleeAt: number;
  herd: [number, number];
  /** Worth a badge, not just a journal line. */
  rare?: boolean;
  /** Leaves the ground when startled, rather than running. */
  flies?: boolean;
  shape: () => THREE.BufferGeometry;
  suits: (y: number, slope: number, temp: number, moist: number) => boolean;
}

function body(opts: {
  body: [number, number, number];
  neck: number;
  head: [number, number, number];
  legs: number;
  horns?: boolean;
  ears?: number;
  tail?: number;
}): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const [bw, bh, bl] = opts.body;

  const torso = new THREE.BoxGeometry(bw, bh, bl);
  torso.translate(0, opts.legs + bh / 2, 0);
  parts.push(torso);

  // Neck and head lean forward, which is most of what reads as "an animal".
  if (opts.neck > 0.01) {
    const neck = new THREE.BoxGeometry(bw * 0.42, opts.neck, bw * 0.42);
    neck.translate(0, opts.neck / 2, 0);
    neck.rotateX(-0.5);
    neck.translate(0, opts.legs + bh * 0.85, bl * 0.42);
    parts.push(neck);
  }

  const headY = opts.legs + bh * 0.85 + opts.neck * 0.82;
  const headZ = bl * 0.42 + opts.neck * 0.46;
  const head = new THREE.BoxGeometry(...opts.head);
  head.translate(0, headY, headZ);
  parts.push(head);

  if (opts.horns) {
    for (const sx of [-1, 1]) {
      const horn = new THREE.CylinderGeometry(0.03, 0.055, 0.52, 4);
      horn.translate(0, 0.26, 0);
      horn.rotateZ(sx * 0.42);
      horn.rotateX(-0.9);
      horn.translate(sx * 0.09, headY + 0.1, headZ - 0.04);
      parts.push(horn);
    }
  }
  if (opts.ears) {
    for (const sx of [-1, 1]) {
      const ear = new THREE.BoxGeometry(0.045, opts.ears, 0.09);
      ear.translate(0, opts.ears / 2, 0);
      ear.rotateZ(sx * 0.2);
      ear.translate(sx * 0.07, headY + opts.head[1] * 0.4, headZ - 0.05);
      parts.push(ear);
    }
  }
  if (opts.tail) {
    const tail = new THREE.BoxGeometry(opts.tail * 0.4, opts.tail * 0.4, opts.tail);
    tail.translate(0, opts.legs + bh * 0.7, -bl * 0.5 - opts.tail * 0.4);
    parts.push(tail);
  }

  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as [number, number][]) {
    const leg = new THREE.BoxGeometry(bw * 0.17, opts.legs, bw * 0.17);
    leg.translate(sx * bw * 0.33, opts.legs / 2, sz * bl * 0.33);
    parts.push(leg);
  }

  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  if (!merged) throw new Error("wildlife geometry merge failed");
  return merged;
}

/** Long legs, long neck, a beak. Stands in the shallows. */
function wader(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const torso = new THREE.BoxGeometry(0.3, 0.34, 0.64);
  torso.translate(0, 1.05, 0);
  parts.push(torso);
  const neck = new THREE.CylinderGeometry(0.055, 0.075, 0.72, 5);
  neck.translate(0, 0.36, 0);
  neck.rotateX(-0.22);
  neck.translate(0, 1.2, 0.26);
  parts.push(neck);
  const head = new THREE.BoxGeometry(0.14, 0.15, 0.24);
  head.translate(0, 1.76, 0.42);
  parts.push(head);
  const beak = new THREE.ConeGeometry(0.045, 0.3, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 1.74, 0.66);
  parts.push(beak);
  for (const sx of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4);
    leg.translate(sx * 0.09, 0.45, 0);
    parts.push(leg);
    const wing = new THREE.BoxGeometry(0.46, 0.035, 0.34);
    wing.translate(sx * 0.33, 1.1, -0.04);
    parts.push(wing);
  }
  const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  if (!m) throw new Error("wader merge failed");
  return m;
}

/** Squat, round, almost no legs. A bird that would rather walk. */
function fowl(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const torso = new THREE.IcosahedronGeometry(0.24, 0);
  torso.scale(0.85, 0.82, 1.15);
  torso.translate(0, 0.26, 0);
  parts.push(torso);
  const head = new THREE.IcosahedronGeometry(0.11, 0);
  head.translate(0, 0.42, 0.2);
  parts.push(head);
  const beak = new THREE.ConeGeometry(0.03, 0.1, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.41, 0.31);
  parts.push(beak);
  for (const sx of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 4);
    leg.translate(sx * 0.07, 0.08, 0);
    parts.push(leg);
    const wing = new THREE.BoxGeometry(0.3, 0.03, 0.24);
    wing.translate(sx * 0.21, 0.3, -0.02);
    parts.push(wing);
  }
  const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  if (!m) throw new Error("fowl merge failed");
  return m;
}

/** No legs at all. Lies on the sand and can barely be bothered. */
function pinniped(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const torso = new THREE.IcosahedronGeometry(0.42, 0);
  torso.scale(0.8, 0.62, 1.9);
  torso.translate(0, 0.26, 0);
  parts.push(torso);
  const head = new THREE.IcosahedronGeometry(0.2, 0);
  head.scale(0.9, 0.85, 1.1);
  head.translate(0, 0.42, 0.72);
  parts.push(head);
  const tail = new THREE.ConeGeometry(0.17, 0.4, 5);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0.24, -0.92);
  parts.push(tail);
  const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  if (!m) throw new Error("pinniped merge failed");
  return m;
}

export const SPECIES: Record<Species, SpeciesSpec> = {
  deer: {
    label: "Red deer", tint: 0x8a6440, graze: 0.7, flee: 11, alertAt: 70, fleeAt: 38, herd: [3, 7],
    shape: () => body({ body: [0.52, 0.62, 1.5], neck: 0.58, head: [0.26, 0.26, 0.5], legs: 0.84, horns: true }),
    suits: (y, slope, temp, moist) => slope < 0.34 && temp > 0.26 && moist > 0.22 && y < 1700,
  },
  ibex: {
    label: "Ibex", tint: 0x6d6457, graze: 0.55, flee: 8, alertAt: 64, fleeAt: 34, herd: [2, 5],
    shape: () => body({ body: [0.5, 0.56, 1.2], neck: 0.4, head: [0.24, 0.24, 0.44], legs: 0.6, horns: true }),
    suits: (y, slope) => slope > 0.3 && y > 700,
  },
  hare: {
    // Tiny and jumpy: it sees you long before you see it.
    label: "Hare", tint: 0xa08a68, graze: 0.5, flee: 9, alertAt: 44, fleeAt: 26, herd: [1, 3],
    shape: () => body({ body: [0.2, 0.22, 0.4], neck: 0.08, head: [0.13, 0.13, 0.2], legs: 0.17, ears: 0.26 }),
    suits: (y, slope, temp, moist) => slope < 0.4 && temp > 0.3 && moist < 0.62 && y > 10 && y < 1400,
  },
  bison: {
    // Big enough not to care much. Looks up, rarely bothers to run.
    label: "Bison", tint: 0x5c4634, graze: 0.4, flee: 6, alertAt: 56, fleeAt: 20, herd: [4, 9],
    shape: () => body({ body: [0.9, 1.0, 2.0], neck: 0.42, head: [0.5, 0.46, 0.6], legs: 0.82, horns: true }),
    suits: (y, slope, temp, moist) => slope < 0.2 && temp > 0.4 && moist < 0.52 && y > 30 && y < 900,
  },
  fox: {
    label: "Fox", tint: 0xb06434, graze: 0.8, flee: 10, alertAt: 52, fleeAt: 30, herd: [1, 2],
    shape: () => body({ body: [0.26, 0.28, 0.72], neck: 0.16, head: [0.18, 0.17, 0.3], legs: 0.3, ears: 0.14, tail: 0.42 }),
    suits: (y, slope, temp, moist) => slope < 0.42 && temp > 0.18 && temp < 0.62 && moist > 0.3 && y > 20,
  },
  crane: {
    label: "Crane", tint: 0xd8d4c8, graze: 0.35, flee: 9, alertAt: 60, fleeAt: 32, herd: [2, 5],
    flies: true,
    shape: wader,
    suits: (y, slope, temp) => y > 2 && y < 60 && slope < 0.18 && temp > 0.34,
  },
  ptarmigan: {
    label: "Ptarmigan", tint: 0xe8ecef, graze: 0.4, flee: 11, alertAt: 40, fleeAt: 22, herd: [2, 6],
    flies: true,
    shape: fowl,
    suits: (y, slope, temp) => temp < 0.34 && slope < 0.45 && y > 600,
  },
  seal: {
    // The rarest thing out here, and it barely acknowledges you.
    label: "Seal", tint: 0x6b7076, graze: 0.12, flee: 2.6, alertAt: 34, fleeAt: 13, herd: [1, 4],
    rare: true,
    shape: pinniped,
    suits: (y, slope, temp) => y > 1 && y < 14 && slope < 0.14 && temp > 0.3,
  },
};

const SPECIES_KEYS = Object.keys(SPECIES) as Species[];

interface Animal {
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  heading: number;
  speed: number;
  phase: number;
  state: "graze" | "alert" | "flee";
  timer: number;
  scale: number;
  species: Species;
  /** Height above the ground, for the ones that leave it. */
  lift: number;
  climb: number;
}

function herdInCell(gx: number, gz: number) {
  if (slotRandom(gx, gz, 1297) > 0.46) return null;
  const x = (gx + (slotRandom(gx, gz, 1301) - 0.5) * 0.7) * HERD_CELL;
  const z = (gz + (slotRandom(gx, gz, 1303) - 0.5) * 0.7) * HERD_CELL;
  const y = heightAt(x, z);
  if (y < 1) return null;

  const slope = slopeAt(x, z, 8);
  const temp = temperatureAt(x, z) - y / 9000;
  const moist = moistureAt(x, z);

  // Everything this ground suits, then one of them by hash — so the same spot
  // always holds the same animals, and the mix shifts as the country does.
  const fits = SPECIES_KEYS.filter((k) => SPECIES[k].suits(y, slope, temp, moist));
  if (!fits.length) return null;

  const pick = slotRandom(gx, gz, 1319);
  const species = fits[Math.min(fits.length - 1, Math.floor(pick * fits.length))];
  const spec = SPECIES[species];
  // The rare ones are rare even where they fit.
  if (spec.rare && slotRandom(gx, gz, 1321) > 0.3) return null;

  const [lo, hi] = spec.herd;
  const count = lo + Math.floor(slotRandom(gx, gz, 1307) * (hi - lo + 1));
  return { x, z, species, count };
}

export class Wildlife {
  readonly group = new THREE.Group();
  private meshes = new Map<Species, THREE.InstancedMesh>();
  private shadows: THREE.InstancedMesh;
  private animals: Animal[] = [];
  private cellX = NaN;
  private cellZ = NaN;

  /** Called the first time each species is seen. */
  onSight?: (species: Species, spec: SpeciesSpec, x: number, z: number) => void;

  constructor() {
    for (const key of SPECIES_KEYS) {
      const spec = SPECIES[key];
      const mesh = new THREE.InstancedMesh(
        spec.shape(),
        new THREE.MeshLambertMaterial({ color: spec.tint, flatShading: true }),
        PER_SPECIES
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    }
    this.shadows = new THREE.InstancedMesh(blobGeometry(10), blobMaterial(), PER_SPECIES * SPECIES_KEYS.length);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 3;
    this.group.add(this.shadows);
  }

  private repopulate(px: number, pz: number) {
    this.animals.length = 0;
    const cx = Math.round(px / HERD_CELL);
    const cz = Math.round(pz / HERD_CELL);
    const reach = Math.ceil(SIM_RANGE / HERD_CELL);
    const used = new Map<Species, number>();

    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const herd = herdInCell(cx + i, cz + j);
        if (!herd) continue;
        if (Math.hypot(herd.x - px, herd.z - pz) > SIM_RANGE) continue;
        for (let n = 0; n < herd.count; n++) {
          const taken = used.get(herd.species) ?? 0;
          if (taken >= PER_SPECIES) break;
          used.set(herd.species, taken + 1);
          const a = (n / herd.count) * Math.PI * 2;
          const r = 3 + (n % 3) * 4.5;
          this.animals.push({
            x: herd.x + Math.cos(a) * r,
            z: herd.z + Math.sin(a) * r,
            homeX: herd.x,
            homeZ: herd.z,
            heading: a,
            speed: 0,
            phase: n * 1.7,
            state: "graze",
            timer: Math.random() * 4,
            scale: 0.88 + (n % 4) * 0.09,
            species: herd.species,
            lift: 0,
            climb: 0,
          });
        }
      }
    }
  }

  update(dt: number, px: number, pz: number, sunElevation: number, glassing = false) {
    const cx = Math.round(px / HERD_CELL);
    const cz = Math.round(pz / HERD_CELL);
    if (cx !== this.cellX || cz !== this.cellZ) {
      this.cellX = cx;
      this.cellZ = cz;
      this.repopulate(px, pz);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const counts = new Map<Species, number>();
    // Binoculars are for watching animals, so they genuinely extend what you
    // can claim to have seen.
    const sightRange = glassing ? SIGHT_GLASSED : SIGHT_NEAR;
    let shadowN = 0;

    for (const an of this.animals) {
      const spec = SPECIES[an.species];
      const dx = an.x - px;
      const dz = an.z - pz;
      const near = Math.hypot(dx, dz);

      if (near < sightRange) this.onSight?.(an.species, spec, an.x, an.z);

      an.timer -= dt;
      if (near < spec.fleeAt) {
        if (an.state !== "flee" && spec.flies) {
          // Off the ground, hard, the moment it decides to go.
          an.climb = 10 + Math.random() * 4.5;
        }
        an.state = "flee";
        an.timer = (spec.flies ? 4.5 : 2.4) + Math.random() * 2;
        an.heading = Math.atan2(dx, dz);
      } else if (near < spec.alertAt && an.state !== "flee") {
        an.state = "alert";
        an.heading = Math.atan2(dx, dz) + Math.PI;
      } else if (an.state === "flee" && an.timer <= 0) {
        an.state = "graze";
        an.homeX = an.x;
        an.homeZ = an.z;
      } else if (an.state === "alert" && near > spec.alertAt * 1.25) {
        an.state = "graze";
      }

      if (an.state === "graze") {
        if (an.timer <= 0) {
          an.timer = 2 + Math.random() * 5;
          const toHome = Math.atan2(an.homeX - an.x, an.homeZ - an.z);
          const far = Math.hypot(an.homeX - an.x, an.homeZ - an.z);
          an.heading = far > 16 ? toHome : Math.random() * Math.PI * 2;
          an.speed = Math.random() < 0.45 ? 0 : spec.graze;
        }
      } else if (an.state === "alert") {
        an.speed = 0;
      } else {
        an.speed = spec.flee;
      }

      an.x += Math.sin(an.heading) * an.speed * dt;
      an.z += Math.cos(an.heading) * an.speed * dt;

      if (spec.flies) {
        // Climb away, level off, then settle back down once it feels safe.
        if (an.state === "flee") {
          an.climb -= dt * 5.2;
          an.lift += Math.max(an.climb, -1.7) * dt;
        } else {
          an.lift -= dt * 2.4;
        }
        an.lift = Math.max(0, Math.min(26, an.lift));
        if (an.lift <= 0) an.climb = 0;
      }
      // Wings beat hard on the climb and barely at all on a glide.
      an.phase += dt * (an.lift > 0 ? (an.climb > 0 ? 16 : 5) : an.speed > 0.1 ? 7 : 1.1);

      const ground = heightAt(an.x, an.z);
      const mesh = this.meshes.get(an.species)!;
      const n = counts.get(an.species) ?? 0;
      if (n >= PER_SPECIES) continue;

      const flying = an.lift > 0.05;
      const bob = an.speed > 0.1 && !flying ? Math.abs(Math.sin(an.phase)) * 0.1 * (an.speed / spec.flee + 0.3) : 0;
      const pitch = flying
        ? an.climb > 0 ? -0.42 : 0.06
        : an.state === "alert" ? -0.2 : an.speed > 4 ? 0.14 : 0;
      // Rolling with the wingbeat is what sells a bird at distance — the
      // instance matrix can't animate a wing on its own.
      const roll = flying ? Math.sin(an.phase) * (an.climb > 0 ? 0.42 : 0.14) : 0;
      pos.set(an.x, ground + bob + an.lift, an.z);
      q.setFromEuler(new THREE.Euler(pitch, an.heading, roll));
      scl.setScalar(an.scale);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(n, m);
      counts.set(an.species, n + 1);

      if (!flying && shadowN < this.shadows.instanceMatrix.count) {
        pos.set(an.x, ground + 0.05, an.z);
        q.setFromAxisAngle(up, an.heading);
        scl.set(an.scale * 0.8, 1, an.scale * 1.25);
        m.compose(pos, q, scl);
        this.shadows.setMatrixAt(shadowN++, m);
      }
    }

    for (const [key, mesh] of this.meshes) {
      mesh.count = counts.get(key) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    const mat = this.shadows.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.3 * Math.max(0, Math.min(1, (sunElevation + 0.04) / 0.22));
    mat.visible = mat.opacity > 0.01;
  }

  /** How many animals are currently aware of you. */
  get watching(): number {
    return this.animals.filter((a) => a.state === "alert").length;
  }
}
