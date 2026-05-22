/**
 * Timeline driver — slower 22s loop where tiles get drawn from a pool and
 * laid down like mahjong melds.
 *
 *   0.0  - 1.5s   Scene fades in; pool of jumbled tiles becomes visible.
 *   1.5  - 3.5s   Shuffle: pool tiles jitter as if being mixed.
 *   3.5  - 17.0s  Draw phase — 23 hero tiles arc out of the pool, flip face-
 *                 up mid-flight, and settle into their meld row (top → bottom).
 *                 0.55s stagger per tile, 0.90s per arc.
 *  17.0  - 20.0s  Finale — all melds glow, bg motif accelerates, camera drifts.
 *  20.0  - 21.0s  Scatter — tiles flip face-down and arc back into the pool.
 *  21.0  - 22.0s  Fade for loop seam.
 */

import { MELD_SIZES } from "./scene.js";

export const LOOP = 22.0;

// ---------- easing ----------
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const easeOutCubic   = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic    = (t) => t * t * t;
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeInOutSine  = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// ---------- phase constants ----------
const FADE_IN_END    = 1.5;
const SHUFFLE_START  = 1.5;
const SHUFFLE_END    = 3.5;

const DRAW_START      = 3.5;
const DRAW_DURATION   = 0.85;   // single arc duration
const WITHIN_STAGGER  = 0.08;   // stagger between tiles inside a meld
const MELD_GAP        = 0.75;   // pause between a meld landing and the next starting

const FINALE_START   = 16.8;
const FINALE_END     = 19.8;

const SCATTER_START  = 19.8;
const SCATTER_DURATION = 0.85;
const SCATTER_STAGGER  = 0.04;

const FADE_END       = 22.0;

// Compute the start time of each meld so they cascade with a deliberate pause
// between them — like a player slapping down one meld at a time.
const MELD_START_TIMES = (() => {
  const out = [DRAW_START];
  for (let i = 1; i < MELD_SIZES.length; i++) {
    const prevDur = (MELD_SIZES[i - 1] - 1) * WITHIN_STAGGER + DRAW_DURATION;
    out.push(out[i - 1] + prevDur + MELD_GAP);
  }
  return out;
})();

// Arc parameters
const ARC_HEIGHT     = 1.6;  // peak above straight-line travel

// ---------- per-tile draw computation ----------
/**
 * Returns the tile's world position + rotation state at time t.
 *   stage 'pool'   : sitting in pool, face-down (with random pool-rot)
 *   stage 'drawing': mid-arc, position lerped + flip rotating in
 *   stage 'meld'   : at meld position, face-up
 *   stage 'scatter': mid-reverse-arc, flipping back
 *
 * Returns a fresh plain object each call — must not share state across tiles.
 */
function tileDrawState(t, tile, drawBegin) {
  const px = tile.poolPos.x, py = tile.poolPos.y, pz = tile.poolPos.z;
  const mx = tile.meldPos.x, my = tile.meldPos.y, mz = tile.meldPos.z;

  const drawEnd = drawBegin + DRAW_DURATION;
  const scatterBegin = SCATTER_START + tile.index * SCATTER_STAGGER;
  const scatterEnd = scatterBegin + SCATTER_DURATION;

  // ---------- in pool (before draw) ----------
  if (t < drawBegin) {
    return { pos: { x: px, y: py, z: pz }, flip: Math.PI, yRot: 0, zRot: tile.poolRot };
  }

  // ---------- drawing (arc from pool to meld) ----------
  if (t < drawEnd) {
    const u = (t - drawBegin) / DRAW_DURATION;
    const ePos = easeInOutCubic(u);
    const arc = Math.sin(u * Math.PI);
    const x = px + (mx - px) * ePos;
    const y = py + (my - py) * ePos + ARC_HEIGHT * arc;
    const z = pz + (mz - pz) * ePos + 1.2 * arc;

    // Flip starts ~20% in, completes ~10% before landing — face turns over
    // while the tile is high in the arc.
    const flipU = clamp01((u - 0.2) / 0.7);
    const flip = Math.PI * (1 - easeInOutCubic(flipU));

    const yRot = arc * 0.35;
    const zRot = tile.poolRot * (1 - u);
    return { pos: { x, y, z }, flip, yRot, zRot };
  }

  // ---------- at meld (before scatter) ----------
  if (t < scatterBegin) {
    const breathe = Math.sin(t * 0.9 + tile.index * 0.7) * 0.012;
    return { pos: { x: mx, y: my, z: mz }, flip: 0, yRot: 0, zRot: breathe };
  }

  // ---------- scattering (arc back to pool) ----------
  if (t < scatterEnd) {
    const u = (t - scatterBegin) / SCATTER_DURATION;
    const ePos = easeInCubic(u);
    const arc = Math.sin(u * Math.PI);
    const x = mx + (px - mx) * ePos;
    const y = my + (py - my) * ePos + 0.9 * arc;
    const z = mz + (pz - mz) * ePos + 0.5 * arc;

    const flipU = clamp01((u - 0.1) / 0.7);
    const flip = Math.PI * easeInOutCubic(flipU);
    const yRot = -arc * 0.35;
    const zRot = tile.poolRot * u;
    return { pos: { x, y, z }, flip, yRot, zRot };
  }

  // ---------- back in pool ----------
  return { pos: { x: px, y: py, z: pz }, flip: Math.PI, yRot: 0, zRot: tile.poolRot };
}

