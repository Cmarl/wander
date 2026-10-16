import type { AudioEngine } from "./engine";
import type { Surface } from "../world/field";

/** Per-surface footstep character. Brighter + shorter = harder ground. */
const STEP: Record<Surface, { freq: number; q: number; decay: number; level: number; body: number }> = {
  grass: { freq: 1500, q: 0.8, decay: 0.11, level: 0.085, body: 118 },
  sand: { freq: 2050, q: 0.6, decay: 0.16, level: 0.072, body: 104 },
  rock: { freq: 2750, q: 1.7, decay: 0.07, level: 0.10, body: 136 },
  snow: { freq: 980, q: 1.3, decay: 0.13, level: 0.092, body: 96 },
  water: { freq: 760, q: 0.7, decay: 0.21, level: 0.10, body: 88 },
};

export class Sfx {
  constructor(private e: AudioEngine) {}

  footstep(surface: Surface, speed: number) {
    if (!this.e.ready) return;
    const s = STEP[surface];
    const effort = 0.6 + Math.min(speed / 5.2, 1) * 0.55;
    const vary = 0.85 + Math.random() * 0.3;
    const dest = this.e.sfxBus;

    this.e.burst({
      dest,
      freq: s.freq * vary,
      q: s.q,
      level: s.level * effort,
      decay: s.decay * vary,
    });
    // The weight behind the scuff — without it steps sound like paper.
    this.e.tone({
      dest,
      from: s.body * vary,
      to: s.body * 0.7,
      level: 0.034 * effort,
      attack: 0.004,
      decay: 0.07,
    });
    if (surface === "rock") {
      this.e.tone({ dest, from: 2400 * vary, to: 1800, level: 0.013, decay: 0.03 });
    }
    if (surface === "water") {
      this.e.burst({ dest, type: "highpass", freq: 1800, level: 0.042 * effort, decay: 0.18, sweepTo: 4200 });
    }
  }

  landing(surface: Surface) {
    if (!this.e.ready) return;
    const s = STEP[surface];
    this.e.burst({ dest: this.e.sfxBus, freq: s.freq * 0.8, q: s.q, level: s.level * 1.5, decay: s.decay * 1.6 });
    this.e.tone({ dest: this.e.sfxBus, from: s.body * 0.9, to: s.body * 0.55, level: 0.07, decay: 0.12 });
  }

  /**
   * Leaving the ground.
   *
   * Clyde asked for "sounds for jump and another for when the truck lands".
   * On foot it is an exhale and a bit of kit shifting. In a vehicle it is the
   * suspension unloading — springs letting go all at once, which is a low
   * thump with the pitch sweeping UP as the weight comes off, the opposite
   * shape to a landing.
   */
  jump(inVehicle: boolean) {
    if (!this.e.ready) return;
    const dest = inVehicle ? this.e.vehicleBus : this.e.sfxBus;
    if (inVehicle) {
      this.e.tone({ dest, type: "sine", from: 62, to: 120, level: 0.1, attack: 0.008, decay: 0.3 });
      this.e.burst({ dest, type: "bandpass", freq: 900, q: 0.8, level: 0.05, decay: 0.22, sweepTo: 2100 });
      // A rattle off the body as it unloads.
      this.e.burst({ dest, type: "highpass", freq: 2600, q: 0.6, level: 0.022, decay: 0.13 });
    } else {
      this.e.burst({ dest, type: "bandpass", freq: 520, q: 0.7, level: 0.03, decay: 0.16, sweepTo: 900 });
      this.e.tone({ dest, type: "sine", from: 180, to: 260, level: 0.025, attack: 0.01, decay: 0.12 });
    }
  }

