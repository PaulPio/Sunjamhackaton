// Synthesized combat SFX — no audio assets, no licensing. Shared by the
// desktop arena and the phone controllers (phones use a quieter mix).

export interface Sfx {
  ctx: AudioContext;
  master: GainNode;
  whoosh(intensity?: number): void;
  clash(): void;
  hit(): void;
  parry(): void;
  countBeep(final?: boolean): void;
  setVolume(v: number): void;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 1;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function createSfx(ctx: AudioContext, volume = 0.8): Sfx {
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  const noiseBuf = makeNoiseBuffer(ctx);

  function noise(): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    return src;
  }

  function env(node: AudioNode, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(master);
    return g;
  }

  return {
    ctx,
    master,
    setVolume(v: number) {
      master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    },

    // Air being cut: band-passed noise with a fast downward frequency sweep.
    whoosh(intensity = 0.7) {
      const t = ctx.currentTime;
      const src = noise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400 + 2200 * intensity, t);
      bp.frequency.exponentialRampToValueAtTime(220, t + 0.22);
      src.connect(bp);
      env(bp, 0.35 + 0.3 * intensity, 0.02, 0.22);
      src.start(t);
      src.stop(t + 0.3);
    },

    // Blade on blade: inharmonic metallic partials + a noise snap.
    clash() {
      const t = ctx.currentTime;
      for (const [freq, amp] of [
        [2731, 0.22],
        [3390, 0.16],
        [4177, 0.1],
        [1517, 0.12],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq * (0.98 + Math.random() * 0.04);
        env(osc, amp, 0.004, 0.28 + Math.random() * 0.1);
        osc.start(t);
        osc.stop(t + 0.45);
      }
      const snap = noise();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      snap.connect(hp);
      env(hp, 0.5, 0.002, 0.06);
      snap.start(t);
      snap.stop(t + 0.1);
    },

    // Body hit: low sine thump + mid noise crunch.
    hit() {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      env(osc, 0.9, 0.005, 0.2);
      osc.start(t);
      osc.stop(t + 0.25);
      const crunch = noise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      crunch.connect(bp);
      env(bp, 0.4, 0.003, 0.12);
      crunch.start(t);
      crunch.stop(t + 0.16);
    },

    // Perfect block: bright rising ping.
    parry() {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
      env(osc, 0.5, 0.005, 0.3);
      osc.start(t);
      osc.stop(t + 0.4);
    },

    countBeep(final = false) {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = final ? 880 : 440;
      env(osc, 0.25, 0.005, final ? 0.35 : 0.12);
      osc.start(t);
      osc.stop(t + 0.5);
    },
  };
}
