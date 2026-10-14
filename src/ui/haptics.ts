/**
 * Haptics. Short, rare, and only for things that physically happen.
 *
 * A phone buzzing constantly is the opposite of relaxing, so there is no
 * feedback for UI taps, menus or ordinary driving — only impacts and arrivals.
 */

const can = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
let enabled = localStorage.getItem("wander.haptics") !== "0";

const buzz = (pattern: number | number[]) => {
  if (!can || !enabled) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers expose vibrate but refuse it outside a gesture.
  }
};

export const haptics = {
  get available() {
    return can;
  },
  get on() {
    return enabled;
  },
  set(v: boolean) {
    enabled = v;
    localStorage.setItem("wander.haptics", v ? "1" : "0");
  },
  /** `force` 0..1 — a graze barely registers, a real hit thumps. */
  crash(force: number) {
    buzz(Math.round(18 + force * 55));
  },
  land(force: number) {
    buzz(Math.round(8 + force * 22));
  },
  /** Two soft taps, so arriving somewhere feels different from hitting it. */
  discover() {
    buzz([14, 70, 22]);
  },
};
