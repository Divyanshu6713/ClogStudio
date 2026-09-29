# What the studio needs from you

## 1. The real clog model (most important)

| Item | Needed? | Notes |
|---|---|---|
| Format **.glb** (binary glTF 2.0) | Required | Blender: *File → Export → glTF 2.0*, format "glTF Binary". Self-contained .gltf also works. OBJ/FBX: convert first. No Draco/KTX2 compression for now (Meshopt is fine). |
| **One mesh per colour zone**, named | Strongly recommended | e.g. `body`, `strap`, `sole`, `footbed`, `hardware`. Unnamed/merged meshes can't be coloured separately. |
| Y-up, toe along +X, outer side along +Z | Recommended | Otherwise the Front/Left/Right presets may be mislabelled until admin setup exists. |
| Real scale (metres) **plus one measured dimension** | Needed for mm | e.g. "outsole length = 287 mm for EU 42". Without it everything stays in model units — we never invent millimetres. |
| Which shoe (left/right) and which size | Recommended | Shown in the viewer; needed for future pair/size support. |
| Clean, watertight-ish surfaces, ≤ 300k triangles | Recommended | Scans with holes or millions of triangles slow down picking and distort artwork. |
| Non-overlapping UVs on printable areas | Optional now | Not needed for 3D placement (decals). Needed later for the 2D surface editor and print templates. |
| Charm-hole empties `charm_hole_01…NN` | Optional | Empty objects at each hole centre, local +Y pointing out of the hole. Enables charm snapping later. |

Optional descriptor (put in the glTF scene's `extras`), exactly like the reference model:

```json
{
  "clogStudio": {
    "schema": 1,
    "modelName": "Classic Clog v1 — EU 42",
    "accuracy": "product",
    "side": "right",
    "frame": { "forward": "+x", "up": "+y", "outer": "+z" },
    "zones": [
      { "id": "body",  "label": "Main Body",  "meshes": ["body"],  "printable": true },
      { "id": "strap", "label": "Heel Strap", "meshes": ["strap"], "printable": true },
      { "id": "sole",  "label": "Outsole",    "meshes": ["sole"],  "printable": true }
    ]
  }
}
```

## 2. Artwork

- PNG with transparency (preferred for logos), JPEG, WebP or SVG.
- At least ~1000 px on the long side for anything printed larger than a thumbnail.
- For SVG with text: convert text to outlines, or the browser's installed fonts are used (the app warns).

## 3. If you only have photos

Front/back/side/top photos can guide a 3D artist but do **not** by themselves
produce dimensionally exact geometry. A single photo can only drive a
*concept* visualization, and the app will label it that way.
