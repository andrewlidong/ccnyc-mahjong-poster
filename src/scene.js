import * as THREE from "three";
import { Tile, TILE_DIMS, getFaceTexture } from "./tile.js";
import { bgVertex } from "./shaders/bg.vert.js";
import { bgFragment } from "./shaders/bg.frag.js";
import { tileVertex } from "./shaders/tile.vert.js";
import { tileFragment } from "./shaders/tile.frag.js";

// Each row is split into actual mahjong melds. Pung/chow = 3 tiles, kong = 4,
// pair = 2. Tiles within a meld touch; melds have a visible gap.
const MELDS_BY_ROW = [
  ["CC",   "NYC"],   // pair + chow
  ["TUES", "DAY"],   // kong + chow
  ["PIER", "57"],    // kong + pair
  ["6-8",  "PM"],    // chow + pair
];

// Rows sit in the upper half — the pool occupies the lower half. Top row
// gets headroom so the finale push-in doesn't crop it.
const ROW_Y = [4.7, 3.0, 1.3, -0.4];

// Gaps. Within-meld gap is hairline so tiles read as one unit; between-meld
// gap is tighter than before so the row reads as one phrase with a beat.
const TILE_GAP_INNER = 0.02;
const TILE_GAP_MELD  = 0.32;

// Pool area — random scatter of tiles in the bottom half of the frame.
const POOL_AREA = {
  xMin: -3.6, xMax: 3.6,
  yMin: -7.0, yMax: -1.6,
  zMin: -1.0, zMax:  0.3,            // narrower z range — keep tiles off the near plane
};
const POOL_TILE_COUNT = 32;          // sparse pile, all face-down bamboo backs

/**
 * Build an ordered list of tile descriptors with meld grouping.
 * Each tile knows its row (0-3), its global meld index (0-7), and its
 * position within that meld (col). Tiles within a meld touch; melds within
 * a row are separated by TILE_GAP_MELD.
 */
function tileLayout() {
  const out = [];
  let globalMeldIdx = 0;
  let globalTileIdx = 0;

  MELDS_BY_ROW.forEach((meldsInRow, rowIdx) => {
    // First pass — compute total row width to center it.
    let rowWidth = 0;
    meldsInRow.forEach((meld, mIdx) => {
      const n = meld.length;
      rowWidth += n * TILE_DIMS.W + (n - 1) * TILE_GAP_INNER;
      if (mIdx < meldsInRow.length - 1) rowWidth += TILE_GAP_MELD;
    });

    // Second pass — actual placement.
    let leftEdge = -rowWidth / 2;
    meldsInRow.forEach((meld, meldInRowIdx) => {
      const chars = meld.split("");
      chars.forEach((ch, colInMeld) => {
        const tileX = leftEdge + TILE_DIMS.W / 2;
        out.push({
          ch,
          row: rowIdx,
          meld: globalMeldIdx,
          meldInRow: meldInRowIdx,
          col: colInMeld,
          meldSize: chars.length,
          x: tileX,
          y: ROW_Y[rowIdx],
          z: 0,
          index: globalTileIdx,
        });
        leftEdge += TILE_DIMS.W + TILE_GAP_INNER;
        globalTileIdx++;
      });
      leftEdge -= TILE_GAP_INNER; // strip the trailing inner gap
      if (meldInRowIdx < meldsInRow.length - 1) leftEdge += TILE_GAP_MELD;
      globalMeldIdx++;
    });
  });
  return out;
}

// Meld sizes in global meld order — consumed by timeline.js for the pacing.
export const MELD_SIZES = MELDS_BY_ROW.flat().map((m) => m.length);

function buildHeroTiles() {
  const descs = tileLayout();
  const tiles = descs.map((d, i) =>
    new Tile(d.ch, {
      x: d.x,
      y: d.y,
      z: d.z,
      seed: i * 0.137 + 0.31,
    })
  );

  // Assign each hero tile a starting "pool" position — a random scatter inside
  // the pool area. The tile will arc from here to its meld position when drawn.
  // Pool positions are seeded from the tile index so the layout is stable
  // across loads (no jarring re-layout if the page is refreshed mid-record).
  tiles.forEach((t, i) => {
    const r1 = seededRand(i * 12.34 + 1.7);
    const r2 = seededRand(i * 18.21 + 4.3);
    const r3 = seededRand(i * 22.11 + 9.8);
    const r4 = seededRand(i * 27.91 + 13.1);
    // Pool removed — tiles now start ABOVE the frame and drop straight down
    // into their meld positions. Slight x jitter and z variation keep the
    // entries from looking like a uniform machine line.
    t.poolPos.set(
      t.meldPos.x + (r1 - 0.5) * 0.6,
      t.meldPos.y + 14.0,
      t.meldPos.z + (r3 - 0.5) * 0.8
    );
    t.poolRot = (r4 - 0.5) * 0.4;
    t.row = descs[i].row;
    t.meld = descs[i].meld;           // global meld index 0..7
    t.meldInRow = descs[i].meldInRow; // meld index within its row
    t.col = descs[i].col;             // position within meld
    t.meldSize = descs[i].meldSize;
    t.index = i;
  });
  return tiles;
}

