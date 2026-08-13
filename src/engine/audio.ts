// ---------------------------------------------------------------------------
// Procedural audio — zero asset files, same approach as Spell Storm's
// audio/procedural.ts. A tiny synth layer plus a step-sequenced dungeon loop.
//
// Everything is created lazily on the first user gesture (browser autoplay
// policy). Every public function is safe to call before init.
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;
let muted = false;

export function initAudio(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.34;
  musicGain.connect(master);
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}
export function isMuted(): boolean {
  return muted;
}

function now(): number {
  return ctx ? ctx.currentTime : 0;
}

interface ToneOpts {
  freq: number;
  freqEnd?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  when?: number;
  dest?: AudioNode;
}

function tone(o: ToneOpts): void {
  if (!ctx || !master) return;
  const t0 = o.when ?? now();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? "square";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + o.dur);
  const peak = o.gain ?? 0.2;
  const atk = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(o.dest ?? master);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
}

function noise(dur: number, gain: number, filterFreq: number, filterEnd?: number, when?: number): void {
  if (!ctx || !master) return;
  const t0 = when ?? now();
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFreq, t0);
  if (filterEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(20, filterEnd), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

// ------------------------------- SFX ----------------------------------------

export const sfx = {
  swing(): void {
    noise(0.14, 0.24, 2400, 500);
  },
  hitEnemy(): void {
    tone({ freq: 220, freqEnd: 90, dur: 0.1, type: "square", gain: 0.25 });
    noise(0.08, 0.2, 900, 300);
  },
  hitBlocked(): void {
    tone({ freq: 700, freqEnd: 500, dur: 0.07, type: "triangle", gain: 0.2 });
  },
  playerHurt(): void {
    tone({ freq: 160, freqEnd: 70, dur: 0.28, type: "sawtooth", gain: 0.28 });
  },
  enemyDie(): void {
    tone({ freq: 500, freqEnd: 60, dur: 0.4, type: "square", gain: 0.2 });
    noise(0.3, 0.16, 700, 120);
  },
  roll(): void {
    noise(0.18, 0.14, 600, 220);
  },
  coin(): void {
    tone({ freq: 987, dur: 0.07, type: "square", gain: 0.16 });
    tone({ freq: 1318, dur: 0.22, type: "square", gain: 0.16, when: now() + 0.07 });
  },
  heart(): void {
    tone({ freq: 660, dur: 0.09, type: "triangle", gain: 0.2 });
    tone({ freq: 880, dur: 0.09, type: "triangle", gain: 0.2, when: now() + 0.09 });
    tone({ freq: 1108, dur: 0.2, type: "triangle", gain: 0.2, when: now() + 0.18 });
  },
  key(): void {
    const t = now();
    [1244, 1567, 2093].forEach((f, i) =>
      tone({ freq: f, dur: 0.14, type: "square", gain: 0.15, when: t + i * 0.11 }),
    );
  },
  chest(): void {
    const t = now();
    [523, 659, 783, 1046].forEach((f, i) =>
      tone({ freq: f, dur: 0.16, type: "triangle", gain: 0.2, when: t + i * 0.12 }),
    );
  },
  gateClose(): void {
    tone({ freq: 130, freqEnd: 60, dur: 0.35, type: "sawtooth", gain: 0.24 });
    noise(0.3, 0.2, 300, 90);
  },
  gateOpen(): void {
    tone({ freq: 80, freqEnd: 220, dur: 0.4, type: "sawtooth", gain: 0.2 });
    noise(0.35, 0.14, 200, 700);
  },
  doorUnlock(): void {
    const t = now();
    tone({ freq: 392, dur: 0.1, type: "square", gain: 0.2, when: t });
    tone({ freq: 523, dur: 0.1, type: "square", gain: 0.2, when: t + 0.1 });
    tone({ freq: 784, dur: 0.3, type: "square", gain: 0.2, when: t + 0.2 });
  },
  barrelBreak(): void {
    noise(0.16, 0.26, 500, 150);
    tone({ freq: 180, freqEnd: 90, dur: 0.12, type: "triangle", gain: 0.18 });
  },
  spikes(): void {
    noise(0.08, 0.12, 3000, 1200);
  },
  bossRoar(): void {
    tone({ freq: 90, freqEnd: 45, dur: 0.8, type: "sawtooth", gain: 0.32 });
    noise(0.7, 0.2, 250, 80);
  },
  bolt(): void {
    tone({ freq: 1200, freqEnd: 400, dur: 0.18, type: "sawtooth", gain: 0.14 });
  },
  awaken(): void {
    noise(0.5, 0.16, 400, 900);
    tone({ freq: 100, freqEnd: 180, dur: 0.5, type: "triangle", gain: 0.12 });
  },
  victory(): void {
    const t = now();
    const seq: [number, number][] = [
      [523, 0], [523, 0.12], [523, 0.24], [523, 0.36],
      [415, 0.6], [466, 0.84], [523, 1.08], [466, 1.32], [523, 1.56],
    ];
    for (const [f, dt] of seq) {
      tone({ freq: f, dur: dt === 1.56 ? 0.7 : 0.18, type: "square", gain: 0.2, when: t + dt });
      tone({ freq: f / 2, dur: dt === 1.56 ? 0.7 : 0.18, type: "triangle", gain: 0.14, when: t + dt });
    }
  },
  gameOver(): void {
    const t = now();
    [392, 369, 349, 329].forEach((f, i) =>
      tone({ freq: f, dur: 0.4, type: "triangle", gain: 0.2, when: t + i * 0.35 }),
    );
  },
};

// ------------------------------ music ---------------------------------------
//
// A brooding little dungeon loop: minor bass ostinato + sparse arpeggio +
// noise-hat pulse. Scheduled bar by bar with lookahead.

const BPM = 92;
const STEP = 60 / BPM / 2; // eighth notes
// A minor-ish: A2 root walk + harmonic color
const BASS = [110, 110, 0, 110, 98, 0, 110, 0, 87.3, 87.3, 0, 87.3, 103.8, 0, 98, 0];
const ARP = [440, 0, 523, 0, 659, 0, 523, 0, 415, 0, 523, 0, 622, 0, 523, 0];

let step = 0;
let nextStepTime = 0;

function scheduleMusic(): void {
  if (!ctx || !musicGain) return;
  const ahead = 0.15;
  while (nextStepTime < ctx.currentTime + ahead) {
    const i = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const b = BASS[i];
    if (b) tone({ freq: b, dur: STEP * 0.9, type: "triangle", gain: 0.22, when: nextStepTime, dest: musicGain });
    // arpeggio enters on bars 2-4 to keep the loop breathing
    const a = ARP[i];
    if (a && bar > 0) {
      tone({ freq: a, dur: STEP * 0.6, type: "square", gain: 0.05, when: nextStepTime, dest: musicGain });
    }
    if (i % 4 === 2) noise(0.03, 0.05, 6000, undefined, nextStepTime);
    nextStepTime += STEP;
    step++;
  }
}

export function startMusic(): void {
  if (!ctx || musicTimer !== null) return;
  step = 0;
  nextStepTime = ctx.currentTime + 0.1;
  musicTimer = window.setInterval(scheduleMusic, 50);
}

export function stopMusic(): void {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}
