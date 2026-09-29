# Clog Design Studio

Browser-based 3D design studio for visualizing custom clog designs before
manufacturing. One design document → one 3D clog → every camera angle.

```bash
npm install
npm run dev          # http://localhost:5260
npm run build        # typecheck + production build
npm run build:model  # regenerate public/models/reference-clog.glb
```

- Architecture, decisions, plan, risks: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- What to supply (real model, artwork): [docs/MODEL_REQUIREMENTS.md](docs/MODEL_REQUIREMENTS.md)
- Dev self-test (console): `await __clogStudio.consistencyCheck()`

The bundled clog is a **procedural reference stand-in**, not a real product;
dimensions are uncalibrated model units. Previews are digital simulations —
final manufactured colours, positioning, texture and finish may vary.
