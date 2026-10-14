import * as THREE from "three";
import { heightAt, normalAt } from "../world/field";
import { PropQuery } from "../world/props";
import { DynamicShadow } from "../world/shadows";
import { makeCharacter, makeVehicle, type Character, type Vehicle } from "./models";
import type { Controls } from "../input/controls";

const WALK = 2.3;
const RUN = 5.2;
const GRAVITY = 24;
const JUMP = 7.2;
const EYE = 1.55;

// Drag sets the real ceiling: steady state is ACCEL/DRAG, so that has to clear
// DRIVE_TOP or the clamp never comes into play and the truck feels capped low.
const DRIVE_TOP = 48; // ~173 km/h
const DRIVE_REVERSE = 13;
const DRIVE_ACCEL = 27;
const DRIVE_BRAKE = 30;
const DRIVE_DRAG = 0.5; // 27 / 0.5 = 54 > DRIVE_TOP

const MOUNT_RANGE = 4.5;

/**
 * How fast the camera eases round behind a walker. Movement is camera-relative,
 * so this is a feedback loop by construction: hold the stick left and you arc
 * left as the camera follows. That IS the wanted behaviour — changing direction
 * brings the camera round — so the rate is what matters. At 0.7 a full-strafe
 * arc takes about six seconds, which reads as a turn rather than a spin.
 */
const FOLLOW_RATE = 0.7;
/** Grace after the player last touched the look, so it never fights them. */
const FOLLOW_GRACE = 0.35;
/** ~5x magnification against the default 62 degree view. */
const GLASS_FOV = 13;

const VEH_GRAVITY = 26;
const VEH_JUMP = 10.5;
/** Head-on closing speed above which a bump becomes a crash. */
const CRASH_SPEED = 7;
/** The truck as two circles along its spine — close enough to a 4.1x1.9 box. */
const BODY_R = 1.15;
const BODY_OFFSET = 1.25;
const FOOT_R = 0.42;

/**
 * The camp tether.
 *
 * Inside CAMP_FREE nothing happens at all. Past it, only the component of your
 * movement pointing AWAY from the fire is damped — movement across the circle
 * is never touched, so you can always walk around the fire at full speed. That
 * is the difference between being held somewhere and being penned in: a wall
 * stops you whichever way you face, this only resists the one direction that
 * would end the camp without you saying so.
 *
 * To actually leave, you break camp. That's the door, and it's always open.
 */
const CAMP_FREE = 3.2;
const CAMP_REACH = 6.6;

export type Mode = "foot" | "drive";

/** Player, vehicle and the chase camera — they're one coupled system. */
export class Player {
  readonly group = new THREE.Group();
  readonly character: Character;
  readonly vehicle: Vehicle;

  position = new THREE.Vector3(0, 0, 0);
  heading = 0;
  mode: Mode = "foot";
  distanceTravelled = 0;
  speed = 0;
  grounded = true;

  /** Hooks for audio and anything else that cares about discrete moments. */
  onLand?: () => void;
  onMount?: () => void;
  onDismount?: () => void;
  /** Fired on a real impact. `force` is 0..1. */
  onCrash?: (force: number) => void;
  onVehicleLand?: (force: number) => void;

  /** Shadows fade out with the sun. */
  setSunElevation(e: number) {
    this.footShadow.setStrength(e);
    this.vehShadow.setStrength(e);
  }

  private velY = 0;
  private throttle = 0;
  private props = new PropQuery();
  private shake = 0;
  /**
   * Collision circles contributed by nearby landmarks. Kept separate from the
   * prop query because landmarks are placed on a far coarser grid — and because
   * an arch has to be two legs you can drive between, not one blocking disc.
   */
  landmarkSolids: { x: number; z: number; radius: number }[] = [];

  private vehPos = new THREE.Vector3();
  private vehHeading = 0;
  private vehSpeed = 0;
  private vehSteer = 0;
  private vehVelY = 0;
  private vehAir = false;
  private vehQuat = new THREE.Quaternion();

  private camYaw = 0;
  private camPitch = -0.22;
  private camDist = 9;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camInit = false;
  private warmedUp = false;
  private lookIdle = 0;
  private glassTime = 0;
  private baseFov: number;

