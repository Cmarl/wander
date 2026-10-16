import * as THREE from "three";
import { NOISE_GLSL } from "./glsl/noise";
import { TERRAIN_GLSL } from "./glsl/terrain";
import { SKY_GLSL } from "./glsl/sky";
import { COMMON_GLSL } from "./glsl/common";
import { clearingsNear } from "./clearings";
import { CRUSH_POINTS, crushPoints, updateCrush } from "./crush";

/**
 * Ground cover, placed entirely on the GPU.
 *
 * A fixed grid of tufts follows the camera, snapped to its own spacing so it
 * doesn't swim. Each instance works out its own world position, ground height
 * and biome in the vertex shader by calling the same terrain function the
 * landscape uses — so there is no CPU cost, no streaming, and no chance of a
 * tuft floating above the hill it's standing on.
 *
 * Tufts in unsuitable ground (underwater, frozen, desert, too high) collapse to
 * zero height and draw as degenerate triangles, which costs nothing to hide.
 */

/** One tuft: three tapered blades leaning outward from a shared base. */
function tuftGeometry(blades: number): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + 0.4;
    const px = Math.cos(a);
    const pz = Math.sin(a);
    const qx = -pz;
    const qz = px;
    const ox = px * 0.055;
    const oz = pz * 0.055;
    const w = 0.032;
    // base, base, tip — tip leans outward so the tuft splays
    pos.push(ox + qx * w, 0, oz + qz * w);
    pos.push(ox - qx * w, 0, oz - qz * w);
    pos.push(ox + px * 0.13, 1, oz + pz * 0.13);
  }

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const VERT = /* glsl */ `
#define CRUSH_POINTS ${CRUSH_POINTS}
in vec2 aCell;
uniform vec4 uCrush[CRUSH_POINTS];
/**
 * Ground somebody cleared: xy is the centre, zw is cos and sin of its
 * rotation. uClearSize carries the half extents, and a zero length means the
 * slot is unused.
 */
uniform vec4 uClear[3];
uniform vec2 uClearSize[3];
uniform vec2 uOrigin;
uniform float uSpacing;
uniform float uRadius;
uniform float uTime;
uniform float uWind;

out vec3 vRel;
out float vTip;
out vec3 vTint;

void main() {
  vec2 base = uOrigin + aCell * uSpacing;

  // Scatter within the cell so the grid never reads as a grid.
  float j1 = wNoise(base * 0.37, 701u);
  float j2 = wNoise(base * 0.37 + 11.3, 709u);
  vec2 wp = base + (vec2(j1, j2) - 0.5) * uSpacing * 0.95;

  float y = terrainHeight(wp);
  float moist = wMoisture(wp);
  float temp = wTemperature(wp) - y * (1.0 / 9000.0);

  // Grass grows above the tideline, below the snow, and not in the desert.
  // The snow line is the same temperature-dependent one the terrain shader
  // uses — a fixed altitude cutoff left grass growing on cold snowfields.
  float snowLine = mix(2300.0, 820.0, 1.0 - clamp(temp, 0.0, 1.0));
  float ok = smoothstep(2.0, 9.0, y)
           * smoothstep(0.14, 0.32, temp)
           * smoothstep(0.06, 0.24, moist)
           * (1.0 - smoothstep(snowLine - 220.0, snowLine, y));

  // Nor on a graded runway. Same rectangles the scatter uses, so the grass and
  // the trees agree about where the ground was cleared.
  for (int i = 0; i < 3; i++) {
    if (uClearSize[i].y <= 0.0) continue;
    vec2 d = wp - uClear[i].xy;
    float lx = d.x * uClear[i].z - d.y * uClear[i].w;
    float lz = d.x * uClear[i].w + d.y * uClear[i].z;
    if (abs(lx) < uClearSize[i].x && abs(lz) < uClearSize[i].y) ok = 0.0;
  }

  // Nothing grows in a wheel rut. This is what actually makes a track read as
  // worn rather than painted on — the colour alone looked like a decal.
  // Matches the terrain tint's fade, so grass never thins out in a rut that
  // is too far away to be drawn.
  ok *= 1.0 - wWay(wp) * 0.92 * smoothstep(1500.0, 500.0, distance(cameraPosition.xz, wp));

  float dist = distance(cameraPosition.xz, wp);
  ok *= 1.0 - smoothstep(uRadius * 0.45, uRadius, dist);

  float height = (0.24 + j1 * 0.42) * ok;

  vec3 local = position;
  // Thicken with distance. A blade narrower than a pixel doesn't get thinner,
  // it flickers — widening keeps far grass as a soft mass instead of speckle.
  local.xz *= (0.55 + j2 * 0.45) * (1.0 + dist * 0.045);
  local.y *= height;

  // Anything that has driven past recently pushes the blades over and holds
  // them down. They spring back as the crush point fades.
  vec2 shove = vec2(0.0);
  float flatten = 0.0;
  for (int i = 0; i < CRUSH_POINTS; i++) {
    float strength = uCrush[i].w;
    if (strength <= 0.001) continue;
    vec2 away = wp - uCrush[i].xz;
    float d = length(away);
    float infl = strength * (1.0 - smoothstep(0.0, 2.6, d));
    if (infl <= 0.0) continue;
    shove += (away / max(d, 0.001)) * infl;
    flatten = max(flatten, infl);
  }
  local.y *= 1.0 - flatten * 0.82;

  // Bend from the tip, not the root.
  float tip = clamp(position.y, 0.0, 1.0);
  float sway = sin(uTime * 1.6 + base.x * 0.11 + base.y * 0.08) * 0.55
             + sin(uTime * 3.3 + base.y * 0.19) * 0.22;
  local.x += sway * tip * tip * uWind;
  local.z += sway * 0.6 * tip * tip * uWind;
  local.xz += shove * tip * 0.75;

  vec3 world = vec3(wp.x + local.x, y + local.y, wp.y + local.z);
  vRel = world - cameraPosition;
  vTip = tip;

  // Match the ground it grows out of, a touch more saturated.
  const vec3 GOLD   = SRGB(0.82, 0.69, 0.33);
  const vec3 MEADOW = SRGB(0.47, 0.56, 0.27);
  vTint = mix(GOLD, MEADOW, smoothstep(0.46, 0.82, moist)) * (0.78 + j2 * 0.30);

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
in vec3 vRel;
in float vTip;
in vec3 vTint;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform float uFogDensity;
uniform float uTime;
uniform float uCloudCover;

void main() {
  // Blades are flat, so a real normal is meaningless — light them as a soft
  // vertical mass and let the root-to-tip gradient do the shaping.
  float ndl = max(uSunDir.y, 0.0);
  // Under the same cloud as the ground it is standing on. Grass left bright
  // while the hillside beneath it darkened would be worse than no shadow.
  float shade = cloudShade(vRel + cameraPosition, uSunDir, uTime, uCloudCover);
  vec3 col = vTint * (0.48 + 0.42 * vTip) * (uSunColor * shade * (0.30 + ndl * 0.52) + uSkyAmbient);

  /**
   * Blades are thin, so they transmit — and the tips most of all. Looking into
   * a low sun across a field, the whole thing lights up. Weighted to the tip
   * because that is where there is least plant to stop the light.
   */
  vec3 viewDir = -normalize(vRel);
  float back = pow(max(dot(viewDir, -uSunDir), 0.0), 3.0);
  col += vTint * uSunColor * back * shade * (0.22 + 0.5 * vTip)
       * (1.0 - smoothstep(0.06, 0.45, uSunDir.y));

  col = applyHaze(col, vRel, uSunDir, uFogDensity);
  fragColor = vec4(toDisplay(col), 1.0);
}
`;

