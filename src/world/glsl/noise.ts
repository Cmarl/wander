/**
 * Integer-lattice value noise.
 *
 * The hash takes *integer* lattice coords, so it is bit-exact identical on the
 * GPU (uint ops in GLSL ES 3.00) and on the CPU (Math.imul / >>> 0 in JS).
 * That's what lets the terrain the player collides with be the same terrain
 * the vertex shader draws. Only the float interpolation differs between the
 * two, at ~1e-7 relative — sub-millimetre on a 2500 m mountain.
 *
 * MIRROR: src/world/field.ts — keep the two in lockstep.
 */
export const NOISE_GLSL = /* glsl */ `
// Palettes are authored as the colour you want to SEE. Shading happens in
// linear space, so lift them out of display space first. Squaring is a close
// enough stand-in for sRGB decode and constant-folds away at compile time.
#define SRGB(r, g, b) (vec3(r, g, b) * vec3(r, g, b))

uint wHash(uint x, uint y) {
  uint h = x * 1597334677u ^ y * 3812015801u;
  h ^= h >> 16; h *= 2246822519u;
  h ^= h >> 13; h *= 3266489917u;
  h ^= h >> 16;
  return h;
}

// lattice value in [0,1)
float wLattice(ivec2 c, uint seed) {
  uint h = wHash(uint(c.x) ^ seed, uint(c.y) ^ (seed * 747796405u));
  return float(h >> 8) * (1.0 / 16777216.0);
}

float wNoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 c = ivec2(i);
  float a = wLattice(c,                 seed);
  float b = wLattice(c + ivec2(1, 0),   seed);
  float d = wLattice(c + ivec2(0, 1),   seed);
  float e = wLattice(c + ivec2(1, 1),   seed);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

float wFbm(vec2 p, int octaves, uint seed) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum  += amp * wNoise(p, seed + uint(i) * 1013u);
    norm += amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

// ridged multifractal — the sharp alpine crest generator
float wRidged(vec2 p, int octaves, uint seed) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = wNoise(p, seed + uint(i) * 1013u);
    sum  += amp * (1.0 - abs(n * 2.0 - 1.0));
    norm += amp;
    p *= 2.07;
    amp *= 0.52;
  }
  return sum / norm;
}
`;
