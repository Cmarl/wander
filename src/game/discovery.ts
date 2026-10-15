/**
 * What the player has found.
 *
 * Deliberately stored as a flat list of plain coordinates rather than anything
 * clever. Everything a player marks on this map — landmarks found, and later
 * camps, cairns and tracks — goes in this shape, so turning any of it into
 * shared world traces becomes a server change rather than a rewrite.
 *
 * Local only. No account, no auth, no hosting cost. The export code is a
 * copyable blob so a save can move between devices by hand.
 */

const KEY = "wander.found";

export interface Found {
  /** Grid cell id — stable for every player, since the world is a function. */
  id: string;
  kind: string;
  name: string;
  x: number;
  z: number;
  /** Real-world timestamp, for the journal. */
  at: number;
  /** In-game time of day when it was found, 0..1. Optional for older saves. */
  tod?: number;
  /** Which region it was in. Optional for older saves. */
  region?: string;
}

export class Discoveries {
  private found = new Map<string, Found>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) for (const f of JSON.parse(raw) as Found[]) this.found.set(f.id, f);
    } catch {
      // A corrupt save is not worth losing a session over.
    }
  }

  has(id: string) {
    return this.found.has(id);
  }

  get count() {
    return this.found.size;
  }

  all(): Found[] {
    return [...this.found.values()].sort((a, b) => b.at - a.at);
  }

  /** Returns false if it was already known. */
  add(f: Found): boolean {
    if (this.found.has(f.id)) return false;
    this.found.set(f.id, f);
    this.save();
    return true;
  }

  /** How many of each kind — the journal reads this. */
  tally(): Map<string, number> {
    const t = new Map<string, number>();
    for (const f of this.found.values()) t.set(f.kind, (t.get(f.kind) ?? 0) + 1);
    return t;
  }

  exportCode(): string {
    return JSON.stringify({ v: 1, found: this.all() });
  }

  importCode(code: string): number {
    const data = JSON.parse(code) as { v: number; found: Found[] };
    if (!data || !Array.isArray(data.found)) throw new Error("not a Wander save");
    let added = 0;
    for (const f of data.found) {
      if (typeof f?.id !== "string") continue;
      if (!this.found.has(f.id)) added++;
      this.found.set(f.id, f);
    }
    this.save();
    return added;
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.all()));
    } catch {
      // Private browsing, quota, whatever — the game still plays.
    }
  }
}