  private footShadow = new DynamicShadow(0.62, 0.62);
  private vehShadow = new DynamicShadow(1.5, 2.6);

  constructor(private camera: THREE.PerspectiveCamera, spawn: THREE.Vector2) {
    this.baseFov = camera.fov;
    this.character = makeCharacter();
    this.vehicle = makeVehicle();
    this.group.add(
      this.character.root,
      this.vehicle.root,
      this.footShadow.mesh,
      this.vehShadow.mesh
    );

    this.position.set(spawn.x, heightAt(spawn.x, spawn.y), spawn.y);
    // Park the truck a pace away — inside MOUNT_RANGE, so the "drive" prompt is
    // up from the first frame and the core verb is discoverable without hunting.
    this.vehPos.set(spawn.x + 3.2, 0, spawn.y + 2.4);
    this.vehPos.y = heightAt(this.vehPos.x, this.vehPos.z);
  }

  /** Everything the soundscape needs to voice the truck. */
  get vehicleState() {
    return {
      speed: this.vehSpeed,
      throttle: this.throttle,
      y: this.vehPos.y,
      topSpeed: DRIVE_TOP,
    };
  }

  /** Camp wants you stopped and out of the truck. */
  get canCamp(): boolean {
    return this.mode === "foot" && this.grounded && this.speed < 0.2;
  }

  get nearVehicle(): boolean {
    return this.mode === "foot" && this.position.distanceTo(this.vehPos) < MOUNT_RANGE;
  }

  /** Binoculars up. Slows the look, narrows the lens, moves to the eye. */
  glassing = false;
  /** Photo mode — unlocks the orbit range. */
  freeCamera = false;
  /**
   * While camped the camera leaves the player alone and orbits the fire.
   * Set by main each frame from the Camp.
   */
  campCamera: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** The fire, while camped. Movement is softly held around it. */
  campAnchor: THREE.Vector3 | null = null;
  /**
   * Settled into a place — soaking, sitting, up a lookout. While this is set
   * the character doesn't walk at all: they're put exactly where the feature
   * wants them, which is the difference between being somewhere and standing
   * near it.
   */
  featureHold: THREE.Vector3 | null = null;
  /** True once the tether is noticeably resisting — the HUD explains the door. */
  heldByCamp = false;

  update(dt: number, input: Controls) {
    this.glassing = input.glass;
    // Damped, not locked. 1/4.8 would be true 1:1 screen motion at this
    // magnification, but it reads as stuck — this is looser while still far
    // steadier than hip-fire, so you can sweep a horizon without swinging.
    const aim = this.glassing ? 0.42 : 1;
    this.camYaw += input.look.x * aim;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + input.look.y * aim, -1.1, 0.75);
    // Photo mode opens the orbit right up; in play it stays a chase camera.
    const far = this.freeCamera ? 90 : 26;
    this.camDist = THREE.MathUtils.clamp(this.camDist + input.zoom * (this.freeCamera ? 1.6 : 0.6), 1.6, far);

    if (input.interact) {
      if (this.mode === "foot" && this.nearVehicle) {
        this.mode = "drive";
        this.onMount?.();
      } else if (this.mode === "drive") {
        this.dismount();
      }
    }

    if (this.mode === "foot") this.updateOnFoot(dt, input);
    else this.updateDriving(dt, input);

    this.character.root.visible = this.mode === "foot";
    this.footShadow.mesh.visible = this.mode === "foot";
    if (this.mode === "foot") {
      const g = heightAt(this.position.x, this.position.z);
      this.footShadow.update(this.position.x, this.position.z, g, this.heading, this.position.y - g);
    }
    const vg = heightAt(this.vehPos.x, this.vehPos.z);
    this.vehShadow.update(this.vehPos.x, this.vehPos.z, vg, this.vehHeading, this.vehPos.y - vg);

