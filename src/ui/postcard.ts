/**
 * Photo mode.
 *
 * Worth more here than in most games, because Wander's world is a pure
 * function: the coordinates stamped on a picture are a *working address*. Hand
 * someone the link and they stand exactly where you stood, in a byte-identical
 * landscape. A screenshot isn't a picture of the game, it's a place in it.
 *
 * Capture reads the drawing buffer in the same frame as the render, so the
 * renderer doesn't need preserveDrawingBuffer and nobody pays for the feature
 * while they aren't using it.
 */

export interface ShotInfo {
  x: number;
  z: number;
  biome: string;
  clock: string;
}

export class Postcard {
  active = false;
  /** Set by the shutter, consumed by the frame loop right after render. */
  pending = false;

  private root: HTMLElement;
  private hint: HTMLElement;
  private linkBtn: HTMLElement;

  constructor(private ui: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "photo";
    this.root.innerHTML = `
      <div class="photo-bar">
        <button class="photo-btn" id="p-close">close</button>
        <button class="photo-shutter" id="p-shoot" aria-label="take photo"></button>
        <button class="photo-btn" id="p-link">copy link</button>
      </div>
      <div class="photo-hint" id="p-hint">drag to frame · scroll to pull back · [ ] for the light</div>
    `;
    document.body.appendChild(this.root);
    this.hint = this.root.querySelector("#p-hint")!;
    this.linkBtn = this.root.querySelector("#p-link")!;

    const stop = (e: Event) => e.stopPropagation();
    this.root.querySelector(".photo-bar")!.addEventListener("pointerdown", stop);
    this.root.querySelector("#p-shoot")!.addEventListener("pointerdown", (e) => {
      stop(e);
      this.pending = true;
    });
    this.root.querySelector("#p-close")!.addEventListener("pointerdown", (e) => {
      stop(e);
      this.toggle(false);
    });
  }

  toggle(on = !this.active) {
    this.active = on;
    this.root.classList.toggle("on", on);
    // Everything else gets out of the frame.
    this.ui.classList.toggle("hidden-for-photo", on);
  }

  /** The link that drops someone else exactly here. */
  linkFor(x: number, z: number) {
    return `${location.origin}${location.pathname.replace(/\/$/, "")}?at=${Math.round(x)},${Math.round(z)}`;
  }

  async copyLink(x: number, z: number) {
    const url = this.linkFor(x, z);
    try {
      await navigator.clipboard.writeText(url);
      this.flash("link copied — it opens right here");
    } catch {
      // Clipboard needs a secure context and permission; show it instead.
      this.flash(url);
    }
  }

  bindLink(get: () => { x: number; z: number }) {
    this.linkBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const p = get();
      void this.copyLink(p.x, p.z);
    });
  }

  private flash(msg: string) {
    const original = "drag to frame · scroll to pull back · [ ] for the light";
    this.hint.textContent = msg;
    setTimeout(() => (this.hint.textContent = original), 2600);
  }

  /**
   * Stamp and hand off. Must be called in the same frame as the render, before
   * the browser clears the drawing buffer.
   */
  grab(canvas: HTMLCanvasElement, info: ShotInfo) {
    this.pending = false;
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0);

    const pad = Math.round(out.height * 0.045);
    const big = Math.round(out.height * 0.031);
    const small = Math.round(out.height * 0.019);
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = Math.round(out.height * 0.012);

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `600 ${big}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.fillText(`${Math.round(info.x)}, ${Math.round(info.z)}`, pad, out.height - pad - small * 1.6);

    ctx.fillStyle = "rgba(255,255,255,0.68)";
    ctx.font = `500 ${small}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.fillText(`${info.biome} · ${info.clock}`, pad, out.height - pad);

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = `600 ${small}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    const mark = "WANDER";
    ctx.fillText(mark, out.width - pad - ctx.measureText(mark).width, out.height - pad);

    out.toBlob((blob) => {
      if (!blob) return;
      const name = `wander-${Math.round(info.x)}_${Math.round(info.z)}.png`;
      const file = new File([blob], name, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      // On a phone, sharing beats a file dropped in Downloads.
      if (nav.canShare?.({ files: [file] })) {
        void (navigator as Navigator & { share: (d: unknown) => Promise<void> })
          .share({ files: [file], text: this.linkFor(info.x, info.z) })
          .catch(() => this.download(blob, name));
      } else {
        this.download(blob, name);
      }
      this.flash("saved");
    }, "image/png");
  }

  private download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
