// Projected decal geometry.
//
// The artwork rectangle is projected along the surface normal at its anchor.
// Starting from the triangle under the anchor we grow a connected patch of
// front-facing triangles, clip each against the projector box, and emit new
// triangles that lie exactly on the original surface — so the artwork follows
// the curvature and stays attached from every camera angle.

import * as THREE from 'three';
import type { ProjectedPlacement } from '@/domain/types';
import type { SurfaceIndex } from './surfaceIndex';
import { v3 } from './frame';

/** Triangles steeper than this relative to the projection axis are excluded (≈ 78°). */
const MIN_FACING = 0.2;

export interface DecalBasis {
  anchor: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  normal: THREE.Vector3;
}

export function decalBasis(p: ProjectedPlacement): DecalBasis {
  const normal = v3(p.normal).normalize();
  const up0 = v3(p.up);
  up0.addScaledVector(normal, -up0.dot(normal)).normalize();
  const up = up0.applyAxisAngle(normal, THREE.MathUtils.degToRad(p.rotationDeg));
  const right = up.clone().cross(normal).normalize();
  return { anchor: v3(p.anchor), right, up, normal };
}

/** Depth of the projector box — how far above/below the anchor surface may be captured. */
export function projectionDepth(p: ProjectedPlacement) {
  return THREE.MathUtils.clamp(Math.max(p.width, p.height) * 0.55, 0.02, 0.6);
}

interface CV {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

function clip(poly: CV[], axisKey: 'x' | 'y' | 'z', limit: number, sign: 1 | -1): CV[] {
  // keep points with sign*coord <= limit
  const out: CV[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = sign * a[axisKey] - limit;
    const db = sign * b[axisKey] - limit;
    if (da <= 0) out.push(a);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        nx: a.nx + (b.nx - a.nx) * t,
        ny: a.ny + (b.ny - a.ny) * t,
        nz: a.nz + (b.nz - a.nz) * t,
      });
    }
  }
  return out;
}

export interface DecalBuildOptions {
  flipX: boolean;
  flipY: boolean;
  /** lift along the surface normal to avoid depth fighting, model units */
  lift: number;
  /** triangle known to be under the anchor (skips the nearest-triangle search) */
  seedTriangle?: number;
}

export interface DecalBuildResult {
  geometry: THREE.BufferGeometry;
  triangles: number;
  /** fraction of the artwork rectangle that landed on the surface (area-based, approx.) */
  coverage: number;
}

export function buildDecalGeometry(surface: SurfaceIndex, p: ProjectedPlacement, opts: DecalBuildOptions): DecalBuildResult | null {
  const B = decalBasis(p);
  const hw = p.width / 2;
  const hh = p.height / 2;
  const depth = projectionDepth(p);
  const seed = opts.seedTriangle ?? surface.nearestTriangle(B.anchor, B.normal);
  if (seed < 0) return null;

  const { pos, nrm, idx, faceNrm, triCount } = surface;
  const visited = new Uint8Array(triCount);
  const queue: number[] = [seed];
  visited[seed] = 1;

  const outPos: number[] = [];
  const outNrm: number[] = [];
  const outUv: number[] = [];
  let area = 0;
  const tmp = new THREE.Vector3();

  const local = (i: number): CV => {
    tmp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).sub(B.anchor);
    return {
      x: tmp.dot(B.right),
      y: tmp.dot(B.up),
      z: tmp.dot(B.normal),
      nx: nrm[i * 3],
      ny: nrm[i * 3 + 1],
      nz: nrm[i * 3 + 2],
    };
  };

  while (queue.length) {
    const t = queue.pop()!;
    const facing = faceNrm[t * 3] * B.normal.x + faceNrm[t * 3 + 1] * B.normal.y + faceNrm[t * 3 + 2] * B.normal.z;
    if (facing < MIN_FACING) continue;
    const a = local(idx[t * 3]);
    const b = local(idx[t * 3 + 1]);
    const c = local(idx[t * 3 + 2]);
    // outside the projector box entirely → do not emit and do not grow past it
    if (
      (a.x > hw && b.x > hw && c.x > hw) || (a.x < -hw && b.x < -hw && c.x < -hw) ||
      (a.y > hh && b.y > hh && c.y > hh) || (a.y < -hh && b.y < -hh && c.y < -hh) ||
      (a.z > depth && b.z > depth && c.z > depth) || (a.z < -depth && b.z < -depth && c.z < -depth)
    )
      continue;

    let poly: CV[] = [a, b, c];
    poly = clip(poly, 'x', hw, 1);
    if (poly.length) poly = clip(poly, 'x', hw, -1);
    if (poly.length) poly = clip(poly, 'y', hh, 1);
    if (poly.length) poly = clip(poly, 'y', hh, -1);
    if (poly.length) poly = clip(poly, 'z', depth, 1);
    if (poly.length) poly = clip(poly, 'z', depth, -1);

    if (poly.length >= 3) {
      for (let k = 1; k < poly.length - 1; k++) {
        const tri = [poly[0], poly[k], poly[k + 1]];
        area += Math.abs((tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[2].x - tri[0].x) * (tri[1].y - tri[0].y)) / 2;
        for (const v of tri) {
          const nl = Math.hypot(v.nx, v.ny, v.nz) || 1;
          const nx = v.nx / nl, ny = v.ny / nl, nz = v.nz / nl;
          outPos.push(
            B.anchor.x + B.right.x * v.x + B.up.x * v.y + B.normal.x * v.z + nx * opts.lift,
            B.anchor.y + B.right.y * v.x + B.up.y * v.y + B.normal.y * v.z + ny * opts.lift,
            B.anchor.z + B.right.z * v.x + B.up.z * v.y + B.normal.z * v.z + nz * opts.lift,
          );
          outNrm.push(nx, ny, nz);
          let u = v.x / p.width + 0.5;
          let vv = v.y / p.height + 0.5;
          if (opts.flipX) u = 1 - u;
          if (opts.flipY) vv = 1 - vv;
          // textures are uploaded with flipY = false → image row 0 is v = 0
          outUv.push(u, 1 - vv);
        }
      }
    }
    surface.forEachNeighbor(t, (n) => {
      if (!visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    });
  }

  if (outPos.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outNrm, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, triangles: outPos.length / 9, coverage: Math.min(1, area / (p.width * p.height)) };
}
