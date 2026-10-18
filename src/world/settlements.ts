import { heightAt, slopeAt, moistureAt, temperatureAt, slotRandom } from "./field";

/**
 * Settlements — the headline ask, and the one thing in the world that has to
 * stay rare to work.
 *
 * Clyde's call was "somewhat rare", about one every ten to fifteen minutes of
 * driving, and still small: four to nine buildings. That rarity is the whole
 * design. At three kilometres a hamlet is scenery and the emptiness that makes
 * the rest of the world work is gone; at sixteen, finding one is an event.
 *
 * Suitability is deliberately strict and deliberately the same logic that
 * chose real sites — flat, low, sheltered, with water and something growing —
 * which means towns end up where they LOOK like they belong rather than
 * wherever the grid happened to land.
 *
 * Generated, like everything else, as a pure function of the seed. A hamlet
 * costs nothing to store and is identical for every player.
 */

export const SETTLEMENT_CELL = 16000;

/** Which building, from the shared kit. */
export type Form = "cabin" | "barn" | "shack" | "store" | "tower";

export interface Building {
  form: Form;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  wear: number;
}

export interface Settlement {
  id: string;
  name: string;
  x: number;
  z: number;
  y: number;
  buildings: Building[];
  /** Metres from the centre to the furthest building, for arrival and naming. */
  reach: number;
}

const FIRST = [
  "Ash", "Wind", "Stone", "Elk", "Cedar", "Salt", "Clay", "Crow", "Fern", "Birch",
  "Iron", "Bell", "Pine", "Hollow", "Still", "Long", "Low", "Amber", "Quiet", "Far",
];
const SECOND = [
  "fall", "ward", "water", "bank", "ridge", "ford", "reach", "gate", "hollow", "stead",
];
/** What kind of place it is. Chosen to sound like somewhere, not something. */
const SUFFIX = [
  "Crossing", "Landing", "Flats", "Bend", "Wells", "Mill", "Camp", "Siding", "Row", "Hope",
];

/**
 * Everything the kit can build, and how big each one stands.
 *
 * Collision radius matters more here than anywhere else in the game: a hamlet
 * you can drive through the middle of is a hamlet, and one you bounce off the
 * edge of is a wall.
 */
export const FORM_RADIUS: Record<Form, number> = {
  cabin: 3.4,
  barn: 5.0,
  shack: 2.4,
  store: 4.0,
  tower: 2.2,
};

function pickForm(r: number): Form {
  // Weighted so a hamlet is mostly homes, with at most a couple of the big
  // forms — six barns in a row would read as an industrial estate.
  if (r < 0.34) return "cabin";
  if (r < 0.56) return "shack";
  if (r < 0.72) return "barn";
  if (r < 0.9) return "store";
  return "tower";
}

export function settlementInCell(gx: number, gz: number): Settlement | null {
  // Rare on top of strict: even a perfect site is usually empty country.
  if (slotRandom(gx, gz, 1103) > 0.42) return null;

  const jx = slotRandom(gx, gz, 1109);
  const jz = slotRandom(gx, gz, 1117);
  const x = (gx + (jx - 0.5) * 0.7) * SETTLEMENT_CELL;
  const z = (gz + (jz - 0.5) * 0.7) * SETTLEMENT_CELL;
  const y = heightAt(x, z);

  // Low, but not in the sea. People settle where a boat or a cart can reach.
  if (y < 10 || y > 300) return null;
  // A wide slope sample, because this has to be flat across a few hundred
  // metres rather than merely flat underfoot.
  if (slopeAt(x, z, 60) > 0.085) return null;
  if (moistureAt(x, z) < 0.42) return null;
  if (temperatureAt(x, z) < 0.36) return null;

  const name =
    `${FIRST[Math.floor(slotRandom(gx, gz, 1123) * FIRST.length) % FIRST.length]}` +
    `${SECOND[Math.floor(slotRandom(gx, gz, 1129) * SECOND.length) % SECOND.length]} ` +
    `${SUFFIX[Math.floor(slotRandom(gx, gz, 1151) * SUFFIX.length) % SUFFIX.length]}`;

  // Four to nine. A hamlet you can walk across in two minutes is a discovery;
  // anything bigger is a content-production problem that would eat the project.
  const count = 4 + Math.floor(slotRandom(gx, gz, 1153) * 6);

  // The spine follows the local contour, so a street runs ALONG the hill
  // rather than straight up it — which is both what real tracks do and what
  // keeps the buildings on ground they can sit level on.
  const e = 70;
  const gradient = Math.atan2(
    heightAt(x, z + e) - heightAt(x, z - e),
    heightAt(x + e, z) - heightAt(x - e, z)
  );
  const along = gradient + Math.PI / 2;
  const ax = Math.cos(along);
  const az = Math.sin(along);

  const buildings: Building[] = [];
  let reach = 0;
  let t = -((count - 1) / 2) * 19;
  for (let i = 0; i < count; i++) {
    const salt = 1200 + i * 23;
    // Alternating sides of the street, with enough jitter that it reads as
    // grown rather than laid out.
    const side = i % 2 === 0 ? 1 : -1;
    const off = side * (10 + slotRandom(gx, gz, salt) * 6);
    const slide = (slotRandom(gx, gz, salt + 1) - 0.5) * 9;
    const bx = x + ax * (t + slide) - az * off;
    const bz = z + az * (t + slide) + ax * off;

    /**
     * One of them is always the tower.
     *
     * Clyde: "I still haven't located a settlement, is there a way or trick?"
     * Measured, there was not. A hamlet's tallest ordinary building is the
     * barn at 7.6 m, which is visible from 1.7 km; the tower is 11.6 m and
     * reads from 2.6. But the tower was a one-in-ten roll per building, so
     * about half of all hamlets had none and topped out at the barn.
     *
     * Every hamlet has one now — which is not a concession, it is what a
     * group of houses out here would actually have. Water has to come from
     * somewhere and it has to be up high to feed a trough by itself. It is
     * also the thing you genuinely see first coming over a rise.
     *
     * Placed at the middle of the street rather than an end, so it reads as
     * belonging to the hamlet rather than standing next to it.
     */
    const isTower = i === (count >> 1);
    buildings.push({
      form: isTower ? "tower" : pickForm(slotRandom(gx, gz, salt + 2)),
      x: bx,
      y: heightAt(bx, bz),
      z: bz,
      // Roughly square to the street, because that is what fronting a street
      // means, with a few degrees of slop.
      rot: along + (side > 0 ? 0 : Math.PI) + (slotRandom(gx, gz, salt + 3) - 0.5) * 0.3,
      scale: 0.92 + slotRandom(gx, gz, salt + 4) * 0.22,
      wear: slotRandom(gx, gz, salt + 5),
    });
    reach = Math.max(reach, Math.hypot(bx - x, bz - z));
    t += 15 + slotRandom(gx, gz, salt + 6) * 9;
  }

  return { id: `s${gx},${gz}`, name, x, z, y, buildings, reach };
}

export function settlementsNear(x: number, z: number, cells: number): Settlement[] {
  const cx = Math.round(x / SETTLEMENT_CELL);
  const cz = Math.round(z / SETTLEMENT_CELL);
  const out: Settlement[] = [];
  for (let gx = cx - cells; gx <= cx + cells; gx++) {
    for (let gz = cz - cells; gz <= cz + cells; gz++) {
      const s = settlementInCell(gx, gz);
      if (s) out.push(s);
    }
  }
  return out;
}
