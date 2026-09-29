// Every design mutation goes through here. Each command is a small, named,
// undoable change to the document — UI components never edit the document
// directly.

import type { Draft } from 'immer';
import type { AssetMeta, Hex, ID, ImageLayer, Layer, Project, ProjectedPlacement } from '@/domain/types';
import { newId } from '@/domain/factory';
import { studio, useStudio } from './store';

function version(d: Draft<Project>) {
  const v = d.versions.find((x) => x.id === d.activeVersionId);
  if (!v) throw new Error('No active version');
  return v;
}

function layer(d: Draft<Project>, id: ID) {
  return version(d).layers.find((l) => l.id === id);
}

export function uniqueLayerName(layers: readonly Layer[], base: string): string {
  const names = new Set(layers.map((l) => l.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export const cmd = {
  setZoneColor(zoneId: string, color: Hex, live = false) {
    const recipe = (d: Draft<Project>) => {
      const m = version(d).materials[zoneId];
      if (m) m.color = color;
    };
    if (live) studio.preview(recipe);
    else studio.apply(`Colour: ${zoneId}`, recipe, `zone-color:${zoneId}`);
  },

  applyColors(label: string, colors: Record<string, Hex>) {
    studio.apply(label, (d) => {
      const mats = version(d).materials;
      for (const [zone, c] of Object.entries(colors)) if (mats[zone]) mats[zone].color = c;
    });
  },

  /** Asset + layer as ONE undo step (upload). */
  addAssetWithLayer(meta: AssetMeta, name: string, placement: ProjectedPlacement): ID {
    const id = newId('lyr');
    const now = Date.now();
    studio.apply(`Upload ${meta.name}`, (d) => {
      d.assets[meta.id] = meta;
      const v = version(d);
      v.layers.push({
        id,
        type: 'image',
        name: uniqueLayerName(v.layers, name),
        assetId: meta.id,
        visible: true,
        locked: false,
        opacity: 1,
        flipX: false,
        flipY: false,
        finish: 'printed',
        placement,
        createdAt: now,
        updatedAt: now,
      });
    });
    studio.select(id);
    return id;
  },

  updateLayer(id: ID, label: string, patch: Partial<Omit<ImageLayer, 'id' | 'type' | 'placement'>>, coalesce?: string) {
    studio.apply(
      label,
      (d) => {
        const l = layer(d, id);
        if (!l) return;
        Object.assign(l, patch);
        l.updatedAt = Date.now();
      },
      coalesce,
    );
  },

  /** Placement change. `live` = inside a drag/scrub transaction. */
  updatePlacement(id: ID, label: string, patch: Partial<ProjectedPlacement>, opts: { live?: boolean; coalesce?: string } = {}) {
    const recipe = (d: Draft<Project>) => {
      const l = layer(d, id);
      if (!l) return;
      Object.assign(l.placement, patch);
      l.updatedAt = Date.now();
    };
    if (opts.live) studio.preview(recipe);
    else studio.apply(label, recipe, opts.coalesce);
  },

  removeLayer(id: ID) {
    const l = findLayer(id);
    if (!l) return;
    studio.apply(`Delete ${l.name}`, (d) => {
      const v = version(d);
      v.layers = v.layers.filter((x) => x.id !== id);
    });
    studio.pruneSelection();
  },

  duplicateLayer(id: ID, placement?: ProjectedPlacement): ID | null {
    const src = findLayer(id);
    if (!src) return null;
    const copyId = newId('lyr');
    studio.apply(`Duplicate ${src.name}`, (d) => {
      const v = version(d);
      const i = v.layers.findIndex((x) => x.id === id);
      const now = Date.now();
      const copy = structuredClone(src) as Layer;
      copy.id = copyId;
      copy.name = uniqueLayerName(v.layers, `${src.name} copy`);
      copy.locked = false;
      copy.createdAt = now;
      copy.updatedAt = now;
      if (placement) copy.placement = placement;
      v.layers.splice(i + 1, 0, copy);
    });
    studio.select(copyId);
    return copyId;
  },

  /** Move a layer to a new index in bottom→top order. */
  moveLayer(id: ID, toIndex: number) {
    const l = findLayer(id);
    if (!l) return;
    studio.apply(`Reorder ${l.name}`, (d) => {
      const v = version(d);
      const from = v.layers.findIndex((x) => x.id === id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(v.layers.length - 1, toIndex));
      if (from === to) return;
      const [moved] = v.layers.splice(from, 1);
      v.layers.splice(to, 0, moved);
    });
  },

  renameProject(name: string) {
    studio.apply('Rename project', (d) => {
      d.name = name;
    });
  },
};

export function findLayer(id: ID): Layer | undefined {
  const p = useStudio.getState().project;
  if (!p) return undefined;
  return p.versions.find((v) => v.id === p.activeVersionId)?.layers.find((l) => l.id === id);
}
