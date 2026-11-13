# Automatic room detection

Upload one photo of a room and the visualiser finds, with no manual marking:

- the **floor**, the **ceiling** and **each wall separately** (walls are split at the room's corners),
- the **perspective** of every surface, so tiles recede correctly on each plane,
- an **object layer**: sofas, chairs, plants, lamps, curtains, windows, pictures, counters, anything that
  is not a tileable surface. Those pixels stay on top, untouched, whatever tile or colour is applied.

It is the same information the reference visualiser's backend returns for an uploaded room:

| Reference file | What it is | Here |
|---|---|---|
| `object_msk…` (black / white) | object layer | `objMask` of the room (PNG alpha) |
| `unq_…` (grey levels 100 / 103 / 106) | surface-id mask: one id per plane | one `PhotoSurface` per plane (`area` outline) |
| vanishing points + focal length | camera, plane per surface | `quad` perspective guide per surface, fitted from 3D planes |
| `merger_…` (blurred photo) | lighting layer | generated light maps (`src/lib/roomLayers.ts`) |

In the upload dialog choose **Detect room automatically**. The editor then opens with every area,
perspective guide and the object layer already filled in, so the result can be checked and given
finishing touches (drag an area point, move the guide, paint or erase objects) before pressing
**Use this room**. **Mark surfaces by hand instead** keeps the fully manual route.

Editing the object layer (step 2 of the editor):

- **Paint** adds what you paint; **Erase** rubs out only what the eraser touches; **Remove object**
  takes out one whole object with a single tap (it uses the detected kind of each pixel, so removing
  a plant leaves the curtain behind it). No action ever changes the rest of the layer.
- **Undo** steps back through the last 8 actions.
- **Zoom** (− / + / Fit, Ctrl + scroll, or a two-finger pinch) with **Move** to drag the zoomed photo.
- **Focus mode**: the button in the photo's bottom-right corner fills the screen with the photo. A
  slim bar keeps the essential tools; the gear opens a drawer with the steps and every other option.
  A landscape room on a phone held upright is turned sideways (the screen is locked to landscape
  where the browser allows it, otherwise the view itself is rotated). A phone already held sideways
  opens the editor in focus mode.

In the visualiser, **Preview** (bottom-right of the room) shows the designed room full screen on any
device, turned sideways the same way.

## Measured against the reference

On the sample room supplied with this feature (`room_original_2.webp`), compared with the reference's
own masks for the same photo:

| Check | Result |
|---|---|
| Object layer overlap (IoU), browser settings | **96.3%** |
| Object layer overlap (IoU), server settings | **95.7%** (lower only because it also keeps the lamp stem and chair slats the reference drops) |
| Pixels assigned to the same surface (floor / left wall / right wall) | **99.4%** |
| Camera | 48° field of view, level horizon: matches the photo's vertical lines |

Reproduce: `npm run detect -- photo.webp --ref-obj object_msk.webp --ref-ids unq.webp --rugs --ref-no-ceiling`
(`--rugs` and `--ref-no-ceiling` because the reference tiles over rugs and does not offer the ceiling).

## Real-world scale (how many tiles fit)

**How the reference does it.** Nothing is hard-coded. For every uploaded photo its server returns,
per surface, four image corners plus `width_m`, `height_m`, `avg_depth` and `tiles_x` / `tiles_y`
(= size in metres / 0.6), and a camera field of view. The sizes come from a metric depth estimate of
that photo: the test living room came out 2.77 m high, the test corridor 2.24 m. (Its catalogue
rooms are hand-built 3D models instead: a camera plus one plane per surface.)

**How we do it, the same way.** Per photo:

1. the room's shape (planes, corners, camera) comes from the depth network, as before;
2. floor and ceiling are made level and slid to meet the walls on the junctions seen in the photo;
3. **absolute size** comes from a third network, Metric3D v2, which predicts real distances for a
   camera of known focal length. The room is scaled by the median ratio between its distances and
   our planes' over the visible surfaces, times a calibration of 0.85 (the reference's sizes run
   15% smaller than metric depth implies, by the same amount on both uploads compared). Without
   that network the old rule applies: 2.7 m ceiling, or the depth network's metres x 1.2.

Size of 1 m on screen, ours vs the reference, on the same photos:

| Room | Before (2.7 m ceiling rule) | Now (measured per photo) |
|---|---|---|
| Uploaded living room (`tv_room_v3`) | 1.06x | **1.00x** (walls 0.97 to 1.02, floor 0.91 to 0.99) |
| Uploaded corridor (`tv_room_v3`) | 0.74x | **0.99x** (end wall 1.17, side walls 0.90 to 1.14) |
| Catalogue room 1710 (hand-built model) | 1.0 to 1.2x | about 0.93x |

