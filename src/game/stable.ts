import { CLASSES, type VehicleClass } from "./vehicles";

/**
 * What you own, and which one is yours right now.
 *
 * Summoning brings whatever is set, or the truck, which you always have — so
 * there is no state in which you are stranded without a way to get around.
 *
 * Stored under the wander.* prefix like everything else, which means it rides
 * along in the portable save with no work: that save is the whole subtree.
 */
const KEY = "wander.stable";

export class Stable {
  owned: VehicleClass[] = ["truck"];
  chosen: VehicleClass = "truck";

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw) {
        // Filter against CLASSES so a save written by a build that knew about
        // a vehicle this one doesn't can't put you in something that no longer
        // exists — you would be driving a spec that is undefined.
        const owned = (raw.owned as unknown[] ?? []).filter(
          (c): c is VehicleClass => typeof c === "string" && (CLASSES as string[]).includes(c)
        );
        this.owned = [...new Set(["truck" as VehicleClass, ...owned])];
        this.chosen = this.owned.includes(raw.chosen) ? raw.chosen : "truck";
      }
    } catch {
      // Fresh start, which is a truck.
    }
  }

  /** True if this is new to you. */
  claim(cls: VehicleClass): boolean {
    if (this.owned.includes(cls)) return false;
    this.owned.push(cls);
    this.save();
    return true;
  }

  choose(cls: VehicleClass) {
    if (!this.owned.includes(cls)) return;
    this.chosen = cls;
    this.save();
  }

  /** Next one you own, for the keyboard shortcut. */
  cycle(): VehicleClass {
    const i = this.owned.indexOf(this.chosen);
    this.chosen = this.owned[(i + 1) % this.owned.length];
    this.save();
    return this.chosen;
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ owned: this.owned, chosen: this.chosen }));
    } catch {
      // Private browsing. You keep it for this session.
    }
  }
}
