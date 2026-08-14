// ---------------------------------------------------------------------------
// Procedural audio — zero asset files, same approach as Spell Storm's
// audio/procedural.ts. A tiny synth layer plus step-sequenced music tracks,
// ONE PER CONTEXT so every screen and biome gets its own vibe:
//
//   - title      : title screen — slow, hopeful, sparse
//   - village    : peaceful pastoral loop, folk harmony, soft
//   - forest     : mysterious woods, minor mode with pentatonic flute
//   - dungeon    : brooding dungeon crawl — the original v3 loop, retuned
//   - boss       : intense driving loop for the throne room
//   - victory    : triumphant fanfare (short, non-looping)
//   - gameover   : sad descending loop
//
// The scheduler runs one active track at a time. Cross-fades are handled by
// ramping musicGain on switch — the new track starts on the next bar so a
// beat pulse doesn't drop mid-note.
//
// Everything is created lazily on the first user gesture (browser autoplay
// policy). Every public function is safe to call before init.
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;
let muted = false;

/** Music context/mood keys. */
export type MusicTrack =
  | "title"
  | "village"
  | "forest"
  | "dungeon"
  | "boss"
  | "victory"
  | "gameover";

// Currently active track, and the one queued for switch-on-next-bar.
let currentTrack: MusicTrack | null = null;
let pendingTrack: MusicTrack | null = null;

// ---------------------------------------------------------------------------
// v6: streamed music files (optional). If a file is registered for a track,
// playMusic() uses the file with a smooth crossfade instead of the procedural
// scheduler. Missing files fall back to procedural — you can migrate one
// track at a time, drop `assets/music/village.mp3` and the village theme
// automatically becomes the streamed version while dungeon stays procedural.
//
// Files go in `assets/music/` with the track name as filename. Loading is
// lazy on first playMusic() — nothing loads if the user never opens the game.
// ---------------------------------------------------------------------------
interface MusicFile {
  /** URL relative to the site root. If missing, procedural is used. */
  url: string;
  /** Playback volume 0..1 (per-track normalisation — some Suno exports are hot). */
  gain: number;
  /** Loop the file (false only for victory/gameover, which are one-shots). */
  loop: boolean;
  /** Populated lazily by loadMusicFile(). */
  element?: HTMLAudioElement;
  /** Web Audio node for crossfading; created together with element. */
  source?: MediaElementAudioSourceNode;
  /** Gain node so we can crossfade independent of `musicGain` master. */
  trackGain?: GainNode;
}

const MUSIC_FILES: Partial<Record<MusicTrack, MusicFile>> = {
  title:    { url: "assets/music/title.mp3",    gain: 0.9, loop: true  },
  village:  { url: "assets/music/village.mp3",  gain: 0.9, loop: true  },
  forest:   { url: "assets/music/forest.mp3",   gain: 0.9, loop: true  },
  dungeon:  { url: "assets/music/dungeon.mp3",  gain: 0.9, loop: true  },
  boss:     { url: "assets/music/boss.mp3",     gain: 1.0, loop: true  },
  victory:  { url: "assets/music/victory.mp3",  gain: 1.0, loop: false },
  gameover: { url: "assets/music/gameover.mp3", gain: 0.9, loop: false },
};

/** Which track (if any) is currently playing from a streamed file. */
let activeFileTrack: MusicTrack | null = null;
/** File-load attempts we've already made (success or fail) — no retry storms. */
const fileTried = new Set<MusicTrack>();

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

