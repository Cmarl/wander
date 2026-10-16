import * as THREE from "three";
import { heightAt, normalAt, slopeAt, SEA_LEVEL } from "../world/field";
import { PropQuery } from "../world/props";
import { DynamicShadow } from "../world/shadows";
import { makeCharacter, type Character, type Vehicle } from "./models";
import { SPECS, makeFor, type VehicleClass, type VehicleSpec } from "./vehicles";
import { STOCK, tuned, type Tune } from "./parts";
import { PAINTS } from "./paint";
import type { Controls } from "../input/controls";

/**
 * On foot.
 *
 * Clyde: "walking speed should be increased as well." 2.3 m/s is a real
 * walking pace and it reads as a trudge in a world this size, where the
 * nearest anything is a kilometre off. 3.4 is a brisk walk that still looks
 * like walking.
 */
const WALK = 3.4;
const RUN = 7.0;
/**
 * Swimming. Slower than walking, as it should be — crossing water is a
 * decision, not a shortcut. Fast enough that a lake is a pleasant few minutes
 * rather than a chore.
 */
const SWIM = 2.2;
/** Deeper than this and your feet are off the bottom. */
const SWIM_DEPTH = 1.25;
/** How much of you is under when swimming. */
const FLOAT = 0.42;
const GRAVITY = 24;
const JUMP = 7.2;
const EYE = 1.55;

// Drag sets the real ceiling: steady state is ACCEL/DRAG, so that has to clear
// this.spec.top or the clamp never comes into play and the truck feels capped low.
// These now live on the vehicle spec — see game/vehicles.ts. They were
// module constants when there was one vehicle, and a motorcycle that handles
// exactly like a truck is just a truck with a different mesh.

const MOUNT_RANGE = 4.5;
/**
 * Far enough away that calling it is the sensible thing.
 *
 * This was 40 m, which opened a DEAD ZONE: between stepping-in range and forty
 * metres, the interact key did nothing at all and showed no prompt. Clyde hit
 * exactly that — "I'm itching to fly my plane. no idea how and E didn't work".
 *
 * Just past stepping-in range now. If you cannot get in, you can call it, and
 * there is no gap between the two where the key is dead.
 */
const SUMMON_MIN = 7;
/** Inside MOUNT_RANGE so you can step straight in, clear of the body itself. */
const SUMMON_RANGE = 4.2;

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
/**
 * How deep a wheeled vehicle will go before the water wins.
 *
 * About axle height on the truck. Below this you ford it; above it you stop.
 */
const VEH_WADE = 0.9;
/**
 * How far past the flat top speed a full descent can take you.
 *
 * 0.38 puts the truck a little over 66 m/s on the steepest sustained ground
 * worth driving, against 48 on the flat. Fast enough to feel like the hill is
 * giving you something, short of the point where steering stops being an
 * option.
 */
