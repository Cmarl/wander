/**
 * Gamepad support.
 *
 * An additive input source: it fills the same fields the keyboard and the
 * touch controls already fill, so nothing downstream knows or cares where a
 * movement came from. Keyboard, touch and pad all work at once.
 *
 * The Gamepad API gives no events for axes — you poll it once a frame, which
 * is what beginFrame already does for the keyboard.
 */

export type PadAction =
  | "interact"
  | "jump"
  | "down"
  | "glass"
  | "camp"
  | "cruise"
  | "pin"
  | "journal"
  | "horn";

export interface PadBinding {
  /** Button index on the pad. */
  button: number;
  label: string;
}

/**
 * Defaults for the standard mapping, which is what every pad reports on a
 * modern browser. Chosen so the common verbs sit under a thumb that is not
 * also steering.
 */
export const DEFAULT_BINDINGS: Record<PadAction, PadBinding> = {
  interact: { button: 0, label: "A / cross" },
  jump: { button: 1, label: "B / circle" },
  down: { button: 10, label: "left stick press" },
  glass: { button: 2, label: "X / square" },
  camp: { button: 3, label: "Y / triangle" },
  cruise: { button: 5, label: "right bumper" },
  pin: { button: 4, label: "left bumper" },
  journal: { button: 9, label: "start" },
  horn: { button: 7, label: "right trigger" },
};

export const ACTION_LABEL: Record<PadAction, string> = {
  interact: "get in / do the thing",
  jump: "jump, and climb when flying",
  // Running is no longer a thing you ask for — it is simply how you move —
  // so this binding is only the half of it that still has a job.
  down: "descend, when flying",
  glass: "binoculars",
  camp: "make or break camp",
  cruise: "cruise",
  pin: "pin what you are looking at",
  journal: "field journal",
  horn: "horn",
};

const KEY = "wander.pad";
/** Sticks rest slightly off centre; below this is noise, not intent. */
const DEADZONE = 0.16;

export class Pads {
  bindings: Record<PadAction, PadBinding> = { ...DEFAULT_BINDINGS };
  /** Index of the pad we are listening to, or null. */
  active: number | null = null;
  /** True for one frame after a button goes down. */
  private was = new Set<string>();
  /** Set while the mapping menu is waiting for a press. */
  listenFor: PadAction | null = null;
  onBound?: () => void;

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw as Record<string, PadBinding>)) {
          if (k in this.bindings && v && typeof v.button === "number") {
            this.bindings[k as PadAction] = { button: v.button, label: v.label ?? `button ${v.button}` };
          }
        }
      }
    } catch {
      // Defaults, which is where everyone starts.
    }
    addEventListener("gamepadconnected", (e) => {
      this.active = (e as GamepadEvent).gamepad.index;
    });
    addEventListener("gamepaddisconnected", (e) => {
      if (this.active === (e as GamepadEvent).gamepad.index) this.active = null;
    });
  }

  reset() {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.save();
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.bindings));
    } catch {
      // Private browsing. Yours for the session.
    }
  }

  /** The pad we are using, if any is still present. */
  get pad(): Gamepad | null {
    const all = navigator.getGamepads?.() ?? [];
    if (this.active !== null && all[this.active]) return all[this.active];
    // Fall back to the first connected pad, so plugging one in mid-session
    // works even if the connect event was missed.
    for (let i = 0; i < all.length; i++) {
      if (all[i]) {
        this.active = i;
        return all[i];
      }
    }
    return null;
  }

  private dead(v: number): number {
    return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
  }

  /**
   * Read the pad into a frame's worth of input.
   *
   * Returns null when there is no pad, so the caller leaves every other input
   * source untouched rather than zeroing it.
   */
  read(): {
    moveX: number;
    moveY: number;
    lookX: number;
    lookY: number;
    throttle: number;
    held: Set<PadAction>;
    pressed: Set<PadAction>;
  } | null {
    const pad = this.pad;
    if (!pad) return null;

    // Rebinding: the next button pressed becomes the binding.
    if (this.listenFor) {
      for (let i = 0; i < pad.buttons.length; i++) {
        if (pad.buttons[i]?.pressed) {
          this.bindings[this.listenFor] = { button: i, label: `button ${i}` };
          this.listenFor = null;
          this.save();
          this.onBound?.();
          break;
        }
      }
    }

    const held = new Set<PadAction>();
    const pressed = new Set<PadAction>();
    for (const action of Object.keys(this.bindings) as PadAction[]) {
      const b = this.bindings[action].button;
      const down = !!pad.buttons[b]?.pressed;
      const key = `${action}`;
      if (down) {
        held.add(action);
        if (!this.was.has(key)) pressed.add(action);
        this.was.add(key);
      } else {
        this.was.delete(key);
      }
    }

    // Triggers drive the throttle, which is the one thing a pad does better
    // than a keyboard: an analogue amount rather than on or off.
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;

    return {
      moveX: this.dead(pad.axes[0] ?? 0),
      moveY: -this.dead(pad.axes[1] ?? 0),
      lookX: this.dead(pad.axes[2] ?? 0),
      lookY: this.dead(pad.axes[3] ?? 0),
      throttle: rt - lt,
      held,
      pressed,
    };
  }

  /** Live readout for the mapping menu, so you can see it working. */
  snapshot(): { name: string; axes: number[]; buttons: number[] } | null {
    const pad = this.pad;
    if (!pad) return null;
    return {
      name: pad.id,
      axes: pad.axes.map((a) => Math.round(a * 100) / 100),
      buttons: pad.buttons.map((b) => Math.round(b.value * 100) / 100),
    };
  }
}
