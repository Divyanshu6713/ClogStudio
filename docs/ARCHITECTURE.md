# Clog Design Studio — Architecture & Technical Decisions

Status: **P0 foundation slice built** (one model + artwork layers + true surface
mapping + 360° consistency + colour zones + layers + undo/redo + local
persistence). Versions, comparison, text and export are the next steps.

---

## 1. Product understanding

A pre-manufacturing **visualization tool**, not a shop or an image generator.
The user's real artwork is placed on a real (or stand-in) 3D clog, inspected
from every angle, iterated as versions, and exported as visuals + a
specification. Accuracy and consistency beat creativity.

The core invariant:

```
ONE design document  →  ONE 3D scene  →  MANY cameras
```

Changing the camera never changes the document. Artwork is never redrawn,
recoloured or "improved" — only positioned, scaled, rotated, flipped and faded
by explicit user actions.

## 2. The hard technical problems

| Problem | Why it is hard | What we did |
|---|---|---|
| Artwork that follows a curved surface | Flat planes float; UV-based printing depends on UV quality we don't control in user models | Projected decals clipped to the actual mesh (§5) |
| Consistency across views | Any per-view state or regeneration breaks it | Placements live in model space; cameras are the only thing that moves; verified by an automated check |
| Thin shells & holes | A decal on the outer wall can leak onto the inner wall; a drag ray can fall through a vent hole | Facing filter + connected-patch growth; drag accepts only the first visible surface; re-projection has a max travel distance |
| Stable orientation on a sphere-like toe box | No global "up" field exists on a closed surface (hairy-ball theorem) | "Up" is **stored** with the placement and parallel-transported while dragging — no snapping, deterministic rendering |
| Colour fidelity | ACES/AgX tone mapping and strong lights shift hues | Khronos PBR Neutral tone mapping + lights calibrated so a camera-facing surface renders within ~2 RGB levels of its HEX |
| Honest dimensions | No real model/dimensions exist yet | Model units everywhere; mm only appear when a model carries calibration |
| Undo with continuous drags | Every pointermove must not be a history entry | Transactions (`begin/preview/commit`) + coalescing keys |
| Large/unsafe files | Memory, corrupted images, script-bearing SVG | Magic-byte sniffing, decode checks, size limits, working previews, DOMPurify + raster-only SVG rendering |

## 3. Architecture

```
┌──────────────────────── UI (React) ────────────────────────┐
│ TopBar · ToolRail · Colours/Artwork/Model panels            │
│ Viewport (hosts engine) · Properties · Layers · BottomBar   │
└───────────────┬───────────────────────────────▲─────────────┘
                │ commands (named, undoable)    │ selectors
┌───────────────▼───────────────────────────────┴─────────────┐
│ STATE  src/state   zustand store: Project doc + history +   │
│                    selection + save status                   │
│ DOMAIN src/domain  pure types + factories (no React/three)   │
└───────┬──────────────────────┬───────────────────────┬──────┘
        │ sync(version)        │ autosave               │ asset bytes
┌───────▼────────┐   ┌─────────▼─────────┐   ┌──────────▼─────────┐
│ ENGINE         │   │ PERSISTENCE       │   │ ASSETS             │
│ src/engine     │   │ src/persistence   │   │ src/assets         │
│ StudioEngine   │   │ ProjectRepository │   │ import/validate    │
│ modelLoader    │   │ AssetRepository   │   │ hash, preview, SVG │
│ surfaceIndex   │   │ (IndexedDB impl)  │   │ sanitise           │
│ decal, frame,  │   └───────────────────┘   └────────────────────┘
│ placement      │
└────────────────┘
```

Rules that keep the boundaries clean:

- **The document is the only source of truth.** UI components never hold design
  data in local state (only transient text while typing). The engine renders
  whatever document it is given and never writes to it.
- **All mutations are commands** (`src/state/commands.ts`) with a label, so
  undo/redo, autosave and (later) collaboration all see the same stream.
- **Geometry questions go to pure functions** (`src/engine/placement.ts`) that
  work in model space without a renderer — usable by UI, tests and exporters.
- **Persistence sits behind interfaces** (`ProjectRepository`,
  `AssetRepository`). A cloud backend replaces the IndexedDB implementation
  without touching the editor.

## 4. Technology stack (and why)

Matches the other projects in this workspace (Vite + React 19 + TS + three
0.186 + zustand), so tooling and conventions carry over.

