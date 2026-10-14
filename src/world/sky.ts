import * as THREE from "three";
import { NOISE_GLSL } from "./glsl/noise";
import { SKY_GLSL } from "./glsl/sky";
import { COMMON_GLSL } from "./glsl/common";

const VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vDir = wp - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
in vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uTime;
uniform float uCloudCover;
void main() {
  vec3 c = skyFull(normalize(vDir), uSunDir, uMoonDir, cameraPosition, uTime, uCloudCover);
  fragColor = vec4(toDisplay(c), 1.0);
}
`;

/** Sky sphere parented to the camera, drawn first with depth off. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(camera: THREE.Camera) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uTime: { value: 0 },
        uCloudCover: { value: 0.52 },
        uSunsetBoost: { value: 1 },
      },
      vertexShader: NOISE_GLSL + VERT,
      fragmentShader: NOISE_GLSL + SKY_GLSL + COMMON_GLSL + FRAG,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 32), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    camera.add(this.mesh);
  }
}
