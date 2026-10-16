import * as THREE from "three";
import { NOISE_GLSL } from "./glsl/noise";
import { TERRAIN_GLSL } from "./glsl/terrain";
import { SKY_GLSL } from "./glsl/sky";
import { COMMON_GLSL } from "./glsl/common";

/**
 * Geometry clipmap.
 *
 * Level 0 is a solid patch of `BASE` metres. Each level above it is a square
 * ring of double the extent with a hole in the middle that the level below
 * fills. Eight levels reach 33 km from 4 m triangles underfoot — constant
 * vertex count, constant memory, infinite world.
 *
 * Each level snaps to its own grid so the mesh never swims under the camera.
 * Rings overlap their child by two cells, which papers over the LOD seam
 * without needing skirts or vertex morphing.
 */

const BASE = 256; // metres across the level-0 patch
const RES = 64; // quads per side, every level
const LEVELS = 8; // → 256 * 2^7 = 32.7 km

function buildLevel(outer: number, hollow: boolean): THREE.BufferGeometry {
  const s = outer / RES;
  const half = outer / 2;
  const holeHalf = outer / 4 - 2 * s;

  const verts = new Float32Array((RES + 1) * (RES + 1) * 3);
  let v = 0;
  for (let j = 0; j <= RES; j++) {
    for (let i = 0; i <= RES; i++) {
      verts[v++] = -half + i * s;
      verts[v++] = 0;
      verts[v++] = -half + j * s;
    }
  }

  const idx: number[] = [];
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      if (hollow) {
        const cx = -half + (i + 0.5) * s;
        const cz = -half + (j + 0.5) * s;
        if (Math.abs(cx) < holeHalf && Math.abs(cz) < holeHalf) continue;
      }
      const a = j * (RES + 1) + i;
      const b = a + 1;
      const c = a + (RES + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
out vec3 vWorld;
out vec3 vRel;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  wp.y = terrainHeight(wp.xz);
  vWorld = wp;
  vRel = wp - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
in vec3 vWorld;
in vec3 vRel;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform float uFogDensity;
uniform float uTime;
uniform float uCloudCover;
uniform int uDebug;

void main() {
  vec3 n = faceNormal(vRel);
  vec3 albedo = terrainAlbedo(vWorld.xz, vWorld.y, n, length(vRel));

  float ndl = max(dot(n, uSunDir), 0.0);
  // Cheap wrapped term so shadowed slopes keep some shape instead of going flat.
  float wrap = max(dot(n, uSunDir) * 0.5 + 0.5, 0.0);
  vec3 ambient = mix(uGroundAmbient, uSkyAmbient, 0.5 + 0.5 * n.y);

  // Clouds that are overhead are now also underfoot.
  float shade = cloudShade(vWorld, uSunDir, uTime, uCloudCover);

  vec3 col = albedo * (uSunColor * shade * (ndl * 0.88 + wrap * 0.12) + ambient);

  /**
   * Backscatter — the reason golden hour looks like that.
   *
   * Grass and dry scrub are thin enough to transmit, so ground lit from BEHIND
   * glows rather than going dark. The whole effect is one dot product against
   * the view direction, and it is the difference between a field at sunset and
   * a field at sunset in a game.
   *
   * Killed on rock and snow, which do not transmit, and strongest when the sun
   * is low, which is when you can see it in life.
   */
  float dist = length(vRel);
  vec3 viewDir = -vRel / dist;
  float back = pow(max(dot(viewDir, -uSunDir), 0.0), 3.5);
  float low = 1.0 - smoothstep(0.06, 0.42, uSunDir.y);
  float soft = 1.0 - smoothstep(0.26, 0.62, 1.0 - clamp(n.y, 0.0, 1.0));
  col += albedo * uSunColor * back * (0.18 + 0.55 * low) * soft * shade;

  /**
   * Grazing sheen. Any rough surface goes shiny when you look along it, which
   * is why a hillside catches the light near the horizon. Broad and weak —
   * this is sheen, not a highlight.
   */
  vec3 h = normalize(viewDir + uSunDir);
  col += uSunColor * pow(max(dot(n, h), 0.0), 18.0) * 0.10 * ndl * shade;
  col = applyHaze(col, vRel, uSunDir, uFogDensity);
  if (uDebug == 1) col = albedo;
  if (uDebug == 2) col = vec3(wFbm(vWorld.xz * (1.0 / 220.0), 3, 151u));
  if (uDebug == 3) col = vec3(wMoisture(vWorld.xz), wTemperature(vWorld.xz), 0.0);
  fragColor = vec4(uDebug == 0 ? toDisplay(col) : col, 1.0);
}
`;

export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  /** Half-width of the drawn world, in metres. */
  readonly reach = (BASE * 2 ** (LEVELS - 1)) / 2;
  private levels: THREE.Mesh[] = [];

  constructor() {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyAmbient: { value: new THREE.Color(0.3, 0.4, 0.55) },
        uGroundAmbient: { value: new THREE.Color(0.1, 0.1, 0.09) },
        uFogDensity: { value: 0.00009 },
        uSunsetBoost: { value: 1 },
        uTime: { value: 0 },
        uCloudCover: { value: 0.52 },
        uDebug: { value: 0 },
      },
      vertexShader: NOISE_GLSL + TERRAIN_GLSL + VERT,
      fragmentShader: NOISE_GLSL + TERRAIN_GLSL + SKY_GLSL + COMMON_GLSL + FRAG,
    });

    for (let l = 0; l < LEVELS; l++) {
      const mesh = new THREE.Mesh(buildLevel(BASE * 2 ** l, l > 0), this.material);
      mesh.frustumCulled = false; // real extent lives in the vertex shader
      mesh.renderOrder = LEVELS - l; // draw fine detail first, coarse rings fill in
      this.levels.push(mesh);
      this.group.add(mesh);
    }
  }

  update(camX: number, camZ: number) {
    for (let l = 0; l < LEVELS; l++) {
      const spacing = (BASE * 2 ** l) / RES;
      const snap = spacing * 2;
      const m = this.levels[l];
      m.position.x = Math.round(camX / snap) * snap;
      m.position.z = Math.round(camZ / snap) * snap;
      m.updateMatrixWorld();
    }
  }
}
