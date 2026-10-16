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
 * Paint, rather than coloured cardboard.
 *
 * A flat-shaded Lambert has no specular at all, so the truck — the one object
 * on screen every single second — was the same matte green as a bush. Every
 * painted metal surface has a hard, tight highlight that slides across it as
 * you turn, and that highlight is most of what says "this is a made thing".
 *
 * Two lobes, because a clearcoat really is two surfaces: a tight one for the
 * lacquer and a broad soft one for the colour under it. One alone reads as
 * plastic.
 *
 * Only emitted for materials that ask for it. Trees and rocks are not
 * lacquered, and there are thousands of them — this is per-pixel work that
 * the vast majority of the world should not be paying for.
 */
const GLOSS_GLSL = /* glsl */ `
          {
            // uSunDir is a WORLD direction and the normal here is view space.
            // Mixing the two silently gives a highlight that swings around as
            // the camera turns, which looks like a bug in the model.
            vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            vec3 hv = normalize(vDir + sunV);
            float ndh = max(dot(nrm, hv), 0.0);
            /**
             * Broad lobes, because these vehicles are flat panels.
             *
             * Tuned first at pow 86, which is a correct clearcoat and useless
             * here: a tight highlight needs CURVATURE to land on, and on a
             * truck made of boxes the half-vector almost never lines up with
             * a face normal. Measured on the real model it moved 904 pixels
             * by 5/255 — true on a test sphere, invisible on the thing it was
             * for.
             *
             * A flat painted panel does not get a spot. The whole panel
             * flashes as you walk past it, because every point on it has the
             * same normal. So the lobes are wide enough that a face which is
             * roughly at the half-angle lights up as one piece, which is both
             * what the geometry can express and what the real thing does.
             */
            float lacquer = pow(ndh, 26.0) * 0.52;
            /**
             * And the broad lobe stays small.
             *
             * At 0.22 the gate caught it flooding: on a SPHERE the mean
             * brightness went from 54 to 100, because pow 5 covers an
             * enormous solid angle and on a curved surface that is most of
             * the object. It looked right on the flat-panelled truck and
             * wrong on anything round — and both measurements were true.
             * The tight lobe is what does the panel work; this one only has
             * to stop the tight one reading as a decal.
             */
            float body = pow(ndh, 6.0) * 0.05;
            float shade = cloudShade(vWorldPos, uSunDir, uTime, uCloudCover);
            // Lambert has no specular term in its output, so this joins the
            // diffuse. It is added light either way.
            reflectedLight.directDiffuse +=
              uSunColor * (lacquer + body) * uGloss * uGlossScale * shade * max(uSunDir.y, 0.0);
          }
`;

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
  /** The sun's own colour, for anything that reflects it rather than scatters it. */
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  /**
   * A master scale on the clearcoat, for the same reason uRim is a uniform:
   * the only honest way to show a highlight does something is to render the
   * same frame with it off, and a per-material constant cannot be turned off
   * from outside.
   */
  uGlossScale: { value: 1 },
};

/**
 * Patch a material to use the world's haze and cloud shadow.
 *
 * Returns the material, so it can be wrapped around a constructor call.
 * Idempotent: patching twice would chain two onBeforeCompile hooks and inject
 * the helpers twice, which is a compile error, so it marks what it has done.
 */
export function worldLit<T extends THREE.Material>(mat: T, gloss = 0): T {
  if ((mat as unknown as { __worldLit?: boolean }).__worldLit) return mat;
  (mat as unknown as { __worldLit?: boolean }).__worldLit = true;
  const uGloss = { value: gloss };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WORLD_UNIFORMS);
    shader.uniforms.uGloss = uGloss;

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
        uniform float uGloss;
        uniform float uGlossScale;
        uniform vec3 uSunColor;
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
          vec3 nrm = normalize(normal);
          float rim = pow(1.0 - clamp(dot(nrm, vDir), 0.0, 1.0), 4.0);
          reflectedLight.indirectDiffuse += skyBase(vec3(0.0, 1.0, 0.0), uSunDir) * rim * uRim;
${gloss > 0 ? GLOSS_GLSL : ""}
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
  // The injected source DIFFERS between glossy and matte, so they cannot share
  // a cache key — three would hand the second one the first one's program.
  mat.customProgramCacheKey = () => (gloss > 0 ? "worldLit-gloss" : "worldLit");
  mat.needsUpdate = true;
  return mat;
}
