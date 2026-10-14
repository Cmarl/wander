import * as THREE from "three";
import "./style.css";

import { Terrain } from "./world/terrain";
import { Water } from "./world/water";
import { Sky } from "./world/sky";
import { Scatter } from "./world/scatter";
import { Grass } from "./world/grass";
import { findSpawn } from "./world/spawn";
import { heightAt, biomeNameAt } from "./world/field";
import { Environment } from "./game/environment";
import { Player } from "./game/player";
import { Controls } from "./input/controls";
import { Hud } from "./ui/hud";
import { Soundscape } from "./audio/soundscape";

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
scene.fog = new THREE.FogExp2(0x9fb4c8, 0.00022);

const spawn = findSpawn();
const player = new Player(camera, spawn);
scene.add(player.group);

const sound = new Soundscape();
sound.attachUnlock();
player.onLand = () => sound.land();
player.onMount = () => sound.mount();
player.onDismount = () => sound.dismount();
player.onCrash = (f) => sound.crash(f);
player.onVehicleLand = (f) => sound.vehicleLand(f);

const hud = new Hud(controls, sound);

// Live handle for tuning from the console: __wander.env.timeOfDay = 0.5, etc.
(window as Window & { __wander?: unknown }).__wander = {
  env, terrain, water, sky, grass, player, camera, renderer, scene, sound,
};

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
addEventListener("resize", resize);
resize();

// Dev convenience: nudge the clock without waiting an hour for dusk.
addEventListener("keydown", (e) => {
  if (e.code === "BracketRight") env.timeOfDay = (env.timeOfDay + 1 / 24) % 1;
  if (e.code === "BracketLeft") env.timeOfDay = (env.timeOfDay + 23 / 24) % 1;
  if (e.code === "KeyM") hud.setMuted(sound.toggleMute());
});

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
  env.advance(dt);
  player.update(dt, controls);

  terrain.update(camera.position.x, camera.position.z);
  water.update(camera.position.x, camera.position.z);
  scatter.update(player.position.x, player.position.z);
  grass.update(camera.position.x, camera.position.z, env.elapsed);

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
  (scene.fog as THREE.FogExp2).color.copy(env.horizonColor);
  env.sunLight.target.position.copy(camera.position);
  scatter.setSunElevation(env.sunDir.y);
  player.setSunElevation(env.sunDir.y);

  sound.update(dt, {
    x: player.position.x,
    z: player.position.z,
    onFoot: player.mode === "foot",
    speed: player.speed,
    grounded: player.grounded,
    night: 1 - Math.min(1, Math.max(0, (env.sunDir.y + 0.12) / 0.18)),
    vehicle: player.mode === "drive" ? player.vehicleState : null,
  });

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
      player.mode === "drive"
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

  renderer.render(scene, camera);
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
