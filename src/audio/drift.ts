import type { AudioEngine } from "./engine";

/**
 * Drift — the music layer.
 *
 * Fully synthesised, so the game still ships no audio files at all.
 *
 * The structure is hand-authored and only the *sequencing* is generative. Pure
 * procedural music wanders and stops meaning anything; a small table of real
 * progressions, picked between by where you are and what just happened, sounds
 * composed while never repeating a session.
 *
 * Three voices glide between chord tones rather than retriggering — at this
 * tempo a portamento between chords is most of the character — through a
 * feedback delay for space and a lowpass that closes as you speed up, so wind
 * and engine take the top end back when you're driving hard.
 */

export type Mood = "open" | "warm" | "cold" | "shore";

interface MoodSpec {
  /** Semitone offsets from the root, per chord. */
  progression: number[][];
  /** Scale degrees motifs may use. */
  motif: number[];
  root: number;
}

/**
 * Four moods, matched to country rather than to a mode name. Open fourths for
 * big dry country, thirds for forest, minor for the cold, suspensions at the
 * water where nothing quite resolves.
 */
const MOODS: Record<Mood, MoodSpec> = {
  open: {
    root: 110,
    progression: [
      [0, 7, 14],
      [2, 9, 16],
      [-3, 4, 11],
      [5, 12, 19],
    ],
    motif: [0, 2, 4, 7, 9, 12, 14],
  },
  warm: {
    root: 98,
    progression: [
      [0, 4, 7],
      [-3, 0, 4],
      [5, 9, 12],
      [2, 5, 9],
    ],
    motif: [0, 2, 4, 5, 7, 9, 11, 12],
  },
  cold: {
    root: 87,
    progression: [
      [0, 3, 7],
      [-2, 3, 5],
      [-4, 0, 3],
      [5, 8, 12],
    ],
    motif: [0, 2, 3, 5, 7, 8, 10, 12],
  },
  shore: {
    root: 104,
    progression: [
      [0, 5, 7],
      [2, 7, 9],
      [-3, 2, 4],
      [5, 10, 12],
    ],
    motif: [0, 2, 5, 7, 9, 12],
  },
};

const CHORD_SECONDS = 24;
/** Motifs stay rare on purpose — they mark a moment, they don't decorate one. */
const MOTIF_COOLDOWN = 50;

const semitone = (root: number, n: number) => root * Math.pow(2, n / 12);

export class Drift {
  private built = false;
  private voices: OscillatorNode[] = [];
  private pad!: GainNode;
  private tone!: BiquadFilterNode;
  private motifBus!: GainNode;

  private mood: Mood = "open";
  private chord = 0;
  private chordTimer = 0;
  private motifTimer = MOTIF_COOLDOWN * 0.4;
  private ducked = 0;

  constructor(private e: AudioEngine) {}

  build() {
    if (this.built || !this.e.ctx) return;
    this.built = true;
    const ctx = this.e.ctx;

    this.pad = this.e.gain(0);
    this.tone = this.e.filter("lowpass", 900, 0.6);

    // A long feedback delay does the work a reverb would, for four nodes.
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.42;
    const fb = this.e.gain(0.33); // feedback kept low so the pad can't build up
    const damp = this.e.filter("lowpass", 1800, 0.7);
    delay.connect(damp).connect(fb).connect(delay);

    this.tone.connect(this.pad);
    /**
     * The send into the delay is filtered, and this is the fix for the "low
     * loud click".
     *
     * The sub sits at root/2 — 43.5 Hz in the cold mood, the lowest of the
     * four, which is why it showed up where it did. Feeding that into a 0.42 s
     * delay at 33% feedback recirculates it every 0.42 s, and the result is a
     * periodic low pulse. It is not a sample-level discontinuity, which is why
     * a click detector finds nothing, but it reads as a repeated low clop and
     * it is fatiguing. Reverbs filter their sends for exactly this reason.
     *
     * Measured offline over 60 s: low-band amplitude pumping falls from 1.9x
     * to 1.3x in the cold mood, and the share of that pumping which lines up
     * with the delay period falls from 0.55 to 0.08.
     */
    this.tone.connect(this.e.filter("highpass", 300, 0.7)).connect(delay);
    delay.connect(this.pad);

    // Clears rumble below the lowest note anyone is playing. The sub's 43 Hz
    // fundamental survives; what goes is the inaudible weight under it that
    // only ate headroom and muddied everything above it.
    this.pad.connect(this.e.filter("highpass", 75, 0.7)).connect(this.e.ambientBus);

    this.motifBus = this.e.gain(1);
    this.motifBus.connect(this.tone);

    const spec = MOODS[this.mood];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.value = semitone(spec.root, spec.progression[0][i]);
      // A few cents apart so the pad breathes instead of beating.
      o.detune.value = (i - 1) * 4;
      o.connect(this.e.gain(i === 0 ? 0.5 : 0.3)).connect(this.tone);
      o.start();
      this.voices.push(o);
    }