// ---------- per-tile emission ----------
function tileEmission(t, drawBegin, tileIndex) {
  const drawEnd = drawBegin + DRAW_DURATION;
  if (t < drawEnd) return 0;

  const scatterBegin = SCATTER_START + tileIndex * SCATTER_STAGGER;

  // 1) Sharp pulse right after landing
  if (t < drawEnd + 0.35) {
    const u = (t - drawEnd) / 0.35;
    return Math.sin(u * Math.PI) * 0.55 + 0.10;
  }

  // 2) Baseline glow until finale
  if (t < FINALE_START) return 0.10;

  // 3) Finale ramp — gentle so the engraving stays readable
  if (t < FINALE_END) {
    const u = (t - FINALE_START) / (FINALE_END - FINALE_START);
    const base = 0.12 + 0.38 * easeInOutCubic(u);
    const shimmer = 0.08 * Math.sin(t * 2.6 + tileIndex * 0.7);
    return base + shimmer;
  }

  // 4) Fade with scatter — emission drops as tile flips back
  if (t < scatterBegin) return 0.50;
  const u = clamp01((t - scatterBegin) / SCATTER_DURATION);
  return (1 - u) * 0.50;
}

// ---------- main driver ----------
export function computeState(tRaw, tiles) {
  const t = ((tRaw % LOOP) + LOOP) % LOOP;

  // Master alpha (used by bg + post-fx ramps)
  const fadeIn = clamp01(t / FADE_IN_END);
  const fadeOut = 1.0 - clamp01((t - (FADE_END - 1.0)) / 1.0);
  const sceneAlpha = fadeIn * fadeOut;

  // Background intensity & reveal
  let bgIntensity;
  if (t < FADE_IN_END)        bgIntensity = 0.08 + 0.22 * easeOutCubic(t / FADE_IN_END);
  else if (t < FINALE_START)  bgIntensity = 0.30 + 0.06 * Math.sin(t * 0.4);
  else if (t < FINALE_END)    bgIntensity = 0.30 + 0.85 * easeInOutCubic((t - FINALE_START) / (FINALE_END - FINALE_START));
  else if (t < FADE_END)      bgIntensity = 1.15 * (1.0 - easeInCubic((t - FINALE_END) / (FADE_END - FINALE_END)));
  else                        bgIntensity = 0;
  bgIntensity *= sceneAlpha;

  // Reveal accumulator — how much of the message is on the table right now
  let drawnCount = 0;
  for (let i = 0; i < tiles.length; i++) {
    const drawBegin = MELD_START_TIMES[tiles[i].meld] + tiles[i].col * WITHIN_STAGGER;
    if (t > drawBegin + DRAW_DURATION) drawnCount++;
  }
  let bgReveal = drawnCount / tiles.length;
  if (t > FINALE_END) bgReveal *= 1.0 - clamp01((t - FINALE_END) / 1.5);

  // Camera — gentle pull-in during draw, slight drift during finale.
  // Kept conservative so the top row keeps headroom in all phases.
  const cam = { z: 30, yaw: 0, pitch: 0 };
  if (t < FADE_IN_END) {
    cam.z = 31.5 - 1.5 * easeOutCubic(t / FADE_IN_END);
  } else if (t >= DRAW_START && t < FINALE_START) {
    const u = (t - DRAW_START) / (FINALE_START - DRAW_START);
    cam.z = 30 - 0.7 * easeInOutSine(u);
  } else if (t >= FINALE_START && t < FINALE_END) {
    const u = (t - FINALE_START) / (FINALE_END - FINALE_START);
    cam.yaw = Math.sin(u * Math.PI) * 0.035;
    cam.pitch = Math.sin(u * Math.PI * 0.8) * 0.015;
    cam.z = 29.3 - 0.6 * Math.sin(u * Math.PI);
  } else if (t >= FINALE_END) {
    cam.z = 28.7 + (t - FINALE_END) * 0.6;
  }

  // Per-tile state
  const tileStates = new Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const drawBegin = MELD_START_TIMES[tile.meld] + tile.col * WITHIN_STAGGER;
    const draw = tileDrawState(t, tile, drawBegin);
    const emission = tileEmission(t, drawBegin, i);
    tileStates[i] = {
      pos: draw.pos,
      flip: draw.flip,
      yRot: draw.yRot,
      zRot: draw.zRot,
      emission,
    };
  }

  // Pool shuffle intensity — peaks during shuffle phase, then decays
  let shuffleIntensity = 0;
  if (t >= SHUFFLE_START && t < SHUFFLE_END) {
    const u = (t - SHUFFLE_START) / (SHUFFLE_END - SHUFFLE_START);
    shuffleIntensity = Math.sin(u * Math.PI) * 0.9; // fade in and out
  }
  // Also a smaller jiggle during scatter
  if (t >= SCATTER_START && t < FADE_END) {
    const u = (t - SCATTER_START) / (FADE_END - SCATTER_START);
    shuffleIntensity = Math.max(shuffleIntensity, Math.sin(u * Math.PI) * 0.4);
  }

  return {
    t,
    tileStates,
    bg: { intensity: bgIntensity, reveal: clamp01(bgReveal) },
    camera: cam,
    sceneAlpha,
    shuffleIntensity,
  };
}