export class Grass {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private spacing: number;

  constructor(opts: { side: number; spacing: number; blades: number }) {
    this.spacing = opts.spacing;
    const radius = (opts.side * opts.spacing) / 2;

    const geo = tuftGeometry(opts.blades);
    const cells = new Float32Array(opts.side * opts.side * 2);
    let i = 0;
    const half = (opts.side - 1) / 2;
    for (let z = 0; z < opts.side; z++) {
      for (let x = 0; x < opts.side; x++) {
        cells[i++] = x - half;
        cells[i++] = z - half;
      }
    }
    geo.setAttribute("aCell", new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = opts.side * opts.side;

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      uniforms: {
        uOrigin: { value: new THREE.Vector2() },
        uSpacing: { value: opts.spacing },
        uRadius: { value: radius },
        uTime: { value: 0 },
        uWind: { value: 0.1 },
        uCrush: { value: crushPoints },
        uClear: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uClearSize: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyAmbient: { value: new THREE.Color(0.3, 0.4, 0.55) },
        uFogDensity: { value: 0.000085 },
        uSunsetBoost: { value: 1 },
        uCloudCover: { value: 0.52 },
      },
      vertexShader: NOISE_GLSL + TERRAIN_GLSL + VERT,
      fragmentShader: NOISE_GLSL + SKY_GLSL + COMMON_GLSL + FRAG,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Advance the shared wake. Grass and saplings both read it. */
  crush(dt: number, x: number, y: number, z: number, moving: boolean) {
    updateCrush(dt, x, y, z, moving);
  }

  private clearAtX = Infinity;
  private clearAtZ = Infinity;

  update(camX: number, camZ: number, time: number) {
    // Snap to the grid so tufts stay put as the camera moves.
    const o = this.material.uniforms.uOrigin.value as THREE.Vector2;
    o.set(Math.round(camX / this.spacing) * this.spacing, Math.round(camZ / this.spacing) * this.spacing);
    this.material.uniforms.uTime.value = time;

    /**
     * Tell the shader where the ground was cleared.
     *
     * Recomputed only when the camera has moved a tuft's spacing, because
     * landmarksNear is a real scan and running it every frame for something
     * that changes every few metres would be waste.
     */
    if (Math.hypot(camX - this.clearAtX, camZ - this.clearAtZ) > 24) {
      this.clearAtX = camX;
      this.clearAtZ = camZ;
      const near = clearingsNear(camX, camZ, 1);
      const cs = this.material.uniforms.uClear.value as THREE.Vector4[];
      const ss = this.material.uniforms.uClearSize.value as THREE.Vector2[];
      for (let i = 0; i < cs.length; i++) {
        const c = near[i];
        if (!c) {
          ss[i].set(0, 0);
          continue;
        }
        cs[i].set(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot));
        ss[i].set(c.halfW, c.halfL);
      }
    }
  }
}
