// Session runtime: the live engine instance, loaded model cache and
// transient UI status (loading, toasts). None of this is design data.

import { create } from 'zustand';
import type { ProductModelRef } from '@/domain/types';
import type { StudioEngine } from '@/engine/StudioEngine';
import { loadModelFromBuffer, loadModelFromUrl, type LoadedModel, type LoadStage } from '@/engine/modelLoader';
import { localAssets } from '@/persistence/repositories';

export const REFERENCE_MODEL_URL = `${import.meta.env.BASE_URL}models/reference-clog.glb`;

export const runtime: { engine: StudioEngine | null } = { engine: null };

export interface ModelStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  label: string;
  /** 0..1 when the download size is known; null otherwise (no fake numbers) */
  progress: number | null;
  error: string | null;
}

interface RuntimeState {
  model: LoadedModel | null;
  modelKey: string | null;
  status: ModelStatus;
  toasts: Array<{ id: number; tone: 'info' | 'warn' | 'error'; text: string }>;
  /** bumps when engine-side state shown in panels changes (e.g. a texture finished loading) */
  renderTick: number;
}

export const useRuntime = create<RuntimeState>(() => ({
  model: null,
  modelKey: null,
  status: { state: 'idle', label: '', progress: null, error: null },
  toasts: [],
  renderTick: 0,
}));

const cache = new Map<string, Promise<LoadedModel>>();

export const modelKey = (ref: ProductModelRef) => (ref.source.kind === 'builtin' ? `builtin:${ref.source.id}` : `asset:${ref.source.assetId}`);

function setStage(s: LoadStage) {
  if (s.stage === 'download')
    useRuntime.setState({ status: { state: 'loading', label: 'Loading clog model…', progress: s.total ? s.loaded / s.total : null, error: null } });
  else useRuntime.setState({ status: { state: 'loading', label: 'Preparing design surface…', progress: null, error: null } });
}

export function loadBuiltinModel(): Promise<LoadedModel> {
  const key = 'builtin:reference-clog';
  let p = cache.get(key);
  if (!p) {
    p = loadModelFromUrl(REFERENCE_MODEL_URL, setStage);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export function loadModelBuffer(key: string, buf: ArrayBuffer, name: string): Promise<LoadedModel> {
  let p = cache.get(key);
  if (!p) {
    p = loadModelFromBuffer(buf, name, setStage);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** Ensure the project's model is loaded and current. */
export async function ensureModel(ref: ProductModelRef): Promise<LoadedModel> {
  const key = modelKey(ref);
  const st = useRuntime.getState();
  if (st.modelKey === key && st.model) return st.model;
  useRuntime.setState({ modelKey: key, model: null, status: { state: 'loading', label: 'Loading clog model…', progress: null, error: null } });
  try {
    let m: LoadedModel;
    if (ref.source.kind === 'builtin') m = await loadBuiltinModel();
    else {
      const blobs = await localAssets.get(ref.source.assetId);
      if (!blobs) throw new Error('The model file for this project is missing from local storage.');
      m = await loadModelBuffer(key, await blobs.original.arrayBuffer(), ref.name);
    }
    if (useRuntime.getState().modelKey === key)
      useRuntime.setState({ model: m, status: { state: 'ready', label: '', progress: null, error: null } });
    return m;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    useRuntime.setState({ status: { state: 'error', label: 'Model failed to load', progress: null, error: msg } });
    throw e;
  }
}

let toastId = 0;
export function toast(text: string, tone: 'info' | 'warn' | 'error' = 'info', ms = tone === 'error' ? 9000 : 5000) {
  const id = ++toastId;
  useRuntime.setState((s) => ({ toasts: [...s.toasts, { id, tone, text }] }));
  setTimeout(() => useRuntime.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function dismissToast(id: number) {
  useRuntime.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
