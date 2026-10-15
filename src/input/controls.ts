/**
 * One input surface for both platforms.
 *
 * Desktop: WASD + drag-to-look (or click to capture the pointer), wheel zoom.
 * Touch:   left thumb is a floating stick, right thumb looks, buttons for the rest.
 */

export class Controls {
  /** Stick vector: +x strafes right, +y walks forward. Magnitude <= 1. */
  move = { x: 0, y: 0 };
  /** Look delta accumulated since the last consume(), in radians. */
  look = { x: 0, y: 0 };
  zoom = 0;
  sprint = false;
  jump = false;
  interact = false;
  /** Held: raise the binoculars. */
  glass = false;
  /** Edge: pin whatever is nearest the centre of the view. */
  pin = false;
  /** Edge: make or break camp. */
  camp = false;
  /** Held throttle, so a phone only has to steer. */
  cruise = false;

  /**
   * maxTouchPoints is the signal that survives an embedded WebView. Telegram's
   * in-app browser can report hover capability and omit ontouchstart, which
   * left isTouch false — no on-screen buttons at all, and no keyboard either,
   * so there was genuinely no way to get out of the truck.
   */
  readonly isTouch =
    matchMedia("(hover: none)").matches ||
    "ontouchstart" in window ||
    (navigator.maxTouchPoints ?? 0) > 0;

  private keys = new Set<string>();
  private pointerLook: number | null = null;
  private lastLook = { x: 0, y: 0 };
  private stick: { id: number; ox: number; oy: number } | null = null;
  private stickEl: HTMLElement | null = null;
  private knobEl: HTMLElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space") this.jump = true;
      if (e.code === "KeyE" || e.code === "Enter") this.interact = true;
      if (e.code === "KeyF") this.pin = true;
      if (e.code === "KeyC") this.camp = true;
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());

    canvas.addEventListener("wheel", (e) => {
      this.zoom += e.deltaY * 0.01;
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    addEventListener("pointermove", (e) => this.onPointerMove(e));
    addEventListener("pointerup", (e) => this.onPointerUp(e));
    addEventListener("pointercancel", (e) => this.onPointerUp(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("click", () => {
      if (!this.isTouch && !document.pointerLockElement) canvas.requestPointerLock?.();
    });
    addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === canvas) {
        this.look.x -= e.movementX * 0.0028;
        this.look.y -= e.movementY * 0.0024;
      }
    });
  }

  /** Guards against a WebView firing both touch and pointer for one tap. */
  private lastTap = new WeakMap<HTMLElement, number>();

  /** Wire HUD buttons up without Controls needing to know about the DOM layout. */
  bindButton(el: HTMLElement, action: "jump" | "interact" | "sprint" | "glass" | "pin" | "camp" | "cruise") {
    const down = (e: Event) => {
      e.preventDefault();
      // Some WebViews fire touchstart AND pointerdown for a single tap, others
      // only one of them. Listen for both and ignore the echo.
      const now = performance.now();
      if (now - (this.lastTap.get(el) ?? 0) < 350) return;
      this.lastTap.set(el, now);
      el.classList.add("held");
      if (action === "sprint") {
        this.sprint = !this.sprint;
        el.classList.toggle("on", this.sprint);
      } else if (action === "cruise") {
        this.cruise = !this.cruise;
        el.classList.toggle("on", this.cruise);
      } else if (action === "glass") {
        // Toggle on touch — nobody wants to hold a button and steer.
        this.glass = !this.glass;
        el.classList.toggle("on", this.glass);
      } else {
        this[action] = true;
      }
    };
    const up = (e: Event) => {
      e.preventDefault();
      el.classList.remove("held");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("touchstart", down, { passive: false });
    el.addEventListener("pointerup", up);
    el.addEventListener("touchend", up);
    el.addEventListener("pointercancel", up);
  }

  bindStick(base: HTMLElement, knob: HTMLElement) {
    this.stickEl = base;
    this.knobEl = knob;
  }

  private onPointerDown(e: PointerEvent) {
    if (this.isTouch && e.pointerType === "touch" && e.clientX < innerWidth * 0.45) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      if (this.stickEl) {
        this.stickEl.style.left = `${e.clientX}px`;
        this.stickEl.style.top = `${e.clientY}px`;
        this.stickEl.classList.add("active");
      }
      return;
    }
    if (this.pointerLook === null) {
      this.pointerLook = e.pointerId;
      this.lastLook.x = e.clientX;
      this.lastLook.y = e.clientY;
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (this.stick && e.pointerId === this.stick.id) {
      const dx = e.clientX - this.stick.ox;
      const dy = e.clientY - this.stick.oy;
      const max = 64;
      const len = Math.hypot(dx, dy);
      const k = len > max ? max / len : 1;
      this.move.x = (dx * k) / max;
      this.move.y = (-dy * k) / max;
      if (this.knobEl) this.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      return;
    }
    if (e.pointerId === this.pointerLook) {
      this.look.x -= (e.clientX - this.lastLook.x) * 0.006;
      this.look.y -= (e.clientY - this.lastLook.y) * 0.005;
      this.lastLook.x = e.clientX;
      this.lastLook.y = e.clientY;
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick = null;
      this.move.x = 0;
      this.move.y = 0;
      if (this.knobEl) this.knobEl.style.transform = "translate(0,0)";
      if (this.stickEl) this.stickEl.classList.remove("active");
    }
    if (e.pointerId === this.pointerLook) this.pointerLook = null;
  }

  /** Poll held keys. Call at the top of the frame, before reading `move`. */
  beginFrame() {
    if (this.isTouch) return; // touch stick writes `move` directly from events
    const k = this.keys;
    const x = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const y = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    this.move.x = x / len;
    this.move.y = y / len;
    this.sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    this.glass = k.has("KeyQ");
  }

  /** Clear one-shot inputs and accumulated deltas. Call at the end of the frame. */
  endFrame() {
    this.look.x = 0;
    this.look.y = 0;
    this.zoom = 0;
    this.jump = false;
    this.interact = false;
    this.pin = false;
    this.camp = false;
  }
}
