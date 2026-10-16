/**
 * Paint unlocked by distance.
 *
 * Purely cosmetic and never gating: the only thing that earns a colour is
 * having driven somewhere, which is the thing the game is already about. No
 * stats change, nothing is locked behind an activity you don't enjoy, and
 * skipping it costs nothing.
 */

export interface Paint {
  name: string;
  hex: number;
  km: number;
}

export const PAINTS: Paint[] = [
  { name: "Ochre", hex: 0xd8c04a, km: 0 },
  { name: "Dust", hex: 0xb9a68a, km: 25 },
  { name: "Pine", hex: 0x4a6b52, km: 75 },
  { name: "Rust", hex: 0xa85c38, km: 150 },
  { name: "Slate", hex: 0x5c6670, km: 300 },
  { name: "Snowline", hex: 0xe4e7ea, km: 600 },
];

/**
 * Colours you find rather than earn.
 *
 * The distance list above is a reward for driving; these are a reward for
 * going somewhere particular. A tin of paint in a shed is more personal than
 * a colour that arrived because the odometer passed a number, and the two
 * stack rather than competing.
 */
export const CAN_PAINTS: Paint[] = [
  { name: "Signal", hex: 0xc4432f, km: 0 },
  { name: "Seafoam", hex: 0x6fbfa6, km: 0 },
  { name: "Cobalt", hex: 0x3a5f9e, km: 0 },
  { name: "Mustard", hex: 0xd2a33c, km: 0 },
  { name: "Plum", hex: 0x7a4f73, km: 0 },
  { name: "Bone", hex: 0xe6dfcd, km: 0 },
  { name: "Forest", hex: 0x2f5340, km: 0 },
  { name: "Copper", hex: 0xb56b3a, km: 0 },
];

const CANS_KEY = "wander.cans";
const KEY = "wander.paint";

export class Garage {
  index = Math.max(0, Number(localStorage.getItem(KEY) ?? 0)) | 0;

  /** Indices into CAN_PAINTS that have been found. */
  cans: number[] = [];

  loadCans() {
    try {
      const raw = JSON.parse(localStorage.getItem(CANS_KEY) || "[]");
      if (Array.isArray(raw)) {
        this.cans = raw.filter((i) => typeof i === "number" && i >= 0 && i < CAN_PAINTS.length);
      }
    } catch {
      this.cans = [];
    }
  }

  /** Returns the paint if it is new to you, or null. */
  findCan(index: number): Paint | null {
    const i = ((index % CAN_PAINTS.length) + CAN_PAINTS.length) % CAN_PAINTS.length;
    if (this.cans.includes(i)) return null;
    this.cans.push(i);
    try {
      localStorage.setItem(CANS_KEY, JSON.stringify(this.cans));
    } catch {
      // Private browsing. Yours for the session.
    }
    return CAN_PAINTS[i];
  }

  unlocked(km: number): Paint[] {
    return [...PAINTS.filter((p) => km >= p.km), ...this.cans.map((i) => CAN_PAINTS[i])];
  }

  current(km: number): Paint {
    const open = this.unlocked(km);
    return open[Math.min(this.index, open.length - 1)] ?? PAINTS[0];
  }

  /** Returns the newly selected paint. */
  cycle(km: number): Paint {
    const open = this.unlocked(km);
    this.index = (this.index + 1) % open.length;
    localStorage.setItem(KEY, String(this.index));
    return open[this.index];
  }
}
