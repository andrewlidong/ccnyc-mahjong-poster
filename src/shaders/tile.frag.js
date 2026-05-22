export const tileFragment = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  varying vec3 vObjectNormal;

  uniform sampler2D uFaceTex;     // RGBA face texture (engraved character)
  uniform vec3 uInkColor;         // crimson or jade — character ink
  uniform float uEmission;        // 0..1, drives reveal glow
  uniform float uFaceVisible;     // 0..1, fades the face content in during the flip past 90°
  uniform vec3 uKeyDir;           // direction toward key light (warm)
  uniform vec3 uRimDir;           // direction toward rim light (cool)
  uniform vec3 uKeyColor;
  uniform vec3 uRimColor;
  uniform vec3 uIvory;            // tile body color
  uniform vec3 uBackColor;        // tile back color (bamboo dark green)
  uniform float uTime;
  uniform float uTileSeed;        // small per-tile variation for grain

  // Cheap value noise
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewDir);
    float NdotV = clamp(dot(n, v), 0.0, 1.0);

    // ------- face detection (object-space normal) -------
    float isFront = step(0.5, vObjectNormal.z);
    float isBack  = step(0.5, -vObjectNormal.z);
    float isEdge  = 1.0 - isFront - isBack;

    // ------- key + rim lighting -------
    float keyDiff = max(dot(n, normalize(uKeyDir)), 0.0);
    float rimDiff = max(dot(n, normalize(uRimDir)), 0.0);

    // Half-vector spec (cheap)
    vec3 hKey = normalize(uKeyDir + v);
    float specKey = pow(max(dot(n, hKey), 0.0), 80.0);

    // ------- body base (used on edges + back) -------
    vec3 grain = vec3(noise(vUv * 80.0 + uTileSeed * 17.0) * 0.04);
    vec3 ivoryBody = uIvory + grain - 0.02;

    // ------- fake SSS / inner glow (Fresnel-like) -------
    // Glow tint MUST match whichever face is visible — otherwise face-down
    // tiles get an ivory halo around their bamboo-green back that reads as
    // a ghost-tile overlay.
    float fres = pow(1.0 - NdotV, 3.0);
    float isBackInit = step(0.5, -vObjectNormal.z);
    vec3 sssTint = mix(uIvory, uBackColor * 1.4, isBackInit);
    vec3 sssWarm = mix(vec3(0.95, 0.78, 0.55), uBackColor * 1.8, isBackInit);
    vec3 sss = sssTint * fres * 0.6 + sssWarm * fres * 0.25;

    // Bevel highlight near tile edge (uv-based) — also tinted by face color.
    vec2 edgeUv = abs(vUv - 0.5) * 2.0; // 0 at center, 1 at edge
    float bevel = smoothstep(0.85, 0.99, max(edgeUv.x, edgeUv.y));
    vec3 bevelTint = mix(vec3(1.0, 0.92, 0.75), uBackColor * 2.2, isBackInit);
    vec3 bevelHi = bevelTint * bevel * 0.5;

    // ------- front face content -------
    // Sample with a tiny chromatic offset to suggest deep engraving
    vec4 faceTex = texture2D(uFaceTex, vUv);
    float ink = faceTex.a;

    // Engraving "depth" — ink area is recessed; soften edges
    float inkSoft = smoothstep(0.05, 0.7, ink);
    float inkEdge = smoothstep(0.0, 0.25, ink) - smoothstep(0.5, 0.9, ink);
    inkEdge = clamp(inkEdge, 0.0, 1.0);

    // Front body starts as ivory; carve in the ink
    vec3 frontCol = ivoryBody;

    // Subtle inset shadow at the ink edge (engraving rim)
    frontCol -= inkEdge * 0.18;

    // Ink fill — crimson or jade depending on the uniform
    vec3 inkFill = mix(uInkColor * 0.55, uInkColor, inkSoft);
    frontCol = mix(frontCol, inkFill, inkSoft * uFaceVisible);

    // ------- back face content -------
    // Two-tone back: a darker bamboo green with a faint engraved corner motif
    vec3 backCol = uBackColor + grain * 0.4;
    // A simple emblem in the center of the back
    vec2 b = vUv - 0.5;
    float r = length(b);
    float emblem = smoothstep(0.18, 0.16, r) - smoothstep(0.13, 0.11, r);
    backCol = mix(backCol, backCol * 1.5, emblem * 0.35);

    // ------- composite by face -------
    vec3 col = ivoryBody;
    col = mix(col, frontCol, isFront);
    col = mix(col, backCol,  isBack);

    // Lighting
    vec3 lit = col * (0.32 + 0.7 * keyDiff) * uKeyColor
             + col * (0.18 + 0.45 * rimDiff) * uRimColor;
    lit += specKey * 0.4 * uKeyColor * (1.0 - isBack); // less spec on back
    lit += sss * 0.7;
    lit += bevelHi;

    // Reveal glow — only the inked area on the front face emits.
    // Kept restrained so bloom + finale doesn't blow out the engraving color.
    float glowMask = ink * isFront * uFaceVisible;
    vec3 glow = uInkColor * glowMask * uEmission * 1.4;
    glow += vec3(1.0, 0.82, 0.45) * glowMask * uEmission * 0.20;

    vec3 outCol = lit + glow;

    // Soft gamma-ish curve
    outCol = pow(outCol, vec3(0.92));

    gl_FragColor = vec4(outCol, 1.0);
  }
`;
