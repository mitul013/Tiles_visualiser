# Visual comparison against reference renders

To check output quality, 7 public sample images from the tilesview.ai homepage (6 room renders plus
1 marble showcase) were used as **local test fixtures only**. They live in the git-ignored
`test-fixtures/` folder and are never committed. Nothing else was downloaded: no product library and
no app/API data.

The harness `scripts/compare.cjs` renders every case twice and writes an HTML report:

1. **Photo re-tile**: the reference is used as an uploaded room photo, the tiled surface is
   marked with 4 corners, and a comparable tile from our catalog (or a slab texture cropped from
   the sample) is applied. This tests perspective, light/shadow carry-over and masking.
2. **3D equivalent**: the closest demo room with the same tile, layout, grout and finish.

```bash
npm run build && npx vite preview --port 4173 &
npm run compare            # → test-fixtures/report/index.html
```

## Metrics (baseline → after this round of fixes)

| Case | Light & shadow carry-over ¹ | Surface brightness ² | Texture detail ³ | Outside-surface change ⁴ |
|---|---|---|---|---|
| Wood plank floor | 0.93 → **0.99** | 153 → **150** (ref 148) | 9.7 → **13.6** (ref 15.4) | 0.7 |
| Patterned feature wall | 0.75 → **0.94** | 146 → **156** (ref 185) | 61.9 → **65.1** (ref 36.3) | 1.4 |
| Dark marble backsplash | 0.76 → **0.92** | 44 → **38** (ref 69) | 8.1 → **8.7** (ref 19.8) | 0.7 |
| Marble slab countertop | 0.71 → **0.59** | 143 → **155** (ref 180) | 27.5 → **27.1** (ref 23.6) | 1.2 |
| Glossy shower wall | 0.75 → **0.89** | 118 → **127** (ref 74) | 10.5 → **16.3** (ref 10.0) | 0.8 |
| Outdoor stone pavers | 0.88 → **0.96** | 145 → **178** (ref 157) | 14.5 → **11.9** (ref 14.7) | 1.4 |
| Bookmatched marble slabs | 0.51 → **0.49** | 120 → **130** (ref 145) | 29.8 → **31.3** (ref 23.8) | 2.9 |

1. Correlation between the low-frequency luminance of the reference and our render on the
   surface (1.0 = identical light/shadow pattern). Cases where the *tile itself* has large-scale
   contrast (marble slabs) score lower by nature.
2. Mean luminance of the surface. The difference is mostly the tile colour chosen (e.g. our sea-green
   subway is lighter than the reference's teal).
3. High-frequency energy (texture/grout/veins).
4. Mean pixel change outside the marked surface (should be ≈0: the rest of the photo is untouched).

## What the comparison found, and what was fixed

| Finding | Fix |
|---|---|
| Photo re-tiles were too dark: the shading multiply could only darken | Per-pixel light factor normalised to the surface mean, so highlights brighten too |
| Wood planks lay in a strict grid; the ends lined up | New **Random** and **1/3 offset** layouts; stagger now runs along the plank length |
| Marble veins looked like curly wires; no stone cloudiness | New marble art: cloudy multi-scale base, straight crisp veins, hairline network |
| Veins didn't continue between tiles | Marble faces are cut from one 3×3 slab, so veins flow across neighbouring tiles |
| No bookmatch/endmatch for slabs | New **Bookmatch** and **Endmatch** layouts (mirrored slabs) |
| Stone pavers blotchy and repetitive | Finer streaked stone art, lower-contrast clouds, 6 variants, random 180° turns |
| No tile-to-tile tone variation | Per-material tone variation (stronger for handmade subway/zellige, stone, wood) |
| Flat 3D look: no grout depth, no glaze relief | Generated normal + roughness maps: recessed rough grout, bevelled edges, wavy handmade glaze |
| 3D lacked shadows and corner darkening | Shadow-casting key light (soft shadows) on all furniture + baked corner/junction AO |
| Countertop edges were plain white | Countertops are now slabs: the chosen material wraps the edges |
| **Bug**: Vertical Stack left gaps between rows | Fixed |
| **Bug**: capture/catalog/download broke after switching from a 3D room to a photo room | Fixed (each scene only clears its own capture hook) |

## Known differences that remain

- References are AI/photoreal renders with global illumination; our 3D rooms are real-time and
  stylised. Photo re-tiles are the closest like-for-like comparison.
- Objects standing in front of a marked surface are tiled over (no automatic segmentation).
- The old surface's strongest texture (e.g. dark marble veins) can faintly show through in photo
  re-tiles, because light and texture can't be separated perfectly from a single photo.
- Glossy reflections are simulated in 3D only; photo re-tiles get a sheen, not true reflections.
