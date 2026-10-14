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

  readonly isTouch = matchMedia("(hover: none)").matches || "ontouchstart" in window;

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

  /** Wire HUD buttons up without Controls needing to know about the DOM layout. */
  bindButton(el: HTMLElement, action: "jump" | "interact" | "sprint") {
    const down = (e: Event) => {
      e.preventDefault();
      el.classList.add("held");
      if (action === "sprint") {
        this.sprint = !this.sprint;
        el.classList.toggle("on", this.sprint);
      } else {
        this[action] = true;
      }
    };
    const up = (e: Event) => {
      e.preventDefault();
      el.classList.remove("held");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
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
  }

  /** Clear one-shot inputs and accumulated deltas. Call at the end of the frame. */
  endFrame() {
    this.look.x = 0;
    this.look.y = 0;
    this.zoom = 0;
    this.jump = false;
    this.interact = false;
  }
}
