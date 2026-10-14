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

const KEY = "wander.paint";

export class Garage {
  index = Math.max(0, Number(localStorage.getItem(KEY) ?? 0)) | 0;

  unlocked(km: number): Paint[] {
    return PAINTS.filter((p) => km >= p.km);
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
