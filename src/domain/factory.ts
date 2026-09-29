import type { DesignVersion, Hex, ID, Project, ProductModelRef, ZoneMaterial } from './types';
import { PROJECT_SCHEMA } from './types';

export const newId = (prefix: string): ID =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

export function normalizeHex(input: string): Hex | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${s.split('').map((c) => c + c).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`.toUpperCase();
  return null;
}

/** Neutral starting colours per zone id. Unknown zones start mid-grey. */
const DEFAULT_ZONE_COLORS: Record<string, Hex> = {
  body: '#E8E1D1',
  sole: '#E8E1D1',
  footbed: '#D9D1BF',
  strap: '#1E3D31',
  hardware: '#2A2A2A',
};

export function defaultMaterials(model: ProductModelRef): Record<string, ZoneMaterial> {
  const out: Record<string, ZoneMaterial> = {};
  for (const z of model.zones) out[z.id] = { color: DEFAULT_ZONE_COLORS[z.id] ?? '#BFBFBF', finish: 'matte-foam' };
  return out;
}

export function createVersion(model: ProductModelRef, name: string): DesignVersion {
  const now = Date.now();
  return {
    id: newId('ver'),
    name,
    createdAt: now,
    updatedAt: now,
    parentId: null,
    status: 'draft',
    favorite: false,
    pair: { mode: 'single-preview' },
    materials: defaultMaterials(model),
    layers: [],
  };
}

export function createProject(name: string, model: ProductModelRef): Project {
  const now = Date.now();
  const v = createVersion(model, 'Version A');
  return {
    schema: PROJECT_SCHEMA,
    id: newId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    model,
    assets: {},
    palettes: [],
    versions: [v],
    activeVersionId: v.id,
  };
}

export function activeVersion(p: Project): DesignVersion {
  return p.versions.find((v) => v.id === p.activeVersionId) ?? p.versions[0];
}
