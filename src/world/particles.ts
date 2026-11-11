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

/**
 * A vehicle going up.
 *
 * Clyde: "if you hit something fast your vehicle should probably explode."
 *
 * A fireball is three things at three speeds: a flash that is over in a
 * tenth of a second, fire that billows for most of one, and pieces that keep
 * falling after both are gone. They are unlit and additive, so the lens does
 * the rest — the bloom is most of why this reads as heat and not as orange
 * spheres. One pool, reused: there is only ever one vehicle to lose.
 */
const FIRE = 16;
const DEBRIS = 14;

export class Explosion {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight(0xffa040, 0, 160, 1.6);
  private fire: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; vx: number; vy: number; vz: number; size: number; delay: number }[] = [];
  private bits: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; spin: number; floor: number }[] = [];
  private age = Infinity;

  constructor() {
    const ball = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < FIRE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(ball, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.fire.push({ mesh, mat, vx: 0, vy: 0, vz: 0, size: 1, delay: 0 });
    }
    const scrap = new THREE.MeshBasicMaterial({ color: 0x14100d });
    for (let i = 0; i < DEBRIS; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5 + (i % 3) * 0.3, 0.14, 0.4 + (i % 2) * 0.5), scrap);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.bits.push({ mesh, vx: 0, vy: 0, vz: 0, spin: 0, floor: 0 });
    }
    this.group.add(this.light);
  }

  /** `dirX/dirZ` is the way the vehicle was going: the blast leans that way. */
  burst(x: number, y: number, z: number, dirX: number, dirZ: number, floor: (x: number, z: number) => number) {
    this.age = 0;
    this.light.position.set(x, y + 3, z);
    for (let i = 0; i < FIRE; i++) {
      const f = this.fire[i];
      const a = Math.random() * Math.PI * 2;
      const out = 2 + Math.random() * 7;
      f.mesh.position.set(x + Math.cos(a) * 0.8, y + 1 + Math.random() * 1.2, z + Math.sin(a) * 0.8);
      f.vx = Math.cos(a) * out + dirX * 5;
      f.vz = Math.sin(a) * out + dirZ * 5;
      f.vy = 3 + Math.random() * 9;
      f.size = 1.6 + Math.random() * 2.6;
      // The middle goes first and the edges follow, so it rolls outward.
      f.delay = i < 4 ? 0 : Math.random() * 0.16;
      f.mesh.visible = true;
    }
    for (let i = 0; i < DEBRIS; i++) {
      const b = this.bits[i];
      const a = Math.random() * Math.PI * 2;
      const out = 5 + Math.random() * 16;
      b.mesh.position.set(x, y + 1.2, z);
      b.vx = Math.cos(a) * out + dirX * 9;
      b.vz = Math.sin(a) * out + dirZ * 9;
      b.vy = 9 + Math.random() * 16;
      b.spin = (Math.random() - 0.5) * 14;
      b.floor = floor(x, z);
      b.mesh.visible = true;
    }
  }

  update(dt: number, floor: (x: number, z: number) => number) {
    if (this.age > 5) return;
    this.age += dt;
    const t = this.age;
    // The flash: enormous, and gone before you could say what colour it was.
    this.light.intensity = t < 1.4 ? 2600 * Math.pow(Math.max(0, 1 - t / 1.4), 3) : 0;
    for (const f of this.fire) {
      const k = (t - f.delay) / 1.05;
      if (k < 0) continue;
      if (k >= 1) {
        f.mesh.visible = false;
        continue;
      }
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.position.z += f.vz * dt;
      // Fire slows as it rises and cools from white through orange to red.
      f.vx *= 1 - Math.min(1, dt * 2.4);
      f.vz *= 1 - Math.min(1, dt * 2.4);
      f.vy *= 1 - Math.min(1, dt * 1.3);
      f.mesh.scale.setScalar(f.size * (0.35 + 1.5 * Math.sqrt(k)));
      // Orange from the first frame: sixteen white spheres added together
      // are a white screen, and looked like the renderer failing.
      f.mat.color.setRGB(1, 0.62 - 0.5 * k, Math.max(0, 0.2 - 1.2 * k));
      f.mat.opacity = (1 - k) * (1 - k) * 0.5;
    }
    for (const b of this.bits) {
      if (!b.mesh.visible) continue;
      b.vy -= 22 * dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      b.mesh.rotation.x += b.spin * dt;
      b.mesh.rotation.z += b.spin * 0.7 * dt;
      const g = floor(b.mesh.position.x, b.mesh.position.z);
      if (b.mesh.position.y < g + 0.08) {
        // It lands, and stays where it landed for a few seconds.
        b.mesh.position.y = g + 0.08;
        b.vx = b.vz = b.vy = 0;
        b.spin = 0;
      }
      if (t > 4.6) b.mesh.visible = false;
    }
  }
}

/**
 * Fire off the back wheels.
 *
 * Clyde: "when you get a boost from whatever (skids, big jumps) make fire
 * come from the wheels." A boost you cannot see is a number going up. This
 * is a short hot streak out of each rear tyre for as long as it is pushing:
 * additive, so it glows through the lens, and cooling from yellow to red to
 * nothing in a third of a second so it reads as a jet and not as smoke.
 */
const FLAME_MAX = 90;

export class Flames {
  readonly mesh: THREE.InstancedMesh;
  private pool: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; size: number }[] = [];
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      FLAME_MAX
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 10;
    // Allocate the colour buffer up front; three only makes it on first use.
    this.mesh.setColorAt(0, this.c.setRGB(0, 0, 0));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    if (this.pool.length >= FLAME_MAX) return;
    this.pool.push({ x, y, z, vx, vy, vz, life: 0, size: 0.22 + Math.random() * 0.2 });
  }

  update(dt: number) {
    const LIFE = 0.34;
    let n = 0;
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const f = this.pool[i];
      f.life += dt;
      if (f.life >= LIFE) {
        this.pool.splice(i, 1);
        continue;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
    }
    for (const f of this.pool) {
      const k = f.life / LIFE;
      this.s.setScalar(f.size * (1 + k * 1.6));
      this.m.compose(this.p.set(f.x, f.y, f.z), this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      // Additive, so fading the colour to black IS fading it out.
      const a = (1 - k) * (1 - k);
      this.mesh.setColorAt(n, this.c.setRGB(1.0 * a, (0.85 - 0.75 * k) * a, (0.35 - 0.6 * k > 0 ? 0.35 - 0.6 * k : 0) * a));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
