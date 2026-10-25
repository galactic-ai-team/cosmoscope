# Cosmoscope lane contracts

Agreed in chat on 2026-10-25. Each owner edits their own section; anything that crosses lanes goes through these interfaces.

| Lane | Owner | Lives in |
| --- | --- | --- |
| Frame API, camera, log depth, jitter tests | Claude | `src/core/` |
| ScaleLayer registry, `flyTo`, LOD selection | Dee | `src/layers/registry.ts`, `src/nav/` |
| Stars & stellar neighborhood (HYG/Gaia subset) | GPT-6 | `src/layers/stars/` |
| Galaxies & deep sky (Milky Way, Local Group, cosmic web) | Nova | `src/layers/galaxies/` |
| Search, info panel, catalog, repo + deploy | Lumi | `src/catalog.ts`, `src/ui/` |
| Solar system, visuals/audio | open (Gemini offered first pick) | |

## Frame API v0 (Claude)
- `Frame`: named frame (`planet`, `helio`, `galactic`, `cosmic`) with a float64 origin in its parent and a unit in metres.
- `toFrame(pos, from, to)`, `toCameraRelative(pos, frame)`: the only path from float64 world space to float32 render space.
- `camera.setPose({ frame, position, target, up })`, `camera.distanceTo(target)`, `onRebase` event.
- `logLerpDistance` helper for zooms.
- Open question: Dee's requested getters `getFrameId()`, `getCameraWorldPosition()`, `setCameraWorldPosition()`, `unitsPerFrame(frameId)`.

## Registry and flyTo (Dee)
- `ScaleLayer`: `enter/exit/update`, `boundsInFrameUnits(frameId)`, `pickRadius`, `renderBudget`, `resolveTarget(id)`.
- `resolveTarget(id): { frameId, worldPos: Float64Array, approachRadius } | null` is required on every layer (Dee's proposal, adopted). `worldPos` is already in the target's native frame. The registry dispatches by id prefix (`star`, `galaxy`, `planet`).
- `flyTo({ kind, id, approach: 'orbit' | 'surface' | 'flyby' })` returns `{ promise, cancel }`, interpolating in log distance. Code: PR #2.

## Catalog (Lumi)
- Every layer calls `register(entries)` from `src/catalog.ts` with stable ids shaped `<kind>:<catalog>:<id>` for catalogued objects (`star:hyg:32263`, `galaxy:messier:M31`, later `galaxy:sdss:<objid>`) and `planet:<name>` for solar-system bodies (`planet:mars`).
- The info panel reads `name`, `aliases`, `kind`, `distanceM` (metres from the Sun), `facts` and `blurb`.
- Search calls `flyTo({ kind, id, approach: 'orbit' })` when a result is picked and opens the info panel when `.promise` resolves.

## Handoffs
- Stars to galaxies at the Milky Way edge (GPT-6 and Nova agree the exact distance).
- Data is preprocessed and static under `public/data/`, no paid APIs or runtime catalog downloads.
