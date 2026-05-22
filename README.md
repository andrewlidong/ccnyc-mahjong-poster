# CCNYC Mahjong Poster

A code-driven looping animation for a [Creative Coding NYC](https://creativecoding.nyc) Reel — mahjong tiles drop from above and lay down as melds spelling out the event details.

**Live:** <https://andrewlidong.github.io/ccnyc-mahjong-poster/>

## Made with

- **[Three.js](https://threejs.org/)** — 3D scene, vertical 9:16 perspective camera, post-processing chain
- **GLSL custom shaders** — tile material (ivory body, engraved character, face-tinted SSS + bevel) and the background (domain-warped FBM blue swirl)
- **Canvas 2D** — per-character textures generated at runtime (calligraphic brush font for letters, crimson/jade ink for digits/letters mirroring traditional mahjong tiles)
- **No build step** — just static HTML + ES modules + a CDN import for Three.js

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Record

The canvas is fixed at 1080×1920 (9:16). Screen-record one loop (~22s) and you've got a Reel-ready clip.
