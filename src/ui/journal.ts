import type { Discoveries, Found } from "../game/discovery";
import { exportCode, importCode } from "../game/save";
import { heightAt } from "../world/field";
import { regionAt } from "../world/regions";

/**
 * The field journal.
 *
 * Collecting sightings rather than objects: it accumulates from simply going
 * places, and re-reading it is the point, not completing it. Deliberately
 * there is no total, no percentage and no empty slots — a journal with gaps is
 * a journal, a journal with blanks waiting to be filled is a checklist, and a
 * checklist is the opposite of what this game is for.
 *
 * Each entry gets a small generated swatch: the sky it was under over the
 * ground it was on. Cheap, and it makes a list of coordinates feel like a
 * memory.
 */

const GROUND: Record<string, string> = {
  "Golden Steppe": "#b8973f",
  "Highland Meadow": "#6a7a3c",
  "Pine Forest": "#38502f",
  "Cold Tundra": "#7d7a63",
  Snowfield: "#dfe4e8",
  "Scree Slope": "#77736c",
  Shoreline: "#c6b183",
  "Open Water": "#2e5f70",
};

const KIND_LABEL: Record<string, string> = {
  badge: "badge",
  sighting: "wildlife",
  // A hamlet is the only find that is somewhere rather than something.
  place: "settlement",
  rumour: "heard about",
  camp: "camp",
  biome: "country",
  feat: "milestone",
};

/** Sky colour for a time of day, matching the sky shader's keyframes loosely. */
function skyAt(tod: number): string {
  const e = Math.sin((tod - 0.25) * Math.PI * 2);
  if (e < -0.25) return "#131a30";
  if (e < 0.02) return "#8a5a5e";
  if (e < 0.22) return "#c98f63";
  return "#8fb6d8";
}

function swatch(entry: Found, biome: string): string {
  const c = document.createElement("canvas");
  c.width = 72;
  c.height = 48;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const sky = skyAt(entry.tod ?? 0.5);
  const ground = GROUND[biome] ?? "#6a7a3c";

  const g = ctx.createLinearGradient(0, 0, 0, 30);
  g.addColorStop(0, sky);
  g.addColorStop(1, "#ffffff22");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 72, 30);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 72, 30);

  // A hill line, seeded off the coordinates so each place looks like itself.
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.moveTo(0, 48);
  const seed = Math.abs(Math.round(entry.x) * 31 + Math.round(entry.z) * 17);
  for (let i = 0; i <= 72; i += 8) {
    const h = 30 + Math.sin((i + seed) * 0.11) * 5 + Math.sin((i + seed) * 0.37) * 2.5;
    ctx.lineTo(i, h);
  }
  ctx.lineTo(72, 48);
  ctx.closePath();
  ctx.fill();
  return c.toDataURL();
}

