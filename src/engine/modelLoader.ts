// Loads a clog model (GLB/GLTF) and turns it into what the studio needs:
// material zones, per-mesh surface indices in model space, and charm-hole
// anchors. The reference clog and user models go through this same path.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ModelAccuracy, ModelFrame, ProductModelRef, ZoneDef } from '@/domain/types';
import { SurfaceIndex } from './surfaceIndex';

export interface HoleAnchor {
  id: string;
  position: THREE.Vector3;
  /** outward axis */
  axis: THREE.Vector3;
  radius: number | null;
}

export interface LoadedModel {
  root: THREE.Group;
  /** mesh node name → mesh */
  meshes: Map<string, THREE.Mesh>;
  /** mesh node name → model-space surface */
  surfaces: Map<string, SurfaceIndex>;
  /** mesh node name → zone id */
  meshZone: Map<string, string>;
  zones: ZoneDef[];
  holes: HoleAnchor[];
  bounds: THREE.Box3;
  /** descriptor facts read from the file (or inferred) */
  info: {
    name: string;
    accuracy: ModelAccuracy;
    side: ProductModelRef['side'];
    frame: ModelFrame;
    calibrated: boolean;
    note: string;
    triangles: number;
    warnings: string[];
  };
}

export type LoadStage = { stage: 'download'; loaded: number; total: number | null } | { stage: 'prepare' };

interface Descriptor {
  modelName?: string;
  accuracy?: ModelAccuracy;
  calibrated?: boolean;
  side?: ProductModelRef['side'];
  frame?: ModelFrame;
  zones?: ZoneDef[];
  note?: string;
}

function loader() {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  return l;
}

function friendlyError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/DRACO/i.test(msg)) return new Error('This model uses Draco compression, which this build cannot decode yet. Export the GLB without Draco compression.');
  if (/KHR_texture_basisu|KTX2/i.test(msg)) return new Error('This model uses KTX2/Basis textures, which this build cannot decode yet. Export with PNG/JPEG textures.');
  if (/Unexpected token|JSON|magic|Invalid/i.test(msg)) return new Error(`The file is not a valid glTF/GLB model (${msg}).`);
  return new Error(`Model failed to load: ${msg}`);
}

export async function loadModelFromUrl(url: string, onStage?: (s: LoadStage) => void): Promise<LoadedModel> {
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) =>
    loader().load(
      url,
      resolve,
      (ev) => onStage?.({ stage: 'download', loaded: ev.loaded, total: ev.lengthComputable ? ev.total : null }),
      (e) => reject(friendlyError(e)),
    ),
  );
  onStage?.({ stage: 'prepare' });
  await nextFrame();
  return prepare(gltf.scene, gltf.scenes[0]?.userData ?? {}, 'model');
}

export async function loadModelFromBuffer(buf: ArrayBuffer, fileName: string, onStage?: (s: LoadStage) => void): Promise<LoadedModel> {
  onStage?.({ stage: 'prepare' });
  let gltf;
  try {
    gltf = await loader().parseAsync(buf, '');
  } catch (e) {
    throw friendlyError(e);
  }
  await nextFrame();
  return prepare(gltf.scene, gltf.scenes[0]?.userData ?? {}, fileName);
}

// Yield so the loading label can paint. A timer (not rAF) keeps loading going in background tabs.
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

function prepare(scene: THREE.Group, sceneExtras: Record<string, unknown>, fallbackName: string): LoadedModel {
  const warnings: string[] = [];
  const desc = (sceneExtras.clogStudio ?? null) as Descriptor | null;
  const root = new THREE.Group();
  root.name = 'model-root';
  root.add(scene);
  root.updateMatrixWorld(true);

  const meshes = new Map<string, THREE.Mesh>();
  const holes: HoleAnchor[] = [];
  let unnamed = 0;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) warnings.push(`"${o.name}" is skinned; it is shown in its bind pose.`);
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      if (!m.name || meshes.has(m.name)) m.name = `${m.name || 'part'}_${++unnamed}`;
      meshes.set(m.name, m);
    } else if (/^charm_hole/i.test(o.name)) {
      const pos = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const axis = new THREE.Vector3(0, 1, 0).transformDirection(o.matrixWorld);
      holes.push({ id: o.name, position: pos, axis, radius: typeof o.userData.radius === 'number' ? o.userData.radius : null });
    }
  });
  if (meshes.size === 0) throw new Error('The model contains no meshes.');

  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const surfaces = new Map<string, SurfaceIndex>();
  const bounds = new THREE.Box3();
  let triangles = 0;
  for (const [name, mesh] of meshes) {
    const s = new SurfaceIndex(mesh, rootInv.clone().multiply(mesh.matrixWorld));
    surfaces.set(name, s);
    bounds.union(s.bounds);
    triangles += s.triCount;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  // Zones: from the descriptor if the file has one, otherwise one zone per mesh.
  let zones: ZoneDef[];
  if (desc?.zones?.length) {
    zones = desc.zones.map((z) => ({ ...z, meshes: z.meshes.filter((m) => meshes.has(m)) })).filter((z) => z.meshes.length);
    const covered = new Set(zones.flatMap((z) => z.meshes));
    for (const name of meshes.keys()) if (!covered.has(name)) zones.push({ id: slug(name), label: name, meshes: [name], printable: true });
  } else {
    zones = [...meshes.keys()].map((name) => ({ id: slug(name), label: labelFrom(name), meshes: [name], printable: true }));
    warnings.push('No zone descriptor in the file: each mesh became one colour zone. Name meshes (body, strap, sole…) for clearer zones.');
  }
  const meshZone = new Map<string, string>();
  for (const z of zones) for (const m of z.meshes) meshZone.set(m, z.id);

  // Frame: trust the descriptor; otherwise glTF is +Y up and we guess the toe
  // points along the longest horizontal axis (editable in Model settings).
  let frame: ModelFrame;
  if (desc?.frame) frame = desc.frame;
  else {
    const size = bounds.getSize(new THREE.Vector3());
    frame = size.x >= size.z ? { forward: '+x', up: '+y', outer: '+z' } : { forward: '-z', up: '+y', outer: '+x' };
    warnings.push('Model orientation was guessed from its bounding box. Check the Front view and correct it in Model settings if needed.');
  }

  return {
    root,
    meshes,
    surfaces,
    meshZone,
    zones,
    holes,
    bounds,
    info: {
      name: desc?.modelName ?? fallbackName,
      accuracy: desc?.accuracy ?? 'product',
      side: desc?.side ?? 'unknown',
      frame,
      calibrated: desc?.calibrated === true,
      note: desc?.note ?? '',
      triangles,
      warnings,
    },
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zone';
const labelFrom = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
