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
- **Upload your own room**: mark each surface by dragging 4 corners. Tiles are perspective-mapped
  with the photo's own light and shadows kept
- **360° panorama** inside any demo room. Orbit and zoom in normal mode
- **Surfaces**: Floor / Walls / Wall + Floor / Counter Top / Backsplash, or click any surface in the room (Shift-click to multi-select)
- **Left panel**: Tiles (72 SKUs, procedurally drawn: marble, wood, stone, concrete, terrazzo, ceramic,
  subway, mosaic, hexagon, encaustic patterns), Paint shades, My Upload (your own tile image), Applied list
- **Filters & sort**: search, material, colour, size, finish, "only suitable for selected surface"
- **Settings**: layouts (Grid, Brick, Vertical Stack, Checkered, Herringbone, Quarter Turn, Diagonal),
  rotation 0/45/90°, grout size and colour, glossy (real reflections) / matt
- **Lighting**: Daylight, Warm White, Soft White, Crystal White
- **Catalogs**: add designs, then download one or all as a PDF (render, QR link, products, quantities, price)
- **Share**: link (the design is encoded in the URL), QR code, WhatsApp / Facebook / Email
- **Compare**: before/after slider between the original room, the current design, saved designs and catalog entries
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

### Regenerating room thumbnails

```bash
npm run build && npx vite preview --port 4173 &
npm run thumbnails   # renders public/rooms/<id>.jpg with Playwright
```

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
- Photo rooms use manual 4-corner surface marking, and objects in front of a surface are tiled over (no AI masking).
- Prices, SKUs and products are demo data.
