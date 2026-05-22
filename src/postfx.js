import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/** Minimal RGB shift shader (chromatic aberration) for the reveal pulses. */
const RGBShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount:   { value: 0.0 },     // 0..0.01
    angle:    { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float angle;
    varying vec2 vUv;
    void main() {
      vec2 offset = amount * vec2(cos(angle), sin(angle));
      vec4 cr = texture2D(tDiffuse, vUv + offset);
      vec4 cg = texture2D(tDiffuse, vUv);
      vec4 cb = texture2D(tDiffuse, vUv - offset);
      gl_FragColor = vec4(cr.r, cg.g, cb.b, cg.a);
    }
  `,
};

export function buildPostFX(renderer, scene, camera, width, height) {
  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.55, // strength (modulated per-frame)
    0.55, // radius — tighter so the engraving stays readable
    0.85  // threshold — only bright spots bloom
  );
  composer.addPass(bloom);

  const rgbShift = new ShaderPass(RGBShiftShader);
  composer.addPass(rgbShift);

  composer.addPass(new OutputPass());

  return {
    composer,
    bloom,
    rgbShift,
  };
}
