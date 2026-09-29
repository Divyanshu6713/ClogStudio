// A read-only, model-space copy of one mesh's triangles, with the adjacency
// needed to grow a decal patch across the surface.
//
// "Model space" = the coordinate frame of the loaded model root. Every stored
// placement lives in this frame, so it does not depend on camera, viewport or
// the display normalisation applied to the model.

import * as THREE from 'three';

export class SurfaceIndex {
  readonly meshName: string;
  readonly pos: Float32Array;
  readonly nrm: Float32Array;
  readonly idx: Uint32Array;
  readonly triCount: number;
  readonly faceNrm: Float32Array;
  /** vertex → welded-vertex id (vertices split at UV seams share one id) */
  private readonly weld: Uint32Array;
  private readonly vtOffsets: Uint32Array;
  private readonly vtItems: Uint32Array;
  readonly bounds = new THREE.Box3();

  constructor(mesh: THREE.Mesh, modelFromMesh: THREE.Matrix4) {
    this.meshName = mesh.name;
    let g = mesh.geometry as THREE.BufferGeometry;
    if (!g.getAttribute('normal')) {
      g = g.clone();
      g.computeVertexNormals();
    }
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const vCount = P.count;
    this.pos = new Float32Array(vCount * 3);
    this.nrm = new Float32Array(vCount * 3);
    const nMat = new THREE.Matrix3().getNormalMatrix(modelFromMesh);
    const v = new THREE.Vector3();
    for (let i = 0; i < vCount; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(modelFromMesh);
      this.pos[i * 3] = v.x;
      this.pos[i * 3 + 1] = v.y;
      this.pos[i * 3 + 2] = v.z;
      this.bounds.expandByPoint(v);
      v.fromBufferAttribute(N, i).applyMatrix3(nMat).normalize();
      this.nrm[i * 3] = v.x;
      this.nrm[i * 3 + 1] = v.y;
      this.nrm[i * 3 + 2] = v.z;
    }
    if (g.index) this.idx = Uint32Array.from(g.index.array as ArrayLike<number>);
    else this.idx = Uint32Array.from({ length: vCount }, (_, i) => i);
    this.triCount = this.idx.length / 3;

    // Flat face normals (used to reject back-facing triangles).
    this.faceNrm = new Float32Array(this.triCount * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < this.triCount; t++) {
      this.vertex(this.idx[t * 3], a);
      this.vertex(this.idx[t * 3 + 1], b);
      this.vertex(this.idx[t * 3 + 2], c);
      b.sub(a);
      c.sub(a);
      b.cross(c).normalize();
      this.faceNrm[t * 3] = b.x;
      this.faceNrm[t * 3 + 1] = b.y;
      this.faceNrm[t * 3 + 2] = b.z;
    }

    // Weld by quantised position so adjacency survives UV/normal seams.
    const q = Math.max(this.bounds.getSize(v).length() * 1e-6, 1e-9);
    const map = new Map<string, number>();
    this.weld = new Uint32Array(vCount);
    let next = 0;
    for (let i = 0; i < vCount; i++) {
      const key = `${Math.round(this.pos[i * 3] / q)},${Math.round(this.pos[i * 3 + 1] / q)},${Math.round(this.pos[i * 3 + 2] / q)}`;
      let id = map.get(key);
      if (id === undefined) map.set(key, (id = next++));
      this.weld[i] = id;
    }
    // CSR list: welded vertex → triangles touching it.
    const counts = new Uint32Array(next + 1);
    for (let i = 0; i < this.idx.length; i++) counts[this.weld[this.idx[i]] + 1]++;
    for (let i = 1; i <= next; i++) counts[i] += counts[i - 1];
    this.vtOffsets = counts;
    this.vtItems = new Uint32Array(this.idx.length);
    const fill = counts.slice();
    for (let i = 0; i < this.idx.length; i++) this.vtItems[fill[this.weld[this.idx[i]]]++] = (i / 3) | 0;
  }

  vertex(i: number, out: THREE.Vector3) {
    return out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }

  /** Triangles sharing at least one (welded) vertex with triangle t. */
  forEachNeighbor(t: number, fn: (n: number) => void) {
    for (let k = 0; k < 3; k++) {
      const w = this.weld[this.idx[t * 3 + k]];
      for (let j = this.vtOffsets[w]; j < this.vtOffsets[w + 1]; j++) fn(this.vtItems[j]);
    }
  }

  /**
   * Triangle whose centroid is closest to `p`, preferring triangles that face
   * along `n` (so a point on a thin wall resolves to the correct side).
   */
  nearestTriangle(p: THREE.Vector3, n: THREE.Vector3): number {
    let best = -1;
    let bestD = Infinity;
    const { pos, idx, faceNrm } = this;
    for (let t = 0; t < this.triCount; t++) {
      if (faceNrm[t * 3] * n.x + faceNrm[t * 3 + 1] * n.y + faceNrm[t * 3 + 2] * n.z < 0.2) continue;
      const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
      const cx = (pos[i0] + pos[i1] + pos[i2]) / 3 - p.x;
      const cy = (pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1]) / 3 - p.y;
      const cz = (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3 - p.z;
      const d = cx * cx + cy * cy + cz * cz;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /**
   * Nearest ray hit in model space (Möller–Trumbore). With `frontOnly`, only
   * triangles facing the ray origin count.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, frontOnly: boolean): { t: number; tri: number } | null {
    if (!rayHitsBox(origin, dir, this.bounds)) return null;
    const { pos, idx } = this;
    let bestT = Infinity;
    let best = -1;
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    for (let t = 0; t < this.triCount; t++) {
      const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
      const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
      const e1x = pos[i1] - ax, e1y = pos[i1 + 1] - ay, e1z = pos[i1 + 2] - az;
      const e2x = pos[i2] - ax, e2y = pos[i2 + 1] - ay, e2z = pos[i2 + 2] - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (frontOnly ? det < 1e-12 : Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = ox - ax, sy = oy - ay, sz = oz - az;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (d > 1e-9 && d < bestT) {
        bestT = d;
        best = t;
      }
    }
    return best < 0 ? null : { t: bestT, tri: best };
  }

  /** Smooth (interpolated) normal at a point inside triangle t. */
  normalAt(t: number, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    this.vertex(this.idx[t * 3], a);
    this.vertex(this.idx[t * 3 + 1], b);
    this.vertex(this.idx[t * 3 + 2], c);
    const bary = THREE.Triangle.getBarycoord(p, a, b, c, new THREE.Vector3());
    if (!bary) return out.set(this.faceNrm[t * 3], this.faceNrm[t * 3 + 1], this.faceNrm[t * 3 + 2]);
    out.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      const i = this.idx[t * 3 + k] * 3;
      const w = k === 0 ? bary.x : k === 1 ? bary.y : bary.z;
      out.x += this.nrm[i] * w;
      out.y += this.nrm[i + 1] * w;
      out.z += this.nrm[i + 2] * w;
    }
    return out.normalize();
  }
}

function rayHitsBox(o: THREE.Vector3, d: THREE.Vector3, b: THREE.Box3): boolean {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < b.min[k] || o[k] > b.max[k]) return false;
      continue;
    }
    let t1 = (b.min[k] - o[k]) / d[k];
    let t2 = (b.max[k] - o[k]) / d[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmax >= 0;
}
