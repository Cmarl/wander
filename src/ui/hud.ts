import type { Controls } from "../input/controls";

export interface HudState {
  clock: string;
  biome: string;
  elevation: number;
  x: number;
  z: number;
  km: number;
  fps: number;
  headingDeg: number;
  prompt: string | null;
  driving: boolean;
}

const DESK_KEYS: [string, string][] = [
  ["W A S D", "move"],
  ["drag mouse", "look around"],
  ["Shift", "run"],
  ["Space", "jump — the truck jumps too"],
  ["E", "get in or out of the truck, or do what a place offers"],
  ["scroll", "zoom the camera"],
  ["[  ]", "wind the clock back / forward an hour"],
  ["M", "mute"],
  ["Q", "raise binoculars"],
  ["F", "pin what you are looking at"],
  ["C", "make or break camp"],
  ["J", "field journal"],
  ["B", "horn"],
  ["K", "change the paint"],
  ["H", "show these controls"],
];

const TOUCH_KEYS: [string, string][] = [
  ["left thumb", "move — the stick appears where you touch"],
  ["right thumb", "look around"],
  ["RUN", "hold a run"],
  ["⤴", "jump — the truck jumps too"],
  ["⏎", "get in or out, or do what a place offers"],
  ["LOOK", "binoculars — tap a marker to pin it"],
  ["CAMP", "stop somewhere and light a fire"],
  ["GO", "cruise — holds the throttle so you only steer"],
  ["journal", "everywhere you have been"],
  ["pinch-free", "the whole left half is the stick"],
];

const CARDINALS: [number, string][] = [
  [0, "N"],
  [45, "NE"],
  [90, "E"],
  [135, "SE"],
  [180, "S"],
  [225, "SW"],
  [270, "W"],
  [315, "NW"],
];

export class Hud {
  private root: HTMLElement;
  private clockEl!: HTMLElement;
  private biomeEl!: HTMLElement;
  private elevEl!: HTMLElement;
  private coordEl!: HTMLElement;
  private kmEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private compassEl!: HTMLElement;
  private promptEl!: HTMLElement;

  private muteEl!: HTMLElement;
  /** Open/close the controls sheet. Also driven by H, ? and Escape. */
  toggleHelp: (show?: boolean) => void = () => {};
  private onlineEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastNameEl!: HTMLElement;
  private toastTimer = 0;
  private glassEl!: HTMLElement;
  private marksEl!: HTMLElement;
  private markPool: HTMLElement[] = [];
  private pinEls: HTMLElement[] = [];
  private pinLeadEl!: HTMLElement;
  /** Called when the player taps a marker through the glass. */
  onPinRequest?: (id: string) => void;
  onRest?: (target: "dawn" | "dusk") => void;
  onJournal?: () => void;
  /** Tapping a name in the who's-here list. */
  onFollow?: (id: number) => void;
  private whoEl!: HTMLElement;
  private whoSig = "";
  onStrikeCamp?: () => void;
  private campEl!: HTMLElement;
  private campWhereEl!: HTMLElement;
  private dotEl!: HTMLElement;

