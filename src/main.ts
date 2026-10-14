import * as THREE from "three";
import "./style.css";

import { Terrain } from "./world/terrain";
import { Water } from "./world/water";
import { Sky } from "./world/sky";
import { Scatter } from "./world/scatter";
import { Grass } from "./world/grass";
import { LandmarkField } from "./world/landmarkRender";
import { landmarkSolids, LANDMARK_NAMES } from "./world/landmarks";
import { Discoveries } from "./game/discovery";
import { Camp } from "./game/camp";
import { Dust, Birds } from "./world/particles";
import { Wildlife } from "./world/wildlife";
import { surfaceAt, moistureAt, treeDensityAt, slopeAt } from "./world/field";
import { findSpawn } from "./world/spawn";
import { heightAt, biomeNameAt } from "./world/field";
import { Environment } from "./game/environment";
import { Player } from "./game/player";
import { Controls } from "./input/controls";
import { Hud } from "./ui/hud";
import { Postcard } from "./ui/postcard";
import { Journal } from "./ui/journal";
import { haptics } from "./ui/haptics";
import { Garage } from "./game/paint";
import { Soundscape } from "./audio/soundscape";
import { Net, DEFAULT_WORLD } from "./net/net";
import { PeerBodies } from "./net/peers";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const controls = new Controls(canvas);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !controls.isTouch,
  powerPreference: "high-performance",
});
const MAX_DPR = controls.isTouch ? 1.4 : 2;
let dpr = MAX_DPR;
renderer.setPixelRatio(dpr);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 1, 42000);
scene.add(camera);

const env = new Environment();
const terrain = new Terrain();
const water = new Water(terrain.reach);
const sky = new Sky(camera);
const scatter = new Scatter();
// Grass is vertex-shader heavy — every blade evaluates the terrain function —
// so phones get a smaller, sparser field.
const grass = new Grass(
  controls.isTouch
    ? { side: 45, spacing: 1.9, blades: 3 }
    : { side: 61, spacing: 1.45, blades: 4 }
);

scene.add(terrain.group, water.mesh, grass.mesh, scatter.group, env.sunLight, env.sunLight.target, env.hemiLight);
// Tuned so distant landmarks fade at roughly the same rate as the terrain
// shader hazes the hills behind them.
scene.fog = new THREE.FogExp2(0x9fb4c8, 0.0001);

const landmarks = new LandmarkField();
scene.add(landmarks.group);
const found = new Discoveries();
const camp = new Camp();
scene.add(camp.group);
const wildlife = new Wildlife();
scene.add(wildlife.group);
const dust = new Dust();
const birds = new Birds();
scene.add(dust.mesh, birds.mesh);

const atParam = new URLSearchParams(location.search).get("at");
const atMatch = atParam?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
// A shared postcard puts you exactly where the photographer stood. The world is
// a pure function, so no lookup is needed — the coordinates ARE the place.
const spawn = atMatch
  ? new THREE.Vector2(Number(atMatch[1]), Number(atMatch[2]))
  : findSpawn();
const player = new Player(camera, spawn);
scene.add(player.group);

const sound = new Soundscape();
sound.attachUnlock();
player.onLand = () => sound.land();
player.onMount = () => sound.mount();
player.onDismount = () => sound.dismount();
player.onCrash = (f) => {
  sound.crash(f);
  haptics.crash(f);
};
player.onVehicleLand = (f) => {
  sound.vehicleLand(f);
  haptics.land(f);
};

// --- multiplayer -----------------------------------------------------------
// Connect by default. "See each other" is the point, and a lobby gate between
// the player and the world is friction for a game you open in a browser tab.
const stored = (k: string, fallback: string) => localStorage.getItem(k) || fallback;
const net = new Net();
const peers = new PeerBodies();
scene.add(peers.group);

let myName = stored("wander.name", `wanderer-${Math.floor(1000 + Math.random() * 9000)}`);
let myWorld = stored("wander.world", new URLSearchParams(location.search).get("world") || DEFAULT_WORLD);
// A stable colour per name, so your truck looks like yours to everyone.
const colourFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.55, 0.52).getHex();
};

