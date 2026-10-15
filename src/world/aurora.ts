import * as THREE from "three";

/**
 * The lights.
 *
 * A conditional find: it exists only on nights the date seed says so — about
 * one in nine — only after dark, and only in the cold. You can be in exactly
 * the right place and still not have found it, which the brainstorm calls the
 * cleanest possible answer to "I've seen everything".
 *
 * Six curtains of translucent geometry high above the world, drifting. It is
 * not physically anything; it just has to look like the sky is up to
 * something.
 */

const CURTAINS = 6;
const HEIGHT = 2600;
const SPAN = 9000;

export class Aurora {
  readonly group = new THREE.Group();
  private bands: THREE.Mesh[] = [];
  /** 0 hidden, 1 full. Eased, so it arrives rather than switching on. */
  private level = 0;

  constructor() {
    for (let i = 0; i < CURTAINS; i++) {
      // A tall ribbon, bowed along its length, fading out at the top.
      const g = new THREE.PlaneGeometry(SPAN, 1500, 24, 1);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const alpha = new Float32Array(pos.count);
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const y = pos.getY(v);
        pos.setZ(v, Math.sin((x / SPAN) * Math.PI * 1.7 + i) * 900);
        // Bright at the bottom edge, gone at the top — which is the one thing
        // that makes a flat plane read as a curtain of light.
        alpha[v] = y < 0 ? 1 : 0;
      }
      g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));

      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uLevel: { value: 0 }, uTint: { value: new THREE.Color(i % 3 === 0 ? 0x6fd7a8 : i % 3 === 1 ? 0x72b7e8 : 0xa98fe0) } },
        vertexShader: `
          attribute float aAlpha;
          varying float vA;
          varying float vX;
          void main() {
            vA = aAlpha;
            vX = position.x;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          precision highp float;
          uniform float uLevel;
          uniform vec3 uTint;
          varying float vA;
          varying float vX;
          void main() {
            // Vertical striations, which is what the real thing has.
            float stripe = 0.55 + 0.45 * sin(vX * 0.0043);
            gl_FragColor = vec4(uTint, vA * vA * stripe * 0.5 * uLevel);
          }`,
      });

      const m = new THREE.Mesh(g, mat);
      m.position.set(0, HEIGHT + i * 220, -6000 - i * 1400);
      m.rotation.y = (i - 2.5) * 0.17;
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.bands.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /**
   * @param on      whether tonight is a night for it, and dark enough
   * @param follow  the camera, since the curtains sit on the sky and must not
   *                be something you can drive out from under
   */
  update(dt: number, on: boolean, time: number, follow: THREE.Vector3) {
    this.level += ((on ? 1 : 0) - this.level) * Math.min(1, dt * 0.35);
    this.group.visible = this.level > 0.01;
    if (!this.group.visible) return;

    this.group.position.set(follow.x, 0, follow.z);
    for (let i = 0; i < this.bands.length; i++) {
      const m = this.bands[i];
      // Each curtain breathes at its own rate, so they never pulse together.
      const own = 0.55 + 0.45 * Math.sin(time * (0.11 + i * 0.017) + i * 2.3);
      (m.material as THREE.ShaderMaterial).uniforms.uLevel.value = this.level * own;
      m.rotation.y = (i - 2.5) * 0.17 + Math.sin(time * 0.013 + i) * 0.06;
    }
  }
}
