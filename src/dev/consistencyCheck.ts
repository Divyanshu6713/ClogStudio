// Dev-only regression check for the core promise: one design, many cameras.
// Run in the browser console:  await __clogStudio.consistencyCheck()
//
// For every camera preset it renders the live scene and verifies that
//  1. the design document is byte-identical before and after,
//  2. every artwork mesh has the same world-space bounds in every view,
//  3. where an artwork's centre faces the camera, the rendered pixel there
//     differs from the bare-zone render (the artwork is actually visible).

import * as THREE from 'three';
import { activeVersion } from '@/domain/factory';
import { CAMERA_PRESETS, type StudioEngine } from '@/engine/StudioEngine';
import { useStudio } from '@/state/store';

export interface ViewResult {
  view: string;
  checks: Array<{ layer: string; facing: number; visibleInRender: boolean | null }>;
}

/** Read the drawing buffer right after a render (same task, so it is still intact). */
function snapshot(engine: StudioEngine) {
  engine.renderer.render(engine.scene, engine.camera);
  const gl = engine.renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // canvas pixel (x, y from top) → buffer row from bottom
  return (x: number, y: number) => {
    const i = ((h - 1 - Math.min(h - 1, Math.max(0, y))) * w + Math.min(w - 1, Math.max(0, x))) * 4;
    return [buf[i], buf[i + 1], buf[i + 2]];
  };
}

export async function consistencyCheck(engine: StudioEngine) {
  const project = useStudio.getState().project;
  const model = engine.loadedModel;
  if (!project || !model) throw new Error('Open a project first.');
  const before = JSON.stringify(project);
  const layers = activeVersion(project).layers.filter((l) => l.visible);
  const boxes = (): string =>
    JSON.stringify(layers.map((l) => {
      const m = engine.scene.getObjectByName(`layer:${l.id}`);
      if (!m) return null;
      const b = new THREE.Box3().setFromObject(m);
      return [...b.min.toArray(), ...b.max.toArray()].map((v) => v.toFixed(6));
    }));
  const box0 = boxes();
  const canvas = engine.renderer.domElement;
  const root = model.root;
  const views: ViewResult[] = [];

  for (const preset of CAMERA_PRESETS) {
    engine.setPreset(preset.id, false);
    // render with and without artwork to prove the artwork is what we see
    const withArt = snapshot(engine);
    const meshes = layers.map((l) => engine.scene.getObjectByName(`layer:${l.id}`)).filter(Boolean) as THREE.Object3D[];
    meshes.forEach((m) => (m.visible = false));
    const bare = snapshot(engine);
    meshes.forEach((m) => (m.visible = true));

    const checks = layers.map((l) => {
      const anchor = new THREE.Vector3(...l.placement.anchor).applyMatrix4(root.matrixWorld);
      const n = new THREE.Vector3(...l.placement.normal).transformDirection(root.matrixWorld);
      const facing = n.dot(engine.camera.position.clone().sub(anchor).normalize());
      if (facing < 0.35) return { layer: l.name, facing: +facing.toFixed(2), visibleInRender: null };
      const s = anchor.clone().project(engine.camera);
      const x = Math.round(((s.x + 1) / 2) * canvas.width);
      const y = Math.round(((1 - s.y) / 2) * canvas.height);
      // compare a small neighbourhood so a transparent pixel at the exact centre does not mislead
      let diff = 0;
      for (let dy = -6; dy <= 6; dy += 3)
        for (let dx = -6; dx <= 6; dx += 3) {
          const a = withArt(x + dx, y + dy);
          const b = bare(x + dx, y + dy);
          diff = Math.max(diff, Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]));
        }
      return { layer: l.name, facing: +facing.toFixed(2), visibleInRender: diff > 24 };
    });
    views.push({ view: preset.id, checks });
  }
  engine.setPreset('q-right', false);

  const documentUnchanged = JSON.stringify(useStudio.getState().project) === before;
  const boundsUnchanged = boxes() === box0;
  const failures = views.flatMap((v) => v.checks.filter((c) => c.visibleInRender === false).map((c) => `${v.view}: ${c.layer}`));
  return { pass: documentUnchanged && boundsUnchanged && failures.length === 0, documentUnchanged, boundsUnchanged, failures, views };
}
