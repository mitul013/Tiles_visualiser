# Tiles Visualiser

A browser-based tile & colour visualiser: pick a room, select the floor, walls, counter top or
backsplash, and apply tiles or paint. Change layout, rotation, grout and finish, then compare,
save, share and collect designs into catalogs you can download as a PDF.

Built with **React 19 + TypeScript + Vite**, **three.js / @react-three/fiber** for the 3D rooms,
**zustand** (persisted to IndexedDB), **jsPDF** and **qrcode**. Everything runs client-side with no backend.

The feature set was mapped from the public tilesview.ai visualiser with the
[REA skill](https://github.com/morluto/rea) (see [`docs/REA-ANALYSIS.md`](docs/REA-ANALYSIS.md)).

## Features

- **Landing page** with a *Try Our Visualizer* button that opens the visualiser in a full-screen pop-up
- **Room selection**: 6 demo 3D rooms (living, bedroom, kitchen, bathroom, patio, lobby) with category filter
- **Photo rooms use the reference's layered model**: original → tiles → matt/glossy light map (multiply) → highlights
  (screen) → cut-out on top. Every layer can be uploaded (prepared cut-out + light maps) or is generated.
- **Upload your own room**: mark each surface by dragging 4 corners, then roughly paint the **objects in
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

## Deploy (free)

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
  components/  Visualizer, Scene3D, Furniture, PhotoScene, ProductPanel, SettingsPanel,
               RoomSelect, UploadRoom, Modals, ui
  store.ts     app state (zustand + IndexedDB persistence)
.claude/skills/reverse-engineer-anything   REA skill (MIT)
```

## Notes / limitations

- Uploaded rooms and products are stored only in your browser (IndexedDB). Shared links to them won't open elsewhere.
- Photo rooms use manual 4-corner surface marking. Object outlines come from colour segmentation of a rough brush, not an AI model.
- Prices, SKUs and products are demo data.