    this.updateCamera(dt);
  }

  // --- on foot ---------------------------------------------------------------

  private updateOnFoot(dt: number, input: Controls) {
    if (this.featureHold) {
      this.position.copy(this.featureHold);
      this.speed = 0;
      this.character.root.position.copy(this.position);
      this.character.root.rotation.y = this.heading;
      this.character.animate(dt, 0, false);
      this.placeVehicle(dt, 0, false);
      return;
    }

    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);

    let dx = rx * input.move.x + fx * input.move.y;
    let dz = rz * input.move.x + fz * input.move.y;
    const len = Math.hypot(dx, dz);

    let moveSpeed = 0;
    let faceX = 0;
    let faceZ = 0;
    if (len > 0.001) {
      dx /= len;
      dz /= len;
      // Face where you're pushing even if the tether is holding you, so leaning
      // against it reads as leaning rather than as a glitch.
      faceX = dx;
      faceZ = dz;

      const n = normalAt(this.position.x, this.position.z, 1.5);
      // Climbing costs you; a 45° face is barely walkable.
      const grade = -(n.x * dx + n.z * dz) / Math.max(n.y, 0.2);
      const effort = THREE.MathUtils.clamp(1 - Math.max(0, grade) * 0.85, 0.22, 1.12);

      const held = this.campTether(dx, dz);
      dx = held.x;
      dz = held.z;
      const mag = Math.hypot(dx, dz);
      moveSpeed = (input.sprint ? RUN : WALK) * Math.min(len, 1) * effort * mag;
      if (mag > 1e-4) {
        dx /= mag;
        dz /= mag;
        this.position.x += dx * moveSpeed * dt;
        this.position.z += dz * moveSpeed * dt;
        this.distanceTravelled += moveSpeed * dt;
      }
      this.heading = this.approachAngle(this.heading, Math.atan2(faceX, faceZ), dt * 9);
    }

    this.settleToCamp(dt);
    this.speed = moveSpeed;

    const ground = heightAt(this.position.x, this.position.z);
    if (this.grounded && input.jump) {
      this.velY = JUMP;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.velY -= GRAVITY * dt;
      this.position.y += this.velY * dt;
      if (this.position.y <= ground) {
        this.position.y = ground;
        this.velY = 0;
        this.grounded = true;
        this.onLand?.();
      }
    } else {
      // Glide onto the surface rather than snapping, so steps don't jolt the camera.
      this.position.y += (ground - this.position.y) * Math.min(1, dt * 18);
      if (ground - this.position.y > 0.6) this.position.y = ground;
    }

    this.pushOutOfProps(this.position, FOOT_R);
    this.followOnFoot(dt, input, moveSpeed, faceX, faceZ);

    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.heading;
    this.character.animate(dt, moveSpeed, !this.grounded);

    this.placeVehicle(dt, 0, false);
  }

  /**
   * Ease the camera round behind the walker, so changing direction doesn't need
   * a second thumb.
   *
   * The rate is scaled by how far from the camera you're heading. Walking
   * straight out follows fully; strafing arcs gently; backing toward the camera
   * doesn't follow at all, because swinging 180 degrees to get behind someone
   * walking at the lens is exactly the whip this is supposed to avoid.
   */
  private followOnFoot(dt: number, input: Controls, speed: number, faceX: number, faceZ: number) {
    this.lookIdle = input.look.x !== 0 ? 0 : this.lookIdle + dt;
    if (this.freeCamera || this.glassing || this.campAnchor) return;
    if (this.lookIdle < FOLLOW_GRACE || speed < 0.4) return;

    const camFwdX = -Math.sin(this.camYaw);
    const camFwdZ = -Math.cos(this.camYaw);
    const awayness = faceX * camFwdX + faceZ * camFwdZ; // 1 = straight out, -1 = at the lens
    const weight = Math.min(1, Math.max(0, awayness + 0.35));
    if (weight <= 0) return;

    const rate = dt * FOLLOW_RATE * weight * Math.min(1, speed / WALK);
    this.camYaw = this.approachAngle(this.camYaw, this.heading + Math.PI, rate);
  }

  // --- driving ---------------------------------------------------------------

  private updateDriving(dt: number, input: Controls) {
    // Cruise holds the throttle open so a thumb only has to steer. Pulling
    // back still brakes, so it never takes control away.
    const throttle = input.cruise && input.move.y > -0.12 ? 1 : input.move.y;
    const steerInput = input.move.x;
    this.throttle = throttle;

    if (throttle > 0.02) {
      this.vehSpeed += DRIVE_ACCEL * throttle * dt;
    } else if (throttle < -0.02) {
      // Pulling back brakes while rolling forward, then backs up.
      const rate = this.vehSpeed > 0.5 ? DRIVE_BRAKE : DRIVE_ACCEL * 0.6;
      this.vehSpeed += rate * throttle * dt;
    }
    if (input.jump && !this.vehAir) {
      this.vehVelY = VEH_JUMP;
      this.vehAir = true;
    }

    // Rolling resistance, plus gravity along the slope. In the air there is no
    // slope to fight and no tyres to scrub, so neither applies.
    const n = normalAt(this.vehPos.x, this.vehPos.z, 2.5);
    const fwdX = Math.sin(this.vehHeading);
    const fwdZ = Math.cos(this.vehHeading);
    if (!this.vehAir) {
      const grade = -(n.x * fwdX + n.z * fwdZ) / Math.max(n.y, 0.2);
      this.vehSpeed -= grade * 9.0 * dt;
    }
    this.vehSpeed -= this.vehSpeed * DRIVE_DRAG * dt;
    this.vehSpeed = THREE.MathUtils.clamp(this.vehSpeed, -DRIVE_REVERSE, DRIVE_TOP);

    // Steering authority falls off with speed, so it isn't twitchy at pace.
    const authority = 1.6 / (1 + Math.abs(this.vehSpeed) * 0.075);
    this.vehSteer = THREE.MathUtils.lerp(this.vehSteer, steerInput, Math.min(1, dt * 7));
    // Heading SUBTRACTS steer. Forward is (sin h, 0, cos h), so from a chase
    // camera the viewer's right is -(cos h, 0, -sin h) — rising `h` swings the
    // truck to screen-left. Sign must match the front-wheel visual below.
    // Reversing flips it, as it does on a real car (bicycle model: dh ∝ v·tanδ).
    this.vehHeading -= this.vehSteer * authority * Math.sign(this.vehSpeed) * Math.min(Math.abs(this.vehSpeed) / 5, 1) * dt;

    // Swing the camera back behind the truck, but only once the player has
    // stopped looking around — otherwise it fights them for the stick.
    this.lookIdle = input.look.x !== 0 ? 0 : this.lookIdle + dt;
    if (this.lookIdle > 0.5 && Math.abs(this.vehSpeed) > 1.5) {
      const behind = this.vehHeading + Math.PI;
      const rate = dt * 1.6 * Math.min(1, Math.abs(this.vehSpeed) / 10);
      this.camYaw = this.approachAngle(this.camYaw, behind, rate);
    }

    this.vehPos.x += Math.sin(this.vehHeading) * this.vehSpeed * dt;
    this.vehPos.z += Math.cos(this.vehHeading) * this.vehSpeed * dt;
    this.distanceTravelled += Math.abs(this.vehSpeed) * dt;
    this.speed = Math.abs(this.vehSpeed);

    this.collideVehicle(fwdX, fwdZ);
    this.placeVehicle(dt, this.vehSpeed, true);

    this.position.copy(this.vehPos);
    this.position.y += 1.6;
    this.heading = this.vehHeading;
  }

  /**
   * Push the truck out of anything solid it has driven into, scrub the speed it
   * lost doing so, and report a crash if the hit was square and fast.
   */
  private collideVehicle(fwdX: number, fwdZ: number) {
    if (this.vehAir) return; // you can clear obstacles by jumping them
    const near = this.props.solidNear(this.vehPos.x, this.vehPos.z);
    const solids = this.landmarkSolids.length ? [...near, ...this.landmarkSolids] : near;
    if (!solids.length) return;

    let worst = 0;
    for (const off of [BODY_OFFSET, -BODY_OFFSET]) {
      const cx = this.vehPos.x + fwdX * off;
      const cz = this.vehPos.z + fwdZ * off;
      for (const p of solids) {
        const dx = cx - p.x;
        const dz = cz - p.z;
        const min = BODY_R + p.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;

        const d = Math.sqrt(d2) || 0.0001;
        const nx = dx / d;
        const nz = dz / d;
        this.vehPos.x += nx * (min - d);
        this.vehPos.z += nz * (min - d);

        // How much of our travel was straight into it, versus a graze.
        const into = -(fwdX * nx + fwdZ * nz) * this.vehSpeed;
        if (into <= 0) continue;
        const headOn = Math.min(into / Math.max(Math.abs(this.vehSpeed), 0.01), 1);
        this.vehSpeed *= 1 - 0.92 * headOn;
        if (into > worst) worst = into;
      }
    }

    if (worst > CRASH_SPEED) {
      const force = Math.min((worst - CRASH_SPEED) / 18, 1);
      this.vehSpeed = -worst * 0.07; // a short bounce back off the trunk
      this.shake = Math.max(this.shake, 0.35 + force * 0.65);
      this.vehicle.dent(force);
      this.onCrash?.(force);
    }
  }

  /**
   * Damp only the outward half of a movement. Returns the adjusted vector;
   * magnitude below 1 means the tether is taking some of it.
   */
  private campTether(dx: number, dz: number): { x: number; z: number } {
    this.heldByCamp = false;
    if (!this.campAnchor) return { x: dx, z: dz };

    const ax = this.position.x - this.campAnchor.x;
    const az = this.position.z - this.campAnchor.z;
    const dist = Math.hypot(ax, az);
    if (dist <= CAMP_FREE || dist < 1e-4) return { x: dx, z: dz };

    const ox = ax / dist;
    const oz = az / dist;
    const outward = dx * ox + dz * oz;
    if (outward <= 0) return { x: dx, z: dz }; // heading back in — never resisted

    // Quadratic, so the hold arrives gradually instead of as a step.
    const t = Math.min(1, (dist - CAMP_FREE) / (CAMP_REACH - CAMP_FREE));
    const remove = outward * t * t;
    this.heldByCamp = t > 0.45;
    return { x: dx - ox * remove, z: dz - oz * remove };
  }

  /** A slow drift back if anything ever put you outside the circle. */
  private settleToCamp(dt: number) {
    if (!this.campAnchor) return;
    const ax = this.position.x - this.campAnchor.x;
    const az = this.position.z - this.campAnchor.z;
    const dist = Math.hypot(ax, az);
    if (dist <= CAMP_REACH || dist < 1e-4) return;
    const pull = (dist - CAMP_REACH) * Math.min(1, dt * 1.8);
    this.position.x -= (ax / dist) * pull;
    this.position.z -= (az / dist) * pull;
    this.heldByCamp = true;
  }

  /** Slide a walker out of any solid prop they've wandered into. */
  private pushOutOfProps(pos: THREE.Vector3, radius: number) {
    const near = this.props.solidNear(pos.x, pos.z);
    for (const p of this.landmarkSolids.length ? [...near, ...this.landmarkSolids] : near) {
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const min = radius + p.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.0001;
      pos.x += (dx / d) * (min - d);
      pos.z += (dz / d) * (min - d);
    }
  }

  /** Sit the truck on the ground, averaging the four contact patches. */
  private placeVehicle(dt: number, speed: number, airborne: boolean) {
    const hx = Math.sin(this.vehHeading);
    const hz = Math.cos(this.vehHeading);
    const sx = hz;
    const sz = -hx;
    let sum = 0;
    for (const [f, s] of [
      [1.35, 0.95],
      [1.35, -0.95],
      [-1.35, 0.95],
      [-1.35, -0.95],
    ]) {
      sum += heightAt(this.vehPos.x + hx * f + sx * s, this.vehPos.z + hz * f + sz * s);
    }
    const groundY = sum / 4;

    if (airborne && this.vehAir) {
      this.vehVelY -= VEH_GRAVITY * dt;
      this.vehPos.y += this.vehVelY * dt;
      if (this.vehPos.y <= groundY) {
        const impact = -this.vehVelY;
        this.vehPos.y = groundY;
        this.vehVelY = 0;
        this.vehAir = false;
        if (impact > 4) {
          const force = Math.min(impact / 18, 1);
          this.shake = Math.max(this.shake, force * 0.5);
          this.onVehicleLand?.(force);
        }
      }
    } else {
      this.vehPos.y = groundY;
      this.vehAir = false;
    }

    const n = normalAt(this.vehPos.x, this.vehPos.z, 2.5);
    const up = new THREE.Vector3(n.x, n.y, n.z);
    const fwd = new THREE.Vector3(hx, 0, hz);
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const target = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, fwd)
    );
    // Smooth the body attitude so bumps lean the truck instead of snapping it.
    // In the air the body holds its attitude instead of snapping to the ground
    // it isn't touching.
    this.vehQuat.slerp(target, this.warmedUp ? Math.min(1, dt * (this.vehAir ? 1.4 : 7)) : 1);
    this.warmedUp = true;

    this.vehicle.root.position.copy(this.vehPos);
    this.vehicle.root.quaternion.copy(this.vehQuat);
    this.vehicle.animate(dt, speed, this.vehSteer);
  }

  private dismount() {
    const sx = Math.cos(this.vehHeading);
    const sz = -Math.sin(this.vehHeading);
    const x = this.vehPos.x + sx * 2.4;
    const z = this.vehPos.z + sz * 2.4;
    this.position.set(x, heightAt(x, z), z);
    this.mode = "foot";
    this.velY = 0;
    this.grounded = true;
    this.vehSpeed = 0;
    this.throttle = 0;
    this.vehVelY = 0;
    this.vehAir = false;
    this.onDismount?.();
  }

  // --- camera ----------------------------------------------------------------

  private updateCamera(dt: number) {
    if (this.glassing) return this.updateGlassCamera(dt);
    if (this.campCamera) {
      this.camera.fov += (this.baseFov - this.camera.fov) * Math.min(1, dt * 9);
      this.camera.updateProjectionMatrix();
      // Ease in so striking camp doesn't snap the view.
      const k = this.camInit ? 1 - Math.pow(0.02, dt) : 1;
      this.camInit = true;
      this.camPos.lerp(this.campCamera.pos, k);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.campCamera.look);
      return;
    }
    this.camera.fov += (this.baseFov - this.camera.fov) * Math.min(1, dt * 9);
    this.camera.updateProjectionMatrix();
    const driving = this.mode === "drive";
    const dist = driving ? this.camDist * 1.25 : this.camDist;
    const height = driving ? 2.2 : EYE;

    this.camTarget.set(this.position.x, this.position.y + height, this.position.z);

    const cp = Math.cos(this.camPitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.camYaw) * cp,
      Math.sin(this.camPitch),
      -Math.cos(this.camYaw) * cp
    );

    const want = this.camTarget.clone().addScaledVector(dir, -dist);
    // Never let the camera end up inside a hillside.
    const floor = heightAt(want.x, want.z) + 1.6;
    if (want.y < floor) want.y = floor;

    const k = this.camInit ? 1 - Math.pow(0.0015, dt) : 1;
    this.camInit = true;
    this.camPos.lerp(want, k);
    this.camera.position.copy(this.camPos);

    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.04, dt); // ~0.3 s to settle
      const a = this.shake * 0.9;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
    } else {
      this.shake = 0;
    }
    this.camera.lookAt(this.camTarget);
  }

  /**
   * Glassing puts the camera at the player's eye and narrows the lens, with a
   * slow unsteadiness so a distant shape never sits perfectly still — which is
   * what makes a long lens feel long.
   */
  private updateGlassCamera(dt: number) {
    this.glassTime += dt;
    this.camera.fov += (GLASS_FOV - this.camera.fov) * Math.min(1, dt * 7);
    this.camera.updateProjectionMatrix();

    const eye = this.mode === "drive" ? 2.0 : EYE;
    this.camera.position.set(this.position.x, this.position.y + eye, this.position.z);
    this.camPos.copy(this.camera.position);

    const t = this.glassTime;
    const wobbleY = Math.sin(t * 0.9) * 0.0026 + Math.sin(t * 2.3) * 0.0011;
    const wobbleP = Math.cos(t * 1.1) * 0.0022 + Math.sin(t * 3.1) * 0.0008;
    const yaw = this.camYaw + wobbleY;
    const pitch = this.camPitch + wobbleP;

    const cp = Math.cos(pitch);
    this.camTarget.set(
      this.camera.position.x - Math.sin(yaw) * cp,
      this.camera.position.y + Math.sin(pitch),
      this.camera.position.z - Math.cos(yaw) * cp
    );
    this.camera.lookAt(this.camTarget);
  }

  private approachAngle(from: number, to: number, t: number) {
    let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return from + d * Math.min(1, t);
  }
}
