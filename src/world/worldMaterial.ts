import * as THREE from "three";
import { NOISE_GLSL } from "./glsl/noise";
import { SKY_GLSL } from "./glsl/sky";

/**
 * Everything solid, standing in the same air as the ground.
 *
 * The terrain, the water and the grass are hand-written shaders that fade into
 * `skyBase()` — the actual sky colour in the direction you are looking — on a
 * curve tuned for a 24 km view. Everything ELSE in the world is an ordinary
 * three material fogged by THREE.FogExp2, which is a different curve toward a
 * single flat colour.
 *
 * So they disagreed, and visibly: at three kilometres a water tower faded
 * toward blue-grey while the hill it stood on faded toward whatever the sky
 * was doing. At sunset the hill went amber and the tower did not. Two systems
 * answering the same question differently — the same shape of bug as the
 * landmark rotations and the stuck interact key, in a different medium.
 *
 * This puts every solid thing on the terrain's haze, and gives it the cloud
 * shadows at the same time, so a tree in the shade of a cloud darkens along
 * with the ground under it rather than staying lit on a dark hillside.
 *
 * It is done with onBeforeCompile rather than by writing new materials because
 * the lighting these things already have is fine — a flat-shaded Lambert is
 * the look. The only things wrong with them were which air they were in and
 * which sky was shining on them.
 */

/**
 * One set of uniform objects, SHARED BY REFERENCE across every patched
 * material. main updates these once and every tree, truck and tower in the
 * world sees it — rather than walking a scene graph of hundreds of materials,
 * which is both slow and the kind of thing that silently misses one.
 */
export const WORLD_UNIFORMS = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uFogDensity: { value: 0.00009 },
  uSunsetBoost: { value: 1 },
  uTime: { value: 0 },
  uCloudCover: { value: 0.52 },
  /**
   * Rim strength. A uniform rather than a constant so it can be turned off
   * and on from outside — which is the only honest way to measure whether it
   * does anything, and doubles as the knob for tuning it.
   */
  uRim: { value: 0.19 },
};

/**
 * Patch a material to use the world's haze and cloud shadow.
 *
 * Returns the material, so it can be wrapped around a constructor call.
 * Idempotent: patching twice would chain two onBeforeCompile hooks and inject
 * the helpers twice, which is a compile error, so it marks what it has done.
 */
export function worldLit<T extends THREE.Material>(mat: T): T {
  if ((mat as unknown as { __worldLit?: boolean }).__worldLit) return mat;
  (mat as unknown as { __worldLit?: boolean }).__worldLit = true;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WORLD_UNIFORMS);

    // The world position, which three only varies when something asks for it.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldRel;"
      )
      /**
       * After project_vertex, and doing the instancing by hand.
       *
       * Not after begin_vertex, which is where this obviously belongs and
       * where it is wrong: three applies `instanceMatrix` inside
       * project_vertex, AFTER begin_vertex. Every tree, rock and landmark in
       * this game is an InstancedMesh, so a world position taken at
       * begin_vertex is the position of the mesh's origin — the whole forest
       * would have hazed as though it stood in one spot.
       *
       * three's own <worldpos_vertex> does exactly this, but only inside an
       * #if for envmaps and shadow maps, so it cannot be relied on.
       */
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 wPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wPos = instanceMatrix * wPos;
        #endif
        wPos = modelMatrix * wPos;
        vWorldPos = wPos.xyz;
        // Camera-relative, computed here and interpolated. Subtracting two
        // float32 world coordinates tens of kilometres out in the fragment
        // shader throws away most of the precision in the answer — the same
        // trap the terrain shader documents.
        vWorldRel = wPos.xyz - cameraPosition;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldRel;
        uniform vec3 uSunDir;
        uniform float uFogDensity;
        uniform float uTime;
        uniform float uCloudCover;
        uniform float uRim;
        ${NOISE_GLSL}
        ${SKY_GLSL}`
      )
      /**
       * Cloud shadow goes on the DIRECT light only.
       *
       * Putting it on the final colour would darken the ambient too, and a
       * tree under a cloud does not stop being lit by the sky — it stops being
       * lit by the sun. This is the chunk where three has the direct and
       * indirect terms still separate, which is the only place the difference
       * can be made.
       */
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        // This dims every direct light, the headlamp included — which costs
        // nothing, because cloudShade returns 1.0 whenever the sun is below
        // the horizon, and the headlamp is only ever on after dark.
        reflectedLight.directDiffuse *= cloudShade(vWorldPos, uSunDir, uTime, uCloudCover);

        /**
         * A rim of sky along the edges.
         *
         * Flat-shaded solids have no edge against the landscape: a dark pine
         * standing in front of a dark hillside is a silhouette with nothing
         * to separate it, and a truck parked on a slope merges into it. Every
         * real object has this — surfaces turned away from you catch the sky
         * at a grazing angle, which is why anything outdoors has a bright
         * outline against the ground on an overcast day.
         *
         * Fresnel against the view direction, tinted with the sky ABOVE
         * rather than a constant, so it goes amber at sunset with everything
         * else. Weak on purpose: this wants to read as an edge, not as a
         * glow, and the moment it is noticeable as an effect it is too much.
         */
        {
          vec3 vDir = normalize(vViewPosition);
          float rim = pow(1.0 - clamp(dot(normalize(normal), vDir), 0.0, 1.0), 4.0);
          reflectedLight.indirectDiffuse += skyBase(vec3(0.0, 1.0, 0.0), uSunDir) * rim * uRim;
        }`
      )
      /**
       * And the world's own haze instead of three's fog.
       *
       * Replacing the chunk rather than adding to it, so FogExp2 cannot apply
       * underneath this one and fog everything twice.
       */
      .replace(
        "#include <fog_fragment>",
        `{
          float d = length(vWorldRel);
          float f = 1.0 - exp(-pow(d * uFogDensity, 1.35));
          gl_FragColor.rgb = mix(
            gl_FragColor.rgb,
            skyBase(normalize(vWorldRel), uSunDir),
            clamp(f, 0.0, 1.0)
          );
        }`
      );
  };
  // three caches compiled programs by a key built from the material's state;
  // a changed onBeforeCompile has to invalidate that or the old program is
  // handed back and none of the above happens.
  mat.customProgramCacheKey = () => "worldLit";
  mat.needsUpdate = true;
  return mat;
}
