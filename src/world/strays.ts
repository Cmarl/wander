import { heightAt, slopeAt, slotRandom } from "./field";
import { CLASSES, SPECS, type VehicleClass } from "../game/vehicles";
import { regionAt } from "./regions";

/**
 * Vehicles left in the world.
 *
 * Clyde asked for them to be FOUND rather than unlocked, so they are placed
 * the same way everything else is: a hash over a coarse grid, checked against
 * the terrain. Nothing is earned and nothing is spent — you come across a bike
 * parked on a slope and from then on it is one of yours.
 *
 * Finding one does not remove it from the world, because the world is a pure
 * function and there is nowhere to record that it is gone. That turns out to be
 * the right behaviour anyway: the bike you found stays where you found it, and
 * a friend in the same world finds it too.
 */

export const STRAY_CELL = 3400;
/**
 * Most cells have nothing — but not as few as before.
 *
 * This has been both ways. At 0.3 with the truck included it "started to
 * read as a scrapyard", and it was cut to 0.18. Then Clyde: "it's so hard to
 * find new vehicle types." Both were true, because a fifth of what was out
 * there was a truck — the one machine everybody starts with — so the world
 * was cluttered AND a real find was one cell in seven.
 *
 * 0.25 with the truck taken out of the list: fewer objects standing about
 * than the scrapyard had, and every one of them is something you might not
 * own. They are also talked about on the radio and named through the
 * binoculars now, which matters more than the count does.
 */
const OCCUPANCY = 0.25;

/** Weathered colours. These have been sitting out for years. */
const PAINTS = [0x9a7f4e, 0x6f7a6a, 0xa85c38, 0x5c6670, 0x7d6b84, 0xb9a68a];

export interface Stray {
  id: string;
  cls: VehicleClass;
  paint: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  /** For the journal line. */
  name: string;
}

export function strayInCell(gx: number, gz: number): Stray | null {
  if (slotRandom(gx, gz, 1403) > OCCUPANCY) return null;

  const x = (gx + (slotRandom(gx, gz, 1409) - 0.5) * 0.8) * STRAY_CELL;
  const z = (gz + (slotRandom(gx, gz, 1411) - 0.5) * 0.8) * STRAY_CELL;
  const y = heightAt(x, z);
  // Somebody drove it here, so it has to be ground something could drive on.
  if (y < 12 || y > 2200) return null;
  if (slopeAt(x, z, 8) > 0.26) return null;

  /**
   * Only things with wheels are left lying about.
   *
   * Clyde: aircraft live at airstrips now, and boats at landings. A plane
   * parked in a random meadow was always a bit odd, and having a place they
   * belong to is worth more than having them everywhere.
   */
  const GROUND = CLASSES.filter((c) => !SPECS[c].flies && !SPECS[c].floats && c !== "truck");
  const cls = GROUND[Math.floor(slotRandom(gx, gz, 1423) * GROUND.length) % GROUND.length];
  return {
    id: `stray:${gx},${gz}`,
    cls,
    paint: PAINTS[Math.floor(slotRandom(gx, gz, 1427) * PAINTS.length) % PAINTS.length],
    x,
    y,
    z,
    rot: slotRandom(gx, gz, 1429) * Math.PI * 2,
    name: `${SPECS[cls].label} in ${regionAt(x, z).name}`,
  };
}

export function straysNear(x: number, z: number, cells: number): Stray[] {
  const cx = Math.round(x / STRAY_CELL);
  const cz = Math.round(z / STRAY_CELL);
  const out: Stray[] = [];
  for (let gx = cx - cells; gx <= cx + cells; gx++) {
    for (let gz = cz - cells; gz <= cz + cells; gz++) {
      const s = strayInCell(gx, gz);
      if (s) out.push(s);
    }
  }
  return out;
}
