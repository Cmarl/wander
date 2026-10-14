/**
 * Hand-authored analytic sky. Not a physical scattering model — a keyframed
 * gradient through night → twilight → golden → day, which is far easier to art
 * direct toward the pale hazy look we want.
 *
 * skyBase() is reused by the terrain and water shaders as the fog colour, so
 * aerial perspective automatically goes amber at sunset and blue at noon.
 */
export const SKY_GLSL = /* glsl */ `
uniform float uSunsetBoost;

vec3 skyBase(vec3 dir, vec3 sunDir) {
  float t = clamp(sunDir.y, -1.0, 1.0);

  const vec3 ZEN_NIGHT = vec3(0.010, 0.017, 0.040);
  const vec3 HOR_NIGHT = vec3(0.028, 0.042, 0.078);
  const vec3 ZEN_DUSK  = vec3(0.085, 0.125, 0.255);
  const vec3 HOR_DUSK  = vec3(0.620, 0.300, 0.205);
  const vec3 ZEN_DAY   = vec3(0.225, 0.420, 0.720);
  const vec3 HOR_DAY   = vec3(0.735, 0.805, 0.880);

  float dusk = smoothstep(-0.28, 0.02, t);
  float day  = smoothstep( 0.00, 0.30, t);

  vec3 zen = mix(mix(ZEN_NIGHT, ZEN_DUSK, dusk), ZEN_DAY, day);
  vec3 hor = mix(mix(HOR_NIGHT, HOR_DUSK, dusk), HOR_DAY, day);

  vec3 d = normalize(dir);
  float g = pow(1.0 - max(d.y, 0.0), 4.0);
  vec3 c = mix(zen, hor, g);

  // Forward scattering around the sun: the wide warm bloom at sunrise/sunset.
  float cd = max(dot(d, sunDir), 0.0);
  vec3 glow = mix(vec3(1.00, 0.45, 0.18), vec3(1.00, 0.86, 0.64), day);
  c += glow * (pow(cd, 6.0) * 0.45 + pow(cd, 1.6) * 0.12) * smoothstep(-0.26, 0.08, t) * uSunsetBoost;

  // Below the horizon line, darken slightly so distant land reads as grounded.
  c = mix(c, c * 0.82, smoothstep(0.0, -0.14, d.y));
  return c;
}

float skyStars(vec3 dir) {
  vec3 q = dir * 430.0;
  ivec3 cell = ivec3(floor(q));
  uint h = wHash(uint(cell.x) ^ 0x9e3779b9u, uint(cell.y * 73856093 ^ cell.z * 19349663));
  float r = float(h >> 8) * (1.0 / 16777216.0);
  if (r < 0.9955) return 0.0;
  vec3 centre = normalize((vec3(cell) + 0.5) * (1.0 / 430.0));
  float d = distance(centre, dir);
  float mag = 0.35 + 1.45 * fract(r * 719.7);
  return smoothstep(0.0020, 0.0, d) * mag;
}

float skyClouds(vec3 dir, vec3 camPos, float time, float coverage) {
  if (dir.y < 0.015) return 0.0;
  float H = 2600.0;
  float dist = (H - camPos.y) / dir.y;
  if (dist < 0.0) return 0.0;
  vec2 cp = camPos.xz + dir.xz * dist;
  vec2 q = cp * (1.0 / 3400.0) + vec2(time * 0.0045, time * 0.0017);
  float f = wFbm(q, 5, 211u);
  float c = smoothstep(coverage, coverage + 0.20, f);
  c *= smoothstep(0.015, 0.16, dir.y);          // thin out at the horizon
  c *= smoothstep(140000.0, 26000.0, dist);     // and fade into the haze
  return c;
}

vec3 skyFull(vec3 dir, vec3 sunDir, vec3 moonDir, vec3 camPos, float time, float coverage) {
  vec3 d = normalize(dir);
  vec3 c = skyBase(d, sunDir);

  float night = smoothstep(0.06, -0.18, sunDir.y);
  c += vec3(0.86, 0.90, 1.00) * skyStars(d) * night;

  // Moon: disc plus a soft halo.
  float md = dot(d, moonDir);
  c += vec3(0.92, 0.93, 0.88) * smoothstep(0.9988, 0.99945, md) * 1.6 * night;
  c += vec3(0.30, 0.36, 0.52) * pow(max(md, 0.0), 220.0) * 0.5 * night;

  // Sun disc, dimmed as it reddens near the horizon.
  float sd = dot(d, sunDir);
  float sunDim = smoothstep(-0.04, 0.12, sunDir.y);
  c += mix(vec3(1.0, 0.52, 0.26), vec3(1.0, 0.97, 0.90), sunDim)
       * smoothstep(0.99955, 0.99985, sd) * (2.5 + 6.0 * sunDim);

  float cl = skyClouds(d, camPos, time, coverage);
  float sunUp = smoothstep(-0.10, 0.15, sunDir.y);
  vec3 cloudLit = mix(vec3(0.42, 0.33, 0.36), vec3(1.02, 1.00, 0.99), sunUp);
  vec3 cloudDim = mix(vec3(0.16, 0.17, 0.24), vec3(0.62, 0.66, 0.74), sunUp);
  float rim = pow(max(dot(d, sunDir), 0.0), 3.0);
  c = mix(c, mix(cloudDim, cloudLit, 0.35 + 0.65 * rim), cl * 0.88);

  return c;
}
`;