/**
 * Produce the audio schedule for one loop iteration.
 * All draw / land / settle events follow the meld-based timing in
 * MELD_START_TIMES.
 */
export function audioSchedule(tiles) {
  const events = [];

  // Ambient distant shuffle while scene fades in
  events.push({ time: 0.10, type: "shuffle", params: { duration: 1.4, gain: 0.14, lp: 1200 } });

  // Dense shuffle during the visual shuffle phase — softer than before so it
  // doesn't dominate the music bed.
  events.push({ time: SHUFFLE_START + 0.05, type: "shuffle", params: { duration: SHUFFLE_END - SHUFFLE_START - 0.1, gain: 0.32, lp: 4500 } });

  // Per-tile clack: ONE firm clack at the exact moment of visual impact, with
  // a quiet settle 50ms later. The previous "lift" sample was firing the
  // moment a tile left the pool — there's no visual sound-source there, so
  // it just added noise to the rhythm.
  tiles.forEach((tile) => {
    const drawBegin = MELD_START_TIMES[tile.meld] + tile.col * WITHIN_STAGGER;
    const drawEnd   = drawBegin + DRAW_DURATION;
    events.push({ time: drawEnd,         type: "clack", params: { gain: 0.65, hi: 2100 } });
    events.push({ time: drawEnd + 0.06,  type: "clack", params: { gain: 0.18, hi: 700 } });

    // Last tile in this meld? Trigger a swell ~when it lands.
    if (tile.col === tile.meldSize - 1) {
      const meldEnd = drawBegin + DRAW_DURATION;
      const intensity = tile.meldSize >= 4 ? 0.7 : tile.meldSize === 3 ? 0.55 : 0.4;
      events.push({ time: meldEnd + 0.05, type: "reveal", params: { intensity } });
    }
  });

  // Finale low hum
  events.push({ time: FINALE_START - 0.1, type: "hum", params: { duration: FINALE_END - FINALE_START + 0.2, gain: 0.18 } });

  // Scatter — light clacks as tiles return to pool (softer than draws)
  tiles.forEach((tile, i) => {
    const scatterBegin = SCATTER_START + i * SCATTER_STAGGER;
    events.push({ time: scatterBegin + SCATTER_DURATION * 0.65, type: "clack", params: { gain: 0.14, hi: 1200 } });
  });

  // Light ambient shuffle as scene fades to seam
  events.push({ time: SCATTER_START + 0.3, type: "shuffle", params: { duration: 1.2, gain: 0.16, lp: 1600 } });

  events.sort((a, b) => a.time - b.time);
  return events;
}

// Exposed for main.js so it can drive pool-tile shuffling.
export const PHASES = {
  SHUFFLE_START,
  SHUFFLE_END,
  DRAW_START,
  FINALE_START,
  FINALE_END,
  SCATTER_START,
  FADE_END,
};

// Meld-landing timestamps — main.js uses these to drive bloom + RGB-shift
// pulses on each meld completion.
export const MELD_END_TIMES = MELD_START_TIMES.map(
  (start, i) => start + (MELD_SIZES[i] - 1) * WITHIN_STAGGER + DRAW_DURATION
);

/** When does a particular tile finish its draw arc and land in its meld? */
export function getTileLandTime(tile) {
  return MELD_START_TIMES[tile.meld] + tile.col * WITHIN_STAGGER + DRAW_DURATION;
}
