// Storage service interfaces + the local (IndexedDB) implementation.
// A future cloud backend implements the same interfaces; the editor does not
// change.

import type { ID, Project } from '@/domain/types';
import { PROJECT_SCHEMA } from '@/domain/types';
import { idbAll, idbDelete, idbGet, idbPut, STORES } from './db';

export interface ProjectSummary {
  id: ID;
  name: string;
  updatedAt: number;
  versionCount: number;
  modelName: string;
}

export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  load(id: ID): Promise<Project>;
  save(project: Project): Promise<void>;
  remove(id: ID): Promise<void>;
}

/** Bytes for one asset. `original` is never modified after upload. */
export interface StoredAssetBlobs {
  original: Blob;
  /** downscaled / rasterised working copy used for rendering (raster + svg) */
  preview: Blob | null;
  /** sanitised SVG markup (svg only) — what the app actually renders */
  sanitizedSvg: string | null;
}

export interface AssetRepository {
  put(id: ID, blobs: StoredAssetBlobs): Promise<void>;
  get(id: ID): Promise<StoredAssetBlobs | undefined>;
  remove(id: ID): Promise<void>;
}

export const localProjects: ProjectRepository = {
  async list() {
    const all = await idbAll<Project>(STORES.projects);
    return all
      .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, versionCount: p.versions.length, modelName: p.model.name }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async load(id) {
    const p = await idbGet<Project>(STORES.projects, id);
    if (!p) throw new Error('Project not found in local storage.');
    if (p.schema !== PROJECT_SCHEMA) throw new Error(`Project uses schema ${p.schema}; this build reads schema ${PROJECT_SCHEMA}.`);
    return p;
  },
  async save(project) {
    await idbPut(STORES.projects, project.id, project);
  },
  async remove(id) {
    const p = await idbGet<Project>(STORES.projects, id);
    if (p) for (const assetId of Object.keys(p.assets)) await idbDelete(STORES.assets, assetId);
    await idbDelete(STORES.projects, id);
  },
};

export const localAssets: AssetRepository = {
  put: (id, blobs) => idbPut(STORES.assets, id, blobs),
  get: (id) => idbGet<StoredAssetBlobs>(STORES.assets, id),
  remove: (id) => idbDelete(STORES.assets, id),
};