const OVERSPEED = 0.38;
/** Head-on closing speed above which a bump becomes a crash. */
const CRASH_SPEED = 7;
/** Two circles along the spine. Radius and spacing come from the spec. */
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
  vehicle: Vehicle;
  /** Which vehicle this is, and all of its handling, with parts fitted. */
  spec: VehicleSpec;
  /** The same vehicle before anything was bolted to it. */
  private baseSpec: VehicleSpec;
  private kitTune: Tune = STOCK;

  /**
   * Refit. Called when a part is found or the vehicle changes.
   *
   * Recomputed on an event rather than read per frame, because the spec is
   * touched a dozen times a frame by the driving code and allocating a tuned
   * copy each time would be a real cost for no reason.
   */
  retune(t: Tune) {
    this.kitTune = t;
    this.spec = tuned(this.baseSpec, t);
  }

  position = new THREE.Vector3(0, 0, 0);
  heading = 0;
  mode: Mode = "foot";
  distanceTravelled = 0;
  speed = 0;
  grounded = true;

  /** Hooks for audio and anything else that cares about discrete moments. */
  onLand?: () => void;
  /** Leaving the ground, on foot or in a vehicle. */
  onJump?: (inVehicle: boolean) => void;
  /** Driving through water, 0..1 by how hard. */
  onSplash?: (force: number) => void;
  /** How deep the wheels are, 0..1 of wading depth. */
  vehWading = 0;
  onMount?: () => void;
  onDismount?: () => void;
  /** Fired on a real impact. `force` is 0..1. */
  onCrash?: (force: number) => void;
  onSummon?: () => void;
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
  /** Jump held while flying, i.e. "up". */
  private vehClimb = false;
  /** Shift held while flying, i.e. "down". */
  private vehDescend = false;
  /** Ground height under the vehicle last frame, and how fast it was moving. */
  private vehGroundY = 0;
  private vehGroundRate = 0;
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
    this.baseSpec = SPECS.truck;
    this.spec = SPECS.truck;
    this.vehicle = makeFor(this.spec.cls, PAINTS[0].hex);
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

  /**
   * Swap which vehicle is yours.
   *
   * Rebuilds the body and takes the spec with it, so handling changes with the
   * shape. Only ever called while on foot — swapping the vehicle out from
   * under a driver would leave them sitting on a seat that no longer exists.
   */
  switchTo(cls: VehicleClass, paint: number) {
    if (this.mode !== "foot" || cls === this.spec.cls) return;
    this.group.remove(this.vehicle.root);
    this.baseSpec = SPECS[cls];
    this.spec = tuned(this.baseSpec, this.kitTune);
    this.vehicle = makeFor(cls, paint);
    this.group.add(this.vehicle.root);
    // Lights are set from the sun every frame, so the new body picks them up
    // on the next one without anything needing to be told about the swap.
  }

  /**
   * Take over a vehicle standing in the world.
   *
   * Clyde: "I was expecting to be able to just get into the plane. I can't. it
   * adds it to my vehicle menu to be set as summonable."
   *
   * He is right and the old behaviour was wrong. Walking up to a machine and
   * getting in is the obvious thing; a garage is for calling one BACK, not for
   * permission to use the one you are standing next to.
   *
   * Rather than add a third claimant to the interact key — which is how the
   * "can't get out of the truck" bug happened — the vehicle you walked up to
   * simply becomes yours, parked exactly where it stands. From there the
   * existing "E to get in" path handles it, because your vehicle is now the
   * thing in front of you.
   */
  adopt(cls: VehicleClass, paint: number, x: number, z: number, rot: number) {
    if (this.mode !== "foot") return;
    if (cls !== this.spec.cls) this.switchTo(cls, paint);
    else this.vehicle.setPaint(paint);
    this.vehPos.set(x, heightAt(x, z), z);
    this.vehHeading = rot;
    this.vehSpeed = 0;
    this.vehVelY = 0;
    this.vehAir = false;
    this.warmedUp = false; // settle onto the local slope without a lurch
  }

  /** Everything the soundscape needs to voice the truck. */
  get vehicleState() {
    return {
      speed: this.vehSpeed,
      throttle: this.throttle,
      y: this.vehPos.y,
      topSpeed: this.spec.top,
    };
  }

  /** 0 at the door, 1 at the edge of reach, Infinity if out of reach. */
  get vehicleProximity(): number {
    if (this.mode !== "foot") return Infinity;
    const d = this.position.distanceTo(this.vehPos);
    return d <= MOUNT_RANGE ? d / MOUNT_RANGE : Infinity;
  }

  /** On foot and far enough from the truck that calling it is reasonable. */
  get canSummon(): boolean {
    // Not while swimming. Calling a truck to you in the middle of a lake would
    // drop it somewhere it cannot move, and you cannot get into it anyway.
    return (
      this.mode === "foot" && !this.swimming && this.position.distanceTo(this.vehPos) > SUMMON_MIN
    );
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
  /**
   * A floor above the ground you can walk about on — a lookout deck.
   *
   * Movement is ordinary; only the height and the edges are overridden, so
   * nothing about walking has to know this exists.
   */
  platform: { x: number; z: number; y: number; half: number } | null = null;
  /**
   * Riding in somebody else's truck. Their client owns the driving entirely;
   * we just place ourselves in a seat each frame and send the result, so peers
   * never have to resolve who is riding with whom to draw us correctly.
   */
  ridingHost: number | null = null;
  /** In water past your chest, floating. */
  swimming = false;
  /** In water, but still on the bottom. */
  wading = false;
  /** Yaw of whatever camera currently owns the view, if not the chase camera. */
  holdYaw: number | null = null;
  /**
   * Set when something nearer than the truck wants this frame's interact.
   * There is only one interaction verb in the game, so whoever is closest wins
   * it rather than the player learning a second button.
   */
  suppressInteract = false;
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

    if (input.interact && !this.suppressInteract) {
      if (this.mode === "foot" && this.nearVehicle) {
        this.mode = "drive";
        this.onMount?.();
      } else if (this.mode === "drive") {
        this.dismount();
      } else if (this.canSummon) {
        // E is simply "deal with the truck": step in if it's here, call it if
        // it isn't. No extra control to learn.
        this.summon();
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
      this.placeVehicle(dt, 0, true);
      return;
    }

    // While a hold camera is in charge, steer relative to IT. Using camYaw
    // would mean pushing forward walks along a heading you cannot see.
    const basis = this.holdYaw ?? this.camYaw;
    const fx = -Math.sin(basis);
    const fz = -Math.cos(basis);
    const rx = Math.cos(basis);
    const rz = -Math.sin(basis);

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
      // Wading slows you, swimming is its own pace, and you cannot sprint
      // through either.
      const base = this.swimming ? SWIM : this.wading ? WALK * 0.55 : input.sprint ? RUN : WALK;
      moveSpeed = base * Math.min(len, 1) * (this.swimming ? 1 : effort) * mag;
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

    /**
     * Standing on something that is not the ground.
     *
     * Clyde climbed a fire tower and ended up under it: "big when I climb I
     * sit just as high so worse". The lift was a fixed number of metres while
     * the tower scales — widening the size range made a fixed 17.2 m land
     * nine metres below a deck that had moved to 31.
     *
     * Rather than pin him at the right altitude, the deck is a FLOOR. You walk
     * on it, within its edges, and the view is yours to look around from —
     * which is what he actually asked for and what a lookout is for.
     */
    let ground = heightAt(this.position.x, this.position.z);

    /**
     * Water.
     *
     * Shallow enough to stand in and you wade; past your chest and you swim,
     * floating at the surface rather than walking along the bottom. Getting
     * out is simply walking up a shore that rises above the waterline, so
     * there is no entering or leaving to manage and nothing to press.
     */
    const depth = SEA_LEVEL - ground;
    this.wading = depth > 0.25 && depth <= SWIM_DEPTH;
    this.swimming = depth > SWIM_DEPTH;
    if (this.swimming) {
      ground = SEA_LEVEL - FLOAT;
      this.velY = 0;
      this.grounded = true;
    }

    if (this.platform) {
      const p = this.platform;
      this.position.x = THREE.MathUtils.clamp(this.position.x, p.x - p.half, p.x + p.half);
      this.position.z = THREE.MathUtils.clamp(this.position.z, p.z - p.half, p.z + p.half);
      ground = p.y;
    }
    if (this.grounded && input.jump) {
      this.onJump?.(false);
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

    this.placeVehicle(dt, 0, true);
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
      this.vehSpeed += this.spec.accel * throttle * dt;
    } else if (throttle < -0.02) {
      // Pulling back brakes while rolling forward, then backs up.
      const rate = this.vehSpeed > 0.5 ? this.spec.brake : this.spec.accel * 0.6;
      this.vehSpeed += rate * throttle * dt;
    }
    // For a flyer, jump is the climb control. Latched here because the
    // altitude is integrated in placeVehicle, which never sees the input.
    // The HELD flag, not the one-frame pulse. The pulse made "hold to climb"
    // a single frame of lift per press, which is indistinguishable from the
    // control not existing.
    this.vehClimb = input.jumpHeld;
    this.vehDescend = input.down;
    if (input.jump && !this.vehAir && !this.spec.flies) {
      this.vehVelY = this.spec.jump;
      this.vehAir = true;
      this.onJump?.(true);
    }

    // Rolling resistance, plus gravity along the slope. In the air there is no
    // slope to fight and no tyres to scrub, so neither applies.
    const n = normalAt(this.vehPos.x, this.vehPos.z, 2.5);
    const fwdX = Math.sin(this.vehHeading);
    const fwdZ = Math.cos(this.vehHeading);
    // Positive uphill, negative nose-down. Zero in the air, where there is no
    // slope under you to help or hinder.
    const grade = this.vehAir ? 0 : -(n.x * fwdX + n.z * fwdZ) / Math.max(n.y, 0.2);
    if (!this.vehAir) this.vehSpeed -= grade * this.spec.gradePull * dt;
    this.vehSpeed -= this.vehSpeed * this.spec.drag * dt;

    /**
     * Top speed is a FLATLAND cap, not an absolute one.
     *
     * Clyde: "driving a truck or other on ground vehicle down a big hill
     * should allow you to surpass the top speed of the vehicle reasonably."
     * Gravity was already pushing the vehicle along the slope — the hard clamp
     * was throwing that away, so a long descent felt identical to flat ground
     * and the mass the ledge physics gave the truck vanished the moment it
     * pointed downhill.
     *
     * The ceiling rises with how steeply you are pointed down, and going back
     * uphill lowers it again. Aircraft are excluded: a plane's speed is its
     * own business and it has no wheels on the hill.
     */
    const descent = this.spec.flies ? 0 : Math.max(0, -grade);
    const ceiling = this.spec.top * (1 + Math.min(descent, 1.1) * OVERSPEED);
    if (this.vehSpeed > ceiling) {
      // Bled off rather than snapped. Cresting out of a descent should coast
      // back to normal, and a hard clamp there reads as the brakes coming on
      // by themselves.
      this.vehSpeed -= (this.vehSpeed - ceiling) * Math.min(1, dt * 1.5);
    }
    this.vehSpeed = Math.max(this.vehSpeed, -this.spec.reverse);

    // Steering authority falls off with speed, so it isn't twitchy at pace.
    const authority =
      this.spec.turn / (1 + Math.abs(this.vehSpeed) * (this.spec.turnFalloff ?? 0.075));
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

    /**
     * Water stops a wheeled vehicle.
     *
     * Clyde: "can't drive or walk through water". Driving across a lake was
     * possible because the ground function simply carried on underneath it,
     * and a truck following the bottom of a bay looks exactly as wrong as it
     * sounds.
     *
     * The move is tested before it is taken: if the far side of this step is
     * under the waterline, the vehicle does not go there and the speed is
     * scrubbed hard rather than stopped dead, so arriving at a shore is a
     * halt rather than a wall. Aircraft are exempt, since they are above it.
     */
    const nx = this.vehPos.x + Math.sin(this.vehHeading) * this.vehSpeed * dt;
    const nz = this.vehPos.z + Math.cos(this.vehHeading) * this.vehSpeed * dt;
    /**
     * Where the water actually stops you.
     *
     * Clyde: "We need to very much so lower the shoreline threshold hitbox. I
     * was stopped driving because of water but I was 3 truck lengths from the
     * water."
     *
     * The test was `height < SEA_LEVEL + 0.35` — which is DRY LAND. It stopped
     * the truck on ground a third of a metre above the waterline, and on a
     * gentle shore a third of a metre of rise is many metres inland. He was
     * not near the water at all; he was standing on a beach hitting a wall.
     *
     * It now blocks only where the water is deep enough to genuinely stop a
     * vehicle, which also gives Clyde his other note for free: "I should be
     * able to pass very shallow water (and it should splash)". Anything
     * shallower than the axles is driven through, dragging as it goes.
     */
    const depth = SEA_LEVEL - heightAt(nx, nz);
    const amphibious = this.spec.flies || this.spec.floats;
    this.vehWading = !amphibious && depth > 0.05 ? Math.min(1, depth / VEH_WADE) : 0;

    if (!amphibious && depth > VEH_WADE) {
      this.vehSpeed *= 1 - Math.min(1, dt * 7);
    } else {
      this.vehPos.x = nx;
      this.vehPos.z = nz;
      // Water drags. Deeper water drags harder, which is what makes a ford a
      // decision rather than a texture.
      if (this.vehWading > 0) {
        this.vehSpeed -= this.vehSpeed * this.vehWading * 1.6 * dt;
        if (this.vehWading > 0.3 && Math.abs(this.vehSpeed) > 6) {
          this.onSplash?.(Math.min(1, (Math.abs(this.vehSpeed) / 30) * this.vehWading));
        }
      }
    }
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
    for (const off of [this.spec.bodyOffset, -this.spec.bodyOffset]) {
      const cx = this.vehPos.x + fwdX * off;
      const cz = this.vehPos.z + fwdZ * off;
      for (const p of solids) {
        const dx = cx - p.x;
        const dz = cz - p.z;
        const min = this.spec.bodyR + p.radius;
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

  /**
   * Call the truck over. It drops in beside you rather than appearing, which
   * is both nicer to watch and free: the jump physics already handle a vehicle
   * falling and landing with a thump.
   *
   * The spot is checked for slope and for anything solid, and tried at eight
   * bearings starting behind you so it doesn't land in your view.
   */
  private summon() {
    const px = this.position.x;
    const pz = this.position.z;
    // The fallback is where you stand rather than behind you: every candidate
    // failing usually means you are hemmed in, and dry ground under your own
    // feet beats a guess that could be over water.
    let bestX = px;
    let bestZ = pz;
    let bestScore = -Infinity;

    for (let i = 0; i < 8; i++) {
      const a = this.heading + Math.PI + (i / 8) * Math.PI * 2;
      const x = px + Math.sin(a) * SUMMON_RANGE;
      const z = pz + Math.cos(a) * SUMMON_RANGE;
      if (heightAt(x, z) < 1) continue; // not in the sea

      const slope = slopeAt(x, z, 3);
      if (slope > 0.34) continue;

      let blocked = false;
      for (const q of this.props.solidNear(x, z)) {
        if (Math.hypot(q.x - x, q.z - z) < q.radius + 3.2) blocked = true;
      }
      for (const q of this.landmarkSolids) {
        if (Math.hypot(q.x - x, q.z - z) < q.radius + 3.2) blocked = true;
      }
      if (blocked) continue;

      // Flattest wins, with a nudge toward the first bearing tried.
      const score = -slope - i * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestZ = z;
      }
    }

    this.vehPos.set(bestX, heightAt(bestX, bestZ) + 9, bestZ);
    this.vehHeading = this.heading + Math.PI * 0.5;
    this.vehSpeed = 0;
    this.vehVelY = 0;
    this.vehAir = true;
    this.warmedUp = false; // settle straight onto the local slope
    this.onSummon?.();
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

    if (this.spec.flies) {
      /**
       * Flight.
       *
       * Altitude is COMMANDED, not thrown: hold jump and it climbs, let go and
       * it comes down. That is the whole control scheme, which is the point —
       * one thumb, and nothing to manage.
       *
       * A plane's sink is cancelled by airspeed, so going fast keeps you up
       * and slowing down brings you down. There is no stall and no crash:
       * touching the ground is a landing at any speed, because a landing that
       * can fail would be a fail state and this game has none.
       */
      const wing = this.spec.wing
        ? 1 - Math.min(1, Math.abs(this.vehSpeed) / this.spec.top) * this.spec.wing
        : 1;
      // Up, down, or let it find its own level. Having an explicit descent
      // matters as much as the climb — sinking only when you stop asking to
      // climb is one control pretending to be two.
      const want = this.vehClimb
        ? this.spec.lift!
        : this.vehDescend
          ? -(this.spec.dive ?? this.spec.lift! * 0.85)
          : -this.spec.sink! * wing;

      /**
       * Trading height for speed, and back.
       *
       * Putting the nose down should get you moving, and hauling it up should
       * cost you — that coupling is most of why a dive feels like a dive
       * rather than an elevator going down. It cannot run away: the airspeed
       * ceiling still clamps a flyer at its top speed, and the commanded
       * descent rate is fixed rather than fed by speed, so there is no loop.
       */
      if (this.vehDescend) this.vehSpeed += 11 * dt;
      else if (this.vehClimb) this.vehSpeed -= 7 * dt;
      // Eased, so the controls feel like a machine with mass rather than a
      // cursor being dragged up and down.
      this.vehVelY += (want - this.vehVelY) * Math.min(1, dt * (this.spec.pitchRate ?? 2.2));
      this.vehPos.y += this.vehVelY * dt;

      if (this.vehPos.y <= groundY) {
        const impact = Math.max(0, -this.vehVelY);
        this.vehPos.y = groundY;
        this.vehVelY = 0;
        this.vehAir = false;
        // Settling onto the ground scrubs speed off hard, which is what makes
        // a bad landing merely untidy instead of fatal.
        if (impact > 3) {
          this.vehSpeed *= 0.55;
          const force = Math.min(impact / 18, 1);
          this.shake = Math.max(this.shake, force * 0.45);
          this.onVehicleLand?.(force);
        }
      } else {
        this.vehAir = true;
      }
    } else if (airborne && this.vehAir) {
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
      /**
       * On the ground — but only while the ground can actually hold it.
       *
       * Clyde: "when driving fast off a ledge, truck sticks to the ground, it
       * should jump out. I can fake this if I jump at the right moment, but
       * inertia is missing?" He was exactly right: this branch pinned the
       * truck to the surface no matter how fast the surface fell away, so a
       * ledge at speed was a slide rather than a launch.
       *
       * A wheel leaves the ground when the surface curves away faster than
       * gravity can pull the vehicle after it. So: track how fast the ground
       * under the truck is rising or falling, and how fast THAT is changing.
       * When the surface's own downward acceleration exceeds gravity, it has
       * dropped out from under the truck and the truck is already flying —
       * carrying the vertical velocity it had at the lip, which is what makes
       * a ramp throw you upward and a cliff edge carry you out.
       *
       * It scales with speed for free: the faster you cross a lip, the bigger
       * the rate of change, with no speed term written anywhere.
       */
      const rate = (groundY - this.vehGroundY) / Math.max(dt, 1e-4);
      const accel = (rate - this.vehGroundRate) / Math.max(dt, 1e-4);

      // The acceleration test alone fired on every small ripple at speed —
      // 129 launches in thirty seconds, which is chatter, not air. The ground
      // also has to be genuinely dropping away, which is what distinguishes a
      // ledge from a bumpy surface.
      // Two ways to leave the ground, and both want the same test for the
      // curvature: the ground falling away under you (a ledge), or the crest
      // of something you were driving UP, which throws you off the top. The
      // second is the one that gives a ramp its pop.
      const leaving = rate < -3.5 || rate > 2.0;
      if (this.warmedUp && accel < -VEH_GRAVITY && leaving) {
        this.vehAir = true;
        // Keep what the ground gave us. Damped, because a raw terrain
        // derivative at 48 m/s is spikier than a real suspension would be.
        this.vehVelY = THREE.MathUtils.clamp(rate * 0.55, -14, 9);
        this.vehPos.y += this.vehVelY * dt;
      } else {
        this.vehPos.y = groundY;
        this.vehAir = false;
      }
      this.vehGroundRate = rate;
    }
    this.vehGroundY = groundY;

    // A flying machine in the air has no ground to sit on, so it stays level
    // and lets its own model do the banking.
    const n =
      this.spec.flies && this.vehAir
        ? { x: 0, y: 1, z: 0 }
        : normalAt(this.vehPos.x, this.vehPos.z, 2.5);
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
    /**
     * How fast the body swings to the heading.
     *
     * 1.4 in the air was written for a truck mid-jump, which should hold the
     * attitude it left the ground with. An aircraft is never not in the air,
     * so that rate made the model permanently trail its own flight path — at
     * fifty degrees a second of turn, two thirds of a second of lag is a nose
     * pointing some thirty degrees away from where you are going, and it never
     * caught up while you kept turning.
     *
     * An aircraft tracks promptly. A truck still holds its attitude over a
     * jump, which is what that number was for.
     */
    const settle = this.spec.flies ? 6.5 : this.vehAir ? 1.4 : 7;
    this.vehQuat.slerp(target, this.warmedUp ? Math.min(1, dt * settle) : 1);
    this.warmedUp = true;

    this.vehicle.root.position.copy(this.vehPos);
    this.vehicle.root.quaternion.copy(this.vehQuat);
    this.vehicle.animate(dt, speed, this.vehSteer, this.vehVelY);
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
