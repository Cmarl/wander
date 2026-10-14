import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL, propsInCell, type Prop, type PropKind } from "./props";
import { blobGeometry, blobMaterial } from "./shadows";
import { CRUSH_POINTS, crushPoints } from "./crush";

/**
 * Draws the props that props.ts places.
 *
 * This module owns no placement logic of its own — it asks props.ts where
 * things are, exactly as the collision system does, so what you see and what
 * you hit can never disagree.
 *
 * Rebuilds are spread over frames; a full refresh touches a couple of thousand
 * CPU height samples and would otherwise drop a frame when you crest a hill.
 */

const RADIUS_CELLS = 17; // → ~680 m of scatter around the player
const REBUILD_AFTER = CELL * 2; // metres of travel before re-centring
const CELLS_PER_FRAME = 110;

/** Props only get a contact shadow this close — beyond it nobody can tell. */
const SHADOW_RANGE = 190;
const SHADOW_BUDGET = 1400;

/** Footprint of each kind's shadow, as a multiple of its horizontal scale. */
const FOOTPRINT: Record<PropKind, number> = {
  pine: 1.45,
  broadleaf: 1.8,
  dead: 0.55,
  shrub: 0.85,
  rock: 1.05,
};

const BUDGET: Record<PropKind, number> = {
  pine: 2200,
  broadleaf: 1100,
  dead: 420,
  shrub: 1700,
  rock: 900,
};

/**
 * Cylinders/cones are indexed, icosahedrons are not, and mergeGeometries
 * refuses to mix the two. Everything here is flat-shaded anyway, so drop
 * indices across the board.
 */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error("scatter: geometry merge failed");
  return merged;
}

function conifer(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 5);
  trunk.translate(0, 1.1, 0);
  parts.push(trunk);
  for (const t of [
    { r: 1.65, h: 3.0, y: 1.4 },
    { r: 1.25, h: 2.8, y: 3.2 },
    { r: 0.8, h: 2.4, y: 5.0 },
  ]) {
    const c = new THREE.ConeGeometry(t.r, t.h, 7);
    c.translate(0, t.y + t.h / 2, 0);
    parts.push(c);
  }
  return merge(parts);
}

function broadleaf(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Taller trunk, tighter crown. At full scale the old proportions read as a
  // lollipop rather than a tree.
  const trunk = new THREE.CylinderGeometry(0.13, 0.21, 3.6, 5);
  trunk.translate(0, 1.8, 0);
  parts.push(trunk);
  const crown = new THREE.IcosahedronGeometry(1.25, 0);
  crown.scale(1, 0.88, 1);
  crown.translate(0, 4.1, 0);
  parts.push(crown);
  const crown2 = new THREE.IcosahedronGeometry(0.86, 0);
  crown2.translate(0.62, 3.35, -0.4);
  parts.push(crown2);
  return merge(parts);
}

/** A bare snag — bleached trunk and a few broken limbs. */
function deadwood(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.11, 0.24, 4.4, 5);
  trunk.translate(0, 2.2, 0);
  parts.push(trunk);
  for (const b of [
    { y: 2.5, a: 0.5, len: 1.5, tilt: -0.7 },
    { y: 3.2, a: 2.5, len: 1.1, tilt: -0.5 },
    { y: 1.8, a: 4.3, len: 1.3, tilt: -0.9 },
  ]) {
    const limb = new THREE.CylinderGeometry(0.05, 0.1, b.len, 4);
    limb.translate(0, b.len / 2, 0);
    limb.rotateZ(b.tilt);
    limb.rotateY(b.a);
    limb.translate(0, b.y, 0);
    parts.push(limb);
  }
  return merge(parts);
}

/** Low scrub. Soft — you brush through it rather than hitting it. */
function shrub(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const b of [
    { r: 0.62, x: 0, z: 0, y: 0.42 },
    { r: 0.44, x: 0.5, z: 0.22, y: 0.3 },
    { r: 0.36, x: -0.36, z: 0.38, y: 0.27 },
  ]) {
    const g = new THREE.IcosahedronGeometry(b.r, 0);
    g.scale(1, 0.78, 1);
    g.translate(b.x, b.y, b.z);
    parts.push(g);
  }
  return merge(parts);
}

