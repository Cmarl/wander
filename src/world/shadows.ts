import * as THREE from "three";

/**
 * Contact shadows — soft dark ellipses laid on the ground beneath anything
 * solid.
 *
 * Not a shadow map. A real one would need the terrain's custom shader to sample
 * a depth texture, for a landscape whose light barely moves within a session.
 * A blob under each object buys nearly all of the "this thing is resting on the
 * ground" read for a single extra draw call.
 */

let sharedTexture: THREE.Texture | null = null;

/** Radial falloff, generated once at runtime so there's still no asset to ship. */
export function blobTexture(): THREE.Texture {
  if (sharedTexture) return sharedTexture;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.75)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sharedTexture = new THREE.CanvasTexture(c);
  return sharedTexture;
}

export function blobMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x0a0d10,
    alphaMap: blobTexture(),
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    // Hug the terrain without z-fighting it.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

/** A unit disc lying in the XZ plane. */
export function blobGeometry(segments = 14): THREE.CircleGeometry {
  const g = new THREE.CircleGeometry(1, segments);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * A single blob that follows a moving object — the truck, the walker.
 * Lies flat on the terrain rather than tilting, which reads fine at these sizes
 * and avoids the corners of the disc poking through a slope.
 */
export class DynamicShadow {
  readonly mesh: THREE.Mesh;

  constructor(private radiusX: number, private radiusZ: number) {
    this.mesh = new THREE.Mesh(blobGeometry(), blobMaterial());
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
  }

  /** `lift` keeps it clear of the ground; `fade` dims it as the object rises. */
  update(x: number, z: number, groundY: number, heading: number, height: number) {
    const m = this.mesh;
    m.position.set(x, groundY + 0.06, z);
    m.rotation.set(0, heading, 0);
    // Rising off the ground spreads and softens the shadow, as it would.
    const spread = 1 + Math.min(height, 6) * 0.1;
    m.scale.set(this.radiusX * spread, 1, this.radiusZ * spread);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.38 * Math.max(0, 1 - height / 7);
  }

  setStrength(sunElevation: number) {
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.visible = sunElevation > -0.05;
  }
}
