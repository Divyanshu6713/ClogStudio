// Pointer interaction on the 3D viewport. Translates pointer input into
// store commands; the engine only answers geometric questions.
//
//  • click artwork → select it (also locked artwork, so it can be unlocked)
//  • drag unlocked artwork → it slides over the surface of its own mesh
//  • drag elsewhere → orbit (OrbitControls); click on empty space → deselect

import * as THREE from 'three';
import type { ID } from '@/domain/types';
import { activeVersion } from '@/domain/factory';
import type { StudioEngine } from '@/engine/StudioEngine';
import { placementAtHit, reproject } from '@/engine/placement';
import { v3 } from '@/engine/frame';
import { cmd, findLayer } from '@/state/commands';
import { studio, useStudio } from '@/state/store';

const CLICK_SLOP = 4;

export function attachViewportInteraction(engine: StudioEngine, canvas: HTMLCanvasElement): () => void {
  let down: { x: number; y: number; id: number } | null = null;
  let drag: { layerId: ID; mesh: string; offset: THREE.Vector3; pointerId: number } | null = null;
  let pending: PointerEvent | null = null;
  let raf = 0;
  let hoverT = 0;

  const isLocked = (id: ID) => !!findLayer(id)?.locked;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    const layerId = engine.pickLayer(e.clientX, e.clientY, isLocked);
    if (!layerId) return;
    const layer = findLayer(layerId);
    const model = engine.loadedModel;
    if (!layer || !model) return;
    studio.select(layerId);
    const hit = engine.pickSurface(e.clientX, e.clientY, [layer.placement.mesh]);
    if (!hit) return;
    // Grab offset: the artwork keeps its position relative to the pointer, so a grab never jumps.
    drag = { layerId, mesh: layer.placement.mesh, offset: v3(layer.placement.anchor).sub(hit.point), pointerId: e.pointerId };
    engine.setOrbitEnabled(false);
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    studio.begin();
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const applyDrag = () => {
    raf = 0;
    const e = pending;
    pending = null;
    if (!e || !drag) return;
    const model = engine.loadedModel;
    const layer = findLayer(drag.layerId);
    if (!model || !layer) return;
    // Only the first visible surface under the pointer counts: pointing through a
    // vent hole, or at the strap in front of the body, does not move the artwork.
    const hit = engine.pickSurface(e.clientX, e.clientY);
    if (!hit || hit.mesh !== drag.mesh) return;
    const target = hit.point.clone().add(drag.offset);
    const probe = { ...layer.placement, normal: [hit.normal.x, hit.normal.y, hit.normal.z] as [number, number, number] };
    const next = reproject(model, probe, target) ?? placementAtHit(model, hit, layer.placement.up);
    cmd.updatePlacement(drag.layerId, 'Move', next, { live: true });
  };

  const onMove = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.pointerId) {
      pending = e;
      if (!raf) raf = requestAnimationFrame(applyDrag);
      return;
    }
    if (e.buttons === 0) {
      const now = performance.now();
      if (now - hoverT < 60) return;
      hoverT = now;
      canvas.style.cursor = engine.pickLayer(e.clientX, e.clientY, isLocked) ? 'move' : '';
    }
  };

  const endDrag = (commit: boolean) => {
    if (!drag) return;
    if (raf) {
      cancelAnimationFrame(raf);
      applyDrag();
    }
    const name = findLayer(drag.layerId)?.name ?? 'artwork';
    if (commit) studio.commit(`Move ${name}`);
    else studio.cancel();
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    drag = null;
    engine.setOrbitEnabled(true);
    canvas.style.cursor = '';
  };

  const onUp = (e: PointerEvent) => {
    const wasDrag = !!drag;
    endDrag(true);
    if (!wasDrag && down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_SLOP) {
      // plain click: select whatever artwork is under the pointer (locked too), else clear
      const id = engine.pickLayer(e.clientX, e.clientY, () => false);
      studio.select(id);
    }
    down = null;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && drag) {
      e.stopPropagation();
      endDrag(false);
    }
  };

  const onCancel = () => endDrag(false);

  // capture phase so we run before OrbitControls' own pointerdown handler
  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, { capture: true });
  return () => {
    endDrag(false);
    canvas.removeEventListener('pointerdown', onDown, { capture: true });
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, { capture: true });
  };
}

/** Keep the engine in sync with the document, outside React rendering. */
export function attachEngineSync(engine: StudioEngine): () => void {
  const push = () => {
    const s = useStudio.getState();
    if (s.project) engine.sync(activeVersion(s.project), s.project.assets, s.selectedLayerId);
  };
  push();
  return useStudio.subscribe((s, prev) => {
    if (s.project !== prev.project || s.selectedLayerId !== prev.selectedLayerId) push();
  });
}
