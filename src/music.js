/**
 * Procedural electro music — 4-bar loop at 122 BPM, synthesized via Web Audio.
 * Chord progression: Am → F → G → Em (one chord per bar).
 *
 * Schedules ahead in 4-bar blocks. `maintainMusic()` is called every frame
 * from main.js and tops up the schedule before the next block boundary.
 *
 * Lives on its own master gain so the rhythmic clacks in audio.js still cut
 * through the mix.
 */

import { getAudioContext } from "./audio.js";

const EPS = 0.0005;

const BPM = 122;
const STEP = 60 / BPM / 4;          // 16th note (≈ 0.123s)
const BARS_PER_BLOCK = 4;
const STEPS_PER_BAR = 16;
const STEPS_PER_BLOCK = BARS_PER_BLOCK * STEPS_PER_BAR; // 64
const BLOCK_DURATION = STEPS_PER_BLOCK * STEP;          // ≈ 7.87s

let musicMaster = null;
let mNoise = null;        // pre-rolled noise buffer for hats/claps
let nextBlockAt = 0;
let blockCounter = 0;
let lpFilter = null;      // global filter for the "drop / sweep" sidechain feel
let sweepLfo = null;

// Chord progression (one per bar). Am - F - G - Em
const BASS_NOTES = [55.00, 43.65, 49.00, 41.20];   // A1, F1, G1, E1
const LEAD_CHORDS = [
  [440.00, 523.25, 659.25, 880.00],   // Am: A4 C5 E5 A5
  [349.23, 440.00, 523.25, 698.46],   // F : F4 A4 C5 F5
  [392.00, 493.88, 587.33, 783.99],   // G : G4 B4 D5 G5
  [329.63, 392.00, 493.88, 659.25],   // Em: E4 G4 B4 E5
];

// --------------------------------------------------------------------
// setup
// --------------------------------------------------------------------
function ensureSetup() {
  if (musicMaster) return true;
  const ctx = getAudioContext();
  if (!ctx) return false;

  // Global music bus → soft low-pass that we'll modulate for a sweep feel.
  lpFilter = ctx.createBiquadFilter();
  lpFilter.type = "lowpass";
  lpFilter.frequency.value = 6000;
  lpFilter.Q.value = 0.6;

  musicMaster = ctx.createGain();
  musicMaster.gain.value = 0.0;
  // Fade in to avoid a click on the first note
  musicMaster.gain.setValueAtTime(0.0, ctx.currentTime);
  musicMaster.gain.linearRampToValueAtTime(0.38, ctx.currentTime + 1.2);

  musicMaster.connect(lpFilter).connect(ctx.destination);

  // Slow LFO sweeps the filter open/closed over ~16s → adds movement.
  sweepLfo = ctx.createOscillator();
  sweepLfo.frequency.value = 1 / 16;
  const sweepGain = ctx.createGain();
  sweepGain.gain.value = 1800;
  sweepLfo.connect(sweepGain).connect(lpFilter.frequency);
  sweepLfo.start();

  // ~1.5 seconds of stereo noise — reused for hats and claps.
  const len = Math.floor(ctx.sampleRate * 1.5);
  mNoise = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = mNoise.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return true;
}

// --------------------------------------------------------------------
// synth voices
// --------------------------------------------------------------------
function kick(when) {
  const ctx = getAudioContext();
  if (!ctx || !Number.isFinite(when)) return;

  // Pitched body — fast sweep 160 → 42 Hz
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(160, when);
  o.frequency.exponentialRampToValueAtTime(42, when + 0.12);

  const env = ctx.createGain();
  env.gain.setValueAtTime(EPS, when);
  env.gain.exponentialRampToValueAtTime(0.95, when + 0.003);
  env.gain.exponentialRampToValueAtTime(EPS, when + 0.28);

  o.connect(env).connect(musicMaster);
  o.start(when);
  o.stop(when + 0.32);

  // Click transient
  const c = ctx.createOscillator();
  c.type = "triangle";
  c.frequency.value = 1700;
  const cEnv = ctx.createGain();
  cEnv.gain.setValueAtTime(0.45, when);
  cEnv.gain.exponentialRampToValueAtTime(EPS, when + 0.008);
  c.connect(cEnv).connect(musicMaster);
  c.start(when);
  c.stop(when + 0.012);
}

function hat(when, gain = 0.14) {
  const ctx = getAudioContext();
  if (!ctx || !Number.isFinite(when)) return;

  const src = ctx.createBufferSource();
  src.buffer = mNoise;
  // Random buffer offset so hats don't all sound identical
  src.playbackRate.value = 1.4 + Math.random() * 0.4;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7500;

  const env = ctx.createGain();
  env.gain.setValueAtTime(EPS, when);
  env.gain.exponentialRampToValueAtTime(Math.max(EPS, gain), when + 0.001);
  env.gain.exponentialRampToValueAtTime(EPS, when + 0.045);

  src.connect(hp).connect(env).connect(musicMaster);
  src.start(when);
  src.stop(when + 0.06);
}

function clap(when, gain = 0.28) {
  const ctx = getAudioContext();
  if (!ctx || !Number.isFinite(when)) return;

  // 3 staggered noise bursts → that classic 909-ish clappy texture
  for (let i = 0; i < 3; i++) {
    const t = when + i * 0.012;
    const src = ctx.createBufferSource();
    src.buffer = mNoise;
    src.playbackRate.value = 1.0;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700 + Math.random() * 200;
    bp.Q.value = 1.2;

    const g = i === 2 ? gain : gain * 0.55;
    const env = ctx.createGain();
    env.gain.setValueAtTime(EPS, t);
    env.gain.exponentialRampToValueAtTime(Math.max(EPS, g), t + 0.002);
    env.gain.exponentialRampToValueAtTime(EPS, t + (i === 2 ? 0.16 : 0.05));

    src.connect(bp).connect(env).connect(musicMaster);
    src.start(t);
    src.stop(t + 0.2);
  }
}

