// Surface placement operations. Pure model-space geometry: no renderer, no
// camera. Used by the viewport (drag), keyboard nudges and numeric inputs.

import * as THREE from 'three';
import type { ProjectedPlacement, Vec3 } from '@/domain/types';
import type { LoadedModel } from './modelLoader';
import { decalBasis } from './decal';
import { defaultUp, frameVectors, surfaceRegion, toVec3, transportUp, v3 } from './frame';

export interface SurfaceHit {
  mesh: string;
  zoneId: string;
  tri: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

/** Characteristic model size (longest bounding-box side), model units. */
export const modelSize = (m: LoadedModel) => {
  const s = m.bounds.getSize(new THREE.Vector3());
  return Math.max(s.x, s.y, s.z);
};

/** Nearest front-facing hit across the given meshes (all meshes when omitted). */
export function raycastModel(m: LoadedModel, origin: THREE.Vector3, dir: THREE.Vector3, meshes?: string[]): SurfaceHit | null {
  let best: SurfaceHit | null = null;
  let bestT = Infinity;
  for (const name of meshes ?? m.surfaces.keys()) {
    const s = m.surfaces.get(name);
    if (!s) continue;
    const h = s.raycast(origin, dir, true);
    if (h && h.t < bestT) {
      bestT = h.t;
      const point = origin.clone().addScaledVector(dir, h.t);
      best = { mesh: name, zoneId: m.meshZone.get(name) ?? name, tri: h.tri, point, normal: s.normalAt(h.tri, point, new THREE.Vector3()) };
    }
  }
  return best;
}

function labelFor(m: LoadedModel, hit: SurfaceHit): string {
  const s = m.surfaces.get(hit.mesh)!;
  return surfaceRegion(hit.point, hit.normal, s.bounds.getCenter(new THREE.Vector3()), frameVectors(m.info.frame));
}

/** Placement fields that follow from a surface hit, carrying the artwork's "up" along. */
export function placementAtHit(m: LoadedModel, hit: SurfaceHit, prevUp: Vec3 | null): Pick<ProjectedPlacement, 'anchor' | 'normal' | 'up' | 'mesh' | 'zoneId' | 'surfaceLabel'> {
  const f = frameVectors(m.info.frame);
  const up = prevUp ? transportUp(prevUp, hit.normal, f) : defaultUp(hit.normal, f);
  return {
    anchor: toVec3(hit.point),
    normal: toVec3(hit.normal),
    up: toVec3(up),
    mesh: hit.mesh,
    zoneId: hit.zoneId,
    surfaceLabel: labelFor(m, hit),
  };
}

/**
 * Default spot for new artwork on a zone: the middle of its outer side,
 * found by casting a ray at the zone from outside. Deterministic.
 */
export function defaultPlacement(m: LoadedModel, zoneId: string, aspect: number): ProjectedPlacement | null {
  const zone = m.zones.find((z) => z.id === zoneId);
  if (!zone) return null;
  const f = frameVectors(m.info.frame);
  const size = modelSize(m);
  for (const mesh of zone.meshes) {
    const s = m.surfaces.get(mesh);
    if (!s) continue;
    const c = s.bounds.getCenter(new THREE.Vector3());
    const ext = s.bounds.getSize(new THREE.Vector3());
    // aim a little toward the toe (clear of a heel strap) and near mid-height
    const target = c.clone().addScaledVector(f.forward, 0.1 * ext.dot(absV(f.forward)));
    for (const side of [f.outer, f.up, f.forward, f.outer.clone().negate()]) {
      const origin = target.clone().addScaledVector(side, size * 2);
      const hit = raycastModel(m, origin, side.clone().negate(), [mesh]);
      if (!hit) continue;
      let width = size * 0.22;
      let height = width / aspect;
      const maxH = ext.dot(absV(f.up)) * 0.45;
      if (height > maxH) {
        height = maxH;
        width = height * aspect;
      }
      return { kind: 'projected', ...placementAtHit(m, hit, null), rotationDeg: 0, width: r6(width), height: r6(height), aspectLocked: true };
    }
  }
  return null;
}

/**
 * Move artwork along the surface by (dRight, dUp) in its own frame, then
 * re-project onto the same mesh. Returns null if the surface ends there.
 */
export function moveAlongSurface(m: LoadedModel, p: ProjectedPlacement, dRight: number, dUp: number) {
  const B = decalBasis(p);
  const target = B.anchor.clone().addScaledVector(B.right, dRight).addScaledVector(B.up, dUp);
  return reproject(m, p, target);
}

/**
 * Snap an approximate model-space point back onto the placement's mesh.
 * The surface must be found close to the target — a ray that falls through a
 * vent hole or off an edge onto a distant wall is rejected, never a jump.
 */
export function reproject(m: LoadedModel, p: ProjectedPlacement, target: THREE.Vector3) {
  const n = v3(p.normal);
  const size = modelSize(m);
  const lift = Math.max(target.distanceTo(v3(p.anchor)), size * 0.02) + size * 0.02;
  const hit = raycastModel(m, target.clone().addScaledVector(n, lift), n.clone().negate(), [p.mesh]);
  if (!hit || hit.point.distanceTo(target) > lift + size * 0.02) return null;
  return placementAtHit(m, hit, p.up);
}

export function resetOrientation(m: LoadedModel, p: ProjectedPlacement): Vec3 {
  return toVec3(defaultUp(p.normal, frameVectors(m.info.frame)));
}

const absV = (v: THREE.Vector3) => new THREE.Vector3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
