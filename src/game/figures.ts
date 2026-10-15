import * as THREE from "three";
import { heightAt, slopeAt, slotRandom } from "../world/field";
import { makeCharacter } from "./models";

/**
 * Figures.
 *
 * A silhouette on a distant ridge that isn't there when you arrive. Pure
 * atmosphere, no systems, nothing to interact with and nothing to find.
 *
 * The brainstorm's warning is the whole design constraint: use sparingly, or
 * it becomes a mechanic instead of a feeling. So there is never more than one,
 * it only appears a long way off and only on high ground against the sky, and
 * it is gone the moment you look at it properly — close the distance, or look
 * away long enough, and there was nobody there.
 *
 * It deliberately leaves NO TRACE. No journal line, no badge, no sound. If it
 * were recorded it would become a thing to collect, and a thing you can
 * collect is not unsettling, it is a checklist.
 */

/** Never nearer than this, which is the point. */
const NEAR = 420;
const FAR = 1100;
/** How long one can stand there before it has simply gone. */
const LINGER = 26;
/** Real seconds between appearances. Rare enough to be a feeling. */
const WAIT_MIN = 9 * 60;
const WAIT_MAX = 22 * 60;

export class Figures {
  readonly group = new THREE.Group();
  private body: THREE.Object3D;
  private wait = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
  private life = 0;
  private pos = new THREE.Vector3();

  constructor() {
    // An ordinary person, unlit and darkened — read against the sky at six
    // hundred metres, a silhouette is all it ever is.
    this.body = makeCharacter().root;
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ color: 0x2b2f36 });
    });
    this.body.scale.setScalar(1.25);
    this.group.add(this.body);
    this.group.visible = false;
  }

  update(dt: number, player: THREE.Vector3, viewYaw: number) {
    if (this.group.visible) {
      this.life -= dt;
      // Gone if you close the distance, or if you simply give it time.
      if (this.life <= 0 || this.pos.distanceTo(player) < NEAR * 0.75) this.clear();
      return;
    }

    this.wait -= dt;
    if (this.wait > 0) return;
    this.place(player, viewYaw);
  }

  private place(player: THREE.Vector3, viewYaw: number) {
    // Somewhere ahead of you, on ground that stands above what's around it —
    // a figure in a hollow is a person, a figure on a skyline is a question.
    for (let i = 0; i < 14; i++) {
      const a = viewYaw + (slotRandom(i, 7, 1481) - 0.5) * 1.5;
      const d = NEAR + slotRandom(i, 11, 1483) * (FAR - NEAR);
      const x = player.x + Math.sin(a) * d;
      const z = player.z + Math.cos(a) * d;
      const y = heightAt(x, z);
      if (y < player.y + 18) continue; // must be above you, against the sky
      if (slopeAt(x, z, 10) > 0.3) continue;

      this.pos.set(x, y, z);
      this.group.position.copy(this.pos);
      // Facing away, always. Somebody who is looking at you is a character,
      // and a character wants something from you.
      //
      // `a` is the bearing FROM you TO the figure, and a heading of `a` points
      // along that same direction — i.e. further away. Adding pi, which is
      // what reads as "turn it around", spun it to face straight back at you.
      // That is the third time a bearing sign has bitten this project.
      this.group.rotation.y = a;
      this.group.visible = true;
      this.life = LINGER;
      return;
    }
    // Nowhere suitable in view — no high ground ahead. Try again shortly
    // rather than forcing one somewhere it would look wrong.
    this.wait = 40;
  }

  private clear() {
    this.group.visible = false;
    this.wait = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
  }
}