function bass(when, freq, duration = 0.45) {
  const ctx = getAudioContext();
  if (!ctx || !Number.isFinite(when) || !Number.isFinite(freq)) return;

  // Saw at fundamental + sine an octave down for sub weight
  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.value = freq;

  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = freq * 0.5;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1200, when);
  lp.frequency.exponentialRampToValueAtTime(200, when + duration * 0.8);
  lp.Q.value = 4;

  const sawG = ctx.createGain();
  sawG.gain.value = 0.55;
  const subG = ctx.createGain();
  subG.gain.value = 0.6;

  const env = ctx.createGain();
  env.gain.setValueAtTime(EPS, when);
  env.gain.exponentialRampToValueAtTime(0.32, when + 0.015);
  env.gain.exponentialRampToValueAtTime(EPS, when + duration);

  saw.connect(sawG).connect(lp);
  sub.connect(subG).connect(lp);
  lp.connect(env).connect(musicMaster);
  saw.start(when); sub.start(when);
  saw.stop(when + duration + 0.05);
  sub.stop(when + duration + 0.05);
}

function lead(when, freq, duration = 0.18, gain = 0.11) {
  const ctx = getAudioContext();
  if (!ctx || !Number.isFinite(when) || !Number.isFinite(freq)) return;

  // Detuned saws → that fat electro lead
  const a = ctx.createOscillator();
  a.type = "sawtooth";
  a.frequency.value = freq;
  const b = ctx.createOscillator();
  b.type = "sawtooth";
  b.frequency.value = freq * 1.006;     // slight detune up
  const c = ctx.createOscillator();
  c.type = "sawtooth";
  c.frequency.value = freq * 0.994;     // slight detune down

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(3200, when);
  lp.frequency.exponentialRampToValueAtTime(700, when + duration);
  lp.Q.value = 6;

  const env = ctx.createGain();
  env.gain.setValueAtTime(EPS, when);
  env.gain.exponentialRampToValueAtTime(gain, when + 0.005);
  env.gain.exponentialRampToValueAtTime(EPS, when + duration);

  a.connect(lp); b.connect(lp); c.connect(lp);
  lp.connect(env).connect(musicMaster);
  a.start(when); b.start(when); c.start(when);
  a.stop(when + duration + 0.05);
  b.stop(when + duration + 0.05);
  c.stop(when + duration + 0.05);
}

// --------------------------------------------------------------------
// pattern
// --------------------------------------------------------------------
function scheduleBlock(startAt, blockNum) {
  for (let bar = 0; bar < BARS_PER_BLOCK; bar++) {
    const barT = startAt + bar * STEPS_PER_BAR * STEP;
    const chord = bar;

    // 4-on-the-floor kick
    for (let beat = 0; beat < 4; beat++) {
      kick(barT + beat * 4 * STEP);
    }

    // 16th-note hats — accent the offbeats
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      // Skip a hat occasionally for groove (steps 0 — kick covers it; 13 — silence for swing)
      if (s === 0 || s === 13) continue;
      const isOffbeat = (s % 4 === 2);
      hat(barT + s * STEP, isOffbeat ? 0.20 : 0.09);
    }

    // Clap on backbeat (steps 4, 12 = beats 2, 4)
    clap(barT + 4 * STEP);
    clap(barT + 12 * STEP);

    // Bass: root on beat 1, fifth above on beat 3 — gives forward motion
    bass(barT, BASS_NOTES[chord]);
    bass(barT + 8 * STEP, BASS_NOTES[chord] * 1.5);
    // Extra rhythmic pop on the "and" of 4 (step 14)
    bass(barT + 14 * STEP, BASS_NOTES[chord] * 2, 0.18);

    // Lead arp on every 8th — walk through the chord
    // Rotate starting note across blocks so the lead evolves over time
    const notes = LEAD_CHORDS[chord];
    for (let i = 0; i < 8; i++) {
      const step = i * 2;
      // Accent on beats 1 & 3 by making them slightly louder + longer
      const isAccent = (i === 0 || i === 4);
      const noteIdx = (i + blockNum) % notes.length;
      lead(
        barT + step * STEP,
        notes[noteIdx],
        isAccent ? 0.22 : 0.14,
        isAccent ? 0.14 : 0.085
      );
    }
  }
}

// --------------------------------------------------------------------
// public API
// --------------------------------------------------------------------
export function startMusic(at) {
  if (!ensureSetup()) return;
  const ctx = getAudioContext();
  const startAt = Number.isFinite(at) ? at : ctx.currentTime + 0.05;
  nextBlockAt = Math.max(startAt, ctx.currentTime + 0.05);
  blockCounter = 0;
  // Schedule two blocks immediately so we have lead time.
  scheduleBlock(nextBlockAt, blockCounter++);
  nextBlockAt += BLOCK_DURATION;
  scheduleBlock(nextBlockAt, blockCounter++);
  nextBlockAt += BLOCK_DURATION;
}

/** Called every frame — tops up the schedule before we run out. */
export function maintainMusic() {
  const ctx = getAudioContext();
  if (!ctx || !musicMaster) return;
  while (nextBlockAt - ctx.currentTime < 2.0) {
    scheduleBlock(nextBlockAt, blockCounter++);
    nextBlockAt += BLOCK_DURATION;
  }
}

export function setMusicVolume(v) {
  if (!musicMaster) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  musicMaster.gain.linearRampToValueAtTime(
    Math.max(0, Math.min(1, v)),
    ctx.currentTime + 0.1
  );
}
