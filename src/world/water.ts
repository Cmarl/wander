import * as THREE from "three";
import { NOISE_GLSL } from "./glsl/noise";
import { TERRAIN_GLSL } from "./glsl/terrain";
import { SKY_GLSL } from "./glsl/sky";
import { COMMON_GLSL } from "./glsl/common";

const VERT = /* glsl */ `
out vec3 vWorld;
out vec3 vRel;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
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
uniform float uFogDensity;
uniform float uTime;
uniform float uCloudCover;

void main() {
  // Depth comes straight from the world function — no depth buffer read needed.
  float depth = max(0.0, -terrainHeight(vWorld.xz));

  float dist = length(vRel);
  vec3 viewDir = -vRel / dist;

  // Ripples fade with distance so the far water doesn't alias into noise.
  float rip = exp(-dist * 0.0014);
  vec2 p = vWorld.xz;
  float n1 = wFbm(p * 0.035 + vec2(uTime * 0.090, uTime * 0.052), 3, 301u) - 0.5;
  float n2 = wFbm(p * 0.011 - vec2(uTime * 0.038, uTime * 0.071), 3, 307u) - 0.5;
  vec3 n = normalize(vec3(n1 * 0.9 * rip, 1.0, n2 * 0.9 * rip));

  /**
   * The bottom, seen through the water.
   *
   * This was a flat blue-green mixed between two constants by depth, which is
   * what water looks like from an aeroplane and nothing like what it looks
   * like from the shore. Standing in the shallows you see SAND — the ground
   * carries on under the surface and the water tints it rather than hiding it.
   * That is most of what makes a coastline worth walking along.
   *
   * It is the real terrain albedo at the real bottom, so a beach reads as the
   * beach it actually is, a rocky shore reads as rock, and the line where the
   * land goes under needs nothing drawn on it: the colour simply continues.
   *
   * Beer-Lambert, per channel, over TWICE the depth — light goes down to the
   * bottom and comes back up. Red dies far faster than blue, which is the
   * entire reason deep water is blue, and getting that one constant right
   * does more than any amount of tinting.
   */
  const vec3 EXTINCT = vec3(0.145, 0.052, 0.035);
  const vec3 SCATTER = SRGB(0.06, 0.20, 0.26);

  vec3 body;
  // Past about twenty metres nothing comes back up, so the bed is not worth
  // the fbm calls — and terrainAlbedo is the most expensive function here.
  // This is what keeps the cost on the shoreline instead of on the whole sea.
  if (depth < 20.0) {
    // Refraction, cheaply: look at the bottom slightly off to one side,
    // further the deeper it is. This is what makes the bed WOBBLE, which is
    // the single most recognisable thing shallow water does.
    vec2 bedP = vWorld.xz + n.xz * depth * 0.45;
    float bedY = terrainHeight(bedP);
    vec3 bed = terrainAlbedo(bedP, bedY, vec3(0.0, 1.0, 0.0), dist);
    vec3 through = bed * exp(-max(0.0, -bedY) * 2.0 * EXTINCT);
    // What the water itself scatters back, which is what is left once the
    // bottom has faded out.
    body = mix(through, SCATTER, 1.0 - exp(-depth * 0.16));
  } else {
    body = SCATTER;
  }

  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);
  vec3 refl = skyBase(reflect(-viewDir, n), uSunDir);

  float shade = cloudShade(vWorld, uSunDir, uTime, uCloudCover);
  vec3 col = mix(body * (uSkyAmbient + uSunColor * 0.22 * shade), refl, fres);

  /**
   * The glitter path.
   *
   * There was one specular lobe at an exponent of 380, which is a single
   * blazing dot — a chrome ball, not water. What the sun actually makes on a
   * lake is a PATH: a long tongue of broken light running toward you, made of
   * thousands of little facets each catching it for an instant.
   *
   * So: a tight lobe for the facets that happen to line up, a much broader one
   * underneath it for the body of the path, and a fast noise field cutting the
   * broad one into fragments. The noise is what makes it glitter rather than
   * glow, and it is also why the path stretches toward the viewer for free —
   * the geometry already does that, it simply had nothing to show it with.
   */
  float rs = max(dot(reflect(-viewDir, n), uSunDir), 0.0);
  float facets = wFbm(p * 0.9 + vec2(uTime * 1.7, uTime * -1.1), 2, 317u);
  float glitter = pow(rs, 42.0) * smoothstep(0.42, 0.78, facets) * rip;
  col += uSunColor * (pow(rs, 380.0) * 2.6 + glitter * 1.5) * shade;

  // Shoreline foam, pushed in and out by a slow swell.
  float swell = 0.55 + 0.45 * sin(uTime * 0.5 + wFbm(p * 0.02, 2, 311u) * 9.0);
  float foam = smoothstep(1.7 * swell + 0.35, 0.0, depth) * smoothstep(-0.6, 0.1, depth);
  col = mix(col, SRGB(0.94, 0.97, 0.98) * (uSkyAmbient + uSunColor * 0.6), foam * 0.75);

  col = applyHaze(col, vRel, uSunDir, uFogDensity);
  fragColor = vec4(toDisplay(col), 1.0);
}
`;

export class Water {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(extent: number) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyAmbient: { value: new THREE.Color(0.3, 0.4, 0.55) },
        uFogDensity: { value: 0.00009 },
        uSunsetBoost: { value: 1 },
        uTime: { value: 0 },
        uCloudCover: { value: 0.52 },
      },
      vertexShader: NOISE_GLSL + VERT,
      fragmentShader: NOISE_GLSL + TERRAIN_GLSL + SKY_GLSL + COMMON_GLSL + FRAG,
    });

    const g = new THREE.PlaneGeometry(extent * 2, extent * 2, 1, 1);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20; // after terrain
  }

  update(camX: number, camZ: number) {
    this.mesh.position.set(camX, 0, camZ);
    this.mesh.updateMatrixWorld();
  }
}