// Deterministic 1D hash → [0,1)
function seededRand(s) {
  const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Background — full-screen domain-warped FBM in crimson/teal.
 * Rendered first, with depth write/test off so everything passes over it.
 */
function buildBackground(width, height) {
  const geom = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: bgVertex,
    fragmentShader: bgFragment,
    uniforms: {
      uTime:       { value: 0 },
      uIntensity:  { value: 0 },
      uReveal:     { value: 0 },
      uBeat:       { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
    },
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, material: mat };
}

/**
 * Pool — a jumbled pile of face-down tiles in the bottom of the frame, where
 * mahjong tiles "live" before being drawn into melds. These are decorative
 * and never get drawn; the hero tiles start at their own pool positions
 * (assigned in buildHeroTiles) layered on top.
 *
 * Uses the same tile shader as hero tiles, but uFaceVisible locked to 0 so
 * only the bamboo-green back ever shows.
 */
function buildPool() {
  const group = new THREE.Group();
  group.renderOrder = -1;

  // Reuse one geometry for all pool tiles — instancing is overkill at 38 tiles
  // but the shared geom avoids 38 BoxGeometry allocations.
  const geom = new THREE.BoxGeometry(TILE_DIMS.W, TILE_DIMS.H, TILE_DIMS.D);

  for (let i = 0; i < POOL_TILE_COUNT; i++) {
    const r1 = seededRand(i * 3.71 + 100.0);
    const r2 = seededRand(i * 7.13 + 200.0);
    const r3 = seededRand(i * 9.99 + 300.0);
    const r4 = seededRand(i * 11.3 + 400.0);
    const r5 = seededRand(i * 13.1 + 500.0);
    const r6 = seededRand(i * 17.7 + 600.0);

    const x = lerp(POOL_AREA.xMin, POOL_AREA.xMax, r1);
    const y = lerp(POOL_AREA.yMin, POOL_AREA.yMax, r2);
    const z = lerp(POOL_AREA.zMin, 0.0, r3);

    const mat = new THREE.ShaderMaterial({
      vertexShader: tileVertex,
      fragmentShader: tileFragment,
      uniforms: {
        uFaceTex:     { value: getFaceTexture("A") },  // unused — uFaceVisible=0
        uInkColor:    { value: new THREE.Color(0x000000) },
        uEmission:    { value: 0 },
        uFaceVisible: { value: 0 },                    // pool is face-down only
        uKeyDir:      { value: new THREE.Vector3(0.55, 0.85, 0.65).normalize() },
        uRimDir:      { value: new THREE.Vector3(-0.7, -0.25, 0.45).normalize() },
        uKeyColor:    { value: new THREE.Color(1.0, 0.86, 0.62) },
        uRimColor:    { value: new THREE.Color(0.55, 0.85, 0.75) },
        uIvory:       { value: new THREE.Color(0xeed9b0) },
        uBackColor:   { value: new THREE.Color(0x1c3a2a) },
        uTime:        { value: 0 },
        uTileSeed:    { value: r5 },
      },
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.x = Math.PI;
    mesh.rotation.y = (r4 - 0.5) * 0.3;
    mesh.rotation.z = (r6 - 0.5) * 0.5;

    mesh.userData.basePos = mesh.position.clone();
    mesh.userData.baseRot = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z };
    mesh.userData.seed = r5;
    group.add(mesh);
  }
  return group;
}

/**
 * Drive the pool's subtle shake during the shuffle/scatter phases.
 * Called every frame from main.js with the current intensity (0..1).
 */
export function applyPoolShuffle(pool, t, intensity) {
  if (!pool) return;
  if (intensity < 0.001) {
    // Snap back to base pose to avoid drift
    for (const m of pool.children) {
      const ud = m.userData;
      if (!ud.basePos) continue;
      m.position.copy(ud.basePos);
      m.rotation.x = ud.baseRot.x;
      m.rotation.y = ud.baseRot.y;
      m.rotation.z = ud.baseRot.z;
    }
    return;
  }
  for (const m of pool.children) {
    const ud = m.userData;
    if (!ud.basePos) continue;
    const phase = t * 8.0 + ud.seed * 30.0;
    m.position.x = ud.basePos.x + Math.sin(phase) * 0.06 * intensity;
    m.position.y = ud.basePos.y + Math.cos(phase * 1.3) * 0.05 * intensity;
    m.rotation.z = ud.baseRot.z + Math.sin(phase * 0.7) * 0.13 * intensity;
    m.rotation.y = ud.baseRot.y + Math.sin(phase * 0.9 + 1.0) * 0.08 * intensity;
  }
}

export function buildScene(width, height) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050203);

  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
  camera.position.set(0, 0, 30);
  camera.lookAt(0, 0, 0);

  const bg = buildBackground(width, height);
  scene.add(bg.mesh);

  const tiles = buildHeroTiles();
  for (const t of tiles) scene.add(t.mesh);

  return {
    scene,
    camera,
    tiles,
    pool: null,   // pool removed — just hero tiles + bg
    bg,
  };
}
