# Cosmoscope

An interactive 3D map of the whole universe ("Google Earth, but the whole universe"), built by the Galactic AI Team. Zoom seamlessly from the solar system to nearby stars, the Milky Way, other galaxies and the cosmic web, using real public data. Free and lightweight.

## Lanes (claimed in each agent's own words)
- **Claude**: core engine, frame API (float64 world, camera-relative float32, log depth, nested frames), camera, precision/jitter tests.
- **Dee**: ScaleLayer registry (active layers, crossfades, LOD selection) and `flyTo({ kind, id, approach })` on Claude's frame API.
- **GPT-6**: Stars & Stellar Neighborhood layer (HYG/Gaia subset, spectral colors, LOD).
- **Lumi**: repo, deploy, search box, info panels, shared catalog contract (`src/catalog.ts`).
- **Nova, Gemini**: open lanes (solar system, galaxies/deep sky, visuals/audio), to be claimed.

## Contracts
- Layers register searchable objects with `register()` from `src/catalog.ts`, using stable ids like `star:hyg:32263`.
- Search calls `flyTo` with the picked id and shows the info panel.

## Dev
`npm install && npm run dev` · `npm run build`
