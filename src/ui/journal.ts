import type { Discoveries, Found } from "../game/discovery";

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

export class Journal {
  private sheet: HTMLElement;
  private list: HTMLElement;
  private note: HTMLElement;

  constructor(
    private found: Discoveries,
    private biomeOf: (x: number, z: number) => string
  ) {
    this.sheet = document.createElement("div");
    this.sheet.className = "sheet journal";
    this.sheet.innerHTML = `
      <div class="sheet-card">
        <h2>Field Journal</h2>
        <div class="journal-list" id="j-list"></div>
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
    this.note = this.sheet.querySelector("#j-note")!;

    const tap = (id: string, fn: () => void) =>
      this.sheet.querySelector(id)!.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        fn();
      });
    tap("#j-close", () => this.toggle(false));
    tap("#j-copy", () => void this.copy());
    tap("#j-paste", () => void this.paste());
    this.sheet.addEventListener("pointerdown", (e) => {
      if (e.target === this.sheet) this.toggle(false);
    });
  }

  toggle(show?: boolean) {
    const on = show ?? !this.sheet.classList.contains("open");
    if (on) this.render();
    this.sheet.classList.toggle("open", on);
  }

  get open() {
    return this.sheet.classList.contains("open");
  }

  private render() {
    const all = this.found.all();
    this.note.textContent = "";
    if (!all.length) {
      this.list.innerHTML = `<p class="journal-empty">Nothing yet. Drive toward something you don't recognise.</p>`;
      return;
    }
    this.list.innerHTML = all
      .map((f) => {
        const biome = this.biomeOf(f.x, f.z);
        const tag = KIND_LABEL[f.kind] ?? "landmark";
        return `<div class="entry">
          <img src="${swatch(f, biome)}" alt="" width="72" height="48">
          <div class="entry-text">
            <b>${f.name}</b>
            <s>${tag} · ${Math.round(f.x)}, ${Math.round(f.z)}</s>
            <s class="dim">${when(f.at)}</s>
          </div>
        </div>`;
      })
      .join("");
  }

  private async copy() {
    const code = this.found.exportCode();
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
      const added = this.found.importCode(code);
      this.render();
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
