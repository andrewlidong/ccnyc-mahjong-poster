export const tileVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  varying vec3 vObjectNormal;

  void main() {
    vUv = uv;
    vObjectNormal = normal;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    // World-space normal (no non-uniform scale, so normalMatrix is fine)
    vNormalW = normalize(mat3(modelMatrix) * normal);

    vec3 camPos = cameraPosition;
    vViewDir = normalize(camPos - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;