  constructor(
    controls: Controls,
    audio: { toggleMute(): boolean; setVolume(v: number): void; volume: number; muted: boolean },
    net: { name: string; world: string; join(name: string, world: string): void; solo(): void }
  ) {
    this.root = document.getElementById("ui")!;
    this.root.innerHTML = `
      <div class="panel panel-left">
        <div class="clock" id="h-clock">00:00</div>
        <div class="sub" id="h-biome">—</div>
        <div class="sub" id="h-elev">—</div>
      </div>
      <div class="panel panel-right">
        <div class="sub" id="h-coord">—</div>
        <div class="sub" id="h-km">—</div>
        <div class="sub dim" id="h-fps">—</div>
        <div class="audio">
          <input type="range" class="vol" id="h-vol" min="0" max="100" value="${Math.round(audio.volume * 100)}" aria-label="volume">
          <button class="mute" id="h-mute">${audio.muted ? "muted" : "sound"}</button>
        </div>
      </div>
      <div class="compass"><div class="compass-tape" id="h-compass"></div><div class="compass-needle"></div></div>
      <div class="pin-lead" id="h-pin-lead"></div>
      <div class="prompt" id="h-prompt"></div>
      <div class="camp" id="h-camp">
        <div class="camp-where" id="h-camp-where"></div>
        <div class="camp-acts">
          <button class="camp-btn" id="h-rest-dawn">rest until dawn</button>
          <button class="camp-btn" id="h-rest-dusk">rest until dusk</button>
          <button class="camp-btn ghost" id="h-strike">break camp</button>
        </div>
      </div>
      <div class="glass" id="h-glass"><div class="glass-recticle"></div></div>
      <div class="marks" id="h-marks"></div>
      <div class="toast" id="h-toast"><span class="toast-kicker">found</span><span id="h-toast-name"></span></div>
      ${
        controls.isTouch
          ? `<div class="stick" id="h-stick"><div class="knob" id="h-knob"></div></div>
             <div class="buttons">
               <button class="btn" id="b-interact">⏎</button>
               <button class="btn" id="b-jump">⤴</button>
               <button class="btn small" id="b-sprint">RUN</button>
               <button class="btn small" id="b-glass">LOOK</button>
               <button class="btn small" id="b-camp">CAMP</button>
               <button class="btn small" id="b-cruise">GO</button>
             </div>`
          : ``
      }
      <button class="help-btn" id="h-help">controls</button>
      <button class="journal-btn" id="h-journal">journal</button>
      <button class="world-btn" id="h-world"><span class="dot" id="h-dot"></span><span id="h-online">solo</span></button>
      <div class="sheet" id="h-world-sheet">
        <div class="sheet-card">
          <h2>World</h2>
          <label class="field"><span>Your name</span><input id="h-name" maxlength="16" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>World code</span><input id="h-code" maxlength="24" autocomplete="off" spellcheck="false"></label>
          <p class="note">Anyone who enters the same world code roams the same map and can see you. The map itself is identical for everybody — only players are shared.</p>
          <div class="who" id="h-who"></div>
          <button class="sheet-close" id="h-join">join world</button>
          <button class="sheet-close ghost" id="h-solo">play solo</button>
        </div>
      </div>
      <div class="sheet" id="h-sheet">
        <div class="sheet-card">
          <h2>Controls</h2>
          <dl>${(controls.isTouch ? TOUCH_KEYS : DESK_KEYS)
            .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
            .join("")}</dl>
          <button class="sheet-close" id="h-sheet-close">close</button>
        </div>
      </div>
    `;

    this.clockEl = document.getElementById("h-clock")!;
    this.biomeEl = document.getElementById("h-biome")!;
    this.elevEl = document.getElementById("h-elev")!;
    this.coordEl = document.getElementById("h-coord")!;
    this.kmEl = document.getElementById("h-km")!;
    this.fpsEl = document.getElementById("h-fps")!;
    this.compassEl = document.getElementById("h-compass")!;
    this.pinLeadEl = document.getElementById("h-pin-lead")!;
    this.promptEl = document.getElementById("h-prompt")!;
    this.muteEl = document.getElementById("h-mute")!;
    this.muteEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.setMuted(audio.toggleMute());
    });
    const vol = document.getElementById("h-vol") as HTMLInputElement;
    // Stop drags on the slider from also spinning the camera.
    for (const ev of ["pointerdown", "pointermove"]) vol.addEventListener(ev, (e) => e.stopPropagation());
    vol.addEventListener("input", () => audio.setVolume(Number(vol.value) / 100));

    this.compassEl.innerHTML = CARDINALS.concat(CARDINALS.map(([d, n]) => [d + 360, n] as [number, string]))
      .concat(CARDINALS.map(([d, n]) => [d - 360, n] as [number, string]))
      .map(([d, n]) => `<span style="left:${d * 2}px">${n}</span>`)
      .join("");

    this.campEl = document.getElementById("h-camp")!;
    this.campWhereEl = document.getElementById("h-camp-where")!;
    const tap = (id: string, fn: () => void) =>
      document.getElementById(id)!.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        fn();
      });
    tap("h-journal", () => this.onJournal?.());
    tap("h-rest-dawn", () => this.onRest?.("dawn"));
    tap("h-rest-dusk", () => this.onRest?.("dusk"));
    tap("h-strike", () => this.onStrikeCamp?.());

    this.glassEl = document.getElementById("h-glass")!;
    this.marksEl = document.getElementById("h-marks")!;
    this.toastEl = document.getElementById("h-toast")!;
    this.toastNameEl = document.getElementById("h-toast-name")!;
    this.whoEl = document.getElementById("h-who")!;
    this.whoEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const row = (e.target as HTMLElement).closest(".who-row") as HTMLElement | null;
      if (row?.dataset.id) this.onFollow?.(Number(row.dataset.id));
    });
    this.onlineEl = document.getElementById("h-online")!;
    this.dotEl = document.getElementById("h-dot")!;

    const worldSheet = document.getElementById("h-world-sheet")!;
    const nameInput = document.getElementById("h-name") as HTMLInputElement;
    const codeInput = document.getElementById("h-code") as HTMLInputElement;
    const showWorld = (on: boolean) => {
      if (on) {
        nameInput.value = net.name;
        codeInput.value = net.world;
      }
      worldSheet.classList.toggle("open", on);
    };
    document.getElementById("h-world")!.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      showWorld(!worldSheet.classList.contains("open"));
    });
    document.getElementById("h-join")!.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      net.join(nameInput.value, codeInput.value);
      showWorld(false);
    });
    document.getElementById("h-solo")!.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      net.solo();
      showWorld(false);
    });
    worldSheet.addEventListener("pointerdown", (e) => {
      if (e.target === worldSheet) showWorld(false);
    });
    for (const el of [nameInput, codeInput]) {
      for (const ev of ["pointerdown", "keydown"]) el.addEventListener(ev, (e) => e.stopPropagation());
    }

    const sheet = document.getElementById("h-sheet")!;
    const toggle = (show?: boolean) => {
      const on = show ?? !sheet.classList.contains("open");
      sheet.classList.toggle("open", on);
    };
    this.toggleHelp = toggle;
    for (const id of ["h-help", "h-sheet-close"]) {
      document.getElementById(id)!.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        toggle();
      });
    }
    sheet.addEventListener("pointerdown", (e) => {
      if (e.target === sheet) toggle(false);
    });
    addEventListener("keydown", (e) => {
      if (e.code === "KeyH" || e.key === "?") toggle();
      if (e.code === "Escape") toggle(false);
    });
    if (controls.isTouch) {
      controls.bindStick(document.getElementById("h-stick")!, document.getElementById("h-knob")!);
      controls.bindButton(document.getElementById("b-jump")!, "jump");
      controls.bindButton(document.getElementById("b-interact")!, "interact");
      controls.bindButton(document.getElementById("b-sprint")!, "sprint");
      controls.bindButton(document.getElementById("b-glass")!, "glass");
      controls.bindButton(document.getElementById("b-camp")!, "camp");
      controls.bindButton(document.getElementById("b-cruise")!, "cruise");
    }
  }

  /**
   * Who else is in this world. Tapping one puts a chevron on the compass
   * pointing at them — optional, self-selected, and it goes away the moment
   * they leave or you tap again.
   */
  setWho(peers: { id: number; name: string; km: number }[], following: number | null) {
    // Distance is rounded before signing, so the list only rebuilds when
    // something a human would notice has actually changed.
    const sig = peers.map((q) => `${q.id}:${q.km.toFixed(1)}:${q.id === following}`).join("|");
    if (sig === this.whoSig) return;
    this.whoSig = sig;

    this.whoEl.innerHTML = peers.length
      ? peers
          .map(
            (q) => `<button class="who-row${q.id === following ? " on" : ""}" data-id="${q.id}">
              <b>${q.name}</b><s>${q.km.toFixed(1)} km${q.id === following ? " · following" : ""}</s>
            </button>`
          )
          .join("")
      : `<p class="who-empty">Nobody else is out here right now.</p>`;
  }

  /** `count` excludes you. */
  setPresence(status: "offline" | "connecting" | "online", count: number) {
    this.dotEl.className = `dot ${status}`;
    this.onlineEl.textContent =
      status === "online" ? (count === 0 ? "alone here" : `${count + 1} here`)
      : status === "connecting" ? "connecting"
      : "solo";
  }

  /** Says what you just walked up to, then gets out of the way. */
  announce(name: string) {
    this.toastNameEl.textContent = name;
    this.toastEl.classList.add("on");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("on"), 4200);
  }

  setCamp(on: boolean, where: string | null, resting: boolean, held = false) {
    this.campEl.classList.toggle("on", on);
    this.campEl.classList.toggle("resting", resting);
    // Leaning on the tether explains the way out, rather than just stopping you.
    this.campWhereEl.textContent = held
      ? "break camp to move on"
      : where
        ? `camped at ${where}`
        : "camped";
  }

  setGlassing(on: boolean) {
    this.glassEl.classList.toggle("on", on);
    this.marksEl.classList.toggle("on", on);
  }

  /**
   * Markers for what's visible through the glass. Pooled, because this runs
   * every frame while glassing and churning DOM nodes would stutter the view.
   */
  setMarks(marks: { id: string; name: string; sx: number; sy: number; km: number; pinned: boolean }[]) {
    while (this.markPool.length < marks.length) {
      const el = document.createElement("button");
      el.className = "mark";
      el.innerHTML = `<i></i><b></b><s></s>`;
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        if (id) this.onPinRequest?.(id);
      });
      this.marksEl.appendChild(el);
      this.markPool.push(el);
    }
    for (let i = 0; i < this.markPool.length; i++) {
      const el = this.markPool[i];
      const m = marks[i];
      if (!m) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      el.style.transform = `translate(${m.sx}px, ${m.sy}px)`;
      el.dataset.id = m.id;
      el.classList.toggle("pinned", m.pinned);
      el.querySelector("b")!.textContent = m.name;
      el.querySelector("s")!.textContent = `${m.km.toFixed(1)} km`;
    }
  }

  /**
   * Pins on the compass.
   *
   * Position and identity are deliberately separated. Only a narrow chevron
   * and a range ride the tape — a full name is wide enough that, centred on
   * its bearing inside a 230 px compass whose outer fifth is masked away, most
   * of it gets clipped the moment the bearing is off-centre. The name instead
   * goes on its own line below the compass, outside the clipping box, for
   * whichever pin you're actually facing.
   */
  setPins(pins: { name: string; bearing: number; km: number; live?: boolean }[], headingDeg: number) {
    while (this.pinEls.length < pins.length) {
      const el = document.createElement("span");
      el.className = "pin";
      el.innerHTML = `<i>▾</i><s></s>`;
      this.compassEl.appendChild(el);
      this.pinEls.push(el);
    }

    let lead: { name: string; km: number } | null = null;
    let leadOff = 999;

    for (let i = 0; i < this.pinEls.length; i++) {
      const el = this.pinEls[i];
      const p = pins[i];
      if (!p) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      el.style.left = `${p.bearing * 2}px`;
      el.classList.toggle("live", !!p.live);
      el.querySelector("i")!.textContent = p.live ? "●" : "▾";
      el.querySelector("s")!.textContent = `${p.km.toFixed(1)}km`;

      // Signed shortest angle, so wrapping past north doesn't pick the wrong pin.
      const off = Math.abs((((p.bearing - headingDeg) % 360) + 540) % 360 - 180);
      if (off < leadOff) {
        leadOff = off;
        lead = p;
      }
    }

    const show = lead !== null && leadOff < 32;
    this.pinLeadEl.textContent = show && lead ? `${lead.name} · ${lead.km.toFixed(1)} km` : "";
    this.pinLeadEl.classList.toggle("on", show);
  }

  setMuted(muted: boolean) {
    this.muteEl.textContent = muted ? "muted" : "sound";
    this.muteEl.classList.toggle("off", muted);
  }

  update(s: HudState) {
    this.clockEl.textContent = s.clock;
    this.biomeEl.textContent = s.biome;
    this.elevEl.textContent = `${Math.round(s.elevation)} m`;
    this.coordEl.textContent = `${Math.round(s.x)}, ${Math.round(s.z)}`;
    this.kmEl.textContent = `${s.km.toFixed(2)} km travelled`;
    this.fpsEl.textContent = `${Math.round(s.fps)} fps`;
    this.compassEl.style.transform = `translateX(${-s.headingDeg * 2}px)`;
    this.promptEl.textContent = s.prompt ?? "";
    this.promptEl.classList.toggle("on", !!s.prompt);
  }
}
