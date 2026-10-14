/**
 * Shared tail-end of every custom fragment shader: fog, tone map, encoding.
 *
 * Under THREE.GLSL3 three does not declare a fragment output for you (that's
 * only done when it transpiles GLSL1 to WebGL2), so we declare our own.
 */
export const COMMON_GLSL = /* glsl */ `
out vec4 fragColor;

// Aerial perspective. Density is low and the exponent >1 so near ground stays
// crisp while everything past a few km dissolves into the sky — the single
// biggest contributor to the "huge landscape" read.
// Takes a CAMERA-RELATIVE vector, not two absolute positions. Subtracting two
// float32 world coordinates tens of kilometres from the origin throws away most
// of the precision in the result; doing the subtraction once in the vertex
// shader and interpolating keeps it exact.
vec3 applyHaze(vec3 col, vec3 rel, vec3 sunDir, float density) {
  float dist = length(rel);
  float f = 1.0 - exp(-pow(dist * density, 1.35));
  return mix(col, skyBase(normalize(rel), sunDir), clamp(f, 0.0, 1.0));
}

vec3 acesFilm(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 toDisplay(vec3 linear) {
  vec3 c = acesFilm(linear);
  return pow(c, vec3(1.0 / 2.2));
}

// Flat-shaded normal from screen-space derivatives. Free, and it gives the
// faceted low-poly look on purpose.
//
// MUST be fed a camera-relative position. At x = 70000 a float32 resolves to
// about 8 mm, the same order as the per-pixel difference being measured — so
// absolute coordinates turn this into a noise generator, and the ground fills
// with salt-and-pepper speckle the further you travel from the origin.
vec3 faceNormal(vec3 rel) {
  vec3 n = normalize(cross(dFdx(rel), dFdy(rel)));
  return n.y < 0.0 ? -n : n;
}
`;
