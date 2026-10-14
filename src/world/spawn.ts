import * as THREE from "three";
import { heightAt } from "./field";

/**
 * Pick an opening shot worth looking at: low ground near the coast, with real
 * mountains within sight. Deterministic, so the same build always starts in the
 * same place — and cheap enough to run during the boot screen.
 */
export function findSpawn(): THREE.Vector2 {
  const STEP = 2500;
  const SPAN = 20; // ±50 km
  const n = SPAN * 2 + 1;
  const h = new Float32Array(n * n);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      h[j * n + i] = heightAt((i - SPAN) * STEP, (j - SPAN) * STEP);
    }
  }

  const RING = 6; // look 15 km out for peaks
  let best = -Infinity;
  let bx = 0;
  let bz = 0;

  for (let j = RING; j < n - RING; j++) {
    for (let i = RING; i < n - RING; i++) {
      const here = h[j * n + i];
      if (here < 15 || here > 320) continue;

      let peak = 0;
      let water = 0;
      for (let dj = -RING; dj <= RING; dj++) {
        for (let di = -RING; di <= RING; di++) {
          const v = h[(j + dj) * n + (i + di)];
          if (v > peak) peak = v;
          if (v < 0) water++;
        }
      }
      // Reward big peaks in view, some water for the horizon, gentle ground underfoot.
      const score = peak * 1.0 + Math.min(water, 40) * 12 - Math.abs(here - 90) * 2.5;
      if (score > best) {
        best = score;
        bx = (i - SPAN) * STEP;
        bz = (j - SPAN) * STEP;
      }
    }
  }

  // Refine inside the winning cell for somewhere flat to actually stand.
  let fx = bx;
  let fz = bz;
  let flattest = Infinity;
  for (let j = -4; j <= 4; j++) {
    for (let i = -4; i <= 4; i++) {
      const x = bx + i * 120;
      const z = bz + j * 120;
      const c = heightAt(x, z);
      if (c < 12 || c > 260) continue;
      const rough =
        Math.abs(heightAt(x + 25, z) - c) +
        Math.abs(heightAt(x - 25, z) - c) +
        Math.abs(heightAt(x, z + 25) - c) +
        Math.abs(heightAt(x, z - 25) - c);
      if (rough < flattest) {
        flattest = rough;
        fx = x;
        fz = z;
      }
    }
  }

  return new THREE.Vector2(fx, fz);
}
