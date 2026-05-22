# ccnyc mahjong poster

a code-driven looping animation for a [creative coding nyc](https://www.instagram.com/creativecodingnyc/) reel. mahjong tiles drop from above and lay down as melds spelling out the event details.

**live:** <https://andrewlidong.github.io/ccnyc-mahjong-poster/>

## made with

- **[three.js](https://threejs.org/)**: 3d scene, vertical 9:16 perspective camera, post-processing chain
- **glsl custom shaders**: tile material (ivory body, engraved character, face-tinted sss + bevel) and the background (domain-warped fbm blue swirl)
- **canvas 2d**: per-character textures generated at runtime (calligraphic brush font for letters, crimson/jade ink for digits/letters mirroring traditional mahjong tiles)
- **no build step**: just static html + es modules + a cdn import for three.js

## run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
