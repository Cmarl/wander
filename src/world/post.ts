import * as THREE from "three";

/**
 * The lens: bloom, a vignette, and the end of banding.
 *
 * Everything drew straight to the screen, so the brightest thing the game
 * could show was a white pixel — the sun was a hard disc, a headlamp at night
 * was a cream polygon, and sun on water was dots. None of them looked BRIGHT,
 * because nothing bright stays inside its own outline; light that strong
 * spills, in an eye and in a camera both.
 *
 * So the frame is drawn into a texture, the brightest parts are blurred wide
 * and added back, and the result goes to the screen. Three things happen in
 * that last step:
 *
 *   bloom     what is above the threshold glows past its edge
 *   vignette  the corners fall off a little, which draws the eye inward
 *   dither    half a bit of noise, so a dusk sky is a gradient again and not
 *             a stack of bands — 8 bits is not enough for a slow dark ramp
 *
 * The scene shaders already tone-map and encode for display, so this works on
 * display-referred colour. That is a constraint, not a choice: the threshold
 * sits high because "bright" here tops out at 1.0, and the bloom is linearised
 * first so adding it behaves like light and not like fog.
 */

const VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Scene → half size, linear, only what is brighter than the threshold. */
const BRIGHT = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
vec3 lin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 pick(vec2 uv) {
  vec3 c = lin(texture(uTex, uv).rgb);
  float l = max(c.r, max(c.g, c.b));
  // Soft knee: a hard cut makes the glow pop on and off as a surface crosses
  // the line, which reads as flicker on water.
  float k = smoothstep(uThreshold - 0.12, uThreshold + 0.12, l);
  return c * k;
}
void main() {
  vec3 c = pick(vUv + uTexel * vec2(-1.0, -1.0)) + pick(vUv + uTexel * vec2(1.0, -1.0))
         + pick(vUv + uTexel * vec2(-1.0, 1.0)) + pick(vUv + uTexel * vec2(1.0, 1.0));
  o = vec4(c * 0.25, 1.0);
}
`;

/** Dual-filter downsample: five taps, each already a bilinear average. */
const DOWN = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 4.0;
  c += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  o = vec4(c * 0.125, 1.0);
}
`;

