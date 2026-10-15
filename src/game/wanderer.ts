import * as THREE from "three";
import { heightAt } from "../world/field";
import { CLASSES, SPECS, makeFor, type VehicleClass } from "./vehicles";
import type { Vehicle } from "./models";

/**
 * The other wanderer.
 *
 * Occasionally you crest a ridge and there is somebody on the far slope going
 * the other way. They flash their lights. They are gone. No dialogue, no name,
 * no meeting, and nothing is owed in either direction.
 *
 * It has to be an EVENT rather than a simulated traveller. A genuinely
 * independent wanderer loose in an unbounded world would never once be seen,
 * so this schedules itself: a long wait, then somebody crosses your path at a
 * distance, drives on, and does not come back. Being honest about that is
 * better than pretending there is one truck out there somewhere.
 *
 * The whole point is rarity. The wait is deliberately long enough that it is a
 * thing you tell somebody about rather than a feature you notice.
 */

/** Real seconds between encounters. Long on purpose. */
const WAIT_MIN = 20 * 60;
const WAIT_MAX = 45 * 60;
/** How far out they appear, and how far past you they get before giving up. */
const SPAWN = 900;
const GONE = 1700;
/**
 * Close enough to notice each other.
 *
 * Was 320 m, and measured over twelve encounters the closest anyone ever got
 * was 470 m — so the lights never flashed once, which is the entire
 * interaction. They cross wide on purpose; the threshold has to match that.
 */
const FLASH_AT = 650;

type Phase = "waiting" | "passing";

export class Wanderer {
  readonly group = new THREE.Group();
  /** Fires once, the first time you ever see one. */
  onSeen?: (cls: VehicleClass) => void;

  private phase: Phase = "waiting";
  private wait = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
  private body: Vehicle | null = null;
  /** Which class the current body actually is. */
  private builtCls: VehicleClass | null = null;
  private cls: VehicleClass = "truck";
  private pos = new THREE.Vector3();
  private heading = 0;
  private speed = 0;
  private flashed = false;
  private flashTimer = 0;
  private seen = false;

  constructor() {
    this.group.visible = false;
  }

  update(dt: number, player: THREE.Vector3, playerHeading: number) {
    if (this.phase === "waiting") {
      this.wait -= dt;
      if (this.wait <= 0) this.begin(player, playerHeading);
      return;
    }

    const spec = SPECS[this.cls];
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    this.pos.y = heightAt(this.pos.x, this.pos.z) + (spec.flies ? 60 : 0);

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    this.body?.animate(dt, this.speed, 0);

    const d = this.pos.distanceTo(player);

    // The flash. Once, when you are close enough to have seen each other, and
    // then nothing — the entire interaction.
    if (!this.flashed && d < FLASH_AT) {
      this.flashed = true;
      this.flashTimer = 1.6;
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.body?.setLights(Math.floor(this.flashTimer * 4) % 2 === 0);
    } else if (this.flashed) {
      this.body?.setLights(false);
    }

    if (!this.seen && d < SPAWN * 0.8) {
      this.seen = true;
      this.onSeen?.(this.cls);
    }

    if (d > GONE) this.end();
  }

  private begin(player: THREE.Vector3, playerHeading: number) {
    this.cls = CLASSES[Math.floor(Math.random() * CLASSES.length)];
    if (!this.body || this.cls !== this.builtCls) {
      // Rebuild only when the class changes, same as the strays. Comparing
      // against what was actually BUILT — the first version compared the new
      // class against its own spec's class, which is itself, so it only ever
      // built once and then showed the wrong vehicle for the rest of the
      // session.
      if (this.body) this.group.remove(this.body.root);
      this.body = makeFor(this.cls, 0x8a7f6a);
      this.builtCls = this.cls;
      this.group.add(this.body.root);
    }
    // Repainted every time, so a reused body is not recognisably the same
    // truck you saw an hour ago — there is supposed to be only one of these,
    // and the illusion is cheap to keep.
    this.body.setPaint([0x8a7f6a, 0x6f7a6a, 0x9a6a4a, 0x5c6670][Math.floor(Math.random() * 4)]);

    // Put them off to one side of where you are looking and send them across,
    // so they pass through the view rather than head-on down it. Head-on would
    // read as traffic; across reads as somebody else's journey.
    const side = Math.random() < 0.5 ? 1 : -1;
    const offAngle = playerHeading + side * (0.5 + Math.random() * 0.5);
    this.pos.set(
      player.x + Math.sin(offAngle) * SPAWN,
      0,
      player.z + Math.cos(offAngle) * SPAWN
    );
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    // Crossing, not converging: aimed to pass wide of you.
    this.heading = Math.atan2(player.x - this.pos.x, player.z - this.pos.z) - side * 0.42;
    this.speed = SPECS[this.cls].top * (0.4 + Math.random() * 0.2);

    this.flashed = false;
    this.flashTimer = 0;
    this.seen = false;
    this.phase = "passing";
    // Place the body NOW. Position was only copied in update, so the first
    // frame of an encounter drew them at wherever they were last time — or at
    // the world origin, on the first one.
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    this.body.setLights(false);
    this.group.visible = true;
  }

  private end() {
    this.phase = "waiting";
    this.wait = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
    this.group.visible = false;
  }
}
