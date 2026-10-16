import * as THREE from "three";
import "./style.css";

import { Terrain } from "./world/terrain";
import { Water } from "./world/water";
import { Sky } from "./world/sky";
import { Scatter } from "./world/scatter";
import { Grass } from "./world/grass";
import { LandmarkField } from "./world/landmarkRender";
import { SettlementField } from "./world/settlementRender";
import { geyserLevel, landmarkSolids } from "./world/landmarks";
import { decksOf, type Deck } from "./world/decks";
import { hasAccretion } from "./world/accretions";
import { Discoveries } from "./game/discovery";
import { Camp } from "./game/camp";
import { Dog } from "./game/dog";
import { StrayField } from "./world/strayRender";
import { Stable } from "./game/stable";
import { UNSUMMONABLE, type VehicleClass } from "./game/vehicles";
import { Kit, PARTS, PART_KINDS, partAt, type PartKind } from "./game/parts";
import { Wanderer } from "./game/wanderer";
import { Figures } from "./game/figures";
import { Aurora } from "./world/aurora";
import { SPECS } from "./game/vehicles";
import { Features, ACTIONS } from "./game/features";
import { PAINTS } from "./game/paint";
import { Dust, Birds } from "./world/particles";
import { Wildlife } from "./world/wildlife";
import { surfaceAt, moistureAt, treeDensityAt, slopeAt, temperatureAt, slotRandom } from "./world/field";
import { findSpawn } from "./world/spawn";
import { lastPlace, rememberPlace } from "./game/save";
import { heightAt, biomeNameAt } from "./world/field";
import { regionAt } from "./world/regions";
import { rumourAt } from "./world/rumours";
import { Environment } from "./game/environment";
import { Player } from "./game/player";
import { Controls } from "./input/controls";
import { Hud } from "./ui/hud";
import { Postcard } from "./ui/postcard";
import { Journal } from "./ui/journal";
import { ACTION_LABEL as PAD_ACTIONS, type PadAction } from "./input/gamepad";
import { haptics } from "./ui/haptics";
import { Garage, CAN_PAINTS } from "./game/paint";
import { Soundscape } from "./audio/soundscape";
import { Net, DEFAULT_WORLD } from "./net/net";
import { PeerBodies, seatOf } from "./net/peers";

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
const settlements = new SettlementField();
scene.add(settlements.group);
const found = new Discoveries();
const features = new Features();
const camp = new Camp();
scene.add(camp.group);
const wildlife = new Wildlife();
scene.add(wildlife.group);
/**
 * A light for interiors that are not lit by a fire.
 *
 * A steading's hearth is a camp, which brings its own light. A mine has a lamp
 * somebody left hanging on the first timber set, and without an actual light
 * source the drift is a black hole you stand in and cannot read.
 */
const interiorLight = new THREE.PointLight(0xffcf8a, 0, 26, 2);
scene.add(interiorLight);
/** What the headlights actually light, which without lamps fitted is not much. */
const vehicleLamp = new THREE.PointLight(0xfff0c0, 0, 70, 2);
scene.add(vehicleLamp);

const aurora = new Aurora();
scene.add(aurora.group);
const figures = new Figures();
scene.add(figures.group);
const wanderer = new Wanderer();
scene.add(wanderer.group);
const strays = new StrayField();
scene.add(strays.group);
const stable = new Stable();
const kit = new Kit();
const dog = new Dog();
scene.add(dog.group);
const dust = new Dust();
const birds = new Birds();
scene.add(dust.mesh, birds.mesh);

const atParam = new URLSearchParams(location.search).get("at");
const atMatch = atParam?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
// A shared postcard puts you exactly where the photographer stood. The world is
// a pure function, so no lookup is needed — the coordinates ARE the place.
//
// Otherwise you resume where you left off. An explicit ?at= always wins: you
// followed a link to a specific place and that is what you asked for.
const resume = atMatch ? null : lastPlace();
const spawn = atMatch
  ? new THREE.Vector2(Number(atMatch[1]), Number(atMatch[2]))
  : resume
    ? new THREE.Vector2(resume.x, resume.z)
    : findSpawn();
const player = new Player(camera, spawn);
if (resume) player.distanceTravelled = resume.odo;
scene.add(player.group);

const sound = new Soundscape();
sound.attachUnlock();
player.onLand = () => sound.land();
player.onJump = (inVehicle) => sound.jump(inVehicle);
/**
 * Leaving an aircraft, opening a canopy, and arriving.
 *
 * The aircraft keeps flying. It is not destroyed and not waiting for you —
 * it is simply gone, which is both simpler and a better story.
 */
player.onSkydive = (what) => {
  if (what === "jump") {
    sound.jump(false);
    hud.found("you step out", "into the air", "press to open the chute");
    haptics.discover();
  } else if (what === "chute") {
    sound.action("orchard"); // canopy snapping open: cloth and a crack
    hud.announce("canopy out", "");
    haptics.land(0.6);
  } else {
    sound.land();
    found.add({
      id: "skydive",
      kind: "badge",
      name: "Jumped out and lived",
      x: Math.round(player.position.x),
      z: Math.round(player.position.z),
      at: Date.now(),
      tod: env.timeOfDay,
      region: regionAt(player.position.x, player.position.z).name,
    });
  }
};
/**
 * Spray. Rate-limited rather than fired every frame — at sixty frames a
 * second an unthrottled splash is white noise, not a splash.
 */
let splashIn = 0;
player.onSplash = (force) => {
  if (splashIn > 0) return;
  splashIn = 0.16;
  sound.splash(force);
  haptics.land(force * 0.5);
};
player.onMount = () => {
  // The voice has to be set before the engine starts, or the first second of
  // an aeroplane is a truck turning over.
  sound.setVehicleVoice(player.spec.cls);
  sound.mount();
  // Flying has one control and no way to guess it. Said on every boarding of
  // an aircraft rather than once ever, because "once ever" is a thing you
  // miss while looking at the scenery.
  if (SPECS[player.spec.cls].flies) {
    hud.announce(
      controls.isTouch ? "hold ⤴ to climb, RUN to come down" : "hold SPACE to climb, SHIFT to come down",
      "to get airborne"
    );
  }
};
player.onDismount = () => {
  sound.dismount();
  // Stepping out with the horn held should not leave it blaring.
  sound.hornOff();
};
/**
 * Summoning brings whatever you have set, or the truck.
 *
 * The swap happens here rather than at the moment you choose, so choosing in
 * the garage is a preference and not a teleport — the vehicle you are standing
 * next to stays where it is until you call for a different one.
 */
player.onSummon = () => {
  player.switchTo(stable.chosen, garage.current(player.distanceTravelled / 1000).hex);
  hud.announce(`${SPECS[stable.chosen].label.toLowerCase()} on its way`);
};
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
/**
 * A dev build must never land in the shared world by default.
 *
 * NET_ORIGIN points at the live relay from everywhere, so every headless test
 * page — fresh profile, no ?world=, no localStorage — was joining `overland`
 * alongside real players and leaving ghosts behind. The relay now evicts stale
 * sockets, but the root cause is here: local builds get their own world.
 */
const isDevHost =
  ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname) || location.hostname.endsWith(".local");