  /**
   * A vehicle meeting the ground again.
   *
   * Deliberately the mirror of the jump: pitch sweeping DOWN as the springs
   * take the weight, with the thump scaled by how hard it was and a tyre
   * scuff on top. The ledge physics mean this now fires on its own from a fast
   * descent rather than only when you pressed jump.
   */
  touchdown(force: number) {
    if (!this.e.ready) return;
    const dest = this.e.vehicleBus;
    const f = Math.min(1, Math.max(0.12, force));
    this.e.tone({ dest, type: "sine", from: 140 - f * 50, to: 46, level: 0.055 + f * 0.1, attack: 0.004, decay: 0.26 + f * 0.2 });
    this.e.burst({ dest, type: "lowpass", freq: 320 + f * 260, q: 0.9, level: 0.05 + f * 0.09, decay: 0.2 + f * 0.18 });
    // Tyres scrubbing, only when it actually arrived hard.
    if (f > 0.35) {
      this.e.burst({ dest, type: "bandpass", freq: 1500, q: 1.3, level: 0.03 * f, decay: 0.3, sweepTo: 700 });
    }
  }

  /**
   * Driving through water. Broadband noise with the filter sweeping down as
   * the spray falls back, which is most of what a splash is.
   */
  splash(force: number) {
    if (!this.e.ready) return;
    const f = Math.min(1, Math.max(0.1, force));
    this.e.burst({
      dest: this.e.vehicleBus, type: "bandpass", freq: 900 + f * 1400, q: 0.55,
      level: 0.035 + f * 0.07, decay: 0.3 + f * 0.25, sweepTo: 300,
    });
    this.e.burst({
      dest: this.e.vehicleBus, type: "highpass", freq: 2600, q: 0.6,
      level: 0.02 + f * 0.04, decay: 0.18 + f * 0.2,
    });
  }

  doorOpen() {
    if (!this.e.ready) return;
    const dest = this.e.sfxBus;
    this.e.tone({ dest, from: 1900, to: 1400, level: 0.022, decay: 0.025 }); // latch
    this.e.burst({ dest, freq: 460, q: 3.5, level: 0.03, decay: 0.3, sweepTo: 300, attack: 0.02 }); // hinge creak
  }

  doorClose() {
    if (!this.e.ready) return;
    const dest = this.e.sfxBus;
    this.e.burst({ dest, type: "lowpass", freq: 340, level: 0.13, decay: 0.14 });
    this.e.tone({ dest, from: 92, to: 58, level: 0.11, decay: 0.19 });
    this.e.tone({ dest, from: 2600, to: 2000, level: 0.022, decay: 0.035, delay: 0.012 }); // latch catch
  }

  /**
   * Hitting something solid. Metal crunch plus, for trees, a wood crack.
   * `force` 0..1.
   */
  crash(force: number, woody: boolean) {
    if (!this.e.ready) return;
    const dest = this.e.vehicleBus;
    const f = 0.35 + Math.min(force, 1) * 0.65;

    // Body panel: a broadband crunch with a fast collapse.
    this.e.burst({ dest, type: "lowpass", freq: 900, level: 0.3 * f, decay: 0.26, attack: 0.001 });
    this.e.tone({ dest, from: 110, to: 42, level: 0.26 * f, decay: 0.3 });
    // Debris rattle.
    for (let i = 0; i < 4; i++) {
      this.e.burst({
        dest,
        freq: 1400 + Math.random() * 2600,
        q: 5 + Math.random() * 7,
        level: 0.05 * f,
        decay: 0.05 + Math.random() * 0.1,
      });
    }
    if (woody) {
      this.e.burst({ dest, freq: 420, q: 6, level: 0.17 * f, decay: 0.19, sweepTo: 180 });
      this.e.tone({ dest, type: "square", from: 230, to: 90, level: 0.08 * f, decay: 0.13 });
    }
  }

  /** Two detuned tones, because one is a beep and two is a horn. */
  horn(gain = 1) {
    if (!this.e.ready) return;
    const dest = this.e.vehicleBus;
    for (const [f, lvl] of [[372, 0.085], [442, 0.07], [186, 0.05]] as [number, number][]) {
      this.e.tone({ dest, type: "sawtooth", from: f, level: lvl * gain, attack: 0.02, decay: 0.42 });
    }
  }