    /**
     * The low root underneath, always present — but at 0.42 it was carrying
     * far too much of the mix.
     *
     * Three quarters of this music's energy sits below 120 Hz, measured. That
     * is inherent to voicing a pad of sines and weak triangles between 43 and
     * 260 Hz: opening the lowpass from 900 Hz to 3.4 kHz moved the low share
     * by nothing at all, because there are no upper harmonics up there to let
     * through. Fixing it properly would mean rewriting the music, which is the
     * part Clyde likes. Dropping the sub at least stops it being the loudest
     * thing in the mix.
     */
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = spec.root / 2;
    sub.connect(this.e.gain(0.25)).connect(this.tone);
    sub.start();
    this.voices.push(sub);
  }

  setMood(mood: Mood) {
    this.mood = mood;
  }

  /** Mark a moment: an arrival, a summit, first light. */
  motif() {
    if (!this.built || !this.e.ready || this.motifTimer > 0) return;
    this.motifTimer = MOTIF_COOLDOWN;

    const spec = MOODS[this.mood];
    const notes = 3 + Math.floor(Math.random() * 3);
    let degree = Math.floor(Math.random() * spec.motif.length);
    for (let i = 0; i < notes; i++) {
      // Step by one or two degrees, so it reads as a phrase not a scatter.
      degree = Math.max(0, Math.min(spec.motif.length - 1, degree + (Math.random() < 0.5 ? 1 : -1) * (1 + (Math.random() < 0.3 ? 1 : 0))));
      const f = semitone(spec.root * 4, spec.motif[degree]);
      this.e.tone({
        dest: this.motifBus,
        type: "triangle",
        from: f,
        level: 0.038,
        attack: 0.05,
        decay: 1.1 + Math.random() * 0.7,
        delay: i * (0.42 + Math.random() * 0.22),
      });
    }
  }

  /**
   * `speed` closes the lowpass, `duck` pulls the music down for camp, where
   * the fire should be carrying the scene instead.
   */
  update(dt: number, speed: number, duck: number) {
    if (!this.built || !this.e.ctx) return;
    const t = this.e.now;

    this.motifTimer = Math.max(0, this.motifTimer - dt);
    this.chordTimer -= dt;
    if (this.chordTimer <= 0) {
      this.chordTimer = CHORD_SECONDS * (0.8 + Math.random() * 0.4);
      this.nextChord();
    }

    this.ducked += (duck - this.ducked) * Math.min(1, dt * 1.5);
    const level = 0.038 * (1 - this.ducked * 0.82);
    this.pad.gain.setTargetAtTime(level, t, 1.4);
    // Driving hard takes the top off and lets wind and engine through.
    this.tone.frequency.setTargetAtTime(1150 - Math.min(speed / 48, 1) * 520, t, 1.2);
  }

  private nextChord() {
    const spec = MOODS[this.mood];
    this.chord = (this.chord + 1) % spec.progression.length;
    const tones = spec.progression[this.chord];
    const t = this.e.now;
    for (let i = 0; i < 3; i++) {
      // The glide between chords is most of the character at this tempo.
      this.voices[i].frequency.setTargetAtTime(semitone(spec.root, tones[i]), t, 2.6);
    }
    this.voices[3]?.frequency.setTargetAtTime(spec.root / 2, t, 2.6);
  }
}

/** Country decides the mood. */
export function moodFor(biome: string): Mood {
  if (biome === "Open Water" || biome === "Shoreline") return "shore";
  if (biome === "Cold Tundra" || biome === "Snowfield" || biome === "Scree Slope") return "cold";
  if (biome === "Pine Forest" || biome === "Highland Meadow") return "warm";
  return "open";
}
