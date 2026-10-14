/**
 * Audio plumbing: one context, three buses, a shared noise buffer, and small
 * helpers for the two shapes everything else is built from — a looping
 * modulated source, and a short enveloped one-shot.
 *
 * Nothing here loads a file. Every sound in the game is synthesised, which
 * keeps the download at zero and lets the soundscape be driven continuously by
 * world parameters instead of crossfading between fixed recordings.
 */

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  ambientBus!: GainNode;
  sfxBus!: GainNode;
  vehicleBus!: GainNode;
  noiseBuffer!: AudioBuffer;

  private _muted = localStorage.getItem("wander.muted") === "1";
  private _volume = Number(localStorage.getItem("wander.volume") ?? "0.6");

  get ready() {
    return this.ctx !== null && this.ctx.state === "running";
  }
  get muted() {
    return this._muted;
  }

  /** Must be called from a user gesture — browsers refuse audio otherwise. */
  start(): boolean {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ready;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;

    const ctx = new Ctor();
    this.ctx = ctx;

    // A gentle limiter so a cluster of one-shots can never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(limiter).connect(ctx.destination);
    // Fade in rather than punching the bed on at full level.
    if (!this._muted) this.master.gain.exponentialRampToValueAtTime(this.level, ctx.currentTime + 2.5);

    const bus = (g: number) => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.connect(this.master);
      return n;
    };
    this.ambientBus = bus(1);
    this.sfxBus = bus(0.9);
    this.vehicleBus = bus(0.8);

    // Four seconds of white noise, shared by every noise-based voice.
    const len = ctx.sampleRate * 4;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    void ctx.resume();
    return true;
  }

  /** Perceptual taper — a linear slider on raw gain feels useless up top. */
  private get level() {
    return Math.max(0.0001, Math.pow(this._volume, 1.8) * 0.75);
  }

  get volume() {
    return this._volume;
  }

  setVolume(v: number) {
    this._volume = Math.min(1, Math.max(0, v));
    localStorage.setItem("wander.volume", String(this._volume));
    this.apply();
  }

  setMuted(m: boolean) {
    this._muted = m;
    localStorage.setItem("wander.muted", m ? "1" : "0");
    this.apply();
  }

  private apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this._muted ? 0.0001 : this.level, t, 0.08);
  }

  /** Suspend while the tab is hidden so we aren't burning battery in a pocket. */
  setActive(active: boolean) {
    if (!this.ctx) return;
    if (active) void this.ctx.resume();
    else void this.ctx.suspend();
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  noise(loop = true): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuffer;
    s.loop = loop;
    // Random start offset so layers sharing the buffer don't phase together.
    return s;
  }

  gain(v = 0): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /**
   * A unity-gain stage that breathes: gain swings through 1±depth.
   *
   * Use this for swell instead of pointing an LFO at a level GainNode. Param
   * modulation is ADDITIVE, so an LFO of depth 0.6 on a gain of 0.05 doesn't
   * swell it by 60% — it slams it to 0.65 and through negative on the way back.
   * Putting the modulation in series makes it multiplicative, which is what
   * "gusting" actually means.
   */
  tremolo(freq: number, depth: number): GainNode {
    const g = this.gain(1);
    this.lfo(freq, Math.min(depth, 0.95), g.gain);
    return g;
  }

  /** Low-frequency oscillator wired into a parameter, for drift and swell. */
  lfo(freq: number, depth: number, target: AudioParam): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.frequency.value = freq;
    const g = this.gain(depth);
    o.connect(g).connect(target);
    o.start();
    return o;
  }

  /**
   * Percussive one-shot: noise through a filter with an exponential tail.
   * The workhorse behind footsteps, door thunks and suspension hits.
   */
  burst(opts: {
    dest: AudioNode;
    type?: BiquadFilterType;
    freq: number;
    q?: number;
    level: number;
    attack?: number;
    decay: number;
    sweepTo?: number;
  }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = this.noise(false);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.filter(opts.type ?? "bandpass", opts.freq, opts.q ?? 1);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.decay);
    const g = this.gain(0);
    const atk = opts.attack ?? 0.003;
    g.gain.linearRampToValueAtTime(opts.level, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + opts.decay);
    src.connect(f).connect(g).connect(opts.dest);
    src.start(t, Math.random() * 3);
    src.stop(t + atk + opts.decay + 0.05);
  }

  /** Tonal one-shot with a pitch envelope — bird calls, latch clicks, thuds. */
  tone(opts: {
    dest: AudioNode;
    type?: OscillatorType;
    from: number;
    to?: number;
    level: number;
    attack?: number;
    decay: number;
    delay?: number;
  }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(opts.from, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.decay);
    const g = this.gain(0);
    const atk = opts.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.level, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + opts.decay);
    o.connect(g).connect(opts.dest);
    o.start(t);
    o.stop(t + atk + opts.decay + 0.05);
  }
}