const netFacade = {
  get name() { return myName; },
  get world() { return myWorld; },
  join(name: string, world: string) {
    myName = (name || "").trim().slice(0, 16) || myName;
    myWorld = (world || "").trim().toLowerCase().slice(0, 24) || DEFAULT_WORLD;
    localStorage.setItem("wander.name", myName);
    localStorage.setItem("wander.world", myWorld);
    localStorage.removeItem("wander.solo");
    net.connect(myWorld, myName, colourFor(myName));
  },
  solo() {
    localStorage.setItem("wander.solo", "1");
    net.disconnect();
  },
};

const hud = new Hud(controls, sound, netFacade);
hud.onPinRequest = (id) => togglePin(id);
hud.onRest = (t) => camp.rest(t, env.timeOfDay);
hud.onStrikeCamp = () => camp.strike();
hud.onJournal = () => journal.toggle();

const garage = new Garage();
// Whatever you were driving last time, you're still driving.
player.vehicle.setPaint(garage.current(player.distanceTravelled / 1000).hex);
const journal = new Journal(found, (x, z) => biomeNameAt(x, z));
const postcard = new Postcard(document.getElementById("ui")!);
postcard.bindLink(() => ({ x: player.position.x, z: player.position.z }));

net.onPeerLeave = (id) => peers.remove(id);
if (localStorage.getItem("wander.solo") !== "1") {
  net.connect(myWorld, myName, colourFor(myName));
}

// Live handle for tuning from the console: __wander.env.timeOfDay = 0.5, etc.
(window as Window & { __wander?: unknown }).__wander = {
  env, terrain, water, sky, grass, landmarks, wildlife, found, camp, dust, birds, postcard, journal, garage, player, camera, renderer, scene, sound, net, peers,
};

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
addEventListener("resize", resize);
addEventListener("orientationchange", () => setTimeout(resize, 120));
// Mobile browser chrome slides away without firing a window resize.
visualViewport?.addEventListener("resize", resize);
resize();

// Dev convenience: nudge the clock without waiting an hour for dusk.
addEventListener("keydown", (e) => {
  if (e.code === "BracketRight") env.timeOfDay = (env.timeOfDay + 1 / 24) % 1;
  if (e.code === "BracketLeft") env.timeOfDay = (env.timeOfDay + 23 / 24) % 1;
  if (e.code === "KeyM") hud.setMuted(sound.toggleMute());
  if (e.code === "KeyP") postcard.toggle();
  if (e.code === "KeyJ") journal.toggle();
  if (e.code === "KeyB" && player.mode === "drive") sound.horn();
  if (e.code === "KeyK") {
    const paint = garage.cycle(player.distanceTravelled / 1000);
    player.vehicle.setPaint(paint.hex);
    hud.announce(paint.name);
  }
  if (e.code === "Escape" && journal.open) journal.toggle(false);
  if (e.code === "Escape" && postcard.active) postcard.toggle(false);
});

// --- wake: what the world does back ---------------------------------------
const SPRAY: Record<string, { tint: THREE.Color; heavy: boolean; rate: number } | null> = {
  grass: { tint: new THREE.Color(0.44, 0.41, 0.27), heavy: false, rate: 15 },
  sand: { tint: new THREE.Color(0.80, 0.72, 0.53), heavy: true, rate: 40 },
  snow: { tint: new THREE.Color(0.94, 0.96, 1.0), heavy: true, rate: 44 },
  water: { tint: new THREE.Color(0.78, 0.88, 0.92), heavy: true, rate: 48 },
  rock: null, // nothing to kick up off bare stone
};
let sprayDebt = 0;
let birdCooldown = 0;
const tintScratch = new THREE.Color();

function wake(dt: number) {
  const driving = player.mode === "drive";
  // While driving, player.position tracks the cab, so its xz is the truck's.
  const px = player.position.x;
  const pz = player.position.z;
  const speed = player.speed;

  // Grass remembers where you just drove, which doubles as a tyre track.
  grass.crush(dt, px, heightAt(px, pz), pz, speed > 1.2);

  birdCooldown -= dt;
  if (speed < 3) {
    sprayDebt = 0;
  } else {
    const surface = surfaceAt(px, pz);
    const spec = SPRAY[surface];
    if (spec) {
      const ground = heightAt(px, pz);
      sprayDebt += dt * spec.rate * Math.min(speed / 24, 1.4) * (driving ? 1 : 0.35);
      while (sprayDebt >= 1) {
        sprayDebt -= 1;
        // Shade the spray toward the ground it came off.
        tintScratch.copy(spec.tint).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
        dust.emit(px, ground, pz, speed, tintScratch, spec.heavy);
      }
    }

    // Driving fast through thick cover puts birds up.
    if (driving && speed > 12 && birdCooldown <= 0) {
      const ground = heightAt(px, pz);
      const cover = treeDensityAt(px, pz, ground, slopeAt(px, pz, 4)) + moistureAt(px, pz) * 0.4;
      if (cover > 0.45 && Math.random() < dt * 1.6) {
        birdCooldown = 4 + Math.random() * 7;
        const h = player.heading;
        birds.flush(px + Math.sin(h) * 14, ground, pz + Math.cos(h) * 14, Math.sin(h), Math.cos(h));
      }
    }
  }

  dust.update(dt, camera);
  birds.update(dt);
}

