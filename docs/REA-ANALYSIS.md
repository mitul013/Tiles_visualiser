# Reference analysis (REA skill)

The feature set of this visualiser was mapped from the public tilesview.ai visualiser using the
[REA – reverse-engineer-anything](https://github.com/morluto/rea) skill (installed in
`.claude/skills/reverse-engineer-anything`, MIT licence). Only public, shipped assets were examined.
No source code, artwork or data from the reference was copied. This project is an independent
implementation with its own code, procedural tile art and 3D rooms.

## How it was analysed

1. The homepage's **"Try Our Visualizer"** button opens a Bootstrap modal containing an iframe:
   `https://tilesview.ai/app/<vendorId>/room-select`.
2. The app shell's public JS bundles were downloaded and analysed with REA's CLI fallback:
   `npx rea-agents analyze-javascript-application <bundle-dir> --json`.
   REA recovered the route map, network endpoint candidates and browser storage keys.
3. The app's public UI string table (`/app/locales/en/translation.json`) was read to list every
   user-facing feature.
4. A live run was attempted with a browser. The app's API answers `403` to automated clients, and
   that protection was respected (not bypassed), so the runtime UI was not observed.

## Recovered routes (REA evidence)

| Route | Meaning | Implemented here as |
|---|---|---|
| `room-select` | Room picker (demo / upload / 360) | Room select screen |
| `visualizer/:roomId` | Main visualiser | 3D room visualiser |
| `visualizer/:roomId/MySpace` | User-uploaded room | Photo room (homography) |
| `panorama/:roomId` | 360° rooms | 360° mode in any demo room |
| `preview-save-room/...`, `qr-append` | Save room + QR | Save design, share link + QR |
| `selection-summary/:id` | Summary of selection | Summary modal |
| `cart` (+ `cartItems` storage) | Cart / inquiry | Cart + checkout inquiry |
| `catalog-preview`, `download` | Catalog PDF | Catalogs + PDF download |
| `upload`, `/app/upload-visitor-product` | Upload own product | "My Upload" tile upload |
| `wishlist`, `search_history` storage | History | Recently viewed |

## Feature checklist (from UI strings) → status

- Surfaces: Wall, Floor, Counter Top, Backsplash, Wall-Floor ✅
- Library: tiles, paint shades, My Upload ✅; filters by size/colour/finish/material/application, search, sort ✅
- Layouts: Grid, Brick, Vertical Stack, Checkered, Herringbone, Quarter Turn (+ Diagonal) ✅
- Rotation, grout size & colour, glossy/matt ✅
- Lighting themes: Daylight, Warm White, Soft White, Crystal White ✅
- Applied products, product details, variants (sizes), specifications, details PDF ✅
- Add to catalog, Your Catalogs, download all designs as one PDF ✅
- Share (link, QR, WhatsApp, Facebook), save design, my saved designs ✅
- Compare, random design, reset, undo/redo, download HD/standard image, fullscreen, dark theme ✅
- Product calculator (area or dimensions, m/ft, waste %, grout) and cart totals (area, boxes, weight, price) ✅
- Not built: AI photo enhancement/auto surface detection (manual 4-corner marking instead), multi-language,
  vendor login/analytics, WhatsApp catalog delivery (needs a backend), wallpaper/rug/mural objects.
