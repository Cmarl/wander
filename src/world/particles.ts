import * as THREE from "three";
import { blobTexture } from "./shadows";

/**
 * Wheel spray and flushed birds — the two cheapest signals that the world
 * notices you.
 *
 * Both are small CPU-stepped pools drawn as one instanced mesh each. A few
 * hundred particles is nothing to step per frame, and keeping it on the CPU
 * means spawn rate and colour can read directly from the surface you're
 * driving on.
 */

const DUST_MAX = 280;
const BIRD_MAX = 36;

interface Grain {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
}

export class Dust {
  readonly mesh: THREE.InstancedMesh;
  private pool: Grain[] = [];
  private colour = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      }),
      DUST_MAX
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 9;
  }

  /** `tint` should come from the ground, so every biome throws the right colour. */
  emit(x: number, y: number, z: number, speed: number, tint: THREE.Color, heavy: boolean) {
    if (this.pool.length >= DUST_MAX) return;
    const spread = heavy ? 2.4 : 1.4;
    this.pool.push({
      x: x + (Math.random() - 0.5) * 0.8,
      y: y + 0.25,
      z: z + (Math.random() - 0.5) * 0.8,
      vx: (Math.random() - 0.5) * spread,
      vy: 0.6 + Math.random() * (heavy ? 2.6 : 1.3),
      vz: (Math.random() - 0.5) * spread,
      life: 0,
      max: 0.7 + Math.random() * (heavy ? 1.1 : 0.7),
      size: 0.5 + Math.random() * 0.8 + speed * 0.02,
      grow: heavy ? 3.4 : 2.2,
    });
    const i = this.pool.length - 1;
    this.mesh.setColorAt(i, this.colour.copy(tint));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera) {
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    camera.getWorldQuaternion(q);

    let n = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const g = this.pool[i];
      g.life += dt;
      if (g.life >= g.max) continue;

      // Air drag, then a lazy rise — dust hangs, it doesn't fall like gravel.
      const drag = Math.pow(0.12, dt);
      g.vx *= drag;
      g.vz *= drag;
      g.vy = g.vy * Math.pow(0.5, dt) + 0.25 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;

      const t = g.life / g.max;
      pos.set(g.x, g.y, g.z);
      scl.setScalar(g.size * (1 + t * g.grow));
      m.compose(pos, q, scl);
      this.mesh.setMatrixAt(n, m);
      if (n !== i) {
        this.mesh.getColorAt(i, this.colour);
        this.mesh.setColorAt(n, this.colour);
      }
      this.pool[n] = g;
      n++;
    }
    this.pool.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // Opacity rides the oldest particle rather than per-instance alpha, which
    // would cost a custom shader for a detail nobody consciously registers.
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.42;
  }
}

interface Bird {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  flap: number;
}

/** Startled birds. Pure theatre, and worth more than it costs. */
export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private pool: Bird[] = [];

  constructor() {
    // A shallow V — reads as a bird from any angle without being a model.
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, 0, 0, 0, 0.26, 0.1, 1, 0, 0], 3)
    );
    this.mesh = new THREE.InstancedMesh(
      g,
      new THREE.MeshBasicMaterial({ color: 0x2a2e33, side: THREE.DoubleSide }),
      BIRD_MAX
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Burst upward away from whatever disturbed them. */
  flush(x: number, y: number, z: number, awayX: number, awayZ: number) {
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n && this.pool.length < BIRD_MAX; i++) {
      const a = Math.random() * Math.PI * 2;
      this.pool.push({
        x: x + Math.cos(a) * 3,
        y: y + 0.6,
        z: z + Math.sin(a) * 3,
        vx: awayX * (3 + Math.random() * 4) + Math.cos(a) * 2.5,
        vy: 5 + Math.random() * 3.5,
        vz: awayZ * (3 + Math.random() * 4) + Math.sin(a) * 2.5,
        life: 0,
        flap: Math.random() * 6.28,
      });
    }
  }

  update(dt: number) {
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);

    let n = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const b = this.pool[i];
      b.life += dt;
      if (b.life > 7) continue;

      // Climb hard, then level off into a glide.
      b.vy = b.vy * Math.pow(0.45, dt) + (b.life > 1.2 ? -0.4 : 1.2) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.flap += dt * (b.life > 1.6 ? 5 : 17);

      const wing = 0.45 + Math.abs(Math.sin(b.flap)) * 0.55;
      pos.set(b.x, b.y, b.z);
      q.setFromAxisAngle(up, Math.atan2(b.vx, b.vz));
      scl.set(0.5, wing * 0.7, 0.5);
      m.compose(pos, q, scl);
      this.mesh.setMatrixAt(n, m);
      this.pool[n] = b;
      n++;
    }
    this.pool.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