  /**
   * A horn you hold down.
   *
   * Clyde: "fix the horn. should be continuous when I hold it." It was a
   * one-shot fired from keydown, so holding the key retriggered it on the
   * keyboard's auto-repeat — a stutter rather than a note.
   *
   * Sustained voices instead, started once and held until released. The remote
   * horn stays a one-shot, because somebody else's honk arrives as an event
   * and there is nothing to hold.
   */
  private hornVoices: { osc: OscillatorNode; gain: GainNode }[] = [];

  hornOn(gain = 1) {
    if (!this.e.ready || !this.e.ctx || this.hornVoices.length) return;
    const t = this.e.now;
    for (const [f, lvl] of [[372, 0.085], [442, 0.07], [186, 0.05]] as [number, number][]) {
      const osc = this.e.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      const g = this.e.gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(lvl * gain, t + 0.035);
      osc.connect(g).connect(this.e.vehicleBus);
      osc.start();
      this.hornVoices.push({ osc, gain: g });
    }
  }

  hornOff() {
    if (!this.hornVoices.length) return;
    const t = this.e.now;
    for (const v of this.hornVoices) {
      // Ramp down before stopping. Cutting a sawtooth mid-cycle is a click,
      // which is the lesson the music already taught this project.
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), t);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      v.osc.stop(t + 0.12);
    }
    this.hornVoices.length = 0;
  }

  /** Suspension hitting a rut. Level scales with how hard the hit was. */
  thump(force: number) {
    if (!this.e.ready) return;
    const dest = this.e.vehicleBus;
    const f = Math.min(force, 1);
    this.e.tone({ dest, from: 74, to: 46, level: 0.09 * f, decay: 0.16 });
    this.e.burst({ dest, type: "lowpass", freq: 420, level: 0.07 * f, decay: 0.1 });
    if (f > 0.55) this.e.burst({ dest, freq: 1600, q: 2.5, level: 0.022 * f, decay: 0.07 });
  }
}

/**
 * Engine, tyres and wind for the truck. Persistent voices whose parameters are
 * steered every frame — an engine that only crossfades between loops never
 * sounds like it's under load.
 */
export class VehicleAudio {
  private built = false;
  private running = false;

  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private sub!: OscillatorNode;
  private tone!: BiquadFilterNode;
  private engGain!: GainNode;
  private induction!: GainNode;
  private lump!: OscillatorNode;
  private lumpDepth!: GainNode;
  private tyreGain!: GainNode;
  private tyreFilter!: BiquadFilterNode;
  private windGain!: GainNode;

  private prevY: number | null = null;
  private thumpCooldown = 0;

  constructor(private e: AudioEngine, private sfx: Sfx) {}

  build() {
    if (this.built || !this.e.ctx) return;
    this.built = true;
    const ctx = this.e.ctx;

    this.engGain = this.e.gain(0);
    this.tone = this.e.filter("lowpass", 500, 1.1);
    this.tone.connect(this.engGain).connect(this.e.vehicleBus);

    const mk = (type: OscillatorType, g: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 40;
      o.connect(this.e.gain(g)).connect(this.tone);
      o.start();
      return o;
    };
    this.osc1 = mk("sawtooth", 0.5);
    this.osc2 = mk("square", 0.18);
    this.sub = mk("sine", 0.45);

    // Air being dragged through the intake.
    const indSrc = this.e.noise();
    const indFilt = this.e.filter("bandpass", 900, 0.8);
    this.induction = this.e.gain(0);
    indSrc.connect(indFilt).connect(this.induction).connect(this.tone);
    indSrc.start(0, Math.random() * 3);

    // Amplitude lumpiness at the firing rate — the "putter" of a big four.
    this.lump = ctx.createOscillator();
    this.lump.type = "sawtooth";
    this.lump.frequency.value = 20;
    this.lumpDepth = this.e.gain(0);
    this.lump.connect(this.lumpDepth).connect(this.engGain.gain);
    this.lump.start();

    const tyreSrc = this.e.noise();
    this.tyreFilter = this.e.filter("bandpass", 600, 0.5);
    this.tyreGain = this.e.gain(0);
    tyreSrc.connect(this.tyreFilter).connect(this.tyreGain).connect(this.e.vehicleBus);
    tyreSrc.start(0, Math.random() * 3);

    const windSrc = this.e.noise();
    const windFilt = this.e.filter("highpass", 1500, 0.7);
    this.windGain = this.e.gain(0);
    windSrc.connect(windFilt).connect(this.windGain).connect(this.e.vehicleBus);
    windSrc.start(0, Math.random() * 3);
  }

