/**
 * Procedural mahjong soundscape — synthesized at runtime via Web Audio API.
 * No audio files. All scheduling uses AudioContext.currentTime so the events
 * sit exactly on the visual timeline.
 */

let ctx = null;
let master = null;
let noiseBuffer = null;

/** Generate ~2 seconds of stereo white noise once, reused for clacks/shuffles. */
function makeNoiseBuffer(ac) {
  const len = ac.sampleRate * 2;
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return buf;
}

export async function initAudio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);
  noiseBuffer = makeNoiseBuffer(ctx);
  // Some browsers create the context in 'suspended' state until a gesture
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

export function getAudioContext() {
  return ctx;
}

// ---------- primitive synths ----------

/**
 * Single tile-on-tile clack. Filtered noise burst + a thin pitched body.
 * @param {number} when  AudioContext-time to start at
 */
const EPS = 0.0005; // floor for exponentialRampToValueAtTime (never pass 0)

function clack(when, { gain = 0.45, hi = 1800, pan = (Math.random() - 0.5) * 0.7 } = {}) {
  if (!ctx) return;
  if (!Number.isFinite(when)) return;     // non-finite times crash setValueAtTime
  if (!Number.isFinite(gain) || gain < 0.005) return;
  if (!Number.isFinite(hi)) hi = 1800;

  // --- noise component ---
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  // randomize starting offset for variation
  src.loop = false;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = hi + (Math.random() - 0.5) * 600;
  bp.Q.value = 6 + Math.random() * 5;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 400;

  const env = ctx.createGain();
  env.gain.setValueAtTime(EPS, when);
  env.gain.exponentialRampToValueAtTime(Math.max(EPS, gain * (0.7 + Math.random() * 0.3)), when + 0.003);
  env.gain.exponentialRampToValueAtTime(EPS, when + 0.085);

  const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (panner) panner.pan.value = pan;

  src.connect(bp).connect(hp).connect(env);
  if (panner) env.connect(panner).connect(master);
  else env.connect(master);
  src.start(when);
  src.stop(when + 0.12);

  // --- pitched body (wooden tock) ---
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(620 + (Math.random() - 0.5) * 80, when);
  osc.frequency.exponentialRampToValueAtTime(180, when + 0.07);

  const oscEnv = ctx.createGain();
  oscEnv.gain.setValueAtTime(EPS, when);
  oscEnv.gain.exponentialRampToValueAtTime(Math.max(EPS, gain * 0.35), when + 0.005);
  oscEnv.gain.exponentialRampToValueAtTime(EPS, when + 0.06);

  osc.connect(oscEnv);
  if (panner) oscEnv.connect(panner);
  else oscEnv.connect(master);

  osc.start(when);
  osc.stop(when + 0.08);
}

/**
 * Cluster of clacks over `duration`, with exponentially-distributed gaps —
 * sounds like shuffling tiles.
 */
function shuffle(when, { duration = 0.8, gain = 0.35, lp = 3000 } = {}) {
  if (!ctx) return;
  if (!Number.isFinite(when) || !Number.isFinite(duration) || duration <= 0) return;
  let t = when;
  const end = when + duration;

  // Use a low-pass to suggest 'distant' tiles
  // (we apply it per-clack via the hi param). For shuffle we lower hi.
  while (t < end) {
    const localGain = gain * (0.5 + Math.random() * 0.5);
    const hi = Math.min(lp, 800 + Math.random() * 2200);
    // Envelope at the edges of the burst
    const u = (t - when) / duration;
    const edge = Math.min(1, u * 4) * Math.min(1, (1 - u) * 4);
    clack(t, { gain: localGain * edge, hi, pan: (Math.random() - 0.5) * 0.9 });
    t += 0.03 + Math.random() * 0.06; // 30–90 ms apart
  }
}

/**
 * Row-reveal swell — filtered noise sweeping down + a bright initial clack.
 */
function reveal(when, { intensity = 0.5 } = {}) {
  if (!ctx) return;
  if (!Number.isFinite(when)) return;
  if (!Number.isFinite(intensity) || intensity < 0.01) return;

  // Bright lead-in clack
  clack(when, { gain: 0.32 * intensity, hi: 3200, pan: 0 });

  // Filtered noise downsweep
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(2400, when);
  bp.frequency.exponentialRampToValueAtTime(380, when + 0.45);
  bp.Q.value = 4;

  const env = ctx.createGain();
  env.gain.setValueAtTime(EPS, when);
  env.gain.exponentialRampToValueAtTime(Math.max(EPS, 0.20 * intensity), when + 0.04);
  env.gain.exponentialRampToValueAtTime(EPS, when + 0.5);

  src.connect(bp).connect(env).connect(master);
  src.start(when);
  src.stop(when + 0.55);
}

/**
 * Low ambient hum for the finale — slow sine + filtered noise pad.
 */
function hum(when, { duration = 2.5, gain = 0.18 } = {}) {
  if (!ctx) return;
  if (!Number.isFinite(when) || !Number.isFinite(duration) || duration <= 0) return;
  if (!Number.isFinite(gain) || gain < 0.005) return;

  // Two slightly-detuned low sines
  const freqs = [80, 80 * 1.5];
  const env = ctx.createGain();
  env.gain.setValueAtTime(EPS, when);
  env.gain.exponentialRampToValueAtTime(Math.max(EPS, gain), when + 0.6);
  env.gain.setValueAtTime(Math.max(EPS, gain), when + duration - 0.6);
  env.gain.exponentialRampToValueAtTime(EPS, when + duration);

  freqs.forEach((f) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    o.connect(g).connect(env);
    o.start(when);
    o.stop(when + duration + 0.05);

    // Subtle pitch wobble
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18 + Math.random() * 0.2;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 1.5;
    lfo.connect(lfoG).connect(o.frequency);
    lfo.start(when);
    lfo.stop(when + duration + 0.05);
  });

  env.connect(master);

  // Soft noise pad on top
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer;
  n.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const nEnv = ctx.createGain();
  nEnv.gain.setValueAtTime(EPS, when);
  nEnv.gain.exponentialRampToValueAtTime(Math.max(EPS, gain * 0.4), when + 0.8);
  nEnv.gain.setValueAtTime(Math.max(EPS, gain * 0.4), when + duration - 0.6);
  nEnv.gain.exponentialRampToValueAtTime(EPS, when + duration);
  n.connect(lp).connect(nEnv).connect(master);
  n.start(when);
  n.stop(when + duration + 0.05);
}

// ---------- scheduling ----------

/**
 * Schedule a list of events relative to a given AudioContext start time.
 * Events are { time (sec into loop), type, params }.
 */
export function scheduleEvents(events, loopStartAt) {
  if (!ctx) return;
  if (!Number.isFinite(loopStartAt)) {
    console.warn("scheduleEvents: non-finite loopStartAt, skipping schedule:", loopStartAt);
    return;
  }
  for (const ev of events) {
    if (!Number.isFinite(ev.time)) continue;
    const when = loopStartAt + ev.time;
    if (!Number.isFinite(when)) continue;
    if (when < ctx.currentTime - 0.01) continue; // already past
    // Wrap each event so one bad scheduling call doesn't take down the rest
    try {
      switch (ev.type) {
        case "clack":   clack(when, ev.params); break;
        case "shuffle": shuffle(when, ev.params); break;
        case "reveal":  reveal(when, ev.params); break;
        case "hum":     hum(when, ev.params); break;
      }
    } catch (err) {
      console.warn("audio event failed:", ev, err);
    }
  }
}