const when = (ts: number) => {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const chan = (v: number) => Math.max(0, Math.min(255, v | 0));
const rgb = (r: number, g: number, b: number) => `rgb(${chan(r)},${chan(g)},${chan(b)})`;

/**
 * Map ground colour from height, as a ramp between stops.
 *
 * The arithmetic version this replaces had two faults. Channels went out of
 * range at both ends — green negative below about -480 m, red past 255
 * approaching 1800 m — and an out-of-range rgb() string is simply IGNORED by
 * canvas, so those pixels silently kept whatever colour was set last. The sea
 * floor reaches -1,900 m and peaks 3,900 m, so both ends were reachable.
 * Clamping fixed the validity and left deep water dark red, and there was a
 * visible seam at 1800 m where pale yellow jumped straight to grey.
 *
 * Stops cost nothing extra and cannot do either.
 */
const RAMP: [number, number, number, number][] = [
  [-900, 14, 28, 62],    // deep water
  [-60, 52, 98, 136],    // shallows
  [0, 72, 96, 62],       // the shore, where the land starts
  [700, 110, 112, 74],   // grass and forest
  [1600, 150, 142, 118], // bare slope
  [2400, 170, 168, 164], // rock
  [3200, 236, 240, 244], // snow
];

function shade(h: number): string {
  if (h <= RAMP[0][0]) return rgb(RAMP[0][1], RAMP[0][2], RAMP[0][3]);
  for (let i = 1; i < RAMP.length; i++) {
    const [h1, r1, g1, b1] = RAMP[i];
    if (h > h1) continue;
    const [h0, r0, g0, b0] = RAMP[i - 1];
    const t = (h - h0) / (h1 - h0);
    return rgb(r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t);
  }
  const last = RAMP[RAMP.length - 1];
  return rgb(last[1], last[2], last[3]);
}

export class Journal {
  private sheet: HTMLElement;
  private list: HTMLElement;
  private note: HTMLElement;

  private map!: HTMLCanvasElement;
  private tabs!: HTMLElement;
  private view: "register" | "map" | "garage" | "pad" = "register";
  private liveTimer = 0;
  /** What you own and what is set, for the garage tab. */
  stable: () => {
    owned: string[];
    chosen: string;
    labels: Record<string, string>;
    stats: Record<string, string>;
    /** What is bolted on, described rather than tabulated. */
    parts: { label: string; note: string }[];
    /**
     * Every colour you can actually put on the truck — the ones distance
     * earned and the ones you found in a shed, in one list, because from
     * where you are standing they are the same thing: paint you have.
     */
    paints: { name: string; hex: number; found: boolean; on: boolean }[];
  } | null = () => null;
  onChooseVehicle?: (cls: string) => void;
  onChoosePaint?: (index: number) => void;
  /** Controller state and mapping, read live. */
  pad: () => {
    snapshot: { name: string; axes: number[]; buttons: number[] } | null;
    actions: { id: string; label: string; what: string; binding: string }[];
    listening: string | null;
  } | null = () => null;
  onRebind?: (action: string) => void;
  /** Turning a rumour into a marker, which only you can do. */
  onPinRumour?: (f: Found) => void;
  /** The dog, read live rather than from its journal line. */
  dog: () => { name: string; home: string | null } | null = () => null;
  onRenameDog?: (name: string) => void;

  constructor(
    private found: Discoveries,
    private biomeOf: (x: number, z: number) => string,
    /** Where you are now, for the map. */
    private locate: () => { x: number; z: number } = () => ({ x: 0, z: 0 })
  ) {
    this.sheet = document.createElement("div");
    this.sheet.className = "sheet journal";
    this.sheet.innerHTML = `
      <div class="sheet-card">
        <h2>Field Journal</h2>
        <div class="journal-tabs" id="j-tabs">
          <button class="jtab on" data-view="register">register</button>
          <button class="jtab" data-view="map">map</button>
          <button class="jtab" data-view="garage">garage</button>
          <button class="jtab" data-view="pad">controller</button>
        </div>
        <div class="journal-list" id="j-list"></div>
        <canvas class="journal-map" id="j-map" width="420" height="420"></canvas>
        <p class="journal-note" id="j-note"></p>
        <div class="journal-acts">
          <button class="sheet-close ghost" id="j-copy">copy save</button>
          <button class="sheet-close ghost" id="j-paste">restore save</button>
        </div>
        <button class="sheet-close" id="j-close">close</button>
      </div>
    `;
    document.getElementById("ui")!.appendChild(this.sheet);
    this.list = this.sheet.querySelector("#j-list")!;
    this.map = this.sheet.querySelector("#j-map")!;
    this.tabs = this.sheet.querySelector("#j-tabs")!;
    this.tabs.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const v = (e.target as HTMLElement).dataset?.view as "register" | "map" | "garage" | "pad" | undefined;
      if (!v || v === this.view) return;
      this.view = v;
      for (const b of this.tabs.children) b.classList.toggle("on", (b as HTMLElement).dataset.view === v);
      this.render();
    });
    this.note = this.sheet.querySelector("#j-note")!;

    const tap = (id: string, fn: () => void) =>
      this.sheet.querySelector(id)!.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        fn();
      });
    tap("#j-close", () => this.toggle(false));
    // Renaming the dog. Delegated for the same reason as the pin buttons, and
    // the keydown is so Enter commits on a phone where blur is awkward.
    const commit = (el: HTMLInputElement) => {
      const v = el.value.trim();
      if (v) this.onRenameDog?.(v);
      el.blur();
    };
    this.list.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "j-dog") commit(el);
    });
    this.list.addEventListener("keydown", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "j-dog" && (e as KeyboardEvent).key === "Enter") commit(el);
    });
    // Typing in the name field must not reach the game's keyboard handling.
    for (const ev of ["keydown", "keyup", "pointerdown"]) {
      this.list.addEventListener(ev, (e) => {
        if ((e.target as HTMLElement).id === "j-dog") e.stopPropagation();
      });
    }
    // Pinning a rumour. Delegated, because entries are rebuilt on every open.
    this.list.addEventListener("pointerdown", (e) => {
      /**
       * What was actually pressed.
       *
       * This used to read e.target.dataset directly and bail unless it held
       * one of three known keys. Two problems, and I hit both: a new kind of
       * control added below the guard never ran at all, because the guard had
       * already returned; and a press that landed on something INSIDE a
       * control — the colour dot in a paint swatch — saw no dataset and was
       * thrown away.
       *
       * So it asks the DOM which control the press belongs to, rather than
       * keeping its own list of what controls exist. Adding a fourth kind now
       * needs nothing here.
       */
      const el = (e.target as HTMLElement).closest?.(
        "[data-id],[data-veh],[data-pad],[data-paint]"
      ) as HTMLElement | null;
      if (!el) return;
      const id = el.dataset.id;
      e.stopPropagation();
      const padAct = el.dataset.pad;
      if (padAct) {
        e.stopPropagation();
        this.onRebind?.(padAct);
        this.render();
        return;
      }
      const veh = el.dataset.veh;
      if (veh) {
        e.stopPropagation();
        this.onChooseVehicle?.(veh);
        this.render();
        return;
      }
      const paint = el.dataset.paint;
      if (paint !== undefined) {
        this.onChoosePaint?.(Number(paint));
        this.render();
        return;
      }
      if (!id) return;
      const f = this.found.all().find((q) => q.id === id);
      if (!f) return;
      this.onPinRumour?.(f);
      this.flash("pinned — look for it on the compass");
    });
    tap("#j-copy", () => void this.copy());
    tap("#j-paste", () => void this.paste());
    this.sheet.addEventListener("pointerdown", (e) => {
      if (e.target === this.sheet) this.toggle(false);
    });
  }

  /** Re-render without reopening, for the live controller readout. */
  refresh() {
    if (this.open) this.render();
  }

  toggle(show?: boolean) {
    const on = show ?? !this.sheet.classList.contains("open");
    if (on) this.render();
    // The controller readout has to move while you are looking at it.
    clearInterval(this.liveTimer);
    if (on) {
      this.liveTimer = window.setInterval(() => {
        if (this.view === "pad") this.render();
      }, 180);
    }
    this.sheet.classList.toggle("open", on);
  }

  get open() {
    return this.sheet.classList.contains("open");
  }

  private render() {
    const showMap = this.view === "map";
    this.list.style.display = showMap ? "none" : "";
    this.map.style.display = showMap ? "" : "none";
    if (showMap) {
      this.drawMap();
      return;
    }
    if (this.view === "garage") {
      this.drawGarage();
      return;
    }
    if (this.view === "pad") {
      this.drawPad();
      return;
    }

    const all = this.found.all();
    this.note.textContent = "";
    if (!all.length) {
      this.list.innerHTML = `<p class="journal-empty">Nothing yet. Drive toward something you don't recognise.</p>`;
      return;
    }
    // The register: grouped by the country it happened in.
    //
    // Deliberately a count and never a fraction. "7 places in the Long Coast"
    // is a record of where you have been; "7/12" is a checklist, and a
    // checklist would poison the whole thing.
    const groups = new Map<string, Found[]>();
    for (const f of all) {
      const key = f.region ?? regionAt(f.x, f.z).name;
      const g = groups.get(key);
      if (g) g.push(f);
      else groups.set(key, [f]);
    }

    const entry = (f: Found) => {
      const biome = this.biomeOf(f.x, f.z);
      const tag = KIND_LABEL[f.kind] ?? "landmark";
      // A rumour is words, so it shows no coordinates — you were told about
      // the place, not shown it. Pinning it is a separate decision, and the
      // pin you then get is one you placed yourself.
      if (f.kind === "rumour") {
        return `<div class="entry rumour">
          <div class="entry-text">
            <b>${f.name}</b>
            <s class="dim">${tag} · ${when(f.at)}</s>
          </div>
          <button class="pin-it" data-id="${f.id}">pin it</button>
        </div>`;
      }
      return `<div class="entry">
        <img src="${swatch(f, biome)}" alt="" width="72" height="48">
        <div class="entry-text">
          <b>${f.name}</b>
          <s>${tag} · ${Math.round(f.x)}, ${Math.round(f.z)}</s>
          <s class="dim">${when(f.at)}</s>
        </div>
      </div>`;
    };

    // The dog, if there is one. Above the register because it is not a place
    // you went — it is who is with you, read live so renaming it shows.
    const d = this.dog();
    const dogBlock = d
      ? `<div class="dog-row">
           <input class="dog-name" id="j-dog" value="${d.name.replace(/"/g, "&quot;")}" maxlength="16"
                  autocomplete="off" spellcheck="false" aria-label="your dog's name">
           <s>${d.home ? `fell in with you at ${d.home}` : "fell in with you"}</s>
         </div>`
      : "";

    this.list.innerHTML = dogBlock + [...groups.entries()]
      .map(
        ([region, items]) =>
          `<div class="region-head"><b>${region}</b><s>${items.length} ${
            items.length === 1 ? "thing" : "things"
          }</s></div>` + items.map(entry).join("")
      )
      .join("");
  }

  /**
   * The garage.
   *
   * Everything you have come across, and which one summoning brings. Reachable
   * by touch, which a keyboard shortcut alone would not be — and this game gets
   * played on a phone.
   *
   * No stat bars. "Quick, poor on hills" tells you what you need in the words
   * you would use, and a bar chart would invite comparing numbers instead of
   * picking the one that suits where you are going.
   */
  private drawGarage() {
    const st = this.stable();
    if (!st) {
      this.list.innerHTML = "";
      return;
    }
    this.note.textContent = st.parts.length
      ? "summoning brings whichever is set · parts fit every vehicle you own"
      : "summoning brings whichever is set";
    // Its own card rather than a journal entry with the picture taken out.
    // Borrowing .entry meant the set and unset rows were two different
    // components — one in a box, one loose on the page — instead of two
    // states of one thing.
    this.list.innerHTML =
      `<div class="garage">` +
      st.owned
        .map(
          (cls) => `<div class="veh${cls === st.chosen ? " on" : ""}">
            <span class="veh-text">
              <b>${st.labels[cls]}</b>
              <s>${st.stats[cls]}</s>
            </span>
            ${
              cls === st.chosen
                ? `<span class="veh-tag">yours</span>`
                : `<button class="veh-pick" data-veh="${cls}">set as yours</button>`
            }
          </div>`
        )
        .join("") +
      // What is bolted on. No count against a total, no empty slots, no list
      // of what is missing — the register shows what you found and never what
      // you did not.
      (st.parts.length
        ? `<div class="region-head"><b>Fitted</b><s>to every vehicle</s></div>` +
          st.parts
            .map(
              (p) =>
                `<div class="veh"><span class="veh-text"><b>${p.label}</b><s>${p.note}</s></span></div>`
            )
            .join("")
        : "") +
      /**
       * Paint you can actually put on.
       *
       * These used to be inert swatches: a list of tins you had found, with
       * no way to use one. The only way to change colour was the K key, which
       * cycles blindly through a list you cannot see — and on a phone there
       * is no K at all, so a colour found in a shed was unreachable forever.
       *
       * Showing what you own and not letting you choose it is the worst of
       * both: it is management UI that does not manage anything.
       *
       * Earned and found colours sit in ONE list, because from where you are
       * standing they are the same thing — paint you have. The tins are
       * marked, since where a colour came from is the part worth remembering.
       */
      (st.paints.length > 1
        ? `<div class="region-head"><b>Paint</b><s>tap to use</s></div>
           <div class="cans">${st.paints
             .map(
               (c, i) =>
                 `<button class="can${c.on ? " on" : ""}" data-paint="${i}" title="${c.name}">` +
                 `<i style="background:#${c.hex.toString(16).padStart(6, "0")}"></i>` +
                 `${c.name}${c.found ? "<u>found</u>" : ""}</button>`
             )
             .join("")}</div>`
        : "") +
      `</div>`;
  }

  /**
   * The controller tab: does it see your pad, and what is mapped to what.
   *
   * The live readout is the point. A controller that is plugged in but not
   * being read is indistinguishable from one that is broken, so the first
   * thing this has to answer is "is it working" — and a bar that moves when
   * you move the stick answers that better than any amount of text.
   */
  private drawPad() {
    const p = this.pad();
    if (!p) {
      this.list.innerHTML = "";
      return;
    }
    this.note.textContent = p.snapshot
      ? "press a button to rebind · defaults suit most pads"
      : "plug in a controller, then press any button on it";

    if (!p.snapshot) {
      this.list.innerHTML = `<p class="journal-empty">No controller seen yet. Plug one in and press a button —
        browsers hide pads until you do.</p>`;
      return;
    }

    const bar = (v: number) =>
      `<span class="padbar"><i style="width:${Math.round(Math.abs(v) * 100)}%"></i></span>`;

    this.list.innerHTML =
      `<div class="region-head"><b>${p.snapshot.name.slice(0, 40)}</b><s>connected</s></div>` +
      `<div class="padaxes">` +
      p.snapshot.axes
        .map((v, i) => `<div class="padrow"><s>axis ${i}</s>${bar(v)}<b>${v.toFixed(2)}</b></div>`)
        .join("") +
      `</div>` +
      `<div class="region-head"><b>Buttons</b><s>${
        p.snapshot.buttons.filter((b) => b > 0.1).length
      } down</s></div>` +
      `<div class="padbtns">` +
      p.snapshot.buttons
        .map((v, i) => `<span class="padbtn${v > 0.1 ? " on" : ""}">${i}</span>`)
        .join("") +
      `</div>` +
      `<div class="region-head"><b>Mapping</b><s>tap to change</s></div>` +
      p.actions
        .map(
          (a) => `<div class="veh${p.listening === a.id ? " on" : ""}">
            <span class="veh-text"><b>${a.label}</b><s>${a.what}</s></span>
            <button class="veh-pick" data-pad="${a.id}">${
              p.listening === a.id ? "press one" : a.binding
            }</button>
          </div>`
        )
        .join("") +
      `<div class="veh"><span class="veh-text"><b>Reset</b><s>back to the defaults</s></span>
        <button class="veh-pick" data-pad="__reset">defaults</button></div>`;
  }

  /**
   * The map.
   *
   * Opened from the journal rather than pinned to the screen, because a live
   * minimap turns looking at the world into looking at a diagram of it — and
   * the whole game is about the former. It is drawn by sampling the terrain
   * function directly, so there is no fog of war and nothing to reveal: the
   * ground was always going to be there. What the map actually records is
   * where YOU have been, which is the part that is yours.
   */
  private drawMap() {
    const ctx = this.map.getContext("2d")!;
    const W = this.map.width;
    const all = this.found.all();
    const me = this.locate();

    // Frame everything found, plus where you are, with a floor on the span so
    // a first-time map isn't zoomed into a single hillside.
    let minX = me.x, maxX = me.x, minZ = me.z, maxZ = me.z;
    for (const f of all) {
      minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x);
      minZ = Math.min(minZ, f.z); maxZ = Math.max(maxZ, f.z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const span = Math.max(20000, (maxX - minX) * 1.25, (maxZ - minZ) * 1.25);
    const toPx = (x: number, z: number) => [
      ((x - cx) / span + 0.5) * W,
      ((z - cz) / span + 0.5) * W,
    ];

    // Terrain at one sample per four pixels — about 11,000 evaluations, which
    // is a few tens of milliseconds for something you opened on purpose.
    const STEP = 4;
    for (let py = 0; py < W; py += STEP) {
      for (let px = 0; px < W; px += STEP) {
        const x = cx + (px / W - 0.5) * span;
        const z = cz + (py / W - 0.5) * span;
        ctx.fillStyle = shade(heightAt(x, z));
        ctx.fillRect(px, py, STEP, STEP);
      }
    }

    // Everything you have found.
    for (const f of all) {
      const [px, py] = toPx(f.x, f.z);
      ctx.fillStyle = f.kind === "place" ? "#ffd27f" : f.kind === "sighting" ? "#9fe0a8" : "#e2c069";
      ctx.beginPath();
      ctx.arc(px, py, f.kind === "place" ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // You.
    const [mx, my] = toPx(me.x, me.z);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx, my, 5.5, 0, Math.PI * 2);
    ctx.stroke();

    this.note.textContent = `${all.length} ${all.length === 1 ? "thing" : "things"} found · ${(
      span / 1000
    ).toFixed(0)} km across`;
  }

  private async copy() {
    const code = exportCode(this.found);
    try {
      await navigator.clipboard.writeText(code);
      this.flash("save copied — paste it on another device");
    } catch {
      this.flash("clipboard unavailable here");
    }
  }

  private async paste() {
    try {
      const code = await navigator.clipboard.readText();
      const { added, full } = importCode(code, this.found);
      this.render();
      if (full) {
        // Position, pins and paint are read at startup, so they only take
        // effect on a reload. Saying so beats looking like nothing happened.
        this.flash(`restored — ${added} new finds, reloading`);
        setTimeout(() => location.reload(), 1400);
        return;
      }
      this.flash(added ? `restored — ${added} new` : "restored — nothing new");
    } catch {
      this.flash("couldn't read a save from the clipboard");
    }
  }

  private flash(msg: string) {
    this.note.textContent = msg;
    setTimeout(() => (this.note.textContent = ""), 3200);
  }
}
