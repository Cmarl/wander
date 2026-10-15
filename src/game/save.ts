import type { Discoveries } from "./discovery";

/**
 * The whole save, as one portable blob.
 *
 * Everything persistent already lives under the `wander.` localStorage prefix,
 * owned by whichever system actually cares about it — discoveries, pins, paint,
 * volume, haptics, your name. Rather than teach one central save file about
 * each of them, THE BLOB IS THAT SUBTREE. New persistent state (the garage, a
 * chosen vehicle) needs no change here, and a code copied off a phone restores
 * a desktop exactly rather than approximately.
 *
 * `wander.cid` is excluded deliberately. It is this browser's multiplayer
 * identity, and two devices claiming one identity evict each other — the exact
 * rejoin-duplication bug that id was added to fix.
 */
const PREFIX = "wander.";
const EXCLUDE = new Set(["wander.cid"]);
const PLACE = "wander.place";

export interface Place {
  x: number;
  z: number;
  /** Metres travelled, on foot and driving. */
  odo: number;
}

/**
 * Where you left off.
 *
 * Walking away from the screen should not cost you the drive out. This is
 * written on a throttle rather than every frame, so the worst case is losing
 * the last few seconds of a journey.
 */
export function rememberPlace(x: number, z: number, odo: number): void {
  try {
    localStorage.setItem(PLACE, JSON.stringify({ x: Math.round(x), z: Math.round(z), odo: Math.round(odo) }));
  } catch {
    // Private browsing, quota, whatever — the game still plays.
  }
}

export function lastPlace(): Place | null {
  try {
    const raw = localStorage.getItem(PLACE);
    if (!raw) return null;
    const p = JSON.parse(raw) as Place;
    // A save written by a broken build shouldn't strand you off the map.
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.z)) return null;
    return { x: p.x, z: p.z, odo: Number.isFinite(p.odo) ? p.odo : 0 };
  } catch {
    return null;
  }
}

/** Snapshot of every persistent key, for the clipboard. */
export function exportCode(found: Discoveries): string {
  const keys: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX) || EXCLUDE.has(k)) continue;
    const v = localStorage.getItem(k);
    if (v !== null) keys[k] = v;
  }
  // `found` stays a top-level field so a v2 code is still readable by the
  // discoveries-only importer that shipped before this, and so that merging
  // two devices' journals keeps working even if the subtree is dropped.
  return JSON.stringify({ v: 2, found: found.all(), keys });
}

export interface Restored {
  /** New discoveries merged in. */
  added: number;
  /** Whether the rest of the save (place, pins, paint) came across too. */
  full: boolean;
}

/**
 * Apply a code. Discoveries MERGE — two devices' journals add up, and nobody
 * loses a find by restoring. Everything else is a straight replace, because
 * there is no sensible way to average two positions or two paint jobs.
 */
export function importCode(code: string, found: Discoveries): Restored {
  const data = JSON.parse(code) as { v?: number; found?: unknown; keys?: Record<string, string> };
  if (!data || !Array.isArray(data.found)) throw new Error("not a Wander save");
  const added = found.importCode(JSON.stringify({ v: 1, found: data.found }));

  if (!data.keys || typeof data.keys !== "object") return { added, full: false };
  let wrote = 0;
  for (const [k, v] of Object.entries(data.keys)) {
    if (!k.startsWith(PREFIX) || EXCLUDE.has(k) || typeof v !== "string") continue;
    try {
      localStorage.setItem(k, v);
      wrote++;
    } catch {
      // ignore
    }
  }
  return { added, full: wrote > 0 };
}