The same photo gives the same room in the browser and on the server (1.01x vs 1.00x above).

## How it works

```
photo ─► segmentation network ─► wall / floor / ceiling / 147 object classes per pixel
      ─► metric depth network ─► distance of every pixel
      ─► geometry ─► planes, wall corners, camera ─► perspective guide + outline per surface
      ─► object layer ─► edges snapped to the photo (guided filter)
```

1. **Segmentation** (UperNet + ConvNeXt-T, ADE20K): every pixel is a wall, floor, ceiling or one of 147
   object classes. Everything that is not wall / floor / ceiling goes to the object layer.
2. **Metric depth** (Depth Anything V2, indoor): a 3D plane is exactly linear in inverse depth, so each
   surface is fitted by robust least squares. Walls are split where that linear model changes along
   the photo (dynamic programming over the per-column wall profile); each break is a room corner.
3. **Camera**: the focal length is the value that makes floor, ceiling and walls mutually perpendicular.
   Walls are then snapped upright, so corners run along the room's true vertical.
4. **Clean edges**: borders between two surfaces are replaced by the straight line fitted through them;
   object edges are snapped to the photo's own edges; thin parts that only show in depth (lamp arms,
   chair legs) are added to the object layer.
5. **Output**: per surface a perspective guide (a real 1 m square on the plane), an outline and a
   size; plus the object layer. The existing renderer and Surfaces editor use them unchanged, so any
   detected room can still be corrected by hand (areas, guide, object brush).

Code: `src/lib/detect/core.ts` (pipeline), `geometry.ts`, `imageops.ts`. Pure TypeScript on typed
arrays, shared by the browser worker and Node.

## Models and cost

| | Model | Licence | Download |
|---|---|---|---|
| Segmentation | `openmmlab/upernet-convnext-tiny` | MIT | 60 MB |
| Depth (room shape) | `depth-anything/Depth-Anything-V2-Metric-Indoor-Small` | Apache-2.0 | 27 MB |
| Scale (room size) | Metric3D v2 small (`onnx-community/metric3d-vit-small`) | BSD-2-Clause (ONNX export CC0) | 41 MB |

Both are open weights that run on a plain CPU: there is no paid API and no per-image cost. They are
stored in `public/models/` as 8-bit ONNX files split into parts under 20 MB (so any static host
serves them). `scripts/detect/export_models.py` rebuilds them from the public checkpoints.

The segmentation model was trained on the ADE20K dataset, whose images are released for research use;
the weights themselves are MIT-licensed. Have this checked if your legal team requires it.

## Where it runs

**In the browser (default).** Nothing to host and photos never leave the device. The models download
once (128 MB) and are cached. Measured in headless Chromium on a 4-core cloud machine (WebAssembly,
one thread): about 50 s per photo, of which the size network takes about 24 s. Expect phones to be slower.

**On your own server (recommended for production).** The same pipeline in Node, and nothing for
visitors to download. Measured on the same 4-core machine: about 9 s per photo at browser settings,
13 to 16 s with the finer server defaults below:

```bash
npm run detect:server                     # http://localhost:8787, POST /detect
VITE_DETECT_API=https://your-host npm run build
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | port of the service |
| `DETECT_ORIGIN` | `*` | allowed web origin (CORS) |
| `DETECT_THREADS` | 4 | CPU threads per photo |
| `DETECT_SEG` | 960 | segmentation resolution (browser uses 768) |
| `DETECT_DETAIL` | 1218 | resolution of the thin-object pass (0 = off, as in the browser) |
| `VITE_DETECT_API` | unset | build-time: URL of the service; unset = detect in the browser |
| `VITE_MODEL_BASE` | `models/` | build-time: where the browser loads the models from |

## Testing

```bash
npm run detect -- room.jpg --out detect-out      # overlay.jpg, objects.png, result.json
npm run build && npx vite preview --port 4173 &
npm run detect:e2e -- room.jpg detect-out        # real browser: upload, detect, tile, screenshots
```

## Known limits

- **Rugs** stay on the new floor by default ("Tile over rugs" switches that). A rug the network does
  not recognise is tiled over, and its outline can show faintly in the lighting.
- **Very thin objects** (a lamp stem) are caught by the server's thin-object pass but can be missed in
  the browser, where that pass is off for speed. The object brush in the Surfaces editor fixes it.
- **Glass and mirrors** (shower screens, mirrored walls) are detected unevenly.
- **Flat, cartoon-style 3D renders** are outside what the networks were trained on.
- **Dark art or murals painted on a wall** that are not masked as objects show through as shading.
- Tile scale is anchored on a 2.7 m ceiling when floor and ceiling are visible, otherwise on a
  typical camera height; adjust the guide size in the Surfaces editor if tiles look too big or small.
