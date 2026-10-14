/**
 * CPU mirror of src/world/glsl/{noise,terrain}.ts.
 *
 * The hashes are bit-exact against the GPU (integer lattice + Math.imul), so
 * `heightAt()` returns the same surface the vertex shader draws. Only the float
 * interpolation differs, by ~1e-7 relative.
 *
 * If you edit the GLSL, edit this. They are two halves of one function.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function wHash(x: number, y: number): number {
  let h = (Math.imul(x, 1597334677) ^ Math.imul(y, 3812015801)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

function wLattice(cx: number, cy: number, seed: number): number {
  const h = wHash((cx ^ seed) >>> 0, (cy ^ Math.imul(seed, 747796405)) >>> 0);
  return (h >>> 8) * (1 / 16777216);
}

function wNoise(px: number, py: number, seed: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const a = wLattice(ix, iy, seed);
  const b = wLattice(ix + 1, iy, seed);
  const d = wLattice(ix, iy + 1, seed);
  const e = wLattice(ix + 1, iy + 1, seed);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(a, b, ux), lerp(d, e, ux), uy);
}

function wFbm(px: number, py: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let x = px;
  let y = py;
  for (let i = 0; i < octaves; i++) {
    sum += amp * wNoise(x, y, (seed + i * 1013) >>> 0);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

function wRidged(px: number, py: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let x = px;
  let y = py;
  for (let i = 0; i < octaves; i++) {
    const n = wNoise(x, y, (seed + i * 1013) >>> 0);
    sum += amp * (1 - Math.abs(n * 2 - 1));
    norm += amp;
    x *= 2.07;
    y *= 2.07;
    amp *= 0.52;
  }
  return sum / norm;
}

// --- world fields -----------------------------------------------------------

const warp = { x: 0, y: 0 };

function wWarp(px: number, py: number): void {
  const qx = px * (1 / 7000);
  const qy = py * (1 / 7000);
  const wx = wFbm(qx, qy, 3, 91) - 0.5;
  const wy = wFbm(qx + 5.2, qy + 1.3, 3, 97) - 0.5;
  warp.x = px + wx * 2600;
  warp.y = py + wy * 2600;
}

const wContinent = (x: number, y: number) => wFbm(x * (1 / 26000), y * (1 / 26000), 4, 11);
const wRangeMask = (x: number, y: number) =>
  smoothstep(0.5, 0.78, wFbm(x * (1 / 15000), y * (1 / 15000), 3, 31));

/** MIRROR of wStretch in glsl/terrain.ts — see the note there. */
const stretch = (v: number, k: number) => Math.min(1, Math.max(0, (v - 0.5) * k + 0.5));

export const temperatureAt = (x: number, z: number) =>
  Math.min(1, stretch(wFbm(x / 42000, z / 42000, 3, 131), 2.1) + 0.1);

export const moistureAt = (x: number, z: number) =>
  stretch(wFbm(x / 17000, z / 17000, 4, 137) * 0.82 + wFbm(x / 2600, z / 2600, 3, 139) * 0.18, 2.3);

export const SEA_LEVEL = 0;

export function heightAt(x: number, z: number): number {
  wWarp(x, z);
  const wx = warp.x;
  const wz = warp.y;

  const cont = wContinent(wx, wz);
  const land = smoothstep(0.4, 0.52, cont);
  const base = lerp(-300, 400, smoothstep(0.20, 0.86, cont));

  const r = wRidged(wx * (1 / 6500), wz * (1 / 6500), 6, 41);
  const mountains = Math.pow(r, 2.3) * 2550 * wRangeMask(wx, wz) * land;

  const hills = (wFbm(wx * (1 / 950), wz * (1 / 950), 5, 61) - 0.5) * 150 * land;
  const detail = (wFbm(x * (1 / 95), z * (1 / 95), 4, 71) - 0.5) * 13;

  let h = base + mountains + hills + detail * lerp(0.35, 1, land);
  h = h * (1 - 0.5 * Math.exp((-h * h) / 3600));
  return h;
}

/** Surface normal by central difference. `eps` ~ half the local triangle size. */
export function normalAt(x: number, z: number, eps = 2, out = { x: 0, y: 1, z: 0 }) {
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * eps;
  const inv = 1 / Math.hypot(nx, ny, nz);
  out.x = nx * inv;
  out.y = ny * inv;
  out.z = nz * inv;
  return out;
}

export const slopeAt = (x: number, z: number, eps = 2) => 1 - normalAt(x, z, eps).y;

// --- derived, for scatter + HUD ---------------------------------------------

export function biomeNameAt(x: number, z: number): string {
  const h = heightAt(x, z);
  if (h < SEA_LEVEL) return "Open Water";
  if (h < 3) return "Shoreline";

  const temp = temperatureAt(x, z) - h / 9000;
  const moist = moistureAt(x, z);
  const snowLine = lerp(2300, 820, 1 - clamp01(temp));

  if (h > snowLine + 120) return "Snowfield";
  if (slopeAt(x, z, 6) > 0.52) return "Scree Slope";
  if (temp < 0.3) return "Cold Tundra";
  if (moist > 0.66) return "Pine Forest";
  if (moist > 0.5) return "Highland Meadow";
  return "Golden Steppe";
}

export type Surface = "water" | "sand" | "rock" | "snow" | "grass";

/** What you are standing on. Shares its thresholds with biomeNameAt + the shader. */
export function surfaceAt(x: number, z: number): Surface {
  const h = heightAt(x, z);
  if (h < SEA_LEVEL) return "water";
  if (h < 3) return "sand";
  const temp = temperatureAt(x, z) - h / 9000;
  if (h > lerp(2300, 820, 1 - clamp01(temp))) return "snow";
  if (slopeAt(x, z, 4) > 0.5) return "rock";
  return "grass";
}

/** 0..1 chance that a scatter slot grows a tree here. */
export function treeDensityAt(x: number, z: number, h: number, slope: number): number {
  if (h < 4) return 0;
  const temp = temperatureAt(x, z) - h / 9000;
  const moist = moistureAt(x, z);
  const treeLine = lerp(1900, 620, 1 - clamp01(temp));

  let d = smoothstep(0.42, 0.72, moist);
  d *= smoothstep(0.24, 0.42, temp);
  d *= smoothstep(treeLine, treeLine - 420, h);
  d *= smoothstep(0.62, 0.30, slope);
  d *= smoothstep(4, 22, h);
  return d;
}

/** Deterministic per-slot random in [0,1). Same slot always gives the same value. */
export function slotRandom(ix: number, iz: number, salt: number): number {
  return (wHash((ix ^ Math.imul(salt, 2654435761)) >>> 0, (iz ^ Math.imul(salt, 40503)) >>> 0) >>> 8) * (1 / 16777216);
}
