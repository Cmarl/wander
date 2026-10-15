import * as THREE from "three";
import { heightAt } from "../world/field";
import { slotRandom } from "../world/field";

/**
 * The dog.
 *
 * No dialogue, no needs, no fail state, nothing to manage and nothing to lose.
 * It falls in beside you at a steading, trots after you, stops to put its nose
 * in things, catches up, and sits in the truck when you drive. That is the
 * whole system, and the warmth comes entirely from the fact that it asks
 * nothing of you.
 *
 * There is exactly one, so it is a handful of plain meshes rather than
 * anything instanced.
 */

const NAMES = [
  "Scout", "Birch", "Pepper", "Juno", "Moss", "Dash", "Willow", "Bramble",
  "Rusty", "Sable", "Comet", "Nettle", "Bodie", "Hazel", "Tully", "Wren",
];

/** Further than this and it breaks into a run to catch up. */
const RUN_AT = 13;
/** Closer than this and it stops following and mooches instead. */
const SETTLE_AT = 3.6;
const TROT = 4.6;
const RUN = 8.2;

export class Dog {
  readonly group = new THREE.Group();
  /** Null until one joins you. */
  name: string | null = null;
  /** Where it joined, for the journal. */
  home: string | null = null;

  private legs: THREE.Mesh[] = [];
  private tail!: THREE.Mesh;
  private pos = new THREE.Vector3();
  private heading = 0;
  private gait = 0;
  /** Somewhere interesting it has wandered off to, if any. */
  private sniff: THREE.Vector3 | null = null;
  private sniffIn = 6;
  private riding = false;

  constructor() {
    const coat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x4a3a2c, flatShading: true });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.78), coat);
    body.position.y = 0.44;
    this.group.add(body);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.3), coat);
    chest.position.set(0, 0.44, 0.3);
    this.group.add(chest);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.26), coat);
    neck.position.set(0, 0.56, 0.46);
    this.group.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.3), coat);
    head.position.set(0, 0.66, 0.62);
    this.group.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.14, 0.22), dark);
    snout.position.set(0, 0.62, 0.82);
    this.group.add(snout);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.17, 0.12), dark);
      ear.position.set(sx * 0.11, 0.78, 0.58);
      ear.rotation.z = sx * 0.2;
      this.group.add(ear);
    }

    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as [number, number][]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.44, 0.1), dark);
      // Pivot at the shoulder, so swinging the mesh swings the whole leg.
      leg.geometry.translate(0, -0.22, 0);
      leg.position.set(sx * 0.12, 0.44, sz * 0.27);
      this.group.add(leg);
      this.legs.push(leg);
    }

    this.tail = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.42), coat);
    this.tail.geometry.translate(0, 0, 0.21);
    this.tail.position.set(0, 0.54, -0.38);
    this.tail.rotation.x = -0.7;
    this.group.add(this.tail);

    this.group.visible = false;
  }

  get here(): boolean {
    return this.name !== null;
  }

  /**
   * One joins you.
   *
   * Hashed off the place, so the same steading always has the same dog and two
   * players who stop at it meet the same animal.
   */
  join(gx: number, gz: number, where: string, at: THREE.Vector3): string {
    this.name = NAMES[Math.floor(slotRandom(gx, gz, 1361) * NAMES.length) % NAMES.length];
    this.home = where;
    this.pos.copy(at);
    this.group.visible = true;
    return this.name;
  }

  /** Renaming it is the one thing you can decide about it. */
  rename(name: string) {
    const clean = name.trim().slice(0, 16);
    if (clean) this.name = clean;
  }

  restore(name: string, home: string | null, at: THREE.Vector3) {
    this.name = name;
    this.home = home;
    this.pos.copy(at);
    this.group.visible = true;
  }

  /**
   * @param target where the player is
   * @param seat   the truck's passenger seat in world space, or null on foot
   */
  update(dt: number, target: THREE.Vector3, seat: { pos: THREE.Vector3; yaw: number } | null) {
    if (!this.here) return;

    if (seat) {
      // Riding. Snapped to the seat rather than eased, because easing toward a
      // moving truck leaves the dog trailing a metre behind its own seat —
      // the same mistake passengers had before they were seated on their host.
      this.riding = true;
      this.pos.copy(seat.pos);
      this.group.position.copy(seat.pos);
      this.group.rotation.y = seat.yaw;
      this.gait = 0;
      for (const leg of this.legs) leg.rotation.x = -1.1; // tucked under, sitting
      this.tail.rotation.x = -0.4 + Math.sin(performance.now() / 180) * 0.3;
      return;
    }

    if (this.riding) {
      // Just got out: appear beside the truck rather than under it.
      this.riding = false;
      this.pos.x += Math.cos(this.heading) * 1.6;
      this.pos.z += Math.sin(this.heading) * 1.6;
    }

    const toPlayer = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);

    // Mooching. It only wanders when it has caught up, and it gives up on a
    // sniff the moment you get far enough away to be worth following.
    this.sniffIn -= dt;
    if (toPlayer < SETTLE_AT && !this.sniff && this.sniffIn <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 5;
      this.sniff = new THREE.Vector3(target.x + Math.cos(a) * r, 0, target.z + Math.sin(a) * r);
      this.sniffIn = 4 + Math.random() * 8;
    }
    if (this.sniff && (toPlayer > RUN_AT * 0.7 || Math.hypot(this.sniff.x - this.pos.x, this.sniff.z - this.pos.z) < 0.8)) {
      this.sniff = null;
    }

    const goal = this.sniff ?? target;
    const dx = goal.x - this.pos.x;
    const dz = goal.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const stop = this.sniff ? 0.6 : SETTLE_AT;
    const speed = this.sniff ? TROT * 0.7 : toPlayer > RUN_AT ? RUN : TROT;

    if (d > stop) {
      const step = Math.min(speed * dt, d - stop);
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
      this.heading = Math.atan2(dx, dz);
      this.gait += step * 9;
    } else {
      this.gait *= 1 - Math.min(1, dt * 6);
    }

    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.group.position.copy(this.pos);
    // Turn toward where it is going rather than snapping.
    const turn = ((this.heading - this.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.group.rotation.y += turn * Math.min(1, dt * 7);

    // Diagonal pairs, which is what a trot actually is. Standing still, the
    // gait decays toward zero, which straightens the legs on its own.
    for (let i = 0; i < 4; i++) {
      const phase = i === 0 || i === 3 ? 0 : Math.PI;
      this.legs[i].rotation.x = Math.sin(this.gait + phase) * 0.55;
    }
    // The tail never stops, which is most of why it reads as a dog.
    this.tail.rotation.x = -0.7 + Math.sin(this.gait * 0.8 + performance.now() / 250) * 0.22;
  }
}
