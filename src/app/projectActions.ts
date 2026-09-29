// Project-level flows that combine storage, model loading and the store.

import type { ProductModelRef, Project } from '@/domain/types';
import { createProject, newId } from '@/domain/factory';
import type { LoadedModel } from '@/engine/modelLoader';
import { localAssets, localProjects } from '@/persistence/repositories';
import { studio } from '@/state/store';
import { loadBuiltinModel, loadModelBuffer } from '@/runtime';
import { sha256 } from '@/assets/importArtwork';

const LAST_KEY = 'clog-studio:last-project';

export function rememberLast(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* storage unavailable: only affects auto-reopen */
  }
}

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function refFromLoaded(m: LoadedModel, source: ProductModelRef['source']): ProductModelRef {
  return {
    source,
    name: m.info.name,
    accuracy: m.info.accuracy,
    side: m.info.side,
    frame: m.info.frame,
    zones: m.zones,
    // A file can only claim calibration through an explicit descriptor; we never infer it.
    calibration: null,
    sizeLabel: null,
    note: m.info.note,
  };
}

async function openNew(p: Project) {
  await localProjects.save(p);
  studio.open(p);
  rememberLast(p.id);
}

export async function createReferenceProject(name: string) {
  const m = await loadBuiltinModel();
  await openNew(createProject(name, refFromLoaded(m, { kind: 'builtin', id: 'reference-clog' })));
}

const MODEL_MAX_BYTES = 150 * 1024 * 1024;

export async function createProjectFromModelFile(file: File, name: string) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.obj') || lower.endsWith('.fbx'))
    throw new Error(`${lower.endsWith('.obj') ? 'OBJ' : 'FBX'} import is not implemented yet. Export the model as GLB (binary glTF) — Blender: File → Export → glTF 2.0 (.glb).`);
  if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) throw new Error('Choose a .glb or .gltf model file.');
  if (file.size > MODEL_MAX_BYTES) throw new Error(`The model is ${(file.size / 1048576).toFixed(0)} MB; the limit is 150 MB.`);
  const buf = await file.arrayBuffer();
  if (lower.endsWith('.gltf') && /"uri"\s*:\s*"(?!data:)/.test(new TextDecoder().decode(buf.slice(0, 2_000_000))))
    throw new Error('This .gltf references external .bin/texture files, which cannot be read from a single upload. Export as .glb instead.');
  const assetId = newId('ast');
  const m = await loadModelBuffer(`asset:${assetId}`, buf, file.name.replace(/\.(glb|gltf)$/i, ''));
  await localAssets.put(assetId, { original: file, preview: null, sanitizedSvg: null });
  const p = createProject(name, refFromLoaded(m, { kind: 'uploaded', assetId }));
  p.assets[assetId] = {
    id: assetId,
    kind: 'model',
    name: file.name,
    mime: lower.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json',
    bytes: file.size,
    sha256: await sha256(file),
    width: null,
    height: null,
    preview: null,
    warnings: m.info.warnings,
    createdAt: Date.now(),
  };
  await openNew(p);
  return m.info.warnings;
}

export async function openProject(id: string) {
  const p = await localProjects.load(id);
  studio.open(p);
  rememberLast(p.id);
}

export function closeProject() {
  studio.close();
  rememberLast(null);
}
