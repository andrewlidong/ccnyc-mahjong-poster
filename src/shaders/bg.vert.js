export const bgVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Fullscreen quad — bypass camera matrices
    gl_Position = vec4(position.xy, 0.999, 1.0);
  }
`;
