import * as THREE from "three";
import { buildScene } from "./scene.js";
import { buildPostFX } from "./postfx.js";
import { computeState, audioSchedule, LOOP, MELD_END_TIMES, getTileLandTime } from "./timeline.js";
import { initAudio, getAudioContext, scheduleEvents } from "./audio.js";
import { startMusic, maintainMusic } from "./music.js";
import { ParticleSystem } from "./particles.js";

const WIDTH = 1080;
const HEIGHT = 1920;

const canvas = document.getElementById("canvas");
const startEl = document.getElementById("start");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(1); // canvas is already at target resolution
renderer.setSize(WIDTH, HEIGHT, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// Preload the brushy Latin fonts before generating tile textures so we get
// the calligraphic look (not a fallback serif).
const LATIN_GLYPHS = "CNYCTUESDAYPIER5768PM-";
async function preloadGlyphs(font, sample) {
  try { await document.fonts.load(font, sample); } catch (_) {}
}
await Promise.all([
  preloadGlyphs('400 64px "Ma Shan Zheng"', LATIN_GLYPHS),
  preloadGlyphs('400 64px "ZCOOL XiaoWei"', LATIN_GLYPHS),
  document.fonts.ready,
]);

const { scene, camera, tiles, bg } = buildScene(WIDTH, HEIGHT);
const fx = buildPostFX(renderer, scene, camera, WIDTH, HEIGHT);

// Particle system disabled — kept the import in case we want it back.
// (Not adding `particles.points` to the scene means nothing renders.)
const particles = new ParticleSystem();

// Per-tile and per-meld land times — used by tick() to detect the exact
// frame a tile or meld finishes landing, so we can emit particles + shake.
const TILE_LAND_TIMES = tiles.map(getTileLandTime);
const MELD_CENTERS = (() => {
  const out = [];
  for (let m = 0; m < 8; m++) {
    const ts = tiles.filter((t) => t.meld === m);
    const cx = ts.reduce((s, t) => s + t.meldPos.x, 0) / ts.length;
    out.push(new THREE.Vector3(cx, ts[0].meldPos.y, 0));
  }
  return out;
})();
const MELD_LAST_TILE = (() => {
  const out = [];
  for (let m = 0; m < 8; m++) {
    const ts = tiles.filter((t) => t.meld === m);
    out.push(ts[ts.length - 1]);
  }
  return out;
})();

// Camera shake state — decays via exponential after each trigger.
let shakeAmp = 0;
let shakeT0 = 0;
function triggerShake(amp) {
  // Stack peaks rather than overwriting — successive lands compound.
  shakeAmp = Math.min(0.35, shakeAmp + amp);
  shakeT0 = performance.now() / 1000;
}

// Pre-built audio event schedule for one loop (depends only on tile layout)
const AUDIO_EVENTS = audioSchedule(tiles);

let started = false;
let startWallTime = 0;     // performance.now() origin
let lastT = 0;             // previous loop-local time, for detecting wrap
let nextLoopStartAt = 0;   // AudioContext-time of the next/current loop start

function start(tOffset = 0) {
  if (started) return;
  if (!Number.isFinite(tOffset)) tOffset = 0;
  started = true;
  startEl.classList.add("hidden");

  // Audio disabled — straight to the visual loop.
  startWallTime = performance.now() - tOffset * 1000;
  requestAnimationFrame(tick);
}

// Wrap so the MouseEvent doesn't get passed in as `tOffset`.
startEl.addEventListener("click", () => start());
startEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") start();
});

// `?play=auto` bypasses the click — handy for headless dev / recording rigs.
// `?play=auto&t=12` additionally jumps in at loop-second 12.
{
  const _params = new URLSearchParams(location.search);
  if (_params.get("play") === "auto") {
    const tOffset = parseFloat(_params.get("t") || "0");
    start(tOffset);
  }
}

// ---------- render loop ----------

const camLookAt = new THREE.Vector3(0, 0, 0);
let lastFrameMs = performance.now();

function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrameMs) / 1000);
  lastFrameMs = now;
  const elapsed = (now - startWallTime) / 1000;
  const t = ((elapsed % LOOP) + LOOP) % LOOP;

  lastT = t;
  // Audio + music disabled (no scheduling, no music to maintain).

  const state = computeState(t, tiles);

  // Apply per-tile state
  let emissionSum = 0;
  for (let i = 0; i < tiles.length; i++) {
    tiles[i].apply(state.tileStates[i], t);
    emissionSum += state.tileStates[i].emission;
  }
  const emissionAvg = emissionSum / tiles.length;

  // Particles + camera shake intentionally disabled (simplified visual).
  // The per-tile / per-meld land-time arrays are still computed above in case
  // we want to re-enable later.

  // (pool removed — no decorative tiles to shuffle)

  // Background uniforms — `uBeat` decays from 1→0 over each beat of the
  // 122 BPM electro loop. Music kicks in ~0.6s after start, so we offset.
  const BEAT = 60 / 122;
  const musicElapsed = (now - startWallTime) / 1000 - 0.6;
  const beatPhase =
    musicElapsed > 0 ? ((musicElapsed % BEAT) + BEAT) % BEAT : BEAT;
  const beat = Math.exp(-beatPhase * 8);

  bg.material.uniforms.uTime.value = t;
  bg.material.uniforms.uIntensity.value = state.bg.intensity;
  bg.material.uniforms.uReveal.value = state.bg.reveal;
  bg.material.uniforms.uBeat.value = beat;

  // Camera drift (no shake — simplified visual)
  const c = state.camera;
  camera.position.set(
    Math.sin(c.yaw) * c.z,
    Math.sin(c.pitch) * c.z * 0.5,
    Math.cos(c.yaw) * c.z
  );
  camera.lookAt(camLookAt);

  // Post-fx disabled (simplified visual) — bloom and chromatic aberration
  // were creating overlay artifacts. Keep tiny bloom on the finale glow only.
  fx.bloom.strength = 0.10 + emissionAvg * 0.20;
  fx.rgbShift.uniforms.amount.value = 0.0;

  // Render
  fx.composer.render();
  requestAnimationFrame(tick);
}

// ---------- helpers ----------

/**
 * Transient 'pulse' for driving bloom + chromatic-aberration spikes.
 * Peaks on every meld completion (8 per loop), with a soft swell across the
 * finale. Driven from timeline.js's MELD_END_TIMES so the timing always
 * stays in sync.
 */
function computeRowPulse(t) {
  let pulse = 0;
  for (const peak of MELD_END_TIMES) {
    const dt = Math.abs(t - peak);
    pulse = Math.max(pulse, Math.exp(-dt * dt * 40));
  }
  // Soft swell across the finale window (16.8-19.8s)
  if (t >= 16.8 && t < 19.8) {
    const u = (t - 16.8) / 3.0;
    pulse = Math.max(pulse, 0.25 + 0.18 * Math.sin(u * Math.PI));
  }
  return pulse;
}

// ---------- error overlay (helpful while iterating) ----------
window.addEventListener("error", (e) => {
  startEl.querySelector(".hint").textContent = "error — see console";
  console.error(e.error || e.message);
});