function noise(dur: number, gain: number, filterFreq: number, filterEnd?: number, when?: number, dest?: AudioNode): void {
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
  src.connect(filter).connect(g).connect(dest ?? master);
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
  npcTalk(): void {
    tone({ freq: 520, dur: 0.05, type: "square", gain: 0.09 });
    tone({ freq: 660, dur: 0.05, type: "square", gain: 0.09, when: now() + 0.05 });
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

// ============================================================================
// MUSIC
//
// A tiny bar-scheduled step sequencer with lookahead. Every track defines an
// array of 16 eighth-notes for BASS + MELODY + optional HAT/COLOR. The active
// track is picked by playMusic(track). Bar boundary is a natural place to
// switch tracks so the change lands musically.
// ============================================================================

interface Track {
  bpm: number;          // beats per minute
  bassGain: number;     // base gain multipliers per voice
  melodyGain: number;
  colorGain: number;
  bass: number[];       // 16 steps (0 = rest, Hz otherwise)
  melody: number[];     // 16 steps
  /** Called once per step by scheduler. `bar` = bar index (0..3), `i` = step (0..15). */
  color?(bar: number, i: number, t: number): void;
}

// ---- Village: pastoral, gentle, C major, folk feel ----
// Steady root+fifth bass, sparse plucky melody on triangle, no hat.
const VILLAGE: Track = {
  bpm: 78,
  bassGain: 0.14,
  melodyGain: 0.09,
  colorGain: 0.05,
  //         0    1    2    3    4    5    6    7    8    9    10   11   12   13   14   15
  bass:    [130.8, 0,   0,   0,   196, 0,   0,   0,   164.8, 0, 0,   0,   146.8, 0, 0,   0],
  melody:  [523,  0,   659, 0,   784, 0,   659, 0,   523,  0,  587, 0,   659,  0, 587, 523],
  color: (bar, i, t) => {
    // A soft "bell" chime every 8 bars on the downbeat
    if (bar === 3 && i === 0) {
      tone({ freq: 1046, dur: 1.2, type: "triangle", gain: 0.05, when: t, dest: musicGain ?? undefined });
      tone({ freq: 1319, dur: 1.2, type: "triangle", gain: 0.035, when: t, dest: musicGain ?? undefined });
    }
  },
};

// ---- Forest: mysterious minor with pentatonic flute-like melody ----
const FOREST: Track = {
  bpm: 70,
  bassGain: 0.13,
  melodyGain: 0.08,
  colorGain: 0.04,
  //        E2 low ostinato
  bass:    [82.4, 0, 0, 0, 82.4, 0, 110, 0, 82.4, 0, 0, 0, 98, 0, 0, 0],
  //        A minor pentatonic: A C D E G
  melody:  [0, 0, 440, 0, 0, 523, 0, 587, 0, 0, 659, 0, 523, 0, 440, 0],
  color: (bar, i, t) => {
    // "wind" — quiet high noise every 4 bars, on step 8
    if (i === 8 && bar % 2 === 0) {
      noise(0.5, 0.03, 4000, 800, t, musicGain ?? undefined);
    }
    // low "hoot" (owl) on bar 3, step 12
    if (bar === 2 && i === 12) {
      tone({ freq: 220, freqEnd: 174.6, dur: 0.6, type: "sine", gain: 0.06, when: t, dest: musicGain ?? undefined });
    }
  },
};

// ---- Dungeon: the original v3 loop, brooding ----
const DUNGEON: Track = {
  bpm: 92,
  bassGain: 0.22,
  melodyGain: 0.05,
  colorGain: 0.05,
  bass:    [110, 110, 0, 110, 98, 0, 110, 0, 87.3, 87.3, 0, 87.3, 103.8, 0, 98, 0],
  melody:  [440, 0, 523, 0, 659, 0, 523, 0, 415, 0, 523, 0, 622, 0, 523, 0],
  color: (_bar, i, t) => {
    // noise-hat pulse — quiet high tick on off-beats
    if (i % 4 === 2) noise(0.03, 0.05, 6000, undefined, t, musicGain ?? undefined);
  },
};

// ---- Boss: fast driving loop, low & aggressive ----
const BOSS: Track = {
  bpm: 128,
  bassGain: 0.26,
  melodyGain: 0.09,
  colorGain: 0.06,
  //        Aggressive syncopated D minor bass line
  bass:    [73.4, 73.4, 110, 73.4, 87.3, 73.4, 110, 73.4, 73.4, 73.4, 98, 73.4, 87.3, 73.4, 110, 73.4],
  //        High siren-ish melody in D minor (D F A) crescendos across bars
  melody:  [587, 0, 698, 0, 880, 0, 698, 0, 587, 0, 784, 0, 880, 0, 1046, 880],
  color: (bar, i, t) => {
    // heavy kick every downbeat (steps 0, 4, 8, 12)
    if (i % 4 === 0) {
      tone({ freq: 90, freqEnd: 40, dur: 0.12, type: "sine", gain: 0.16, when: t, dest: musicGain ?? undefined });
    }
    // war drums (noise burst) on 2 and 4
    if (i === 4 || i === 12) {
      noise(0.08, 0.08, 900, 200, t, musicGain ?? undefined);
    }
    // scream/wail every 4 bars — a rising sawtooth
    if (bar === 3 && i === 0) {
      tone({ freq: 220, freqEnd: 440, dur: 0.9, type: "sawtooth", gain: 0.06, when: t, dest: musicGain ?? undefined });
    }
  },
};

// ---- Title: hopeful major, sparse, long notes ----
const TITLE: Track = {
  bpm: 60,
  bassGain: 0.12,
  melodyGain: 0.09,
  colorGain: 0.05,
  bass:    [110, 0, 0, 0, 0, 0, 0, 0, 146.8, 0, 0, 0, 0, 0, 0, 0],
  melody:  [659, 0, 0, 0, 784, 0, 0, 0, 880, 0, 0, 0, 784, 0, 659, 0],
  color: (bar, i, t) => {
    // dreamy pad triad on every downbeat
    if (i === 0) {
      tone({ freq: 261.6, dur: 3.0, type: "sine", gain: 0.03, when: t, dest: musicGain ?? undefined });
      tone({ freq: 329.6, dur: 3.0, type: "sine", gain: 0.025, when: t, dest: musicGain ?? undefined });
      tone({ freq: 392, dur: 3.0, type: "sine", gain: 0.02, when: t, dest: musicGain ?? undefined });
    }
    // sparkle every 4 bars
    if (bar === 3 && i === 8) {
      const chord = [1046, 1319, 1568];
      chord.forEach((f, k) => tone({ freq: f, dur: 0.4, type: "triangle", gain: 0.04, when: t + k * 0.08, dest: musicGain ?? undefined }));
    }
  },
};

// ---- Victory: triumphant, one-shot-style (loops but feels celebratory) ----
const VICTORY: Track = {
  bpm: 108,
  bassGain: 0.16,
  melodyGain: 0.14,
  colorGain: 0.08,
  //        C major fanfare: C - G - F - C
  bass:    [130.8, 0, 130.8, 0, 196, 0, 196, 0, 174.6, 0, 174.6, 0, 130.8, 0, 130.8, 0],
  melody:  [523, 659, 784, 1046, 784, 659, 523, 659, 698, 880, 1046, 880, 784, 659, 523, 0],
  color: (_bar, i, t) => {
    // bright horn stab on downbeats
    if (i % 4 === 0) {
      tone({ freq: 261.6, dur: 0.2, type: "square", gain: 0.08, when: t, dest: musicGain ?? undefined });
      tone({ freq: 329.6, dur: 0.2, type: "square", gain: 0.06, when: t, dest: musicGain ?? undefined });
    }
  },
};

// ---- Game over: descending minor, slow and mournful ----
const GAMEOVER: Track = {
  bpm: 54,
  bassGain: 0.14,
  melodyGain: 0.1,
  colorGain: 0.03,
  bass:    [110, 0, 0, 0, 98, 0, 0, 0, 87.3, 0, 0, 0, 82.4, 0, 0, 0],
  melody:  [440, 0, 0, 0, 415, 0, 0, 0, 392, 0, 0, 0, 349, 0, 0, 0],
  color: (bar, i, t) => {
    // low tolling bell every 2 bars
    if (bar % 2 === 0 && i === 0) {
      tone({ freq: 220, dur: 2.5, type: "sine", gain: 0.05, when: t, dest: musicGain ?? undefined });
    }
  },
};

const TRACKS: Record<MusicTrack, Track> = {
  title: TITLE,
  village: VILLAGE,
  forest: FOREST,
  dungeon: DUNGEON,
  boss: BOSS,
  victory: VICTORY,
  gameover: GAMEOVER,
};

// ---- Scheduler ----
let step = 0;
let nextStepTime = 0;

function scheduleMusic(): void {
  if (!ctx || !musicGain) return;
  if (!currentTrack && !pendingTrack) return;
  const active = TRACKS[currentTrack ?? pendingTrack!];
  const stepDur = 60 / active.bpm / 2;
  const ahead = 0.18;
  while (nextStepTime < ctx.currentTime + ahead) {
    // Switch tracks on the bar boundary (every 16 steps) so we don't drop
    // notes mid-phrase when the biome changes.
    if (pendingTrack && step % 16 === 0) {
      currentTrack = pendingTrack;
      pendingTrack = null;
    }
    const tr = TRACKS[currentTrack ?? "village"];
    const i = step % 16;
    const bar = Math.floor(step / 16) % 4;

    const b = tr.bass[i];
    if (b) {
      tone({
        freq: b,
        dur: stepDur * 0.9,
        type: "triangle",
        gain: tr.bassGain,
        when: nextStepTime,
        dest: musicGain,
      });
    }
    const m = tr.melody[i];
    if (m) {
      // melody comes in after the first bar to let the ear anchor to bass
      const g = bar === 0 ? tr.melodyGain * 0.5 : tr.melodyGain;
      tone({
        freq: m,
        dur: stepDur * 0.6,
        type: "square",
        gain: g,
        when: nextStepTime,
        dest: musicGain,
      });
    }
    tr.color?.(bar, i, nextStepTime);

    nextStepTime += stepDur;
    step++;
  }
}

/** Start scheduling loop (idempotent — safe to call multiple times). */
function ensureSchedulerRunning(): void {
  if (!ctx) return;
  if (musicTimer !== null) return;
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  musicTimer = window.setInterval(scheduleMusic, 40);
}

/**
 * Try to load a streamed music file for a given track. Idempotent — safe
 * to call many times, only fetches once. Silently gives up on error and
 * leaves the track on procedural. Called lazily on first playMusic(track).
 */
async function tryLoadMusicFile(track: MusicTrack): Promise<HTMLAudioElement | null> {
  if (!ctx || !musicGain) return null;
  const spec = MUSIC_FILES[track];
  if (!spec) return null;
  if (spec.element) return spec.element;
  if (fileTried.has(track)) return null;
  fileTried.add(track);

  // HEAD-check the URL so we don't create an <audio> element for a 404 —
  // that would spam the console and log a spurious playback error.
  try {
    const head = await fetch(spec.url, { method: "HEAD" });
    if (!head.ok) return null;
  } catch {
    return null;
  }

  const el = document.createElement("audio");
  el.src = spec.url;
  el.loop = spec.loop;
  el.crossOrigin = "anonymous";
  el.preload = "auto";
  // Add to DOM (some browsers won't decode until it is)
  el.style.display = "none";
  document.body.appendChild(el);
  spec.element = el;

  const src = ctx.createMediaElementSource(el);
  const g = ctx.createGain();
  g.gain.value = 0; // silent until this track becomes active
  src.connect(g).connect(musicGain);
  spec.source = src;
  spec.trackGain = g;

  return el;
}

/** Stop the currently active streamed file with a fade-out. */
function fadeOutActiveFile(fadeSeconds = 0.5): void {
  if (!ctx || activeFileTrack === null) return;
  const spec = MUSIC_FILES[activeFileTrack];
  const g = spec?.trackGain;
  if (g) {
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fadeSeconds);
  }
  // Actually pause after the fade — a still-playing but silent element
  // wastes CPU.
  const el = spec?.element;
  if (el) window.setTimeout(() => el.pause(), fadeSeconds * 1000 + 50);
  activeFileTrack = null;
}

/** Fade IN a streamed file for `track`, resuming it if it was paused. */
function fadeInFile(track: MusicTrack, fadeSeconds = 0.5): void {
  if (!ctx) return;
  const spec = MUSIC_FILES[track];
  if (!spec?.element || !spec.trackGain) return;
  const t = ctx.currentTime;
  spec.trackGain.gain.cancelScheduledValues(t);
  spec.trackGain.gain.setValueAtTime(spec.trackGain.gain.value, t);
  spec.trackGain.gain.linearRampToValueAtTime(spec.gain, t + fadeSeconds);
  spec.element.currentTime = spec.element.currentTime; // touch to prevent glitch on some browsers
  const p = spec.element.play();
  if (p && typeof p.catch === "function") p.catch(() => {/* ignore autoplay reject */});
  activeFileTrack = track;
}

/** Stop the procedural scheduler + fade musicGain to zero for the switch. */
function stopProcedural(): void {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  currentTrack = null;
  pendingTrack = null;
}

/**
 * Switch to (or start) a given music track. If a track is already playing,
 * the switch happens at the next bar boundary so notes don't glitch.
 * If nothing is playing yet, the new track kicks in immediately.
 *
 * v6: if `assets/music/<track>.mp3` exists, uses the streamed file with
 * crossfade. Otherwise falls back to the procedural scheduler. This lets
 * you migrate tracks one at a time — drop `village.mp3` and only that
 * track becomes streamed while the rest stay procedural.
 */
export function playMusic(track: MusicTrack): void {
  if (!ctx || !musicGain) return;

  // Try the streamed-file path first. If the file loads OK, use it and
  // stop procedural. If not, fall through to the procedural scheduler.
  void tryLoadMusicFile(track).then((el) => {
    if (!el) {
      // No file for this track: use procedural path (below, non-async).
      return;
    }
    // File is available. Crossfade from whatever is playing to this file.
    if (activeFileTrack === track) return; // already playing
    fadeOutActiveFile(0.5);
    stopProcedural();
    if (musicGain && ctx) {
      // Master music channel back to full — procedural may have faded it out.
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(0.34, ctx.currentTime);
    }
    fadeInFile(track, 0.5);
  });

  // Procedural path — runs immediately (no file wait). If the file loads
  // later, the .then() above will crossfade over. This keeps the audio
  // starting instantly on first user gesture instead of waiting for fetch.
  if (activeFileTrack !== null) return; // file already handling audio
  ensureSchedulerRunning();
  if (currentTrack === null) {
    // First play: gently fade in and start at step 0.
    currentTrack = track;
    pendingTrack = null;
    step = 0;
    nextStepTime = ctx.currentTime + 0.1;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(0.34, ctx.currentTime + 0.6);
    return;
  }
  if (currentTrack === track) return;
  // Queue for the next bar boundary.
  pendingTrack = track;
}

/** Legacy alias — kept for existing callers that used the v3 API. */
export function startMusic(): void {
  playMusic("dungeon");
}

/** Stop scheduling and fade the music out. */
export function stopMusic(): void {
  fadeOutActiveFile(0.4);
  if (musicGain && ctx) {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
  }
  stopProcedural();
}