| Dependency | Why | Not chosen |
|---|---|---|
| `three` | Renderer, GLTF loading, PBR, OrbitControls | — |
| `react`, `react-dom` | UI | — |
| `zustand` | Tiny store, subscribe outside React (engine sync without re-renders) | Redux (heavier) |
| `immer` | Immutable document updates → structural sharing makes snapshot undo cheap and lets the engine detect changes by identity | Hand-written spreads |
| `dompurify` | Well-audited SVG sanitiser | Regex stripping |
| `lucide-react` | Icons | — |
| `@fontsource-variable/inter` | Self-hosted UI font | CDN fonts |

**Deliberately not used:** React Three Fiber/Drei. The engine is a plain class
so the same scene can serve the live view, multi-view export and (later)
synchronized comparison viewports, and so drags don't go through React
reconciliation. Fabric/Konva are deferred until the 2D surface editor (P1).

## 5. How the 3D / surface-mapping system works

### Model loading (`modelLoader.ts`)
1. GLB/GLTF → `GLTFLoader` (Meshopt supported; Draco/KTX2 give a clear error).
2. Each mesh gets a **SurfaceIndex**: its triangles copied into *model space*
   (the model root's frame), with smooth normals, flat face normals, and a
   vertex-welded adjacency list (so UV seams don't break connectivity).
3. Zones come from the file's `clogStudio` descriptor (scene extras) or, if
   absent, one zone per named mesh.
4. Empties named `charm_hole_NN` become charm anchors (+Y = outward axis).
5. For display only, the engine wraps the model in a group that aligns up,
   scales to a standard size and stands it on the ground. **Stored data never
   includes this transform.**

### Artwork placement = projected decal (`decal.ts`)
A placement stores: `mesh`, `anchor` (model-space point), `normal`, `up`,
`rotationDeg`, `width`, `height`. To build the visible geometry:

1. Basis = (right, up′, normal) where up′ is `up` rotated by `rotationDeg`.
2. Start at the triangle under the anchor; grow a **connected patch** across
   neighbouring triangles, rejecting triangles facing more than ~78° away
   from the projection axis (so the inside of a thin wall is never hit).
3. Clip each triangle against the projector box (±w/2, ±h/2, ±depth).
4. Emit the clipped polygons **on the original surface** (lifted 0.04 % of model
   size + polygon offset against z-fighting), with UVs from the projector frame
   and interpolated smooth normals.

Consequences: artwork follows curvature, vent holes and the foot opening cut
it exactly as a print would be cut, and the patch never spills onto another
part. The Properties panel reports how much of the rectangle landed on the
surface ("About 21 % falls off this surface").

Why decals instead of UV compositing for P0: they work on **any** mesh
regardless of UV quality, which is essential while we don't know what your real
model's UVs look like. UV-space compositing is reserved for the 2D surface
editor, and only for models that declare clean printable UV islands.

### Direct 3D editing (`viewportInteraction.ts`)
Pointer → ray in model space → first visible surface. Dragging keeps the grab
offset (no jump), re-projects onto the same mesh, carries `up` along, and runs
inside a transaction (one undo step per drag). Pointing through a vent hole or
at the strap in front of the body does not move the artwork.

### Rendering (`StudioEngine.ts`)
One scene: RoomEnvironment PMREM (neutral studio), one soft key light with
shadows, a faint hemisphere fill, a shadow-catcher ground and a contact-shadow
disc. `NeutralToneMapping`, sRGB output. Rendering is on demand (only when
something changed). Layer meshes are rebuilt only when the placement object
identity changes (immer guarantees unchanged objects keep identity).

## 6. Input assets needed from you

See [MODEL_REQUIREMENTS.md](MODEL_REQUIREMENTS.md). In short: **one real clog
GLB** with separately named parts (body, strap, sole, …), sensible scale, and
ideally charm-hole empties and a real dimension (e.g. outsole length) for
calibration. Plus your real artwork files (PNG with transparency / SVG).

## 7. What can be genuinely accurate

- Artwork pixels, proportions, colours and text are exactly your file (hash-verified).
- Placement relative to the **model geometry** — the same point on the mesh in every view.
- Colour HEX values as stored, and their rendering under neutral light (within a few RGB levels for camera-facing surfaces on a calibrated monitor).
- Consistency: every view, export and comparison reads the same document.
- Physical sizes — **only** once the model is calibrated with a real dimension.

## 8. What will only ever be approximate

- How a print behaves on real foam (ink spread, curvature distortion in pad/UV printing, heat).
- Finish previews (printed / glossy decal; later raised/embossed) — visual simulations.
- Colours on other monitors and under other lighting; foam vs screen colour.
- Any model built from photos (Mode B/C) — labelled *Reference / Concept*.
- Other shoe sizes until per-size meshes or scaling profiles exist.
- The current reference clog itself: it is a procedural stand-in, not a product.

## 9. Implementation plan

### P0 — Core design studio
| # | Item | Status |
|---|---|---|
| 1 | Persistent 3D clog model | ✅ reference GLB + user GLB import |
| 2 | 360° viewing, zoom, pan, reset | ✅ |
| 3 | Camera presets (8) | ✅ keys 1–8 |
| 4 | Material/colour zones, HEX/RGB, recent colours | ✅ |
| 5 | Artwork upload (PNG/JPEG/WebP/SVG), validation, originals kept | ✅ |
| 6 | True surface/decal mapping | ✅ |
| 7–10 | Position, scale, rotation, opacity, flip | ✅ drag, numeric, nudge |
| 11–15 | Layers: select, visibility, lock, duplicate, delete, rename, reorder | ✅ |
| 16 | Undo/redo with meaningful history | ✅ |
| 17 | Text layers | ⏭ next |
| 18–19 | Save + reload project | ✅ autosave + Ctrl+S |
| 20 | Design versions (duplicate/branch/switch/final) | ⏭ next — data model ready |
| 21 | Basic comparison | ⏭ |
| 22 | Multi-view PNG export | ⏭ — `engine.capture()` already renders presets from the same scene |
| 23 | Design specification export | ⏭ |
| 24 | Manufacturing disclaimer | ✅ |

### P1 — Advanced designing
Patterns · 2D UV/surface editor (for models with clean UVs) · drawing · crop &
masks · advanced text (curvature) · saved palettes · project dashboard ·
synchronized version comparison · charms snapped to hole anchors · transparent
& hi-res export · left/right pair designs · persisted history snapshots.

### P2 — Production workflow
Admin model preparation (zones, printable regions, hole map, calibration,
camera defaults) · calibrated measurements · printable/safe regions (only from
real production data) · templates · emboss/deboss · annotations · colour
standards · pair/size variants · cloud storage · collaboration & comments ·
presentation boards.

## 10. Major risks

1. **Real model quality** — non-manifold scans, merged meshes (no zones),
   800k+ triangles. Mitigation: model requirements doc; admin prep mode; a BVH
   (e.g. `three-mesh-bvh`) if raycasts get slow.
2. **Decal distortion at steep curvature** — projection stretches near
   silhouettes. Mitigation: facing cut-off + coverage warning; UV compositing
   for flat-ish printable panels later.
3. **Expectation gap** — users reading the preview as a factory proof.
   Mitigation: persistent disclaimer, accuracy badges, no fake mm.
4. **Browser storage limits / eviction** — IndexedDB can be cleared.
   Mitigation: project file export/import (next), cloud storage later.
5. **Fonts for text** — must render identically in export; missing fonts must
   warn, not substitute silently.

## 11. Directory & data architecture

```
clog-studio/
  docs/                 ARCHITECTURE.md, MODEL_REQUIREMENTS.md
  public/models/        reference-clog.glb (generated)
  tools/reference-clog/ sdf.ts (shape) + build.ts (surface nets → GLB)
  src/
    domain/     types.ts (document schema), factory.ts
    state/      store.ts (doc + history + selection), commands.ts, selectors.ts
    engine/     StudioEngine, modelLoader, surfaceIndex, decal, frame, placement
    assets/     importArtwork (validate/hash/preview/sanitise), assetRuntime
    persistence/db.ts, repositories.ts (interfaces + IndexedDB), autosave.ts
    app/        projectActions.ts (create/open/close flows)
    ui/         App, Home, Studio, Viewport, TopBar, BottomBar, panels/, controls/
    dev/        consistencyCheck.ts (dev-only regression check)
```

Project serialisation (what IndexedDB stores, and what a `.clogproj` file will contain):

```jsonc
{
  "schema": 1, "id": "prj_…", "name": "Forest Dragon",
  "model": { "source": {"kind":"builtin","id":"reference-clog"}, "accuracy":"reference",
             "side":"right", "frame":{…}, "zones":[…], "calibration": null },
  "assets": { "ast_…": { "name":"dragon-v4.png", "sha256":"…", "width":2400, … } },
  "palettes": [],
  "versions": [ { "id":"ver_…", "name":"Version A", "parentId":null, "status":"draft",
                  "pair": {"mode":"single-preview"},
                  "materials": { "body": {"color":"#E8E1D1","finish":"matte-foam"}, … },
                  "layers": [ { "type":"image", "assetId":"ast_…", "opacity":1,
                                "placement": { "kind":"projected", "mesh":"body",
                                  "anchor":[…], "normal":[…], "up":[…],
                                  "rotationDeg":0, "width":0.63, "height":0.31 } } ] } ],
  "activeVersionId": "ver_…"
}
```

Asset bytes are stored separately, keyed by asset id: `{ original, preview, sanitizedSvg }`.
Versions will share assets by id — duplicating a version copies only JSON.

---

## Technical decisions explained (requirement §77)

1. **Loading the clog** — GLB → SurfaceIndex per mesh in model space → display
   wrapper. The reference clog is generated offline by `tools/reference-clog`
   and loaded through the *same* path as your model.
2. **Identifying materials** — `clogStudio.zones` descriptor in the file's scene
   extras; otherwise one zone per named mesh. Each zone gets its own cloned
   `MeshStandardMaterial`; colour is set from the stored sRGB HEX.
3. **Surface mapping** — projected, clipped, connected-patch decals (§5). No
   floating planes; placements are model-space points + frames.
4. **Artwork layers** — `ImageLayer { assetId, opacity, flip, finish, placement }`
   in bottom→top order inside a version. Order = render order + polygon offset.
5. **Texture updates** — working image decoded once per asset into a
   `THREE.Texture` (sRGB, mipmapped, anisotropic). Moving artwork rebuilds only
   that layer's decal geometry (typ. < 5 ms); textures are never regenerated
   during a drag.
6. **Charms vs printed graphics** — printed graphics are surface geometry with
   the artwork texture; charms (P1) will be separate 3D objects attached to
   hole anchors (`charm_hole_NN` position + axis) with their own scale/rotation.
   The loader already reads the anchors (13 on the reference clog).
7. **Versions** — `Project.versions[]`, each with its own materials + layers,
   sharing project-level assets; `parentId` records branching. UI is next.
8. **Serialisation** — the `Project` object above; `schema` field for migrations.
9. **Exports** — `engine.capture(preset, w, h, transparent)` renders the live
   scene from a preset camera at a fixed size (selection outline hidden). The
   export UI and spec sheet generator are next.
10. **Limitations** — see §8 and "Known limitations" below.

## Verification (run 2026-09-28)

`await __clogStudio.consistencyCheck()` in the dev console (dev builds only):

- Document byte-identical after rendering all 8 presets ✅
- Every artwork mesh's world-space bounds identical in all views ✅
- Artwork visibly rendered wherever it faces the camera ✅ (and absent where it faces away)

Manual/automated checks performed in the browser:

| Test | Result |
|---|---|
| 1 View consistency | ✅ logo attached in all views (pixel-sampled) |
| 2 Transform consistency | ✅ size/position unchanged by camera changes |
| 4 Save/reload | ✅ reload restores layers, placement, colours |
| 5 Undo | ✅ 4 drags → 4 undo steps back to the exact original coordinates; redo restores |
| 6 Visibility | ✅ hidden layer kept in document, mesh invisible |
| 7 Text in artwork | ✅ "ANKIT" (in a PNG) reads un-mirrored from every facing view |
| 8 Colour | ✅ #E8E1D1 renders rgb(234,227,210) on a camera-facing surface |
| 10 Asset preservation | ✅ stored original re-hashes to upload SHA-256; alpha intact |
| 3 Version isolation, 9 Export | ⏭ with versions / export UI |

## Known limitations (current build)

- Undo history lives in memory (not restored after reload).
- Orphaned asset blobs remain in IndexedDB after "undo upload" (no GC yet).
- Raycasting is brute force (fine for ≤ ~300k triangles; add a BVH for heavier models).
- Model orientation for files without a descriptor is guessed from the bounding box and cannot yet be corrected in the UI.
- OBJ/FBX import, Draco/KTX2 decoding: not yet.
- Small screens get a view-only layout; full editing needs ≥ 960 px width.