// --- glassing: looking as a verb -------------------------------------------
/** Deliberately few. Pins are intentions, not a to-do list. */
const MAX_PINS = 3;
const GLASS_RANGE = 9000;

interface Pin { id: string; name: string; x: number; z: number }
let pins: Pin[] = [];
try {
  pins = JSON.parse(localStorage.getItem("wander.pins") || "[]");
} catch {
  pins = [];
}
const savePins = () => localStorage.setItem("wander.pins", JSON.stringify(pins));

function togglePin(id: string) {
  const lm = landmarks.loaded.find((l) => l.id === id);
  if (!lm) return;
  const at = pins.findIndex((p) => p.id === id);
  if (at >= 0) pins.splice(at, 1);
  else {
    pins.push({ id, name: LANDMARK_NAMES[lm.kind], x: lm.x, z: lm.z });
    if (pins.length > MAX_PINS) pins.shift();
  }
  savePins();
}

const projected = new THREE.Vector3();

function glassing() {
  hud.setGlassing(player.glassing);
  if (!player.glassing) {
    hud.setMarks([]);
    return;
  }
  const marks: { id: string; name: string; sx: number; sy: number; km: number; pinned: boolean }[] = [];
  let centreBest = Infinity;
  let centreId: string | null = null;

  for (const lm of landmarks.loaded) {
    const dx = lm.x - camera.position.x;
    const dz = lm.z - camera.position.z;
    const d = Math.hypot(dx, dz);
    if (d > GLASS_RANGE || d < 30) continue;

    projected.set(lm.x, lm.y + 18, lm.z).project(camera);
    if (projected.z > 1) continue; // behind the lens
    const sx = (projected.x * 0.5 + 0.5) * innerWidth;
    const sy = (-projected.y * 0.5 + 0.5) * innerHeight;
    if (sx < 0 || sx > innerWidth || sy < 0 || sy > innerHeight) continue;

    marks.push({
      id: lm.id,
      name: LANDMARK_NAMES[lm.kind],
      sx,
      sy,
      km: d / 1000,
      pinned: pins.some((p) => p.id === lm.id),
    });

    // F pins whatever is nearest the reticle.
    const off = Math.hypot(sx - innerWidth / 2, sy - innerHeight / 2);
    if (off < centreBest) {
      centreBest = off;
      centreId = lm.id;
    }
  }
  hud.setMarks(marks);
  if (controls.pin && centreId && centreBest < innerWidth * 0.25) togglePin(centreId);
}

/**
 * Entries that come from simply travelling. Each is keyed so it can only ever
 * land once; `add` is a no-op after that, so calling this every frame is free.
 */
let lastBiome = "";
let lastPhase = 0;
function stampJournal() {
  const x = player.position.x;
  const z = player.position.z;
  const biome = biomeNameAt(x, z);
  const mark = (id: string, kind: string, name: string) =>
    found.add({ id, kind, name, x: Math.round(x), z: Math.round(z), at: Date.now(), tod: env.timeOfDay });

  if (biome !== lastBiome && biome !== "Open Water") {
    lastBiome = biome;
    mark(`biome:${biome}`, "biome", biome);
  }
  const elev = heightAt(x, z);
  if (elev > 2000) mark("alt:2000", "feat", "Above 2,000 m");
  if (elev > 2600) mark("alt:2600", "feat", "Above 2,600 m");

  // Milestones every 25 km, so a long drive is worth something by itself.
  const km = Math.floor(player.distanceTravelled / 25000) * 25;
  if (km >= 25) mark(`km:${km}`, "feat", `${km} km travelled`);
}