let myWorld = stored(
  "wander.world",
  new URLSearchParams(location.search).get("world") || (isDevHost ? "devsandbox" : DEFAULT_WORLD)
);
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
// Tapping the name under the compass drops that pin — face it, tap it, gone.
hud.onPinDrop = (id) => dropPin(id);
// Following someone is a live bearing, not a saved place — they move, and it
// lapses the moment they leave.
let followId: number | null = null;
// Seeing a species for the first time is worth remembering. No total, no
// checklist — the journal just gains a line, and the rare ones a badge.
// Someone nearby honked or waved. Nothing is addressed to us, so there is
// never anything owed back.
net.onEmote = (peer, kind) => {
  const d = Math.hypot(peer.next.x - player.position.x, peer.next.z - player.position.z);
  if (kind === "wave") {
    peers.wave(peer.id);
    if (d < 90) hud.announce(`${peer.name} waves`);
  } else if (kind === "honk" && d < 400) {
    // Falls away with distance, so a honk across a valley is a far-off parp.
    sound.remoteHorn(Math.max(0.08, 1 - d / 400));
  }
};

wildlife.onSight = (species, spec, x, z) => {
  const fresh = found.add({
    id: `saw:${species}`,
    kind: spec.rare ? "badge" : "sighting",
    name: spec.rare ? `Saw a ${spec.label.toLowerCase()}` : spec.label,
    x: Math.round(x),
    z: Math.round(z),
    at: Date.now(),
    tod: env.timeOfDay,
  });
  if (fresh) {
    if (spec.rare) {
      hud.found("a rare sighting", spec.label);
      sound.discovery("rare");
    } else {
      hud.announce(spec.label, "spotted");
      sound.discovery("sighting");
    }
    if (spec.rare) haptics.discover();
  }
};

hud.onFollow = (id) => {
  followId = followId === id ? null : id;
};
hud.onRest = (t) => camp.rest(t, env.timeOfDay);
hud.onStrikeCamp = () => leaveShelter();

/**
 * Stepping back outside, or breaking camp — the same button either way.
 *
 * Indoors the fire and the room are two separate pieces of state, so leaving
 * has to put out the one and release the other; doing only the first left you
 * standing in a dark room with no way out but the interact key.
 */
function leaveShelter() {
  if (features.indoors) features.release();
  camp.strike();
  // Releasing the place is not the same as releasing the PLAYER. This line
  // was missing, which is the whole of the stuck-in-a-barn bug.
  player.featureHold = null;
}

/**
 * Lighting the fire.
 *
 * The hearth is a camp — the same stones, flames and point light, smaller and
 * sat on the floor. Reusing it means resting indoors goes through the rest
 * clock that already works, rather than a second copy of it that would drift.
 */
hud.onLightFire = () => {
  if (!features.indoors || camp.active) return;
  const h = features.hearth(new THREE.Vector3());
  camp.pitch(h.x, h.z, features.held!.lm.name, { y: h.y, indoors: true });
  sound.setFire(1);
  hud.announce("the fire takes", "");
};

/**
 * Making something to eat.
 *
 * Deliberately not a stat. There is no hunger in this game and adding one
 * would turn stopping somewhere warm into a chore with a timer — the exact
 * opposite of the point. It is worth doing because it is a nice thing to do,
 * and the journal remembers the first time.
 */
hud.onEat = () => {
  if (!camp.active) return;
  const where = features.indoors ? features.held!.lm.name : camp.nearby;
  const fresh = found.add({
    id: "ate:first",
    kind: "badge",
    name: "Cooked a meal",
    x: Math.round(player.position.x),
    z: Math.round(player.position.z),
    at: Date.now(),
    tod: env.timeOfDay,
    region: regionAt(player.position.x, player.position.z).name,
  });
  hud.announce(
    fresh ? "something hot, for once" : where ? `something hot at ${where}` : "something hot",
    ""
  );
};
hud.onJournal = () => journal.toggle();

const garage = new Garage();
garage.loadCans();
// Whatever you were driving last time, you're still driving.
player.vehicle.setPaint(garage.current(player.distanceTravelled / 1000).hex);
const journal = new Journal(
  found,
  (x, z) => biomeNameAt(x, z),
  () => ({ x: player.position.x, z: player.position.z })
);
// Plain words rather than stat bars: you pick the one that suits where you
// are going, not the one with the longest bar.
const VEHICLE_NOTES: Record<string, string> = {
  van: "heavy and unhurried, and it carries everything",
  quad: "light, nimble, and happy where the truck will not fit",
  tractor: "the slowest thing with wheels; a hill means nothing to it",
  glider: "no engine at all — height is something you spend",
  boat: "for water, and only for water",
  truck: "steady, carries anything, good anywhere",
  bike: "quickest thing out here, poor on a climb",
  rover: "slow, but a mountain barely notices it",
  chopper: "hold jump to climb, and it can stop in mid-air",
  plane: "fastest thing out here; speed is what keeps it up",
};
// Seeing one is worth a line. The brainstorm's rule is no meeting and nothing
// owed, and a memory of having passed somebody breaks neither.
wanderer.onSeen = (cls) => {
  const fresh = found.add({
    id: "wanderer",
    kind: "badge",
    name: "Passed another wanderer",
    x: Math.round(player.position.x),
    z: Math.round(player.position.z),
    at: Date.now(),
    tod: env.timeOfDay,
    region: regionAt(player.position.x, player.position.z).name,
  });
  hud.announce(
    fresh ? "somebody else is out here" : `a ${SPECS[cls].label.toLowerCase()}, going the other way`,
    "you pass"
  );
};

// Whatever was found in previous sessions is already bolted on.
player.retune(kit.tune);

journal.stable = () => ({
  owned: stable.owned,
  chosen: stable.chosen,
  labels: Object.fromEntries(stable.owned.map((c) => [c, SPECS[c].label])),
  stats: Object.fromEntries(stable.owned.map((c) => [c, VEHICLE_NOTES[c] ?? ""])),
  // What is bolted on, in the words of the thing rather than as numbers.
  // Fitted parts, in a fixed order so the list does not reshuffle as you find
  // things. Paint is excluded: it is a colour, not a part, and has its own row.
  parts: PART_KINDS.filter((k) => k !== "paint" && kit.owned.has(k)).map((k) => ({
    label: PARTS[k].label + (PARTS[k].tiers > 1 ? ` mk${kit.owned.get(k)}` : ""),
    note: PARTS[k].note,
  })),
  // Colours found in tins, as swatches rather than a list of names.
  cans: garage.cans.map((i) => ({ name: CAN_PAINTS[i].name, hex: CAN_PAINTS[i].hex })),
});
/**
 * The controller tab, read live every time the sheet renders.
 *
 * The journal re-renders on a timer while this tab is open, because a readout
 * that only updates when you close and reopen it cannot answer "is my stick
 * working".
 */
journal.pad = () => ({
  snapshot: controls.pads.snapshot(),
  actions: (Object.keys(PAD_ACTIONS) as PadAction[]).map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    what: PAD_ACTIONS[id],
    binding: controls.pads.bindings[id].label,
  })),
  listening: controls.pads.listenFor,
});
journal.onRebind = (action) => {
  if (action === "__reset") {
    controls.pads.reset();
    return;
  }
  controls.pads.listenFor = action as PadAction;
};
controls.pads.onBound = () => journal.refresh();