  ignition() {
    if (!this.e.ready) return;
    this.running = true;
    // Three cranks, then it catches.
    for (let i = 0; i < 3; i++) {
      this.e.tone({ dest: this.e.vehicleBus, type: "sawtooth", from: 42, to: 30, level: 0.045, decay: 0.1, delay: i * 0.13 });
    }
    const t = this.e.now;
    this.engGain.gain.cancelScheduledValues(t);
    this.engGain.gain.setValueAtTime(0.0001, t);
    this.engGain.gain.setTargetAtTime(0.12, t + 0.4, 0.25);
  }

  shutdown() {
    if (!this.e.ready || !this.built) return;
    this.running = false;
    const t = this.e.now;
    this.engGain.gain.cancelScheduledValues(t);
    this.engGain.gain.setTargetAtTime(0.0001, t, 0.16);
    this.tyreGain.gain.setTargetAtTime(0.0001, t, 0.1);
    this.windGain.gain.setTargetAtTime(0.0001, t, 0.1);
    this.prevY = null;
  }

  update(dt: number, s: { speed: number; throttle: number; topSpeed: number; y: number }) {
    if (!this.built || !this.e.ctx) return;
    const t = this.e.now;
    this.thumpCooldown -= dt;

    // Suspension: a big vertical rate of change means we dropped into a rut.
    if (this.running && this.prevY !== null) {
      const rate = Math.abs(s.y - this.prevY) / Math.max(dt, 1e-3);
      if (rate > 2.2 && this.thumpCooldown <= 0) {
        this.sfx.thump(Math.min((rate - 2.2) / 6, 1));
        this.thumpCooldown = 0.18;
      }
    }
    this.prevY = s.y;

    if (!this.running) return;

    const norm = Math.min(Math.abs(s.speed) / s.topSpeed, 1);
    // A fake four-speed: revs climb through each gear then drop on the shift.
    const GEARS = 4;
    const g = Math.min(GEARS - 1, Math.floor(norm * GEARS));
    const rpm = 0.18 + (norm * GEARS - g) * 0.82;
    const load = Math.max(Math.abs(s.throttle), 0.12);

    const f = 26 + rpm * 86;
    const set = (p: AudioParam, v: number, tc = 0.08) => p.setTargetAtTime(v, t, tc);
    set(this.osc1.frequency, f);
    set(this.osc2.frequency, f * 2);
    set(this.sub.frequency, f * 0.5);
    set(this.lump.frequency, f * 0.5, 0.05);
    set(this.lumpDepth.gain, 0.05 + (1 - rpm) * 0.06);

    // Opening the throttle opens the tone — that's most of "under load".
    set(this.tone.frequency, 380 + rpm * 1900 + load * 900, 0.12);
    set(this.induction.gain, 0.012 + load * 0.03 * rpm);
    set(this.engGain.gain, 0.085 + rpm * 0.045 + load * 0.028, 0.12);

    set(this.tyreGain.gain, Math.pow(norm, 1.3) * 0.038);
    set(this.tyreFilter.frequency, 520 + norm * 760, 0.2);
    set(this.windGain.gain, Math.pow(norm, 2.2) * 0.024);
  }
}
