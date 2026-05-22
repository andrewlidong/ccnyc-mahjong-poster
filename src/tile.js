import * as THREE from "three";
import { tileVertex } from "./shaders/tile.vert.js";
import { tileFragment } from "./shaders/tile.frag.js";

const FACE_TEX_SIZE = 512;
const TEX_CACHE = new Map();

/**
 * Find a system font that ACTUALLY draws Chinese glyphs to a canvas.
 * Some fonts claim to exist but render tofu / blank for CJK; this rendering
 * test catches that by counting opaque pixels for a sample character.
 * Runs once on first call; result is cached.
 */
let _detectedCJKFont = null;
function detectCJKFont() {
  if (_detectedCJKFont) return _detectedCJKFont;
  const candidates = [
    "PingFang SC",
    "Hiragino Sans GB",
    "STSong",
    "Songti SC",
    "STHeiti",
    "Apple SD Gothic Neo",
    "Microsoft YaHei",
    "SimSun",
    "STKaiti",
    "Noto Sans CJK SC",
    "Noto Serif CJK SC",
    "Yu Gothic",
    "ZCOOL XiaoWei",
    "Ma Shan Zheng",
    "serif",
  ];
  const test = document.createElement("canvas");
  test.width = test.height = 80;
  const ctx = test.getContext("2d");
  for (const fontName of candidates) {
    ctx.clearRect(0, 0, 80, 80);
    ctx.font = `60px "${fontName}", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "black";
    ctx.fillText("中", 40, 42);
    const data = ctx.getImageData(0, 0, 80, 80).data;
    let pixels = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 50) pixels++;
    }
    // 中 has substantial structure — a real glyph hits >300 pixels; tofu
    // boxes and empty fallbacks come in below 100. 200 is a safe threshold.
    if (pixels > 200) {
      console.log(`[tile] CJK font detected: "${fontName}" (${pixels} px)`);
      _detectedCJKFont = fontName;
      return fontName;
    }
  }
  console.warn("[tile] No working CJK font found — Chinese tiles will be blank");
  _detectedCJKFont = "serif";
  return "serif";
}

const INK_CRIMSON = new THREE.Color(0x9c1a1f);
const INK_JADE    = new THREE.Color(0x1f6b4a);

const IVORY      = new THREE.Color(0xeed9b0);
const BACK_GREEN = new THREE.Color(0x1c3a2a);

const KEY_DIR   = new THREE.Vector3( 0.55,  0.85,  0.65).normalize();
const RIM_DIR   = new THREE.Vector3(-0.7,  -0.25,  0.45).normalize();
const KEY_COLOR = new THREE.Color(1.0,  0.86, 0.62);
const RIM_COLOR = new THREE.Color(0.55, 0.85, 0.75);

const TILE_W = 1.0;
const TILE_H = 1.4;
const TILE_D = 0.36;

/**
 * Build (or fetch) a CanvasTexture with the given character drawn centered.
 * Texture stores the character as full-alpha pixels; shader uses the alpha
 * as a mask, so the on-canvas color doesn't matter — but we draw in black
 * for clarity when debugging.
 */
export function getFaceTexture(ch) {
  if (TEX_CACHE.has(ch)) return TEX_CACHE.get(ch);

  const canvas = document.createElement("canvas");
  canvas.width = FACE_TEX_SIZE;
  canvas.height = FACE_TEX_SIZE;
  const ctx = canvas.getContext("2d");

  // Transparent background — shader composites the ivory body itself
  ctx.clearRect(0, 0, FACE_TEX_SIZE, FACE_TEX_SIZE);

  // For CJK chars, use the font we *verified renders pixels* via detectCJKFont().
  // For Latin chars, keep the brushy Google web fonts.
  const isCJK = /[㐀-鿿]/.test(ch);
  const fontStackLatin =
    '"Ma Shan Zheng", "ZCOOL XiaoWei", "Long Cang", "Bodoni 72", Georgia, serif';
  const fontStack = isCJK
    ? `"${detectCJKFont()}", "PingFang SC", "Songti SC", serif`
    : fontStackLatin;

  // Brush fonts run smaller than serifs at the same px size — push up.
  const isNarrow = /[I1\-]/.test(ch);
  const isWide   = /[MW]/.test(ch);
  // Chinese characters render more densely — keep them slightly smaller so the
  // strokes don't crowd the frame border.
  const isChinese = /[㐀-鿿]/.test(ch);

  let fontSize = 420;
  if (isWide) fontSize = 360;
  if (isNarrow) fontSize = 440;
  if (isChinese) fontSize = 380;

  ctx.font = `400 ${fontSize}px ${fontStack}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Fill with opaque black — alpha=255 becomes the engraving mask
  ctx.fillStyle = "#000";

  // Slight vertical optical offset (digits/letters often look low when centered)
  const cx = FACE_TEX_SIZE / 2;
  const cy = FACE_TEX_SIZE / 2 + 16;
  ctx.fillText(ch, cx, cy);

  // Add a thin decorative double-frame around the character (mahjong style)
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  const m = 32;
  ctx.strokeRect(m, m, FACE_TEX_SIZE - 2 * m, FACE_TEX_SIZE - 2 * m);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.strokeRect(m + 14, m + 14, FACE_TEX_SIZE - 2 * (m + 14), FACE_TEX_SIZE - 2 * (m + 14));

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  TEX_CACHE.set(ch, tex);
  return tex;
}

// Chinese characters get explicit ink colors — traditional mahjong has the
// red dragon (中), the 1/5/9 of characters, and the 5 of dots in red; most
// others are black/dark green. We map our pool's Chinese tiles into our
// crimson/jade palette to match the hero tiles.
const CHINESE_CRIMSON = new Set(["中", "一", "五", "九"]);
const CHINESE_JADE    = new Set([
  "發", "東", "南", "西", "北",
  "二", "三", "四", "六", "七", "八",
  "萬",
]);

/** Numbers get crimson, letters/punctuation get jade — like traditional mahjong. */
export function inkColorFor(ch) {
  if (CHINESE_CRIMSON.has(ch)) return INK_CRIMSON;
  if (CHINESE_JADE.has(ch)) return INK_JADE;
  if (/[0-9]/.test(ch)) return INK_CRIMSON;
  return INK_JADE;
}

export class Tile {
  constructor(ch, { x = 0, y = 0, z = 0, seed = Math.random() } = {}) {
    this.ch = ch;
    this.seed = seed;

    const geom = new THREE.BoxGeometry(TILE_W, TILE_H, TILE_D, 1, 1, 1);

    const material = new THREE.ShaderMaterial({
      vertexShader: tileVertex,
      fragmentShader: tileFragment,
      uniforms: {
        uFaceTex:     { value: getFaceTexture(ch) },
        uInkColor:    { value: inkColorFor(ch).clone() },
        uEmission:    { value: 0.0 },
        uFaceVisible: { value: 0.0 },  // 0 while tile is face-down
        uKeyDir:      { value: KEY_DIR.clone() },
        uRimDir:      { value: RIM_DIR.clone() },
        uKeyColor:    { value: KEY_COLOR.clone() },
        uRimColor:    { value: RIM_COLOR.clone() },
        uIvory:       { value: IVORY.clone() },
        uBackColor:   { value: BACK_GREEN.clone() },
        uTime:        { value: 0 },
        uTileSeed:    { value: seed },
      },
    });

    this.mesh = new THREE.Mesh(geom, material);
    this.mesh.position.set(x, y, z);

    // Convenient handles
    this.uniforms = material.uniforms;

    // Destination ("meld") position — where this tile lives once laid down.
    this.meldPos = new THREE.Vector3(x, y, z);
    // Starting ("pool") position — assigned by scene.js as a random scatter
    // inside the bottom pool area. Tile arcs from here to meldPos when drawn.
    this.poolPos = new THREE.Vector3(x, y - 6, z);
    this.poolRot = 0; // random Z-tilt while sitting in the pool

    this.flip = Math.PI; // PI = face-down. 0 = face-up.
  }

  /**
   * Apply per-frame animation state from the timeline.
   *
   * Required fields:
   *   pos:      THREE.Vector3-like (world position)
   *   flip:     X-rotation in radians (PI = face-down, 0 = face-up)
   *
   * Optional:
   *   zRot:     Z-rotation (tile tilt)
   *   yRot:     Y-rotation (spin during travel)
   *   emission: 0..1 glow ramp
   */
  apply(s, time) {
    this.flip = s.flip;

    this.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.mesh.rotation.x = this.flip;
    this.mesh.rotation.y = s.yRot ?? 0;
    this.mesh.rotation.z = s.zRot ?? 0;

    // Face content fades in as the tile rotates past 90° toward camera.
    const facing = Math.max(0, Math.cos(this.flip));
    this.uniforms.uFaceVisible.value = facing;

    this.uniforms.uEmission.value = s.emission ?? 0;
    this.uniforms.uTime.value = time;
  }
}

export const TILE_DIMS = { W: TILE_W, H: TILE_H, D: TILE_D };