/** Tent upsample, drawn additively onto the level above. */
const UP = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 4.0;
  c += (texture(uTex, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture(uTex, vUv + uTexel * vec2(1.0, 0.0)).rgb
      + texture(uTex, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture(uTex, vUv + uTexel * vec2(0.0, 1.0)).rgb) * 2.0;
  c += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb
     + texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uTex, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  o = vec4(c * (1.0 / 16.0), 1.0);
}
`;

const FINAL = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uDither;
uniform float uAspect;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  if (uBloomStrength > 0.0) {
    // Add as light, in linear, then come back. Adding in display space would
    // lift the darks most, which is what makes cheap bloom look like mist.
    vec3 l = pow(c, vec3(2.2)) + texture(uBloom, vUv).rgb * uBloomStrength;
    c = pow(l, vec3(1.0 / 2.2));
  }
  // Wider than it is tall would make the falloff an ellipse hugging the
  // sides; correcting halfway keeps it off the middle of a phone screen.
  vec2 d = (vUv - 0.5) * vec2(mix(1.0, uAspect, 0.5), 1.0);
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(d) * 1.25);
  // Interleaved gradient noise, half a code value either way.
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  c += (n - 0.5) * uDither / 255.0;
  o = vec4(c, 1.0);
}
`;

const LEVELS = 5;

export class Post {
  /** Off draws the scene straight to the screen, exactly as before. */
  enabled = true;
  bloomStrength = 0.7;
  threshold = 0.8;
  vignette = 0.2;
  dither = 1;

  private scene: THREE.WebGLRenderTarget;
  private chain: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bright: THREE.RawShaderMaterial;
  private down: THREE.RawShaderMaterial;
  private up: THREE.RawShaderMaterial;
  private final: THREE.RawShaderMaterial;
  private w = 0;
  private h = 0;

  constructor(private renderer: THREE.WebGLRenderer, opts: { msaa: boolean }) {
    this.scene = new THREE.WebGLRenderTarget(4, 4, {
      samples: opts.msaa ? 4 : 0,
      depthBuffer: true,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    /**
     * Make this target behave like the screen.
     *
     * three only tone-maps and sRGB-encodes built-in materials when drawing
     * to the canvas; into an ordinary render target they come out linear and
     * un-tone-mapped. But the terrain, water, grass and sky do their own
     * tone-map and encode in the shader regardless — so in a plain target
     * the trees would be linear and the hill under them would not, and the
     * picture would be wrong in a way that still looks like a picture.
     *
     * The one kind of target three treats as a display is an XR one, so this
     * says it is one. The colour space then tells built-ins to encode, and
     * the explicit RGBA8 stops GL encoding a SECOND time on write, which an
     * sRGB-tagged texture would otherwise get. tools/shader-check renders the
     * same scene both ways and requires the same pixels, because this is
     * exactly the sort of thing that silently drifts on a three upgrade.
     */
    (this.scene as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    this.scene.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.texture.internalFormat = "RGBA8";

    for (let i = 0; i < LEVELS; i++) {
      this.chain.push(
        new THREE.WebGLRenderTarget(2, 2, {
          depthBuffer: false,
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          generateMipmaps: false,
        })
      );
    }

    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>, add = false) =>
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: "in vec3 position;\n" + VERT,
        fragmentShader: frag,
        uniforms,
        depthTest: false,
        depthWrite: false,
        blending: add ? THREE.CustomBlending : THREE.NoBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquation: THREE.AddEquation,
      });
    const tex = () => ({ uTex: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.bright = mat(BRIGHT, { ...tex(), uThreshold: { value: this.threshold } });
    this.down = mat(DOWN, tex());
    this.up = mat(UP, tex(), true);
    this.final = mat(FINAL, {
      uScene: { value: this.scene.texture },
      uBloom: { value: this.chain[0].texture },
      uBloomStrength: { value: this.bloomStrength },
      uVignette: { value: this.vignette },
      uDither: { value: this.dither },
      uAspect: { value: 1 },
    });

    // One triangle that covers the screen: no diagonal seam, one less vertex.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo, this.final);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Sizes are in drawing-buffer pixels, not CSS pixels. */
  setSize(w: number, h: number) {
    w = Math.max(2, Math.floor(w));
    h = Math.max(2, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.scene.setSize(w, h);
    let cw = w, ch = h;
    for (const rt of this.chain) {
      cw = Math.max(2, cw >> 1);
      ch = Math.max(2, ch >> 1);
      rt.setSize(cw, ch);
    }
    this.final.uniforms.uAspect.value = w / h;
  }

  private pass(m: THREE.RawShaderMaterial, src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget | null, texel: THREE.WebGLRenderTarget) {
    if (m.uniforms.uTex) {
      m.uniforms.uTex.value = src.texture;
      (m.uniforms.uTexel.value as THREE.Vector2).set(1 / texel.width, 1 / texel.height);
    }
    this.quad.material = m;
    this.renderer.setRenderTarget(dst);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    if (!this.enabled || this.w === 0) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.scene);
    r.render(scene, camera);

    const wasAuto = r.autoClear;
    if (this.bloomStrength > 0) {
      this.bright.uniforms.uThreshold.value = this.threshold;
      this.pass(this.bright, this.scene, this.chain[0], this.scene);
      for (let i = 1; i < LEVELS; i++) this.pass(this.down, this.chain[i - 1], this.chain[i], this.chain[i - 1]);
      // Back up the chain, each level added onto the sharper one above it,
      // so the result is a wide soft glow with a tight bright core.
      r.autoClear = false;
      for (let i = LEVELS - 1; i > 0; i--) this.pass(this.up, this.chain[i], this.chain[i - 1], this.chain[i]);
      r.autoClear = wasAuto;
    }
    this.final.uniforms.uBloomStrength.value = this.bloomStrength / LEVELS;
    this.final.uniforms.uVignette.value = this.vignette;
    this.final.uniforms.uDither.value = this.dither;
    this.pass(this.final, this.scene, null, this.scene);
  }
}