const campPos = new THREE.Vector3();
const campLook = new THREE.Vector3();
const emberTint = new THREE.Color();
const dir = new THREE.Vector3();
let last = performance.now();
let fps = 60;
let slowFrames = 0;
let booted = false;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.08;

  controls.beginFrame();
  player.freeCamera = postcard.active;
  env.advance(dt);
  player.update(dt, controls);

  terrain.update(camera.position.x, camera.position.z);
  water.update(camera.position.x, camera.position.z);
  scatter.update(player.position.x, player.position.z);
  landmarks.update(player.position.x, player.position.z, env.elapsed, camera);
  wildlife.update(dt, player.position.x, player.position.z, env.sunDir.y);

  // Only landmarks you could actually touch take part in collision, and only
  // the nearest is a candidate for discovery.
  const solids: { x: number; z: number; radius: number }[] = [];
  let nearest: { name: string; id: string; kind: string; x: number; z: number; d2: number } | null = null;
  for (const lm of landmarks.loaded) {
    const dx = lm.x - player.position.x;
    const dz = lm.z - player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 160 * 160) {
      for (const c of landmarkSolids(lm)) solids.push({ x: c.x, z: c.z, radius: c.r });
    }
    if (d2 < 55 * 55 && (!nearest || d2 < nearest.d2)) {
      nearest = { name: LANDMARK_NAMES[lm.kind], id: lm.id, kind: lm.kind, x: lm.x, z: lm.z, d2 };
    }
  }
  player.landmarkSolids = solids;
  if (nearest && !found.has(nearest.id)) {
    found.add({
      id: nearest.id,
      kind: nearest.kind,
      name: nearest.name,
      x: Math.round(nearest.x),
      z: Math.round(nearest.z),
      at: Date.now(),
      tod: env.timeOfDay,
    });
    hud.announce(nearest.name);
    sound.moment();
    haptics.discover();
  }
  grass.update(camera.position.x, camera.position.z, env.elapsed);
  wake(dt);

  // One environment, pushed into every shader that cares.
  for (const u of [terrain.material.uniforms, water.material.uniforms, grass.material.uniforms]) {
    u.uSunDir.value.copy(env.sunDir);
    u.uSunColor.value.copy(env.sunColor);
    u.uSkyAmbient.value.copy(env.skyAmbient);
    u.uFogDensity.value = env.fogDensity;
  }
  terrain.material.uniforms.uGroundAmbient.value.copy(env.groundAmbient);
  water.material.uniforms.uTime.value = env.elapsed;
  sky.material.uniforms.uSunDir.value.copy(env.sunDir);
  sky.material.uniforms.uMoonDir.value.copy(env.moonDir);
  sky.material.uniforms.uTime.value = env.elapsed;
  sky.material.uniforms.uCloudCover.value = env.cloudCover;
  for (const u of [terrain.material.uniforms, water.material.uniforms, grass.material.uniforms, sky.material.uniforms]) {
    u.uSunsetBoost.value = env.sunsetBoost;
  }
  // Lights come on as the sun goes down, without the player thinking about it.
  player.vehicle.setLights(env.sunDir.y < 0.04);
  (scene.fog as THREE.FogExp2).color.copy(env.horizonColor);
  env.sunLight.target.position.copy(camera.position);
  scatter.setSunElevation(env.sunDir.y);
  player.setSunElevation(env.sunDir.y);

  sound.update(dt, {
    x: player.position.x,
    z: player.position.z,
    biome: biomeNameAt(player.position.x, player.position.z),
    musicDuck: camp.active ? 1 : 0,
    onFoot: player.mode === "foot",
    speed: player.speed,
    grounded: player.grounded,
    night: 1 - Math.min(1, Math.max(0, (env.sunDir.y + 0.12) / 0.18)),
    vehicle: player.mode === "drive" ? player.vehicleState : null,
  });

  net.update(dt, {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    h: player.heading,
    driving: player.mode === "drive",
    speed: player.speed,
  });
  peers.update(dt, net, camera);

  // --- camp ---------------------------------------------------------------
  if (controls.camp) {
    if (camp.active) camp.strike();
    else if (player.canCamp) {
      const near = landmarks.loaded.find(
        (l) => Math.hypot(l.x - player.position.x, l.z - player.position.z) < 70
      );
      // A step in front of where you stopped, so you end up sitting beside the
      // fire rather than standing in it.
      const fx = player.position.x + Math.sin(player.heading) * 1.6;
      const fz = player.position.z + Math.cos(player.heading) * 1.6;
      camp.pitch(fx, fz, near ? LANDMARK_NAMES[near.kind] : null);
      // A camp is a player-made mark, stored in exactly the shape a landmark
      // is, so shared traces later need no new format.
      found.add({
        id: `camp:${Math.round(camp.site.x)},${Math.round(camp.site.z)}`,
        kind: "camp",
        name: camp.nearby ? `Camp at ${camp.nearby}` : "Camp",
        x: Math.round(camp.site.x),
        z: Math.round(camp.site.z),
        at: Date.now(),
        tod: env.timeOfDay,
      });
    }
  }
  const fire = camp.update(dt, env, (x, y, z) => {
    emberTint.setHSL(0.07 + Math.random() * 0.05, 0.9, 0.55 + Math.random() * 0.2);
    dust.emit(x, y, z, 2, emberTint, false);
  });
  sound.setFire(fire);
  if (camp.active) {
    camp.cameraTarget(campPos, campLook);
    player.campCamera = { pos: campPos, look: campLook };
  } else {
    player.campCamera = null;
  }
  hud.setCamp(camp.active, camp.nearby, camp.resting);

  glassing();
  hud.setPins(
    pins.map((p) => {
      const dx = p.x - player.position.x;
      const dz = p.z - player.position.z;
      return {
        name: p.name,
        bearing: ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360,
        km: Math.hypot(dx, dz) / 1000,
      };
    })
  );

  // Sunrise and sunset each get a phrase, once per crossing.
  const dayPhase = env.timeOfDay;
  if (lastPhase < 0.25 && dayPhase >= 0.25) sound.moment();
  if (lastPhase < 0.78 && dayPhase >= 0.78) sound.moment();
  lastPhase = dayPhase;

  // A vivid sky is worth remembering, and it only happens on some days.
  if (env.today.sunset > 1 && env.sunDir.y < 0.12 && env.sunDir.y > -0.1) {
    found.add({
      id: `sky:${new Date().toISOString().slice(0, 10)}`,
      kind: "feat",
      name: "A vivid sky",
      x: Math.round(player.position.x),
      z: Math.round(player.position.z),
      at: Date.now(),
      tod: env.timeOfDay,
    });
  }

  if (wildlife.watching > 0) {
    found.add({
      id: "feat:watched",
      kind: "feat",
      name: "Something looked up",
      x: Math.round(player.position.x),
      z: Math.round(player.position.z),
      at: Date.now(),
      tod: env.timeOfDay,
    });
  }

  stampJournal();
  camera.getWorldDirection(dir);
  hud.update({
    clock: env.clockString(),
    biome: biomeNameAt(player.position.x, player.position.z),
    elevation: heightAt(player.position.x, player.position.z),
    x: player.position.x,
    z: player.position.z,
    km: player.distanceTravelled / 1000,
    fps,
    headingDeg: (((Math.atan2(dir.x, -dir.z) * 180) / Math.PI) % 360 + 360) % 360,
    prompt:
      camp.active
        ? null
        : player.canCamp && !player.nearVehicle
          ? controls.isTouch ? "CAMP  make camp" : "C  make camp"
          : player.mode === "drive"
        ? controls.isTouch
          ? "⏎  step out"
          : "E  step out"
        : player.nearVehicle
          ? controls.isTouch
            ? "⏎  drive"
            : "E  drive"
          : null,
    driving: player.mode === "drive",
  });
  hud.setPresence(net.status, net.peers.size);

  renderer.render(scene, camera);
  // Must read the buffer in the same frame as the draw, or it's already cleared.
  if (postcard.pending) {
    postcard.grab(renderer.domElement, {
      x: player.position.x,
      z: player.position.z,
      biome: biomeNameAt(player.position.x, player.position.z),
      clock: env.clockString(),
    });
  }
  controls.endFrame();

  // Adaptive resolution: give back pixels before we give up frames.
  if (fps < 42 && dpr > 0.75) {
    if (++slowFrames > 90) {
      dpr = Math.max(0.75, dpr - 0.15);
      renderer.setPixelRatio(dpr);
      resize();
      slowFrames = 0;
    }
  } else {
    slowFrames = 0;
  }

  if (!booted) {
    booted = true;
    const boot = document.getElementById("boot")!;
    boot.classList.add("gone");
    setTimeout(() => boot.remove(), 1000);
  }
}

requestAnimationFrame(frame);
