// Desktop audio: shared synth SFX plus a fully procedural synthwave loop
// (Am–F–C–G, pumping bass, pad, arp, hats) — zero audio assets to license.

import { createSfx, type Sfx } from '../shared/sfx';

const BPM = 100;
const STEP = 60 / BPM / 4; // 16th note, seconds
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const BASS_ROOTS = [33, 29, 24, 31]; // A1 F1 C1 G1

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class ScreenAudio {
  sfx: Sfx | null = null;
  musicOn = true;
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private step = 0;
  private nextStepTime = 0;

  /** Must be called from (or after) a user gesture; safe to call repeatedly. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.sfx = createSfx(this.ctx, 0.8);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    window.setInterval(() => this.pump(), 25);
  }

  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    this.musicGain?.gain.setTargetAtTime(this.musicOn ? 0.16 : 0, this.ctx!.currentTime, 0.1);
    return this.musicOn;
  }

  // ------------------------------------------------------------- sequencer

  private pump() {
    if (!this.ctx) return;
    while (this.nextStepTime < this.ctx.currentTime + 0.15) {
      if (this.musicOn) this.scheduleStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % 64; // 4 bars of 16 steps
      this.nextStepTime += STEP;
    }
  }

  private tone(
    t: number,
    freq: number,
    type: OscillatorType,
    dur: number,
    peak: number,
    filterHz?: number,
    attack = 0.01,
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head: AudioNode = osc;
    if (filterHz) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = filterHz;
      head.connect(lp);
      head = lp;
    }
    head.connect(g);
    g.connect(this.musicGain!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private scheduleStep(step: number, t: number) {
    const ctx = this.ctx!;
    const bar = Math.floor(step / 16);
    const s16 = step % 16;
    const chord = CHORDS[bar];

    // Kick on every beat.
    if (s16 % 4 === 0) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(g).connect(this.musicGain!);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    // Hats on the off-8ths.
    if (s16 % 4 === 2 && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 8000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      src.connect(hp).connect(g).connect(this.musicGain!);
      src.start(t);
      src.stop(t + 0.06);
    }
    // Driving 8th-note bass, octave up on the and-of-2.
    if (s16 % 2 === 0) {
      const up = s16 % 8 === 6 ? 12 : 0;
      this.tone(t, midiHz(BASS_ROOTS[bar] + up), 'sawtooth', STEP * 1.8, 0.5, 500);
    }
    // Pad: chord held at the top of each bar.
    if (s16 === 0) {
      for (const m of chord) {
        this.tone(t, midiHz(m) * 0.999, 'sawtooth', STEP * 15, 0.06, 1100, 0.4);
        this.tone(t, midiHz(m) * 1.004, 'sawtooth', STEP * 15, 0.06, 1100, 0.4);
      }
    }
    // Sparkly 16th arp riding the chord.
    const arpNote = chord[[0, 1, 2, 1][s16 % 4]] + 24;
    this.tone(t, midiHz(arpNote), 'square', STEP * 0.9, 0.045, 3200, 0.005);
  }
}
