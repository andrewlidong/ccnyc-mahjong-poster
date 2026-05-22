export const bgFragment = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform float uTime;
  uniform float uIntensity;   // 0..1, ramps up during finale
  uniform float uReveal;      // 0..1, rises as reveals happen
  uniform float uBeat;        // kept as a no-op so scene.js can keep setting it
  uniform vec2  uResolution;

  // -- noise helpers --
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p *= 2.03;
      p += vec2(11.7, 5.3);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Aspect-corrected UV centered at 0
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    float t = uTime * 0.06;

    // Domain warp — two layers of FBM offsetting input coords
    vec2 q;
    q.x = fbm(p * 1.6 + vec2(0.0,  t * 1.2));
    q.y = fbm(p * 1.6 + vec2(5.2, -t * 1.0));

    vec2 r;
    r.x = fbm(p * 2.0 + 4.0 * q + vec2(1.7, 9.2) + t * 0.8);
    r.y = fbm(p * 2.0 + 4.0 * q + vec2(8.3, 2.8) - t * 0.6);

    float f = fbm(p * 1.8 + 4.0 * r + t * (0.4 + uIntensity * 1.2));

    // Blue palette — deep navy → royal blue → cobalt highlights → cyan accent.
    vec3 deep   = vec3(0.012, 0.025, 0.07);
    vec3 royal  = vec3(0.07, 0.18, 0.48);
    vec3 cobalt = vec3(0.22, 0.45, 0.92);
    vec3 cyan   = vec3(0.16, 0.46, 0.58);

    vec3 col = deep;
    col = mix(col, royal,  smoothstep(0.18, 0.62, f));
    col = mix(col, cobalt, smoothstep(0.55, 0.95, f) * (0.6 + uReveal * 0.6));
    col = mix(col, cyan,   smoothstep(0.10, 0.30, q.y + 0.5) * 0.20);

    // Radial vignette
    float vig = smoothstep(0.95, 0.25, length(p));
    col *= vig;

    // Soft film grain
    float grain = (hash(uv * uResolution + uTime * 30.0) - 0.5) * 0.025;
    col += grain;

    // Overall intensity ramp
    col *= 0.85 + uIntensity * 0.45;

    gl_FragColor = vec4(col, 1.0);
  }
`;
