import * as THREE from "three";

/**
 * Real shadows from the sun, near the camera.
 *
 * Until now nothing in the world cast a shadow. Each object had a soft blob
 * under it, which says "this is resting on the ground" and nothing else: a
 * pine and a water tower threw the same grey ellipse, at noon and at six in
 * the evening alike. The shape of a shadow is most of how you read the shape
 * of the thing and the hour of the day, and it was missing.
 *
 * One orthographic depth map from the sun, a couple of hundred metres across,
 * following the camera. three renders it — it already knows how to draw
 * instanced meshes into a depth target — but nothing uses three's own shadow
 * receiving. The ground, the grass and the solids are three different shader
 * paths, and three's receiver only exists in one of them. So there is ONE
 * sampler, `sunShadow()` below, and all three call it: the same edge, the same
 * softness and the same fade-out on a tree, on the hill under it and on the
 * grass between.
 *
 * It is deliberately a near-field effect. Past the edge of the map the shadow
 * fades to nothing and the old contact blobs carry on, which at that distance
 * is all anyone can see anyway.
 */

/**
 * One set of uniform objects shared by reference, exactly like
 * WORLD_UNIFORMS, and for the same reason: main updates these once and the
 * terrain, the grass and every patched material see it.
 */
export const SHADOW_UNIFORMS = {
  uShadowMap: { value: null as THREE.Texture | null },
  /** CAMERA-RELATIVE world → shadow uv and depth. See update() for why. */
  uShadowMatrix: { value: new THREE.Matrix4() },
  /** x strength (0 = off) · y 1/map size · z radius in metres · w metres per texel */
  uShadowParams: { value: new THREE.Vector4(0, 1 / 2048, 100, 0.1) },
  /** The middle of the map, relative to the camera. */
  uShadowCentre: { value: new THREE.Vector3() },
  /** Depth bias, in the map's own 0..1 units. */
  uShadowBias: { value: 0.0002 },
};

/**
 * The receiver. Works in both the hand-written GLSL3 shaders and three's own
 * (which compile as 300 es as well, so `texture()` is right in both).
 */
