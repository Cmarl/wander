/**
 * The world function. h = terrainHeight(x, z), plus the biome fields that
 * drive colour and scatter.
 *
 * MIRROR: src/world/field.ts — any edit here must be made there too.
 */
export const TERRAIN_GLSL = /* glsl */ `
// Domain warp — bends every downstream feature so nothing reads as grid-aligned.
vec2 wWarp(vec2 p) {
  vec2 q = p * (1.0 / 7000.0);
  float wx = wFbm(q, 3, 91u) - 0.5;
  float wy = wFbm(q + vec2(5.2, 1.3), 3, 97u) - 0.5;
  return p + vec2(wx, wy) * 2600.0;
}

// 0 = deep ocean, 1 = continental interior. Wavelength ~26 km.
float wContinent(vec2 pw) { return wFbm(pw * (1.0 / 26000.0), 4, 11u); }

// Mountains live in belts, not everywhere. Wavelength ~15 km.
float wRangeMask(vec2 pw) { return smoothstep(0.50, 0.78, wFbm(pw * (1.0 / 15000.0), 3, 31u)); }

// fBm sums octaves, so by the central limit theorem its values bunch around
// 0.5 and never reach the extremes. Left raw, every biome blend lands mid-range
// and the whole world comes out one flat colour. Stretch about the midpoint so
// genuinely dry and genuinely wet country both exist.
// MIRROR: src/world/field.ts
float wStretch(float v, float k) { return clamp((v - 0.5) * k + 0.5, 0.0, 1.0); }

// Biased warm: stretching alone left most of the map under the tundra line.
float wTemperature(vec2 p) { return clamp(wStretch(wFbm(p * (1.0 / 42000.0), 3, 131u), 2.1) + 0.1, 0.0, 1.0); }
float wMoisture(vec2 p) {
  // Two scales: broad climate, plus patchiness within a region.
  float broad = wFbm(p * (1.0 / 17000.0), 4, 137u);
  float local = wFbm(p * (1.0 / 2600.0), 3, 139u);
  return wStretch(broad * 0.82 + local * 0.18, 2.3);
}

/**
 * Region-scale character, sampled unwarped so it stays stable.
 *
 * relief  0 = country flat enough to build on, 1 = serious mountains
 * density 0 = empty, 1 = thick with trees and places
 *
 * These are smooth fields rather than cells, so regions blend into one another
 * instead of meeting at a seam — but they're low-frequency enough that a
 * region still reads as one coherent place for tens of kilometres.
 * MIRROR: src/world/field.ts
 */
/**
 * Ways — see wayAt in world/field.ts for why this is a contour and not a
 * route. Mirrored exactly: same scales, same seeds, same thresholds.
 */
float wWay(vec2 p) {
  float v = wFbm(p * (1.0 / 5200.0), 3, 241u) - 0.5;
  float line = 1.0 - smoothstep(0.0, 0.001, abs(v));
  float gate = smoothstep(0.42, 0.62, wFbm(p * (1.0 / 9000.0), 2, 251u));
  return line * gate;
}

float wRelief(vec2 p)  { return wStretch(wFbm(p * (1.0 / 46000.0), 3, 211u), 1.7); }
float wDensity(vec2 p) { return wStretch(wFbm(p * (1.0 / 31000.0), 3, 223u), 1.5); }

float terrainHeight(vec2 p) {
  vec2 pw = wWarp(p);

  float cont = wContinent(pw);
  float land = smoothstep(0.40, 0.52, cont);
  float base = mix(-300.0, 400.0, smoothstep(0.20, 0.86, cont));

  // Relief is what gives the world its contrast: flats you could put a town
  // on in one place, and something you'd need a day to climb in another.
  float relief = wRelief(p);

  float r = wRidged(pw * (1.0 / 6500.0), 6, 41u);
  float mountains = pow(r, 2.3) * 2550.0 * wRangeMask(pw) * land * (0.14 + relief * 1.85);

  float hills  = (wFbm(pw * (1.0 / 950.0), 5, 61u) - 0.5) * 150.0 * land * (0.40 + relief * 1.15);
  float detail = (wFbm(p  * (1.0 /  95.0), 4, 71u) - 0.5) * 13.0;

  float h = base + mountains + hills + detail * mix(0.35, 1.0, land)
          + (relief - 0.5) * 170.0 * land;

  // Flatten toward sea level so coastlines get beaches instead of cliffs.
  h = h * (1.0 - 0.5 * exp(-h * h * (1.0 / 3600.0)));
  return h;
}

vec3 terrainAlbedo(vec2 p, float h, vec3 n) {
  float temp  = wTemperature(p) - h * (1.0 / 9000.0);   // altitude lapse rate
  float moist = wMoisture(p);
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);

  const vec3 SAND   = SRGB(0.86, 0.78, 0.58);
  const vec3 ARID   = SRGB(0.74, 0.52, 0.33);   // burnt earth, hot and dry
  const vec3 GOLD   = SRGB(0.82, 0.69, 0.33);   // dry steppe — the hero colour
  const vec3 MEADOW = SRGB(0.47, 0.56, 0.27);
  const vec3 FOREST = SRGB(0.22, 0.34, 0.21);
  const vec3 TUNDRA = SRGB(0.58, 0.55, 0.42);
  const vec3 ROCK   = SRGB(0.52, 0.50, 0.47);
  const vec3 SNOW   = SRGB(0.95, 0.96, 0.99);

  vec3 c = mix(GOLD, MEADOW, smoothstep(0.46, 0.82, moist));
  c = mix(c, FOREST, smoothstep(0.56, 0.82, moist) * smoothstep(0.35, 0.60, temp));
  // Hot and dry burns the grass out entirely.
  c = mix(c, ARID, smoothstep(0.34, 0.10, moist) * smoothstep(0.48, 0.74, temp));
  c = mix(c, TUNDRA, smoothstep(0.42, 0.24, temp));

  // Mottling at two scales so neither broad country nor close ground reads flat.
  c *= 0.80 + 0.26 * wFbm(p * (1.0 / 230.0), 3, 151u) + 0.20 * wFbm(p * (1.0 / 1400.0), 2, 153u);

  c = mix(SAND, c, smoothstep(1.5, 14.0, h));

  float rockAmt = smoothstep(0.40, 0.66, slope);
  c = mix(c, ROCK * (0.80 + 0.40 * wFbm(p * (1.0 / 60.0), 3, 157u)), rockAmt);

  float snowLine = mix(2300.0, 820.0, 1.0 - clamp(temp, 0.0, 1.0));
  float snowAmt = smoothstep(snowLine, snowLine + 320.0, h) * smoothstep(0.78, 0.46, slope);
  c = mix(c, SNOW, snowAmt);

  // A worn track. Faint on purpose, and it gives up on rock, on snow and on
  // anything steep — the places nobody would have driven in the first place.
  const vec3 TRACK = SRGB(0.44, 0.38, 0.30);
  float way = wWay(p)
            * (1.0 - rockAmt) * (1.0 - snowAmt)
            * smoothstep(0.34, 0.14, slope)
            * smoothstep(2.0, 12.0, h);
  c = mix(c, TRACK * (0.86 + 0.28 * wFbm(p * (1.0 / 40.0), 2, 163u)), way * 0.62);

  return c;
}
`;
