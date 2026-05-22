/**
 * Ink-splash particle system.
 *
 * A pre-allocated ring buffer of THREE.Points fed by `emit(...)` calls from
 * main.js whenever a meld tile lands. Particles fly outward in a hemispherical
 * splash, fade with lifetime, and recycle so we never reallocate.
 *
 * Soft additive disk in the fragment shader → glow against the dark bg.
 */

import * as THREE from "three";

const MAX_PARTICLES = 800;

const particleVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSize;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    // Perspective scaling, kept smaller so particles read as sparkle dust
    // rather than glowing orbs that overlay the tile they came from.
    gl_PointSize = aSize * (75.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const particleFragment = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Soft disk falloff
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // Reduced peak alpha — additive particles were dominating the tile they
    // emanate from.
    float a = pow(1.0 - r, 2.2) * vAlpha * 0.55;
    // Mild inner core bloom (was 0.6 — too bright)
    vec3 col = vColor + vec3(1.0, 0.85, 0.55) * pow(1.0 - r, 6.0) * 0.25;
    gl_FragColor = vec4(col, a);
  }
`;

export class ParticleSystem {
  constructor() {
    this.positions  = new Float32Array(MAX_PARTICLES * 3);
    this.colors     = new Float32Array(MAX_PARTICLES * 3);
    this.alphas     = new Float32Array(MAX_PARTICLES);
    this.sizes      = new Float32Array(MAX_PARTICLES);

    // CPU-only state — not uploaded to GPU.
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.birthtimes = new Float32Array(MAX_PARTICLES);
    this.lifetimes  = new Float32Array(MAX_PARTICLES);

    this.next = 0; // ring-buffer write head

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geom.setAttribute("aColor",   new THREE.BufferAttribute(this.colors, 3));
    geom.setAttribute("aAlpha",   new THREE.BufferAttribute(this.alphas, 1));
    geom.setAttribute("aSize",    new THREE.BufferAttribute(this.sizes, 1));
    // Draw range starts at 0 — we'll grow it as we emit
    geom.setDrawRange(0, MAX_PARTICLES);

    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geom, mat);
    this.points.frustumCulled = false;
    this.geom = geom;
  }

  /**
   * Emit `count` particles from `origin` outward in a 3D fan, tinted with
   * `color`. Called once when a tile lands.
   */
  emit(origin, color, count = 18, opts = {}) {
    const speed = opts.speed ?? 1.6;
    const lifetime = opts.lifetime ?? 1.1;
    const sizeBase = opts.size ?? 9.0;
    const upBias = opts.upBias ?? 0.25;
    const now = performance.now() / 1000;

    for (let i = 0; i < count; i++) {
      const idx = this.next % MAX_PARTICLES;
      const i3 = idx * 3;

      this.positions[i3 + 0] = origin.x;
      this.positions[i3 + 1] = origin.y;
      this.positions[i3 + 2] = origin.z;

      // Random direction biased upward — like ink splashing up off the tile
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.7 + upBias);
      const v = speed * (0.5 + Math.random() * 0.7);
      this.velocities[i3 + 0] = Math.cos(theta) * Math.sin(phi) * v;
      this.velocities[i3 + 1] = Math.cos(phi) * v;
      this.velocities[i3 + 2] = Math.sin(theta) * Math.sin(phi) * v;

      this.colors[i3 + 0] = color.r;
      this.colors[i3 + 1] = color.g;
      this.colors[i3 + 2] = color.b;

      this.alphas[idx] = 1.0;
      this.sizes[idx]  = sizeBase * (0.55 + Math.random() * 0.8);

      this.birthtimes[idx] = now;
      this.lifetimes[idx]  = lifetime * (0.7 + Math.random() * 0.6);

      this.next++;
    }

    this.markDirty();
  }

  /**
   * Burst at a meld center — bigger, brighter, with more particles for kongs.
   */
  burst(origin, color, meldSize) {
    const count = meldSize === 4 ? 60 : meldSize === 3 ? 44 : 30;
    this.emit(origin, color, count, {
      speed: 2.4,
      lifetime: 1.5,
      size: 12.0,
      upBias: 0.05,
    });
  }

  /**
   * Advance simulation. Call once per frame with the current time + dt.
   * `t` is in seconds; for visual continuity we use performance.now()/1000.
   */
  update(dt) {
    const now = performance.now() / 1000;
    const gravity = -1.4;       // gentle downward pull
    const drag = 0.92;           // velocity decay per frame at 60fps

    for (let idx = 0; idx < MAX_PARTICLES; idx++) {
      if (this.alphas[idx] <= 0.0) continue;

      const age = now - this.birthtimes[idx];
      const u = age / this.lifetimes[idx];
      if (u >= 1.0) {
        this.alphas[idx] = 0.0;
        // Move dead particle off-screen so it can't accidentally render
        this.positions[idx * 3 + 1] = -9999;
        continue;
      }

      const i3 = idx * 3;
      // Integrate
      this.velocities[i3 + 0] *= drag;
      this.velocities[i3 + 1] = this.velocities[i3 + 1] * drag + gravity * dt;
      this.velocities[i3 + 2] *= drag;

      this.positions[i3 + 0] += this.velocities[i3 + 0] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      // Alpha curve: quick rise, slow fall
      const fadeIn = Math.min(1.0, u * 5.0);
      const fadeOut = 1.0 - u;
      this.alphas[idx] = fadeIn * fadeOut * fadeOut;
    }
    this.markDirty();
  }

  markDirty() {
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.aColor.needsUpdate = true;
    this.geom.attributes.aAlpha.needsUpdate = true;
    this.geom.attributes.aSize.needsUpdate = true;
  }
}