function boulder(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1, 0.72, 1);
  g.translate(0, 0.45, 0);
  return g;
}

const GEOMETRY: Record<PropKind, () => THREE.BufferGeometry> = {
  pine: conifer,
  broadleaf,
  dead: deadwood,
  shrub,
  rock: boulder,
};

/**
 * Shrink instances at the scatter edge, and lean the whippy ones away from
 * anything that has just driven past.
 *
 * `aBend` is per-instance, so a species keeps a single draw call while solid
 * trees stay rigid and saplings in the same mesh bend.
 *
 * This is Lambert, which three compiles as GLSL1 even on WebGL2, so there is
 * no inverse() available. The instance matrix here is a Y rotation times a
 * scale and the scatter group has no transform of its own, so projecting the
 * world-space push onto the matrix's own basis columns and dividing by the
 * squared scale inverts it exactly, with three dot products.
 */
function addWakeResponse(mat: THREE.Material, fadeEnd: number, bendHeight: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFadeEnd = { value: fadeEnd };
    shader.uniforms.uBendHeight = { value: bendHeight };
    shader.uniforms.uCrush = { value: crushPoints };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uFadeEnd;
         uniform float uBendHeight;
         uniform vec4 uCrush[${CRUSH_POINTS}];
         attribute float aBend;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           vec3 instOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
           float d = distance(instOrigin, cameraPosition);
           transformed *= 1.0 - smoothstep(uFadeEnd - 110.0, uFadeEnd, d);

           if (aBend > 0.5) {
             vec3 push = vec3(0.0);
             for (int i = 0; i < ${CRUSH_POINTS}; i++) {
               float s = uCrush[i].w;
               if (s <= 0.002) continue;
               vec2 away = instOrigin.xz - uCrush[i].xz;
               float dist = length(away);
               // Cubed, so a sapling springs back in about a second while the
               // grass track behind you lingers for several.
               float infl = s * s * s * (1.0 - smoothstep(0.0, 3.4, dist));
               if (infl <= 0.0) continue;
               push.xz += (away / max(dist, 0.001)) * infl;
             }
             float lean = clamp(position.y / uBendHeight, 0.0, 1.0);
             vec3 off = push * lean * lean * 1.35;
             vec3 c0 = instanceMatrix[0].xyz;
             vec3 c2 = instanceMatrix[2].xyz;
             float s2 = max(dot(c0, c0), 1e-5);
             transformed.x += dot(off, c0) / s2;
             transformed.z += dot(off, c2) / s2;
           }
         }`
      );
  };
}

/** Roughly where the top of each kind sits, for the bend profile. */
const BEND_HEIGHT: Record<PropKind, number> = {
  pine: 7.4,
  broadleaf: 5.0,
  dead: 4.4,
  shrub: 0.95,
  rock: 1,
};

function colourFor(p: Prop, out: THREE.Color): THREE.Color {
  switch (p.kind) {
    case "pine":
      return out.setHSL(0.34 - p.tint * 0.05, 0.34 + p.shade * 0.18, 0.22 + p.shade * 0.1, THREE.SRGBColorSpace);
    case "broadleaf":
      return out.setHSL(0.1 + p.tint * 0.12, 0.62 - p.shade * 0.16, 0.44 + p.shade * 0.14, THREE.SRGBColorSpace);
    case "dead":
      return out.setHSL(0.09, 0.14 - p.tint * 0.08, 0.52 + p.shade * 0.16, THREE.SRGBColorSpace);
    case "shrub":
      return out.setHSL(0.17 + p.tint * 0.14, 0.4 - p.shade * 0.14, 0.34 + p.shade * 0.14, THREE.SRGBColorSpace);
    case "rock": {
      const g = 0.45 + p.tint * 0.2;
      return out.setRGB(g * 1.03, g, g * 0.94, THREE.SRGBColorSpace);
    }
  }
}

export class Scatter {
  readonly group = new THREE.Group();
  private meshes = new Map<PropKind, THREE.InstancedMesh>();
  private shadows: THREE.InstancedMesh;

  private originX = Infinity;
  private originZ = Infinity;
  private job: { cx: number; cz: number; i: number; found: Map<PropKind, Prop[]> } | null = null;

  constructor() {
    const reach = CELL * RADIUS_CELLS;
    for (const kind of Object.keys(GEOMETRY) as PropKind[]) {
      const mat = new THREE.MeshLambertMaterial({ flatShading: true });
      addWakeResponse(mat, reach, BEND_HEIGHT[kind]);
      const geo = GEOMETRY[kind]();
      geo.setAttribute("aBend", new THREE.InstancedBufferAttribute(new Float32Array(BUDGET[kind]), 1));
      const mesh = new THREE.InstancedMesh(geo, mat, BUDGET[kind]);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }

    this.shadows = new THREE.InstancedMesh(blobGeometry(), blobMaterial(), SHADOW_BUDGET);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 3; // over the terrain, under the grass
    this.group.add(this.shadows);
  }

  /** Shadows vanish when the sun is down — nothing is casting them. */
  setSunElevation(e: number) {
    const mat = this.shadows.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.38 * Math.max(0, Math.min(1, (e + 0.04) / 0.22));
    mat.visible = mat.opacity > 0.01;
  }

  update(px: number, pz: number) {
    if (!this.job && Math.hypot(px - this.originX, pz - this.originZ) > REBUILD_AFTER) {
      this.job = { cx: Math.round(px / CELL), cz: Math.round(pz / CELL), i: 0, found: new Map() };
    }
    if (this.job) this.step();
  }

  private step() {
    const job = this.job!;
    const side = RADIUS_CELLS * 2 + 1;
    const total = side * side;
    const end = Math.min(total, job.i + CELLS_PER_FRAME);
    const reachSq = (RADIUS_CELLS * CELL) ** 2;
    const scratch: Prop[] = [];

    for (; job.i < end; job.i++) {
      const gx = job.cx - RADIUS_CELLS + (job.i % side);
      const gz = job.cz - RADIUS_CELLS + Math.floor(job.i / side);

      // Cull to a disc so the scatter edge is round, not square.
      const dx = (gx - job.cx) * CELL;
      const dz = (gz - job.cz) * CELL;
      if (dx * dx + dz * dz > reachSq) continue;

      scratch.length = 0;
      propsInCell(gx, gz, scratch);
      for (const p of scratch) {
        let list = job.found.get(p.kind);
        if (!list) job.found.set(p.kind, (list = []));
        if (list.length < BUDGET[p.kind]) list.push(p);
      }
    }

    if (job.i >= total) {
      for (const [kind, mesh] of this.meshes) this.commit(mesh, job.found.get(kind) ?? []);
      this.commitShadows(job.found, job.cx * CELL, job.cz * CELL);
      this.originX = job.cx * CELL;
      this.originZ = job.cz * CELL;
      this.job = null;
    }
  }

  private commitShadows(found: Map<PropKind, Prop[]>, ox: number, oz: number) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const rangeSq = SHADOW_RANGE * SHADOW_RANGE;

    let n = 0;
    for (const [kind, list] of found) {
      const foot = FOOTPRINT[kind];
      for (const p of list) {
        if (n >= SHADOW_BUDGET) break;
        const dx = p.x - ox;
        const dz = p.z - oz;
        if (dx * dx + dz * dz > rangeSq) continue;
        // Props sit slightly sunk into the ground; lift back to the surface.
        pos.set(p.x, p.y + 0.36, p.z);
        q.setFromAxisAngle(up, p.rot);
        const r = p.sx * foot;
        scl.set(r, 1, r);
        m.compose(pos, q, scl);
        this.shadows.setMatrixAt(n++, m);
      }
    }
    this.shadows.count = n;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  private commit(mesh: THREE.InstancedMesh, slots: Prop[]) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    const bend = mesh.geometry.getAttribute("aBend") as THREE.InstancedBufferAttribute | undefined;
    const n = Math.min(slots.length, mesh.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const p = slots[i];
      if (bend) bend.setX(i, p.bends ? 1 : 0);
      pos.set(p.x, p.y, p.z);
      q.setFromAxisAngle(up, p.rot);
      scl.set(p.sx, p.sy, p.sx);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colourFor(p, col));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (bend) bend.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