journal.onChooseVehicle = (cls) => {
  stable.choose(cls as never);
  hud.announce(`${SPECS[stable.chosen].label} · summon to bring it`, "set as yours");
};
journal.dog = () => (dog.here ? { name: dog.name!, home: dog.home } : null);
journal.onRenameDog = (name) => {
  dog.rename(name);
  localStorage.setItem("wander.dog", JSON.stringify({ name: dog.name, home: dog.home }));
};
// A rumour becomes a marker only because you chose to make it one.
journal.onPinRumour = (f) => {
  if (pins.some((p) => p.id === f.id)) return;
  pins.push({ id: f.id, name: f.about ?? f.name, x: f.x, z: f.z });
  if (pins.length > MAX_PINS) pins.shift();
  savePins();
};
const postcard = new Postcard(document.getElementById("ui")!);
postcard.bindLink(() => ({ x: player.position.x, z: player.position.z }));

net.onPeerLeave = (id) => peers.remove(id);
if (localStorage.getItem("wander.solo") !== "1") {
  net.connect(myWorld, myName, colourFor(myName));
}

// Live handle for tuning from the console: __wander.env.timeOfDay = 0.5, etc.
(window as Window & { __wander?: unknown }).__wander = {
  env, controls, terrain, water, sky, grass, landmarks, wildlife, found, camp, features, dust, birds, postcard, journal, garage, player, camera, renderer, scene, sound, net, peers,
};

