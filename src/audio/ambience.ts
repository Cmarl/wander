import type { AudioEngine } from "./engine";

export interface AmbienceContext {
  /** 0..1 how wind-exposed the spot is — altitude and open ground raise it. */
  exposure: number;
  /** 0..1 local tree density. Shelters wind, adds rustle, brings birds. */
  treeCover: number;
  /** 0..1 proximity to the shoreline. */
  water: number;
  /** 0..1 warmth, after the altitude lapse. Drives insect life. */
  warmth: number;
  /** 0..1 darkness. */
  night: number;
  inVehicle: boolean;
}

/**
 * The continuous environmental bed. Every layer is always running; only its
 * gain moves, eased with setTargetAtTime so walking from forest to ridge to
 * shoreline is a slow blend rather than a cut between clips.
 */
export class Ambience {
  private windLow!: GainNode;
  private windHigh!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rustle!: GainNode;
  private surf!: GainNode;
  private crickets!: GainNode;
  private fire!: GainNode;
  private duck!: GainNode;
  private nextCrackle = 0;
  /** 0..1, set by the camp. */
  fireLevel = 0;

  private nextBird = 3;
  private built = false;

  constructor(private e: AudioEngine) {}

  build() {
    if (this.built || !this.e.ctx) return;
    this.built = true;

    // Everything ducks together when you close the truck door on it.
    this.duck = this.e.gain(1);
    this.duck.connect(this.e.ambientBus);

    // --- wind: a low rumble plus a brighter band that drifts in pitch --------
    const lowSrc = this.e.noise();
    const lowFilt = this.e.filter("lowpass", 240, 0.7);
    this.windLow = this.e.gain(0);
    lowSrc.connect(lowFilt).connect(this.e.tremolo(0.047, 0.35)).connect(this.windLow).connect(this.duck);
    lowSrc.start(0, Math.random() * 3);

    const hiSrc = this.e.noise();
    this.windFilter = this.e.filter("bandpass", 620, 1.4);
    this.windHigh = this.e.gain(0);
    hiSrc.connect(this.windFilter).connect(this.e.tremolo(0.083, 0.6)).connect(this.windHigh).connect(this.duck);
    hiSrc.start(0, Math.random() * 3);
    // Gusts: slow swell on level, and a wander on the band centre.
    this.e.lfo(0.061, 240, this.windFilter.frequency);

    // --- leaves ------------------------------------------------------------
    const leafSrc = this.e.noise();
    const leafFilt = this.e.filter("bandpass", 2600, 0.9);
    this.rustle = this.e.gain(0);
    leafSrc.connect(leafFilt).connect(this.e.tremolo(0.11, 0.65)).connect(this.rustle).connect(this.duck);
    leafSrc.start(0, Math.random() * 3);

    // --- shoreline ---------------------------------------------------------
    const surfSrc = this.e.noise();
    const surfFilt = this.e.filter("lowpass", 520, 0.6);
    this.surf = this.e.gain(0);
    surfSrc.connect(surfFilt).connect(this.e.tremolo(0.09, 0.75)).connect(this.surf).connect(this.duck);
    surfSrc.start(0, Math.random() * 3);
    this.e.lfo(0.13, 160, surfFilt.frequency); // the swell

    // --- night insects ------------------------------------------------------
    // A hard-resonant bandpass on noise gives the chirr for free; the LFO cuts
    // it into pulses, so no per-chirp scheduling is needed.
    const crSrc = this.e.noise();
    const crFilt = this.e.filter("bandpass", 4600, 18);
    this.crickets = this.e.gain(0);
    crSrc
      .connect(crFilt)
      .connect(this.e.tremolo(11.5, 0.9))   // the chirr
      .connect(this.e.tremolo(0.07, 0.4))   // and it comes and goes
      .connect(this.crickets)
      .connect(this.duck);
    crSrc.start(0, Math.random() * 3);

    // --- campfire ----------------------------------------------------------
    // Broadband roar through a lowpass; the crackles are scheduled separately
    // because a fire is mostly silence punctuated by sharp little events.
    const fireSrc = this.e.noise();
    const fireFilt = this.e.filter("lowpass", 760, 0.8);
    this.fire = this.e.gain(0);
    fireSrc
      .connect(fireFilt)
      .connect(this.e.tremolo(0.9, 0.35))
      .connect(this.e.tremolo(3.7, 0.22))
      .connect(this.fire)
      .connect(this.e.ambientBus);
    fireSrc.start(0, Math.random() * 3);
  }

  update(dt: number, c: AmbienceContext) {
    if (!this.built || !this.e.ctx) return;
    const t = this.e.now;
    const ease = (p: AudioParam, v: number, tc = 1.6) => p.setTargetAtTime(v, t, tc);

    const shelter = 1 - c.treeCover * 0.45;
    ease(this.windLow.gain, (0.022 + c.exposure * 0.045) * shelter);
    ease(this.windHigh.gain, Math.pow(c.exposure, 1.5) * 0.03 * shelter);
    ease(this.windFilter.frequency, 520 + c.exposure * 620, 3);
    ease(this.rustle.gain, c.treeCover * (0.01 + c.exposure * 0.038));
    ease(this.surf.gain, c.water * 0.055);
    ease(this.crickets.gain, c.night * c.warmth * 0.022 * (1 - c.water * 0.4));
    // Inside the cab, the world goes muffled and distant.
    ease(this.duck.gain, c.inVehicle ? 0.4 : 1, 0.5);

    // The fire sits outside the duck: when you're at camp it IS the ambience.
    ease(this.fire.gain, this.fireLevel * 0.085, 0.8);
    if (this.fireLevel > 0.1) this.crackle(dt);

    this.birds(dt, c);
  }

  /** Sharp little pops, sparse and irregular. */
  private crackle(dt: number) {
    this.nextCrackle -= dt;
    if (this.nextCrackle > 0) return;
    this.nextCrackle = 0.12 + Math.random() * 0.75;
    const level = (0.012 + Math.random() * 0.03) * this.fireLevel;
    this.e.burst({
      dest: this.e.ambientBus,
      freq: 900 + Math.random() * 2800,
      q: 3 + Math.random() * 9,
      level,
      decay: 0.03 + Math.random() * 0.08,
    });
    if (Math.random() > 0.72) {
      this.e.tone({ dest: this.e.ambientBus, from: 180 + Math.random() * 160, to: 70, level: level * 0.8, decay: 0.09 });
    }
  }

  /** Sparse, melodic, and therefore worth scheduling individually. */
  private birds(dt: number, c: AmbienceContext) {
    const activity = (0.25 + c.treeCover) * (1 - c.night) * (0.3 + c.warmth) * (1 - c.water * 0.5);
    if (activity < 0.08) return;

    this.nextBird -= dt * activity;
    if (this.nextBird > 0) return;
    this.nextBird = 1.1 + Math.random() * 5.5;

    const dest = this.duck;
    const base = 1700 + Math.random() * 1900;
    const notes = 2 + Math.floor(Math.random() * 4);
    const level = (0.006 + Math.random() * 0.011) * (c.inVehicle ? 0.4 : 1);
    const spacing = 0.055 + Math.random() * 0.07;

    for (let i = 0; i < notes; i++) {
      const f = base * (1 + (Math.random() - 0.5) * 0.3);
      this.e.tone({
        dest,
        from: f,
        to: f * (1.15 + Math.random() * 0.5), // the little upward slur
        level,
        attack: 0.008,
        decay: 0.07 + Math.random() * 0.06,
        delay: i * spacing,
      });
    }
  }
}
