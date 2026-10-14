import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { heightAt, slopeAt, moistureAt, temperatureAt, slotRandom } from "./field";
import { blobGeometry, blobMaterial } from "./shadows";

/**
 * Herds.
 *
 * The single thing that most makes a world feel inhabited rather than
 * generated — and the one place where the game looks back at you. Graze, lift
 * a head when you get close, scatter if you keep coming.
 *
 * Herds are placed by hashing a cell grid like everything else, so they cost
 * nothing to store. Only the handful near the player is simulated; the rest
 * are a coordinate and a species until you arrive.
 *
 * Nothing here can hurt you and nothing can be hunted. They're scenery that
 * happens to notice you, which is the whole point.
 */

const HERD_CELL = 900;
const SIM_RANGE = 460;
const MAX_DRAWN = 64;

/** Distances at which an animal changes its mind about you. */
const ALERT_AT = 70;
const FLEE_AT = 38;

export type Species = "deer" | "ibex";

interface Animal {
  x: number;
  z: number;
  /** Where it drifts back to when calm. */
  homeX: number;
  homeZ: number;
  heading: number;
  speed: number;
  phase: number;
  state: "graze" | "alert" | "flee";
  timer: number;
  scale: number;
  species: Species;
}

function quadruped(opts: {
  body: [number, number, number];
  neck: number;
  head: [number, number, number];
  legs: number;
  horns: boolean;
}): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const [bw, bh, bl] = opts.body;

  const body = new THREE.BoxGeometry(bw, bh, bl);
  body.translate(0, opts.legs + bh / 2, 0);
  parts.push(body);

  // Neck and head lean forward, which is most of what reads as "an animal".
  const neck = new THREE.BoxGeometry(bw * 0.42, opts.neck, bw * 0.42);
  neck.translate(0, opts.neck / 2, 0);
  neck.rotateX(-0.5);
  neck.translate(0, opts.legs + bh * 0.85, bl * 0.42);
  parts.push(neck);

  const head = new THREE.BoxGeometry(...opts.head);
  head.translate(0, opts.legs + bh * 0.85 + opts.neck * 0.82, bl * 0.42 + opts.neck * 0.46);
  parts.push(head);

  if (opts.horns) {
    for (const sx of [-1, 1]) {
      const horn = new THREE.CylinderGeometry(0.03, 0.055, 0.52, 4);
      horn.translate(0, 0.26, 0);
      horn.rotateZ(sx * 0.42);
      horn.rotateX(-0.9);
      horn.translate(sx * 0.09, opts.legs + bh * 0.85 + opts.neck + 0.1, bl * 0.42 + opts.neck * 0.42);
      parts.push(horn);
    }
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

const SHAPE: Record<Species, () => THREE.BufferGeometry> = {
  deer: () => quadruped({ body: [0.52, 0.62, 1.5], neck: 0.58, head: [0.26, 0.26, 0.5], legs: 0.84, horns: true }),
  ibex: () => quadruped({ body: [0.5, 0.56, 1.2], neck: 0.4, head: [0.24, 0.24, 0.44], legs: 0.6, horns: true }),
};

const TINT: Record<Species, number> = { deer: 0x8a6440, ibex: 0x6d6457 };
const PACE: Record<Species, { graze: number; flee: number }> = {
  deer: { graze: 0.7, flee: 11 },
  ibex: { graze: 0.55, flee: 8 },
};

/** Which animal, if any, belongs in this cell. */
function herdInCell(gx: number, gz: number): { x: number; z: number; species: Species; count: number } | null {
  if (slotRandom(gx, gz, 1297) > 0.42) return null;
  const x = (gx + (slotRandom(gx, gz, 1301) - 0.5) * 0.7) * HERD_CELL;
  const z = (gz + (slotRandom(gx, gz, 1303) - 0.5) * 0.7) * HERD_CELL;
  const y = heightAt(x, z);
  if (y < 12) return null;

  const slope = slopeAt(x, z, 8);
  const temp = temperatureAt(x, z) - y / 9000;
  const moist = moistureAt(x, z);

  // Ibex take the steep high ground, deer the gentler country below.
  let species: Species | null = null;
  if (slope > 0.3 && y > 700) species = "ibex";
  else if (slope < 0.34 && temp > 0.26 && moist > 0.22 && y < 1700) species = "deer";
  if (!species) return null;

  return { x, z, species, count: 3 + Math.floor(slotRandom(gx, gz, 1307) * 5) };
}

export class Wildlife {
  readonly group = new THREE.Group();
  private meshes = new Map<Species, THREE.InstancedMesh>();
  private shadows: THREE.InstancedMesh;
  private animals: Animal[] = [];
  private cellX = NaN;
  private cellZ = NaN;

  constructor() {
    for (const species of Object.keys(SHAPE) as Species[]) {
      const mesh = new THREE.InstancedMesh(
        SHAPE[species](),
        new THREE.MeshLambertMaterial({ color: TINT[species], flatShading: true }),
        MAX_DRAWN
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.set(species, mesh);
      this.group.add(mesh);
    }
    this.shadows = new THREE.InstancedMesh(blobGeometry(10), blobMaterial(), MAX_DRAWN * 2);
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

    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const herd = herdInCell(cx + i, cz + j);
        if (!herd) continue;
        if (Math.hypot(herd.x - px, herd.z - pz) > SIM_RANGE) continue;
        for (let n = 0; n < herd.count && this.animals.length < MAX_DRAWN; n++) {
          const a = (n / herd.count) * Math.PI * 2;
          const r = 4 + (n % 3) * 5;
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
          });
        }
      }
    }
  }

  update(dt: number, px: number, pz: number, sunElevation: number) {
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
    let shadowN = 0;

    for (const an of this.animals) {
      const dx = an.x - px;
      const dz = an.z - pz;
      const near = Math.hypot(dx, dz);
      const pace = PACE[an.species];

      an.timer -= dt;
      if (near < FLEE_AT) {
        an.state = "flee";
        an.timer = 2.4 + Math.random() * 2;
        an.heading = Math.atan2(dx, dz);
      } else if (near < ALERT_AT && an.state !== "flee") {
        // Head up, watching, not yet committed to running.
        an.state = "alert";
        an.heading = Math.atan2(dx, dz) + Math.PI;
      } else if (an.state === "flee" && an.timer <= 0) {
        an.state = "graze";
        // Wherever it fled to becomes the new home ground.
        an.homeX = an.x;
        an.homeZ = an.z;
      } else if (an.state === "alert" && near > ALERT_AT * 1.25) {
        an.state = "graze";
      }

      if (an.state === "graze") {
        if (an.timer <= 0) {
          an.timer = 2 + Math.random() * 5;
          // Drift back toward home so a herd stays a herd.
          const toHome = Math.atan2(an.homeX - an.x, an.homeZ - an.z);
          const far = Math.hypot(an.homeX - an.x, an.homeZ - an.z);
          an.heading = far > 16 ? toHome : Math.random() * Math.PI * 2;
          an.speed = Math.random() < 0.45 ? 0 : pace.graze;
        }
      } else if (an.state === "alert") {
        an.speed = 0;
      } else {
        an.speed = pace.flee;
      }

      an.x += Math.sin(an.heading) * an.speed * dt;
      an.z += Math.cos(an.heading) * an.speed * dt;
      an.phase += dt * (an.speed > 0.1 ? 7 : 1.1);

      const ground = heightAt(an.x, an.z);
      const mesh = this.meshes.get(an.species)!;
      const n = counts.get(an.species) ?? 0;
      if (n >= MAX_DRAWN) continue;

      // A vertical bob plus a pitch is enough gait without per-leg rigging.
      const bob = an.speed > 0.1 ? Math.abs(Math.sin(an.phase)) * 0.1 * (an.speed / pace.flee + 0.3) : 0;
      const pitch = an.state === "alert" ? -0.2 : an.speed > 4 ? 0.14 : 0;
      pos.set(an.x, ground + bob, an.z);
      q.setFromEuler(new THREE.Euler(pitch, an.heading, 0));
      scl.setScalar(an.scale);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(n, m);
      counts.set(an.species, n + 1);

      if (shadowN < MAX_DRAWN * 2) {
        pos.set(an.x, ground + 0.05, an.z);
        q.setFromAxisAngle(up, an.heading);
        scl.set(an.scale * 0.8, 1, an.scale * 1.25);
        m.compose(pos, q, scl);
        this.shadows.setMatrixAt(shadowN++, m);
      }
    }

    for (const [species, mesh] of this.meshes) {
      mesh.count = counts.get(species) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    const mat = this.shadows.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.3 * Math.max(0, Math.min(1, (sunElevation + 0.04) / 0.22));
    mat.visible = mat.opacity > 0.01;
  }

  /** How many animals are currently aware of you — used for the journal. */
  get watching(): number {
    return this.animals.filter((a) => a.state === "alert").length;
  }
}
