// UI-level actions that need both the document and the loaded model geometry.

import { importArtwork } from '@/assets/importArtwork';
import type { ID } from '@/domain/types';
import { defaultPlacement, modelSize, moveAlongSurface } from '@/engine/placement';
import { localAssets } from '@/persistence/repositories';
import { toast, useRuntime } from '@/runtime';
import { cmd, findLayer } from '@/state/commands';
import { useStudio } from '@/state/store';

function requireModel() {
  const m = useRuntime.getState().model;
  if (!m) throw new Error('The clog model is still loading.');
  return m;
}

/** Zone to receive new artwork: the highlighted zone if printable, else the first printable zone. */
function targetZone(): string | null {
  const s = useStudio.getState();
  const zones = s.project?.model.zones.filter((z) => z.printable) ?? [];
  return zones.find((z) => z.id === s.selectedZoneId)?.id ?? zones[0]?.id ?? null;
}

export async function uploadArtwork(files: File[]) {
  for (const file of files) {
    try {
      const model = requireModel();
      const { meta, blobs } = await importArtwork(file);
      const zone = targetZone();
      const aspect = (meta.preview?.width ?? meta.width ?? 1) / (meta.preview?.height ?? meta.height ?? 1);
      const placement = zone ? defaultPlacement(model, zone, aspect) : null;
      if (!placement) throw new Error('Could not find a printable surface on this model to place the artwork.');
      // Store the untouched original before the document references it.
      await localAssets.put(meta.id, blobs);
      cmd.addAssetWithLayer(meta, file.name.replace(/\.[a-z0-9]+$/i, ''), placement);
      for (const w of meta.warnings) toast(w, 'warn', 8000);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }
}

/** Nudge along the surface in the artwork's own right/up directions. `steps` of 0.4 % model size. */
export function nudge(id: ID, stepsRight: number, stepsUp: number) {
  const l = findLayer(id);
  const m = useRuntime.getState().model;
  if (!l || !m || l.locked) return;
  const step = modelSize(m) * 0.004;
  const next = moveAlongSurface(m, l.placement, stepsRight * step, stepsUp * step);
  if (!next) {
    toast('The surface ends there — artwork stays on its current mesh.', 'info', 2500);
    return;
  }
  cmd.updatePlacement(id, `Nudge ${l.name}`, next, { coalesce: `nudge:${id}` });
}

export function rotateBy(id: ID, deg: number) {
  const l = findLayer(id);
  if (!l || l.locked) return;
  const r = ((((l.placement.rotationDeg + deg + 180) % 360) + 360) % 360) - 180;
  cmd.updatePlacement(id, `Rotate ${l.name}`, { rotationDeg: Math.round(r * 100) / 100 }, { coalesce: `rotate:${id}` });
}

export function duplicate(id: ID) {
  const l = findLayer(id);
  const m = useRuntime.getState().model;
  if (!l) return;
  // offset the copy so it is visibly separate; falls back to the same spot at a surface edge
  const moved = m ? moveAlongSurface(m, l.placement, l.placement.width * 0.2, -l.placement.height * 0.2) : null;
  cmd.duplicateLayer(id, moved ? { ...l.placement, ...moved } : undefined);
}

export function remove(id: ID) {
  const l = findLayer(id);
  if (!l) return;
  if (l.locked) {
    toast(`"${l.name}" is locked. Unlock it to delete.`, 'info', 3000);
    return;
  }
  cmd.removeLayer(id);
}
