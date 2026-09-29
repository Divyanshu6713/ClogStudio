// Orientation rules for artwork on the surface. All pure functions of stored
// data, so the same document always produces the same result.

import * as THREE from 'three';
import type { AxisDir, ModelFrame, Vec3 } from '@/domain/types';

export function axis(dir: AxisDir): THREE.Vector3 {
  const s = dir[0] === '-' ? -1 : 1;
  const a = dir[1];
  return new THREE.Vector3(a === 'x' ? s : 0, a === 'y' ? s : 0, a === 'z' ? s : 0);
}

export interface FrameVectors {
  forward: THREE.Vector3;
  up: THREE.Vector3;
  outer: THREE.Vector3;
  /** the shoe's own right-hand direction (forward × up) */
  right: THREE.Vector3;
}

export function frameVectors(f: ModelFrame): FrameVectors {
  const forward = axis(f.forward);
  const up = axis(f.up);
  return { forward, up, outer: axis(f.outer), right: forward.clone().cross(up) };
}

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
export const toVec3 = (v: THREE.Vector3): Vec3 => [round(v.x), round(v.y), round(v.z)];
/** Stored coordinates are rounded to 1e-6 model units: stable JSON, far below visible precision. */
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Default "up" for artwork at a surface normal: the model's up axis projected
 * onto the tangent plane; on near-horizontal surfaces it blends toward the
 * toe direction so text on the toe box reads toe-up in the Top view.
 */
export function defaultUp(normal: Vec3 | THREE.Vector3, frame: FrameVectors): THREE.Vector3 {
  const n = normal instanceof THREE.Vector3 ? normal.clone() : v3(normal);
  const s = THREE.MathUtils.smoothstep(Math.abs(n.dot(frame.up)), 0.75, 0.97);
  const ref = frame.up.clone().multiplyScalar(1 - s).addScaledVector(frame.forward, s);
  const u = ref.addScaledVector(n, -ref.dot(n));
  if (u.lengthSq() < 1e-8) u.copy(frame.forward).addScaledVector(n, -frame.forward.dot(n));
  return u.normalize();
}

/**
 * Carry an existing "up" to a new normal (parallel transport by projection).
 * Keeps artwork orientation continuous while it is dragged over curved
 * surfaces, instead of snapping to a per-point rule.
 */
export function transportUp(prevUp: Vec3, normal: THREE.Vector3, frame: FrameVectors): THREE.Vector3 {
  const u = v3(prevUp);
  u.addScaledVector(normal, -u.dot(normal));
  if (u.lengthSq() < 1e-6) return defaultUp(normal, frame);
  return u.normalize();
}

/** Plain-language surface region, derived from the geometry (not configured data). */
export function surfaceRegion(point: THREE.Vector3, normal: THREE.Vector3, meshCenter: THREE.Vector3, frame: FrameVectors): string {
  const toward = point.clone().sub(meshCenter);
  toward.addScaledVector(frame.up, -toward.dot(frame.up));
  // A normal pointing back toward the mesh axis means we are on an inside wall.
  if (toward.lengthSq() > 1e-6 && normal.dot(toward.normalize()) < -0.35 && normal.dot(frame.up) < 0.6) return 'Interior';
  const o = normal.dot(frame.outer);
  const u = normal.dot(frame.up);
  const f = normal.dot(frame.forward);
  if (u > 0.6) return 'Top';
  if (u < -0.6) return 'Underside';
  if (o > 0.5) return 'Outer side';
  if (o < -0.5) return 'Inner side';
  if (f > 0.5) return 'Toe / front';
  if (f < -0.5) return 'Heel / rear';
  return 'Edge';
}

export { v3 };