export const SHADOW_GLSL = /* glsl */ `
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec4 uShadowParams;
uniform vec3 uShadowCentre;
uniform float uShadowBias;

// three packs depth into RGBA8; this is its unpackRGBAToDepth, by value.
float shadowTap(vec2 uv, float z) {
  const vec4 UNPACK = vec4(
    255.0 / 256.0,
    255.0 / (256.0 * 256.0),
    255.0 / (256.0 * 256.0 * 256.0),
    1.0 / (256.0 * 256.0 * 256.0));
  return step(z, dot(texture(uShadowMap, uv), UNPACK));
}

/**
 * How much of the sun reaches this point: 1 = all of it.
 *
 * rel is CAMERA-RELATIVE, n is a world-space normal.
 */
float sunShadow(vec3 rel, vec3 n, vec3 sunDir) {
  float strength = uShadowParams.x;
  if (strength <= 0.0) return 1.0;

  // Fade out toward the edge of the map so the shadows end in a soft ring
  // rather than at a square you can see the corners of. A sphere of this
  // radius sits inside the map from every sun angle.
  vec3 fromCentre = rel - uShadowCentre;
  float edge = 1.0 - smoothstep(uShadowParams.z * 0.78, uShadowParams.z, length(fromCentre));
  if (edge <= 0.0) return 1.0;

  // Push the lookup off the surface along its normal, further the more the
  // surface grazes the light. This is what stops a sunlit slope shadowing
  // itself in stripes, and it costs nothing a depth bias would not.
  float ndl = clamp(dot(n, sunDir), 0.0, 1.0);
  vec3 p = rel + n * uShadowParams.w * (1.2 + 2.2 * (1.0 - ndl));
  vec3 c = (uShadowMatrix * vec4(p, 1.0)).xyz;
  if (c.z >= 1.0) return 1.0;
  float z = c.z - uShadowBias;

  // 3x3 taps, bilinearly weighted: a penumbra about three texels wide with
  // no grain in it. The same filter three calls PCFSoft.
  float t = uShadowParams.y;
  vec2 f = fract(c.xy / t + 0.5);
  vec2 uv = c.xy - (f - 0.5) * t;
  float a00 = shadowTap(uv + vec2(-t, -t), z);
  float a10 = shadowTap(uv + vec2(0.0, -t), z);
  float a20 = shadowTap(uv + vec2(t, -t), z);
  float a01 = shadowTap(uv + vec2(-t, 0.0), z);
  float a11 = shadowTap(uv, z);
  float a21 = shadowTap(uv + vec2(t, 0.0), z);
  float a02 = shadowTap(uv + vec2(-t, t), z);
  float a12 = shadowTap(uv + vec2(0.0, t), z);
  float a22 = shadowTap(uv + vec2(t, t), z);
  float lit = (
      mix(a00, a10, f.x) + mix(a10, a20, f.x)
    + mix(a01, a11, f.x) + mix(a11, a21, f.x)
  ) * (1.0 - f.y) + (
      mix(a01, a11, f.x) + mix(a11, a21, f.x)
    + mix(a02, a12, f.x) + mix(a12, a22, f.x)
  ) * f.y;
  lit *= 0.25;

  return 1.0 - (1.0 - lit) * strength * edge;
}
`;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class SunShadows {
  /** Half-width of the mapped square, metres. */
  readonly range: number;
  readonly size: number;
  /** Off means off: no depth pass is drawn and every receiver returns 1. */
  enabled = true;

  /** How far back along the sun ray the depth camera sits. */
  private readonly back = 420;
  private x = new THREE.Vector3();
  private y = new THREE.Vector3();
  private centre = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private tick = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    private light: THREE.DirectionalLight,
    opts: { size: number; range: number }
  ) {
    this.range = opts.range;
    this.size = opts.size;
    renderer.shadowMap.enabled = true;
    // The filtering is done by sunShadow(), so the map itself is plain depth.
    renderer.shadowMap.type = THREE.BasicShadowMap;

    light.castShadow = true;
    const s = light.shadow;
    s.mapSize.set(opts.size, opts.size);
    const cam = s.camera;
    cam.left = -opts.range;
    cam.right = opts.range;
    cam.top = opts.range;
    cam.bottom = -opts.range;
    cam.near = 1;
    // Far enough past the centre to hold the whole fade sphere, and near
    // enough to the sun to hold a mast standing between it and the ground.
    cam.far = this.back + opts.range + 40;
    cam.updateProjectionMatrix();

    const texel = (opts.range * 2) / opts.size;
    SHADOW_UNIFORMS.uShadowParams.value.set(0, 1 / opts.size, opts.range, texel);
    SHADOW_UNIFORMS.uShadowBias.value = 0.03 / (cam.far - cam.near);
  }

  /**
   * Anything patched by worldLit casts. Found by walking the scene now and
   * then rather than by remembering to say so at every one of the forty-odd
   * places a mesh is made — a rule that follows the material cannot miss one
   * the way a flag set by hand can.
   */
  markCasters(scene: THREE.Object3D) {
    if (this.tick++ % 20 !== 0) return;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.castShadow) return;
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        | (THREE.Material & { __worldLit?: boolean })
        | undefined;
      // Glass and smoke do not throw a shadow worth drawing.
      if (mat && mat.__worldLit && !mat.transparent) mesh.castShadow = true;
    });
  }

  /** Call after the camera has been placed for the frame, before the draw. */
  update(camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, groundAt?: (x: number, z: number) => number) {
    const light = this.light;
    // Gone by the time the sun reaches the horizon: the shadows are stretching
    // toward infinity there, and the light casting them is fading out anyway.
    const strength = this.enabled ? smoothstep(0.035, 0.16, sunDir.y) : 0;
    SHADOW_UNIFORMS.uShadowParams.value.x = strength;
    light.castShadow = strength > 0;

    camera.updateMatrixWorld();
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    /**
     * Night included, the light is always placed relative to the camera.
     *
     * A directional light shines along (position - target). The light used
     * to sit at sunDir * 1000 from the ORIGIN with its target on the camera,
     * so the direction every tree and truck was lit from was really
     * "from the origin, roughly" — right at the spawn and steadily more wrong
     * with every kilometre travelled, while the terrain beside them used the
     * true sun. Six kilometres out the solids were being lit from sideways.
     */
    if (strength <= 0) {
      light.target.position.copy(this.eye);
      light.position.copy(this.eye).addScaledVector(sunDir, this.back);
      return;
    }

    // Centre the map ahead of the camera, where the screen is, not on it.
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    const flat = this.fwd.length();
    this.centre.copy(this.eye);
    if (flat > 0.05) this.centre.addScaledVector(this.fwd, (this.range * 0.55) / flat);
    /**
     * And on the ground, not in the air.
     *
     * The shadows that matter are the ones lying on the land. Centred on the
     * camera, a climbing aeroplane would lift the map off the ground with it
     * and every shadow below would fade out at exactly the height where you
     * first get to look down on them.
     */
    if (groundAt) this.centre.y = Math.min(this.centre.y, Math.max(groundAt(this.centre.x, this.centre.z), 0));

    /**
     * Snap to the map's own texels.
     *
     * Left free, every shadow edge would shimmer as you walk, because each
     * frame the grid lands somewhere new relative to the tree. Moving the map
     * in whole texels means a still tree is rasterised identically every
     * frame. The basis is the one three's lookAt will build from the same
     * light and target, so the snapped grid is the real grid.
     */
    const z = sunDir;
    this.x.set(0, 1, 0).cross(z).normalize();
    this.y.copy(z).cross(this.x);
    const texel = SHADOW_UNIFORMS.uShadowParams.value.w;
    const cx = Math.round(this.centre.dot(this.x) / texel) * texel;
    const cy = Math.round(this.centre.dot(this.y) / texel) * texel;
    const cz = this.centre.dot(z);
    this.centre.set(0, 0, 0).addScaledVector(this.x, cx).addScaledVector(this.y, cy).addScaledVector(z, cz);

    light.target.position.copy(this.centre);
    light.position.copy(this.centre).addScaledVector(sunDir, this.back);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    light.shadow.updateMatrices(light);

    /**
     * Camera-relative, composed here in doubles.
     *
     * Seventy kilometres from the origin a float32 world coordinate resolves
     * to about 8 mm, and a matrix carrying that translation loses the same
     * again. Folding the camera position into the matrix on the CPU means the
     * shader only ever multiplies small numbers — the same trap, and the same
     * way out, as the terrain's haze.
     */
    const m = SHADOW_UNIFORMS.uShadowMatrix.value;
    m.copy(light.shadow.matrix);
    const e = m.elements;
    const { x: ex, y: ey, z: ez } = this.eye;
    e[12] += e[0] * ex + e[4] * ey + e[8] * ez;
    e[13] += e[1] * ex + e[5] * ey + e[9] * ez;
    e[14] += e[2] * ex + e[6] * ey + e[10] * ez;
    SHADOW_UNIFORMS.uShadowCentre.value.copy(this.centre).sub(this.eye);
    SHADOW_UNIFORMS.uShadowMap.value = light.shadow.map ? light.shadow.map.texture : null;
  }
}
