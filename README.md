# Tiles Visualiser

A browser-based tile & colour visualiser: pick a room, select the floor, walls, counter top or
backsplash, and apply tiles or paint. Change layout, rotation, grout and finish, then compare,
save, share and collect designs into catalogs you can download as a PDF.

Built with **React 19 + TypeScript + Vite**, **three.js / @react-three/fiber** for the 3D rooms,
**zustand** (persisted to IndexedDB), **jsPDF** and **qrcode**. Everything runs client-side with no backend (room detection can optionally run on your own server).

The feature set was mapped from the public tilesview.ai visualiser with the
[REA skill](https://github.com/morluto/rea) (see [`docs/REA-ANALYSIS.md`](docs/REA-ANALYSIS.md)).

## Features

- **Landing page** with a *Try Our Visualizer* button that opens the visualiser in a full-screen pop-up
- **Room selection**: 6 demo 3D rooms (living, bedroom, kitchen, bathroom, patio, lobby) with category filter
- **Photo rooms use the reference's layered model**: original → tiles → matt/glossy light map (multiply) → highlights
  (screen) → cut-out on top. Every layer can be uploaded (prepared cut-out + light maps) or is generated.
- **Automatic room detection**: upload a photo and the floor, each wall (split at the room's corners), the
  ceiling and every object in front of them are found for you, with the perspective fitted per surface.
  Three open models (MIT / Apache-2.0 / BSD) run in the browser or on your own server: no paid service.
  Each room's real size is measured from the photo, so tile counts match the reference.
  Best run on the bundled backend (Docker): faster, a larger model, nothing for
  visitors to download, and the browser takes over automatically if it is unreachable.
  See [`docs/ROOM-DETECTION.md`](docs/ROOM-DETECTION.md)
- **Phones and tablets**, portrait and landscape: room on top with the catalogue below (side by side when a phone
  is turned), dialogs as full-screen sheets, menus as bottom sheets, touch-sized controls, pinch-to-zoom in the
  room editor, notch / home-indicator safe areas
- **Or mark it by hand**: mark each surface by dragging 4 corners, then roughly paint the **objects in
  front** (sofa, plants, taps): the outline is detected automatically and those objects stay on top,
  untouched. Tiles are perspective-mapped with the photo's own light and shadows and soft edges
- **360° panorama** inside any demo room. Orbit and zoom in normal mode
- **Surfaces**: Floor / Walls / Ceiling / Rug / Wall + Floor / Counter Top / Backsplash, or click any surface in the room (Shift-click to multi-select)
- **Left panel** (grid or list view): wallpapers, slat wall/ceiling panels and rugs (swap or remove the rug), plus tiles (procedurally drawn: procedurally drawn: marble, wood, stone, concrete, terrazzo, ceramic,
  subway, mosaic, hexagon, encaustic patterns), Paint shades (walls and ceilings), My Upload (your own tile image), Applied list
- **Filters & sort**: search, material, colour, size, finish, "only suitable for selected surface"
- **Settings**: 11 layouts (Grid, Brick, 1/3 Offset, Random plank, Vertical Stack, Checkered, Herringbone,
  Quarter Turn, Diagonal, Bookmatch, Endmatch), rotation 0/45/90°, grout size and colour, glossy (real reflections) / matt
- **Realism**: recessed grout and bevels (normal maps), per-finish roughness, handmade glaze relief, per-tile tone
  variation, continuous marble veins across tiles, soft cast shadows, corner occlusion, marble-wrapped countertop edges
- **Lighting**: Daylight, Warm White, Soft White, Crystal White
- **Catalogs**: add designs, then download one or all as a PDF (render, QR link, products, quantities, price)
- **Share**: link (the design is encoded in the URL), QR code, WhatsApp / Facebook / Email
- **Compare**: before/after slider between the original room, the current design, saved designs and catalog entries
- **Header**: Get in touch (inquiry with the design attached), Add to Selection, language selector (EN/ES/FR/DE/HI), Rate your experience
- **Save / My saved designs**, **Random design**, **Undo / Redo / Reset**, **Download HD image**, **Full screen**, **Dark theme**
- **Product details** with size variants, specifications, details PDF
- **Calculator & cart**: area from surfaces or dimensions (m / ft), waste %, grout, giving pieces, boxes, weight and cost, plus an inquiry form

## Your shop's branding and currency

Edit `public/brand.json` (on a deployed server: `dist/brand.json` or the web image's `/srv/brand.json`):
shop name, tagline, logo, phone, WhatsApp, email, website, address, **currency** (ISO code such as
`INR`, `USD`, `AED`) and **locale** (number format such as `en-IN`). The header, page title, prices
and catalogue PDFs follow it after a reload; no rebuild needed. Product prices in
`src/data/products.ts` are taken to be in that currency.

## Demo rooms (room library)

The demo rooms (room picker and the upload dialog's **Library** tab) are photo-real rooms in
`public/library/`: 2 living rooms, 3 kitchens, 2 bedrooms and a bathroom. The photos were generated
with open image models (Qwen-Image and FLUX.1-schnell, both Apache-2.0), so they are free to use
commercially with no credit needed. Each one went through the room detector (floor, walls, ceiling and
backsplash at real size, furniture mask), so tiles show at true scale.

Add your own room photos (a photo you own, or one licensed for commercial use):

```bash
node scripts/library-photos.cjs rooms.json   # rooms.json: [{ "id", "name", "category", "src" }]
```

The script resizes each photo, detects it (large model if `server/models/room-seg-large.onnx` exists),
tidies small wall pieces (kitchens get one merged backsplash) and adds it to `manifest.json`.
`node scripts/library-photos.cjs --tidy` re-runs only the clean-up. Rooms with prepared matt / glossy
cut-outs can still be added to the manifest by hand. The old 3D rooms remain in the code for saved designs
but are no longer listed.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (relative base, deploy anywhere)
```

Open `?visualizer` to jump straight into the room picker.

### Visual comparison harness

See [`docs/COMPARISON.md`](docs/COMPARISON.md). `npm run fixtures` downloads the reference samples into the
git-ignored `test-fixtures/` folder (cases live in `tests/visual/`), then `npm run compare` writes a side-by-side
HTML report with metrics.

### Regenerating room thumbnails

```bash
npm run build && npx vite preview --port 4173 &
npm run thumbnails   # renders public/rooms/<id>.jpg with Playwright
```

## Deploy the whole app on your own server

`deploy/docker-compose.yml` runs the web app (Caddy, automatic HTTPS) and the room-detection
backend together on one machine. Step-by-step guides: any VPS such as Hostinger or DigitalOcean
([`docs/DEPLOY-VPS.md`](docs/DEPLOY-VPS.md)), or Oracle Cloud's free tier ([`docs/DEPLOY-ORACLE.md`](docs/DEPLOY-ORACLE.md)).

## Deploy the web app only (free static hosting)

The app is fully static (`npm run build` → `dist/`, relative paths), so any static host works:

- **Netlify** or **Vercel**: "Import from GitHub" and pick this repo/branch; `netlify.toml` / `vercel.json` set the build.
- **Cloudflare Pages**: build command `npm run build`, output `dist`, env `NODE_VERSION=22`.
- **GitHub Pages**: Settings → Pages → Source "GitHub Actions" (workflow in `.github/workflows/pages.yml`; free for public repos).

## Project layout

```
src/
  data/        products, paints, rooms (surface geometry + defaults)
  lib/         tileArt (procedural tiles), layout (pattern renderer), homography (photo rooms),
               calc, pdf, share
  lib/detect/  automatic room detection: core (pipeline), geometry, imageops, worker, index
server/        optional detection backend (same pipeline in Node)
scripts/detect/  CLI, browser end-to-end test, model export + packing
public/models/ the two detection networks, split into parts
  components/  Visualizer, Scene3D, Furniture, PhotoScene, ProductPanel, SettingsPanel,
               RoomSelect, UploadRoom, Modals, ui
  store.ts     app state (zustand + IndexedDB persistence)
.claude/skills/reverse-engineer-anything   REA skill (MIT)
```

## Notes / limitations

- Uploaded rooms and products are stored only in your browser (IndexedDB). Shared links to them won't open elsewhere.
- Automatic detection is tuned for real room photos. Flat cartoon-style renders, mirrors and glass partitions can be misread; the Surfaces editor (areas, perspective guide, object brush) corrects any room by hand.
- Prices, SKUs and products are demo data.