function resize() {
  // An embedded browser's own toolbars sit inside innerHeight but outside the
  // visual viewport, so controls anchored to the bottom end up underneath them
  // and taps hit the browser instead of the game. env(safe-area-inset) does
  // not cover this.
  const vv = window.visualViewport;
  const chrome = vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty("--chrome-bottom", `${Math.round(chrome)}px`);

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
visualViewport?.addEventListener("scroll", resize);
resize();

// Dev convenience: nudge the clock without waiting an hour for dusk.
// Releasing the key stops the horn. Also stopped on blur, because a key held
// when the tab loses focus never delivers its keyup and the horn would be
// left sounding into an empty room.
addEventListener("keyup", (e) => {
  if (e.code === "KeyB") sound.hornOff();
});
addEventListener("blur", () => sound.hornOff());

addEventListener("keydown", (e) => {
  if (e.code === "BracketRight") env.timeOfDay = (env.timeOfDay + 1 / 24) % 1;
  if (e.code === "BracketLeft") env.timeOfDay = (env.timeOfDay + 23 / 24) % 1;
  if (e.code === "KeyM") hud.setMuted(sound.toggleMute());
  if (e.code === "KeyP") postcard.toggle();
  if (e.code === "KeyJ") journal.toggle();
  // Held, not tapped. e.repeat guards against the keyboard's auto-repeat
  // starting it again every few milliseconds.
  if (e.code === "KeyB" && !e.repeat && (player.mode === "drive" || player.ridingHost !== null)) {
    sound.hornOn();
    net.emote("honk");
  }
  if (e.code === "KeyV" && player.mode === "foot") {
    peers.wave(net.selfId);
    net.emote("wave");
  }
  if (e.code === "KeyK") {
    const paint = garage.cycle(player.distanceTravelled / 1000);
    player.vehicle.setPaint(paint.hex);
    hud.announce(paint.name, "painted");
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

/**
 * Arriving retires a pin.
 *
 * A pin is an intention. Standing at the thing is that intention fulfilled,
 * so leaving the marker up turns the compass into a to-do list you have to
 * tidy by hand. The radius is deliberately tight — a lookout is about twenty
 * metres across, so sixty metres means you are at its feet, not merely
 * driving past in the same valley.
 */
const ARRIVE_M = 60;

/**
 * Unpin by id, without needing the landmark loaded.
 *
 * Dropping used to go through togglePin, which looked the landmark up in the
 * loaded set first — so a pin you had driven away from could not be dropped.
 */
function dropPin(id: string, kicker = "unpinned") {
  const at = pins.findIndex((p) => p.id === id);
  if (at < 0) return;
  const [gone] = pins.splice(at, 1);
  savePins();
  hud.announce(gone.name, kicker);
  sound.moment();
}

function togglePin(id: string) {
  if (pins.some((p) => p.id === id)) {
    dropPin(id);
    return;
  }
  const lm = landmarks.loaded.find((l) => l.id === id);
  if (!lm) return;
  pins.push({ id, name: lm.name, x: lm.x, z: lm.z });
  // Three is the cap. Saying what fell off is the difference between knowing
  // why a pin went away and watching one silently vanish.
  const dropped = pins.length > MAX_PINS ? pins.shift() : null;
  savePins();
  hud.announce(dropped ? `${lm.name} — dropped ${dropped.name}` : lm.name, "pinned");
  sound.moment();
}

/**
 * Walking up to a signpost reads it.
 *
 * Clyde asked for readable signs. Rather than a texture per sign — which would
 * break instancing for an object you only ever read from two metres away —
 * the text comes to the toast. It latches on approach, so walking away and
 * back reads it again, but standing beside one doesn't repeat.
 */
const SIGN_RANGE = 9;
let nearSign: string | null = null;

function signposts() {
  let text: string | null = null;
  for (const s of landmarks.signs) {
    if (Math.hypot(s.x - player.position.x, s.z - player.position.z) < SIGN_RANGE) {
      text = s.text;
      break;
    }
  }
  if (text && text !== nearSign) hud.announce(text, "the sign reads");
  nearSign = text;
}

/**
 * Coming into a settlement.
 *
 * Fires generously past the furthest building, so arriving happens as you come
 * up the street rather than when you reach the last roof. Worth a journal line
 * of its own — a hamlet is the rarest thing in the world and the only find
 * that is a PLACE rather than an object.
 */
let inSettlement: string | null = null;

function arriving() {
  const here = settlements.nearest(player.position.x, player.position.z);
  const name = here?.s.name ?? null;
  if (name && name !== inSettlement) {
    const fresh = found.add({
      id: `town:${here!.s.id}`,
      kind: "place",
      name: here!.s.name,
      x: Math.round(here!.s.x),
      z: Math.round(here!.s.z),
      at: Date.now(),
      tod: env.timeOfDay,
      region: regionAt(here!.s.x, here!.s.z).name,
    });
    if (fresh) {
      hud.found("you come into", here!.s.name, `${here!.s.buildings.length} buildings`);
      sound.discovery("town");
      haptics.discover();
    } else {
      hud.announce(here!.s.name, "back in");
    }
    // The noticeboard. Only the first time — a hamlet you pass through weekly
    // shouldn't keep handing you the same scrap of paper.
    if (fresh) {
      const [sgx, sgz] = here!.s.id.slice(1).split(",").map(Number);
      hearRumour(sgx, sgz, 1321, here!.s.x, here!.s.z, "the noticeboard");
    }
  }
  inSettlement = name;
}

/**
 * Hearing a rumour.
 *
 * The two sources the design called for: a radio mast you tune into, and the
 * noticeboard in a hamlet. Both record words in the journal and nothing else —
 * no marker appears, and pinning it is a separate decision you make later.
 */
function hearRumour(gx: number, gz: number, salt: number, x: number, z: number, from: string) {
  const r = rumourAt(gx, gz, salt, x, z);
  if (!r) return;
  const fresh = found.add({
    id: r.id,
    kind: "rumour",
    name: r.text,
    x: r.x,
    z: r.z,
    at: Date.now(),
    tod: env.timeOfDay,
    region: r.region,
    about: r.short,
  });
  hud.announce(r.text, fresh ? from : `${from}, again`, {
    big: true,
    hint: controls.isTouch
      ? "open the journal, then REGISTER — tap “pin it” to put it on your compass"
      : "press J for the journal — “pin it” puts it on your compass",
  });
}

/**
 * The dog.
 *
 * It joins at a steading that has a kennel, with no prompt and no decision to
 * make — walking up is enough. A dog asks nothing of you, and putting a
 * confirmation in front of it would be the one way to make it ask something.
 */
/**
 * Coming across a vehicle somebody left.
 *
 * Finding it is enough — there is no prompt, because the interact key already
 * arbitrates between getting in the truck and doing what a place offers, and
 * adding a third claimant to that is how the "can't get out of the truck" bug
 * happened. Taking it is a separate, deliberate act in the garage.
 */
const CLAIM_RANGE = 11;

/**
 * Something left at a place.
 *
 * Picked up by walking near it, like the dog and like a stray — the interact
 * key already arbitrates two things and a third claimant is how the "can't get
 * out of the truck" bug happened, twice.
 *
 * A part is fitted the moment it is found. There is no inventory and nothing
 * to choose, which is the difference between a reward and a spreadsheet.
 */
const LOOT_RANGE = 18;

function looting() {
  if (player.mode !== "foot") return;
  for (const lm of landmarks.loaded) {
    if (Math.hypot(lm.x - player.position.x, lm.z - player.position.z) > LOOT_RANGE) continue;
    const part = partAt(lm.gx, lm.gz, 1601);
    if (!part) continue;
    // The id is the PLACE, so a place gives up what it has once and the world
    // being a pure function means there is nothing to farm.
    if (found.has(`part:${lm.id}`)) continue;
    takePart(part.kind, part.tier, lm.name, lm.x, lm.z, `part:${lm.id}`);
    break;
  }

  const here = settlements.nearest(player.position.x, player.position.z);
  if (here) {
    const [sgx, sgz] = here.s.id.slice(1).split(",").map(Number);
    const part = partAt(sgx, sgz, 1613);
    if (part && !found.has(`part:${here.s.id}`)) {
      takePart(part.kind, part.tier, here.s.name, here.s.x, here.s.z, `part:${here.s.id}`);
    }
  }
}

function takePart(kind: PartKind, tier: number, where: string, x: number, z: number, id: string) {
  const spec = PARTS[kind];
  const grade = spec.tiers > 1 ? ` mk${tier}` : "";

  /**
   * Paint is its own thing: a colour rather than a capability.
   *
   * Which tin is at which place comes from the place, so the same shed always
   * holds the same colour and two players find the same one there.
   */
  if (kind === "paint") {
    const can = garage.findCan(Math.floor(Math.abs(x + z * 7)) % 8);
    if (!can) {
      hud.announce("a tin you already have", "found");
      return;
    }
    found.add({
      id, kind: "badge", name: `${can.name} paint — from ${where}`,
      x: Math.round(x), z: Math.round(z), at: Date.now(), tod: env.timeOfDay,
      region: regionAt(x, z).name,
    });
    hud.found("a tin of paint", can.name, "press K to put it on");
    sound.discovery("rare");
    haptics.discover();
    return;
  }

  const better = kit.fit(kind, tier);
  found.add({
    id,
    kind: "badge",
    name: `${spec.label}${grade} — from ${where}`,
    x: Math.round(x),
    z: Math.round(z),
    at: Date.now(),
    tod: env.timeOfDay,
    region: regionAt(x, z).name,
  });
  if (better) {
    player.retune(kit.tune);
    // A part is a real find and gets the real treatment.
    hud.found("fitted", `${spec.label}${grade}`, spec.note);
    sound.discovery(tier > 1 ? "rare" : "badge");
    haptics.discover();
    return;
  }
  {
    // You already had a better one. Say so rather than silently nothing.
    hud.announce(`${spec.label}${grade} — you have better`, "found");
    sound.moment();
  }
}

/**
 * Boats at landings, aircraft at airstrips.
 *
 * Clyde wanted both to live somewhere rather than be scattered: "boats sit at
 * docks/landings in the world, grab one to cross water", and "little airports
 * around and those are where airplanes, helicopters and other flying machines
 * are found."
 *
 * Same walk-up-and-it-is-yours rule as a stray, because a third claimant on
 * the interact key is how the "can't get out of the truck" bug happened. The
 * difference is only where the machine is waiting.
 */
function moorings() {
  if (player.mode !== "foot") return;
  for (const lm of landmarks.loaded) {
    if (lm.kind !== "dock" && lm.kind !== "airfield") continue;

    // Where the machine actually sits: a boat alongside the jetty, an
    // aircraft on the apron by the hangar.
    // Alongside the END of the jetty, which is where the water is. It was 13 m
    // out on a 60 m jetty, i.e. still over the beach.
    const local: [number, number] = lm.kind === "dock" ? [-2.6, -54] : [20, 4];
    const c = Math.cos(lm.rot);
    const sn = Math.sin(lm.rot);
    const mx = lm.x + (local[0] * c + local[1] * sn) * lm.scale;
    const mz = lm.z + (-local[0] * sn + local[1] * c) * lm.scale;
    if (Math.hypot(mx - player.position.x, mz - player.position.z) > BOARD_RANGE + 3) continue;

    const cls: VehicleClass =
      lm.kind === "dock"
        ? "boat"
        : // Airstrips keep all three flying machines, hashed per strip so a
          // given field always has the same one waiting.
          (["plane", "chopper", "glider"] as VehicleClass[])[
            Math.floor(slotRandom(lm.gx, lm.gz, 1627) * 3) % 3
          ];
    // Already standing at this one in this machine — nothing to announce.
    const at = player.vehicle.root.position;
    if (player.spec.cls === cls && Math.hypot(at.x - mx, at.z - mz) < 6) continue;

    player.adopt(cls, 0x9a7f4e, mx, mz, lm.rot);
    // A boat is not added to the garage and never becomes what summoning
    // brings; an aircraft is both.
    if (stable.claim(cls)) stable.choose(cls);
    else if (!UNSUMMONABLE.includes(cls)) stable.choose(cls);
    found.add({
      id: `moored:${lm.id}`,
      kind: "badge",
      name: `${SPECS[cls].label} at ${lm.name}`,
      x: Math.round(mx),
      z: Math.round(mz),
      at: Date.now(),
      tod: env.timeOfDay,
      region: regionAt(mx, mz).name,
    });
    hud.announce(`${SPECS[cls].label} · yours — get in`, "tied up here");
    sound.moment();
    return;
  }
}

/** Walk this close and the machine in front of you is the one you are driving. */
const BOARD_RANGE = 7;

function straying() {
  strays.update(player.position.x, player.position.z, strays.taken !== null && player.mode === "drive");
  const s = strays.nearest(player.position.x, player.position.z, CLAIM_RANGE);
  if (!s) return;

  // Close enough to get in. Your vehicle becomes this one, standing where it
  // stands, and the normal "E to get in" prompt takes it from there — which is
  // what Clyde expected to happen and is the obvious reading of walking up to
  // an aeroplane.
  if (
    player.mode === "foot" &&
    Math.hypot(s.x - player.position.x, s.z - player.position.z) < BOARD_RANGE &&
    strays.taken !== s.id
  ) {
    player.adopt(s.cls, s.paint, s.x, s.z, s.rot);
    strays.taken = s.id;
    strays.update(player.position.x, player.position.z, true);
    // Summoning should bring whatever you last got into, not something you
    // chose in a menu a week ago.
    stable.claim(s.cls);
    stable.choose(s.cls);
    hud.announce(`${SPECS[s.cls].label} · yours — get in`, "you walk up to the");
    sound.moment();
    return;
  }

  if (!stable.claim(s.cls)) return;
  found.add({
    id: s.id,
    kind: "badge",
    name: s.name,
    x: Math.round(s.x),
    z: Math.round(s.z),
    at: Date.now(),
    tod: env.timeOfDay,
    region: regionAt(s.x, s.z).name,
  });
  hud.announce(`${SPECS[s.cls].label} · yours now, from the garage`, "you find a");
  sound.moment();
}

const DOG_JOIN_RANGE = 16;
const dogSeat = { pos: new THREE.Vector3(), yaw: 0 };

try {
  const saved = JSON.parse(localStorage.getItem("wander.dog") || "null");
  if (saved?.name) dog.restore(saved.name, saved.home ?? null, player.position);
} catch {
  // no dog, which is the normal state until you meet one
}

function dogging(dt: number) {
  if (!dog.here) {
    // On foot only. Collecting a dog by driving past at forty metres a second
    // is not meeting one, and the design has this happening AT a steading.
    if (player.mode !== "foot") return;
    for (const lm of landmarks.loaded) {
      if (lm.kind !== "steading") continue;
      if (Math.hypot(lm.x - player.position.x, lm.z - player.position.z) > DOG_JOIN_RANGE) continue;
      // Only where somebody kept one. The kennel was already there. This is
      // the cheap hash-only check, not the full accretion build.
      if (!hasAccretion(lm, "kennel")) continue;
      const name = dog.join(lm.gx, lm.gz, lm.name, player.position);
      localStorage.setItem("wander.dog", JSON.stringify({ name, home: lm.name }));
      found.add({
        id: "dog",
        kind: "badge",
        name: `${name} fell in with you`,
        x: Math.round(lm.x),
        z: Math.round(lm.z),
        at: Date.now(),
        tod: env.timeOfDay,
        region: regionAt(lm.x, lm.z).name,
      });
      hud.announce(name, "a dog falls in beside you");
      sound.moment();
      break;
    }
    return;
  }

  // In the truck it sits in the passenger seat, which has to be read off the
  // vehicle's live transform or it trails its own seat by a frame.
  if (player.mode === "drive") {
    const root = player.vehicle.root;
    // From the spec, so the dog sits in the right place in each of them
    // rather than hovering beside a motorcycle at truck height.
    const seat = player.spec.dogSeat;
    dogSeat.pos.set(seat[0], seat[1], seat[2]).applyQuaternion(root.quaternion).add(root.position);
    dogSeat.yaw = root.rotation.y;
    dog.update(dt, player.position, dogSeat);
  } else {
    dog.update(dt, player.position, null);
  }
}

/**
 * Conditional finds — things that exist only when the world says so.
 *
 * You can be in exactly the right place and still not have found them, which
 * is the cleanest answer there is to "I have seen everything". Neither of
 * these can be sought out by grinding: one needs the clock, the other needs
 * the date and the cold.
 */
function conditions(dt: number) {
  landmarks.timeOfDay = env.timeOfDay;

  // Standing at a geyser while it goes is its own find. Being near a quiet
  // pool is not — you have to be there for it.
  {
    for (const lm of landmarks.loaded) {
      if (geyserLevel(lm, env.timeOfDay) < 0.55) continue;
      if (Math.hypot(lm.x - player.position.x, lm.z - player.position.z) > 70) continue;
      if (
        found.add({
          id: `geyser:${lm.id}`,
          kind: "badge",
          name: `${lm.name} — caught it blowing`,
          x: Math.round(lm.x),
          z: Math.round(lm.z),
          at: Date.now(),
          tod: env.timeOfDay,
          region: regionAt(lm.x, lm.z).name,
        })
      ) {
        hud.announce(lm.name, "it goes off");
        sound.moment();
      }
      break;
    }
  }

  // The lights. Only on nights the shared date seed picks, only after dark,
  // and only where it is cold.
  const night = env.sunDir.y < -0.09;
  const cold = temperatureAt(player.position.x, player.position.z) < 0.34;
  const lit = env.today.aurora && night && cold;
  aurora.update(dt, lit, env.elapsed, camera.position);

  if (lit) {
    if (
      found.add({
        id: `aurora:${new Date().toISOString().slice(0, 10)}`,
        kind: "badge",
        name: "The lights were out",
        x: Math.round(player.position.x),
        z: Math.round(player.position.z),
        at: Date.now(),
        tod: env.timeOfDay,
        region: regionAt(player.position.x, player.position.z).name,
      })
    ) {
      hud.announce("the whole sky is moving", "look up");
      sound.moment();
    }
  }
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
      name: lm.name,
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
/** The country you were in last frame, so a crossing fires once. */
let lastRegion: string | null = null;
/** Whether the pad's horn button was down last frame. */
let padHorning = false;

let lastPhase = 0;
function stampJournal() {
  const x = player.position.x;
  const z = player.position.z;
  const biome = biomeNameAt(x, z);
  const mark = (id: string, kind: string, name: string) =>
    found.add({
      id, kind, name,
      x: Math.round(x), z: Math.round(z),
      at: Date.now(), tod: env.timeOfDay,
      region: regionAt(x, z).name,
    });

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

/** A badge is a memory of having done something, not a score. */
function awardBadge(lm: { id: string; name: string; x: number; z: number }, badge: string) {
  if (
    found.add({
      id: `badge:${lm.id}`,
      kind: "badge",
      name: `${badge} — ${lm.name}`,
      x: Math.round(lm.x),
      z: Math.round(lm.z),
      at: Date.now(),
      tod: env.timeOfDay,
    })
  ) {
    // The action, not another discovery.
    hud.announce(badge);
    haptics.discover();
  }
}

/** How close you must be to a moving truck to climb aboard. */
const RIDE_RANGE = 6;
const seatSample = { x: 0, y: 0, z: 0, h: 0 };
const seatPos = new THREE.Vector3();

const campPos = new THREE.Vector3();
const campLook = new THREE.Vector3();
const emberTint = new THREE.Color();
const dir = new THREE.Vector3();
let last = performance.now();
let fps = 60;
let slowFrames = 0;
let booted = false;

/**
 * Writing where you are every frame would hit localStorage sixty times a
 * second for no benefit; four seconds means the worst case is losing the last
 * few seconds of a drive.
 */
let placeSaveIn = 4;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  splashIn -= dt;
  placeSaveIn -= dt;
  if (placeSaveIn <= 0) {
    placeSaveIn = 4;
    rememberPlace(player.position.x, player.position.z, player.distanceTravelled);
  }
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.08;

  controls.beginFrame();
  player.freeCamera = postcard.active;

  // --- riding with someone -------------------------------------------------
  // The driver's client owns the truck entirely. We just put ourselves in a
  // seat each frame and transmit the result, so nobody has to resolve who is
  // riding with whom in order to draw us.
  const host = player.ridingHost !== null ? net.peers.get(player.ridingHost) : undefined;
  if (player.ridingHost !== null && (!host || host.next.mode !== 1)) {
    // They stopped driving, or left. Step off wherever we are.
    player.ridingHost = null;
    player.featureHold = null;
  } else if (host) {
    net.sample(host, seatSample);
    seatOf(net.selfId, seatSample.x, seatSample.y, seatSample.z, seatSample.h, seatPos);
    player.featureHold = seatPos;
    player.heading = seatSample.h;
  }

  // A truck with somebody at the wheel has a seat in it. No invite, no accept:
  // walk up and use the same key you'd use on your own.
  let lift: { id: number; name: string; d: number } | null = null;
  if (player.mode === "foot" && player.ridingHost === null && !camp.active && !features.held) {
    for (const peer of net.peers.values()) {
      if (peer.next.mode !== 1) continue;
      const d = Math.hypot(peer.next.x - player.position.x, peer.next.z - player.position.z);
      if (d < RIDE_RANGE && (!lift || d < lift.d)) lift = { id: peer.id, name: peer.name, d };
    }
  }

  // Work out who owns this frame's interact BEFORE the player consumes it.
  // Normalised proximity, so being deep inside a hot spring beats standing at
  // the very edge of reach of the truck, and vice versa.
  const offer =
    camp.active || player.mode === "drive"
      ? null
      : features.candidate(landmarks.loaded, player.position.x, player.position.z);
  const offerProx = offer
    ? Math.hypot(offer.x - player.position.x, offer.z - player.position.z) /
      (ACTIONS[offer.kind].range * offer.scale)
    : Infinity;
  const liftProx = lift ? lift.d / RIDE_RANGE : Infinity;
  // Both sides of these comparisons can be Infinity — vehicleProximity is
  // Infinity whenever you aren't on foot, and the other two are Infinity when
  // there is nothing on offer. Infinity <= Infinity is true, so without the
  // explicit null checks a driver "won" a ride against their own truck every
  // frame and the press to get out was swallowed.
  const placeWins = !!features.held || (offer !== null && offerProx <= player.vehicleProximity);
  const rideWins =
    !placeWins && (player.ridingHost !== null || (lift !== null && liftProx <= player.vehicleProximity));
  /**
   * While you are driving, the ONLY meaningful interact is getting out, so
   * nothing is allowed to take the press. This is deliberately an invariant
   * rather than an argument about which states are reachable: an earlier
   * Infinity comparison let a non-existent ride win it and sealed the player
   * in, and anything else that leaks in later would do the same. Other buttons
   * bypass this arbitration entirely, which is exactly why the exit button was
   * the only one that ever appeared broken.
   */
  player.suppressInteract = player.mode !== "drive" && (placeWins || rideWins);

  if (controls.interact && rideWins) {
    if (player.ridingHost !== null) {
      // Step off beside the truck rather than inside it.
      player.ridingHost = null;
      player.featureHold = null;
      player.position.x += Math.cos(player.heading) * 2.6;
      player.position.z -= Math.sin(player.heading) * 2.6;
    } else if (lift) {
      player.ridingHost = lift.id;
      hud.announce(`riding with ${lift.name}`);
    }
  }
  env.advance(dt);
  player.update(dt, controls);

  terrain.update(camera.position.x, camera.position.z);
  water.update(camera.position.x, camera.position.z);
  scatter.update(player.position.x, player.position.z);
  landmarks.update(player.position.x, player.position.z, env.elapsed, camera);
  settlements.update(player.position.x, player.position.z);
  arriving();
  wildlife.update(dt, player.position.x, player.position.z, env.sunDir.y, player.glassing);

  // Only landmarks you could actually touch take part in collision, and only
  // the nearest is a candidate for discovery.
  const solids: { x: number; z: number; radius: number }[] = [];
  const decks: Deck[] = [];
  let nearest: { name: string; id: string; kind: string; x: number; z: number; d2: number } | null = null;
  for (const lm of landmarks.loaded) {
    const dx = lm.x - player.position.x;
    const dz = lm.z - player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 160 * 160) {
      for (const c of landmarkSolids(lm)) solids.push({ x: c.x, z: c.z, radius: c.r });
    }
    // Wider than the solids, because an airstrip is 224 m long and you want to
    // be standing on the far threshold, not falling through it.
    if (d2 < 420 * 420) decks.push(...decksOf(lm));
    if (d2 < 55 * 55 && (!nearest || d2 < nearest.d2)) {
      nearest = { name: lm.name, id: lm.id, kind: lm.kind, x: lm.x, z: lm.z, d2 };
    }
  }
  // Settlement buildings are solid too, and they come pre-resolved to world
  // space because a hamlet doesn't move.
  for (const c of settlements.solids) solids.push(c);
  player.landmarkSolids = solids;
  player.decks = decks;
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
    hud.found("found", nearest.name, regionAt(nearest.x, nearest.z).name);
    sound.discovery("place");
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
  // Driving lamps make the headlight actually reach.
  vehicleLamp.intensity = env.sunDir.y < 0.04 && player.mode === "drive" ? 22 * kit.tune.light : 0;
  if (vehicleLamp.intensity > 0) {
    const root = player.vehicle.root;
    vehicleLamp.position.set(root.position.x, root.position.y + 1.4, root.position.z);
  }
  (scene.fog as THREE.FogExp2).color.copy(env.horizonColor);
  env.sunLight.target.position.copy(camera.position);
  scatter.setSunElevation(env.sunDir.y);
  player.setSunElevation(env.sunDir.y);

  sound.update(dt, {
    x: player.position.x,
    z: player.position.z,
    biome: biomeNameAt(player.position.x, player.position.z),
    musicDuck: camp.active || features.indoors ? 1 : 0,
    indoors: features.indoors,
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
    mode: player.ridingHost !== null ? 2 : player.mode === "drive" ? 1 : 0,
    speed: player.speed,
    host: player.ridingHost ?? 0,
  });
  peers.update(
    dt,
    net,
    camera,
    player.mode === "drive"
      ? { id: net.selfId, x: player.position.x, y: player.position.y, z: player.position.z, h: player.heading }
      : undefined
  );

  // --- what this place offers ---------------------------------------------
  /**
   * Bailing out and opening the chute used to be arbitrated here, and both
   * were broken by it. player.update() runs a hundred lines above this, so
   * "checked before the normal interact arbitration" was true of the file and
   * false of the frame: the press had already been spent on dismount(). Both
   * now live in Player's own arbitration, which is the only code that should
   * ever have had an opinion about what the interact key means.
   *
   * Nothing here may take the press while he is in the air.
   */
  if (controls.interact && placeWins && player.skyState === 0) {
    if (features.held) {
      // Press again to get out. Nothing ever traps you somewhere.
      // Indoors the fire belongs to the room, so it goes out with it —
      // otherwise stepping outside left a hearth burning inside a building
      // with the camp camera still pointed at it.
      if (features.indoors) camp.strike();
      features.release();
      player.featureHold = null;
    } else if (offer) {
      const spec = ACTIONS[offer.kind];
      awardBadge(offer, spec.badge);
      // A mast carries a voice reading out places. That is what it is for.
      if (offer.kind === "mast") hearRumour(offer.gx, offer.gz, 1301, offer.x, offer.z, "the radio says");
      // Going into a working is worth something of its own. The badge says
      // you went in; this says what was down there.
      /**
       * What is at the back of a cave.
       *
       * The walk in is the feature, so the payoff has to be at the far end —
       * a vein that catches your lamp, and the bones of something that did
       * not find its way out.
       */
      if (offer.kind === "cave") {
        const fresh = found.add({
          id: `cave:${offer.id}`,
          kind: "badge",
          name: `${offer.name} — bones, and something bright`,
          x: Math.round(offer.x),
          z: Math.round(offer.z),
          at: Date.now(),
          tod: env.timeOfDay,
          region: regionAt(offer.x, offer.z).name,
        });
        if (fresh) hud.found("at the back of it", "bones, and something bright");
      }
      if (offer.kind === "adit") {
        const fresh = found.add({
          id: `seam:${offer.id}`,
          kind: "badge",
          name: `${offer.name} — a seam, still showing`,
          x: Math.round(offer.x),
          z: Math.round(offer.z),
          at: Date.now(),
          tod: env.timeOfDay,
          region: regionAt(offer.x, offer.z).name,
        });
        if (fresh) hud.announce("green in the rock, at the end of it", "you find");
      }
      /**
       * Make the thing happen.
       *
       * Clyde: "'worked the pump' with nothing happening = ultra boring. they
       * need to actually be a cool thing happening."
       *
       * Every action now makes a noise the object would actually make, and
       * the ones with something to move, move.
       */
      sound.action(offer.kind);
      haptics.discover();
      if (offer.kind === "windpump") {
        // The sails race, and water arrives in the tank.
        landmarks.spinBoost = 2.6;
        const c = Math.cos(offer.rot);
        const sn = Math.sin(offer.rot);
        landmarks.puff(
          offer.x + (5.5 * c + 1.5 * sn) * offer.scale,
          offer.y + 2.6 * offer.scale,
          offer.z + (-5.5 * sn + 1.5 * c) * offer.scale,
          3.2
        );
      }
      if (offer.kind === "spring") {
        // Getting in disturbs it: steam comes up properly for a while.
        landmarks.puff(offer.x, offer.y + 1, offer.z, 6);
        landmarks.puff(offer.x + 1.6, offer.y + 1, offer.z - 1.2, 5);
      }
      if (offer.kind === "adit") landmarks.puff(offer.x, offer.y + 1.4, offer.z, 5, true);
      if (offer.kind === "cave") {
        sound.action("adit");
        landmarks.puff(offer.x, offer.y + 1.2, offer.z, 6, true);
      }

      const sustained = features.begin(offer, player.position);
      if (sustained) {
        const at = features.holdPosition(new THREE.Vector3());
        if (sustained.deck) {
          // A deck is a floor, not a pose. You stand on it and walk about.
          player.platform = {
            x: offer.x,
            z: offer.z,
            y: at.y,
            half: sustained.deck * offer.scale,
          };
          player.position.set(offer.x, at.y, offer.z);
        } else {
          player.featureHold = at;
        }
        player.heading = Math.atan2(offer.x - player.position.x, offer.z - player.position.z);
      } else if (offer.kind === "mast") {
        // The one landmark that changes how the game sounds.
        sound.moment();
        hud.announce("tuned in");
      } else if (offer.kind === "wreck") {
        // Something off the wreck for your own truck.
        const paint = PAINTS[Math.floor(Math.random() * PAINTS.length)];
        player.vehicle.setPaint(paint.hex);
        hud.announce(`salvaged ${paint.name} paint`);
      }
    }
  }
  features.update(dt);

  // Driving through an arch is the action — asking permission first would
  // spoil the only landmark you ever meet at speed.
  for (const lm of landmarks.loaded) {
    if (lm.kind !== "arch") continue;
    if (Math.hypot(lm.x - player.position.x, lm.z - player.position.z) > 9 * lm.scale) continue;
    awardBadge(lm, ACTIONS.arch.badge);
  }

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
      camp.pitch(fx, fz, near ? near.name : null);
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
  // While camped, the look input pans the fire camera rather than a yaw the
  // player can't see.
  // Indoors the look input turns your head in the room; the camp camera is
  // not driving at that point, so it must not also consume the gesture.
  if (features.indoors && (controls.look.x !== 0 || controls.look.y !== 0)) {
    features.look(controls.look.x, controls.look.y);
  } else if (camp.active && (controls.look.x !== 0 || controls.look.y !== 0)) {
    camp.look(controls.look.x, controls.look.y);
  }
  const fire = camp.update(dt, env, (x, y, z) => {
    emberTint.setHSL(0.07 + Math.random() * 0.05, 0.9, 0.55 + Math.random() * 0.2);
    dust.emit(x, y, z, 2, emberTint, false);
  });
  sound.setFire(fire);
  // Getting in the truck is leaving — pack up rather than driving off camped,
  // and never stay settled into a place you have driven away from.
  if (camp.active && player.mode === "drive") camp.strike();
  if (features.held && player.mode === "drive") {
    leaveShelter();
    player.featureHold = null;
  }

  /**
   * The invariant: nothing may pin the player to a place they are no longer
   * settled into.
   *
   * Clyde: "I entered the barn, then left and could not walk. had to enter and
   * leave a few times before I could move again. same happened with a mine."
   *
   * featureHold freezes the character exactly where a place wants them, and it
   * was being cleared by each exit path separately — so the one path that
   * forgot (the step-outside button) left the player held by a place they had
   * already left. Pressing interact then RE-ENTERED, and the second press
   * finally cleared it, which is precisely the enter-and-leave-a-few-times
   * dance he described.
   *
   * Clearing it here as well makes the bug structurally impossible rather than
   * fixed in one more place: whatever releases the feature, by whatever route,
   * the hold cannot outlive it by more than the rest of this frame.
   */
  if (!features.held && player.featureHold && player.ridingHost === null) {
    player.featureHold = null;
  }
  /**
   * Same invariant for the deck, plus a way down.
   *
   * Stepping off a lookout thirty metres up should not be a fall — this game
   * has no fail states — so leaving puts you back at the foot of the ladder.
   */
  if (!features.held && player.platform) {
    const p = player.platform;
    player.platform = null;
    player.position.set(p.x + p.half + 2.2, heightAt(p.x + p.half + 2.2, p.z), p.z);
  }

  if (features.held && features.held.spec.camera === "inside") {
    features.interiorTarget(campPos, campLook);
    player.campCamera = { pos: campPos, look: campLook };
    player.campAnchor = null;
    player.holdYaw = null;
  } else if (features.held && features.held.spec.camera === "orbit") {
    features.cameraTarget(campPos, campLook);
    player.campCamera = { pos: campPos, look: campLook };
    player.campAnchor = null;
    player.holdYaw = null; // a held character doesn't steer anyway
  } else if (camp.active) {
    camp.cameraTarget(campPos, campLook);
    player.campCamera = { pos: campPos, look: campLook };
    player.campAnchor = camp.site;
    player.holdYaw = camp.viewYaw;
  } else {
    player.campCamera = null;
    player.campAnchor = null;
    player.holdYaw = null;
  }
  // The panel has to appear on stepping inside, before there is any fire, so
  // that "light the fire" is reachable at all.
  // Light the lamp while you are in a working, and put it out when you leave.
  if (features.indoors && (features.held!.lm.kind === "adit" || features.held!.lm.kind === "cave")) {
    features.hearth(interiorLight.position);
    interiorLight.intensity += (26 - interiorLight.intensity) * Math.min(1, dt * 2.4);
  } else {
    interiorLight.intensity *= 1 - Math.min(1, dt * 4);
  }

  // The stay panel belongs to places you can settle into. A mine is somewhere
  // you go IN, not somewhere you stop — offering to light a fire and sleep at
  // the bottom of a working would be the panel appearing because it can,
  // rather than because it should. You leave a working the way you came in.
  const staying = features.indoors && features.held!.lm.kind === "steading";
  hud.setCamp(
    camp.active || staying,
    staying ? features.held!.lm.name : camp.nearby,
    camp.resting,
    player.heldByCamp,
    staying ? { fire: camp.active, indoors: true } : undefined
  );

  // Pad buttons for the things the keyboard handles in its own listener.
  if (controls.padJournal) {
    controls.padJournal = false;
    journal.toggle();
  }
  // The camp flag is read later in the frame by the code that owns camping,
  // so the pad just raises it rather than duplicating that logic.
  if (controls.padCamp) {
    controls.padCamp = false;
    controls.camp = true;
  }
  if (controls.padHorn !== padHorning) {
    padHorning = controls.padHorn;
    if (padHorning && (player.mode === "drive" || player.ridingHost !== null)) {
      sound.hornOn();
      net.emote("honk");
    } else {
      sound.hornOff();
    }
  }

  glassing();
  signposts();
  dogging(dt);
  straying();
  moorings();
  looting();
  wanderer.update(dt, player.position, player.heading);
  figures.update(dt, player.position, player.heading);
  conditions(dt);
  camera.getWorldDirection(dir);
  const headingDeg = ((((Math.atan2(dir.x, -dir.z) * 180) / Math.PI) % 360) + 360) % 360;
  for (let i = pins.length - 1; i >= 0; i--) {
    const p = pins[i];
    if (Math.hypot(p.x - player.position.x, p.z - player.position.z) > ARRIVE_M) continue;
    dropPin(p.id, "arrived");
  }

  const marks: { name: string; bearing: number; km: number; live?: boolean; id?: string }[] = pins.map((p) => {
    const dx = p.x - player.position.x;
    const dz = p.z - player.position.z;
    return {
      id: p.id,
      name: p.name,
      bearing: ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360,
      km: Math.hypot(dx, dz) / 1000,
    };
  });

  const roster: { id: number; name: string; km: number }[] = [];
  for (const peer of net.peers.values()) {
    const dx = peer.next.x - player.position.x;
    const dz = peer.next.z - player.position.z;
    roster.push({ id: peer.id, name: peer.name, km: Math.hypot(dx, dz) / 1000 });
    if (peer.id === followId) {
      marks.push({
        name: peer.name,
        bearing: ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360,
        km: Math.hypot(dx, dz) / 1000,
        live: true,
      });
    }
  }
  roster.sort((a, b) => a.km - b.km);
  if (followId !== null && !net.peers.has(followId)) followId = null;
  hud.setWho(roster, followId);
  hud.setPins(marks, headingDeg);

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

  /**
   * Crossing into new country.
   *
   * Clyde asked for the same treatment "when you enter a new region or
   * whatever the larger areas are called". Regions are smooth fields with
   * jittered borders, so this fires once on the crossing and then not again
   * until the name actually changes.
   */
  const regionNow = regionAt(player.position.x, player.position.z).name;
  if (lastRegion === null) {
    lastRegion = regionNow;
  } else if (regionNow !== lastRegion) {
    lastRegion = regionNow;
    const firstTime = found.add({
      id: `region:${regionNow}`,
      kind: "feat",
      name: regionNow,
      x: Math.round(player.position.x),
      z: Math.round(player.position.z),
      at: Date.now(),
      tod: env.timeOfDay,
      region: regionNow,
    });
    hud.found(firstTime ? "you cross into" : "back into", regionNow);
    sound.discovery("region");
    haptics.discover();
  }

  stampJournal();
  camera.getWorldDirection(dir);
  /**
   * Two different vehicles, and the prompt has to tell them apart.
   *
   * `mine` is the body standing in front of you — what you would get into.
   * `coming` is what SUMMONING would bring, which is whatever is set in the
   * garage and is not necessarily the same thing.
   *
   * Clyde: "when I was far enough from the truck to summon, the tooltip said
   * 'summon the truck' even though I had plane set. I summoned and the plane
   * came (good) but we should fix that tip". Exactly that case — the body was
   * a truck, the choice was a plane, and naming the body would still have been
   * wrong. The summon prompt names the choice.
   */
  const mine = SPECS[player.spec.cls].label.toLowerCase();
  const coming = SPECS[stable.chosen].label.toLowerCase();
  hud.update({
    clock: env.clockString(),
    biome: biomeNameAt(player.position.x, player.position.z),
    elevation: heightAt(player.position.x, player.position.z),
    region: inSettlement ?? regionAt(player.position.x, player.position.z).name,
    x: player.position.x,
    z: player.position.z,
    km: player.distanceTravelled / 1000,
    fps,
    headingDeg,
    prompt:
      player.skyState === 1
        ? "open the chute"
        : player.skyState === 2
          ? "steer with the stick"
          : player.ridingHost !== null
        ? `hop out`
        : rideWins && lift
          ? `ride with ${lift.name}`
        : features.held
        ? `${features.held.spec.note || "stay a while"}`
        : placeWins && offer
          ? `${ACTIONS[offer.kind].verb}`
        : camp.active
        ? null
        : player.canSummon
          ? `call the ${coming}`
        : player.canCamp && !player.nearVehicle
          ? "make camp"
          : player.mode === "drive"
        ? "step out"
        : player.nearVehicle
          ? `${SPECS[player.spec.cls].flies ? "fly the" : "drive the"} ${mine}`
          : null,
    // Which button the action belongs to, so the label can live ON it rather
    // than floating next to the vehicle as a separate hint.
    /**
     * Which key the prompt is about.
     *
     * This was computed independently of the prompt chain above, so it could
     * disagree with it — and did. Clyde's screenshot shows "C climb": the
     * chain had picked "climb" from a landmark several branches earlier, while
     * this said "camp" because he happened to also be able to camp there.
     *
     * Only the camp branch is ever a C, and it is only reached when nothing
     * above it matched, so it has to be derived from the same condition that
     * selects it rather than re-guessed.
     */
    promptOn:
      player.ridingHost === null &&
      !rideWins &&
      !features.held &&
      !(placeWins && offer) &&
      !camp.active &&
      !player.canSummon &&
      player.canCamp &&
      !player.nearVehicle
        ? "camp"
        : "interact",
    // Whichever is doing the moving.
    speed: player.mode === "drive" ? Math.abs(player.vehicleState.speed) : player.speed,
    driving: player.mode === "drive",
  });
  hud.setJumpLabel(
    player.mode === "drive" && SPECS[player.spec.cls].flies ? "CLIMB" : "JUMP"
  );
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

// Closing the tab or backgrounding the app mid-drive should still be captured;
// pagehide fires on mobile where unload does not.
for (const ev of ["pagehide", "visibilitychange"]) {
  addEventListener(ev, () =>
    rememberPlace(player.position.x, player.position.z, player.distanceTravelled)
  );
}

requestAnimationFrame(frame);
