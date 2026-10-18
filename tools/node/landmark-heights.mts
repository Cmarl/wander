/**
 * How tall is each landmark, really?
 *
 * The audit used hand-estimated heights. Before changing anything on the
 * strength of them, measure the actual geometry: build every kind's layers
 * and take the bounding box.
 */
const canvasStub = () => ({ width: 0, height: 0, getContext: () => ({
  createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fill() {},
  clearRect() {}, beginPath() {}, arc() {},
  set fillStyle(_v: unknown) {}, get fillStyle() { return ""; } }) });
(globalThis as any).document = { createElement: () => canvasStub() };

import * as THREE from "three";
import { LANDMARK_NAMES, type LandmarkKind } from "../../src/world/landmarks";
import { BUILDERS } from "../../src/world/landmarkRender";

const DEG_PER_PX = 70 / 1080;
const dotRange = (h: number) => h / Math.tan((4 * DEG_PER_PX) * Math.PI / 180);

const rows: { kind: string; h: number; r: number }[] = [];
for (const kind of Object.keys(LANDMARK_NAMES) as LandmarkKind[]) {
  const layers = (BUILDERS as any)[kind]?.() ?? [];
  const box = new THREE.Box3();
  for (const l of layers) {
    if (!l.geo) continue;
    l.geo.computeBoundingBox();
    box.union(l.geo.boundingBox!);
  }
  const h = box.isEmpty() ? 0 : box.max.y;
  rows.push({ kind, h, r: dotRange(h) / 1000 });
}
rows.sort((a, b) => a.h - b.h);
console.log("kind                 tallest point   visible as a dot to");
for (const r of rows) {
  console.log(`  ${(LANDMARK_NAMES[r.kind as LandmarkKind] ?? r.kind).padEnd(18)} ` +
    `${r.h.toFixed(1).padStart(6)} m        ${r.r.toFixed(2).padStart(5)} km` +
    (r.r < 1.93 ? "   <-- closer than the median gap between landmarks" : ""));
}
