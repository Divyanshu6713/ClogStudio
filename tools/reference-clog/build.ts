// Builds public/models/reference-clog.glb from the SDF description in sdf.ts.
//
//   node tools/reference-clog/build.ts
//
// Output is an ordinary glTF 2.0 binary: one named mesh per material zone,
// one empty node per charm hole (`charm_hole_NN`, +Y = outward axis), and a
// `clogStudio` descriptor in the scene extras. A real manufacturer model is
// expected to follow the same conventions (see docs/MODEL_REQUIREMENTS.md).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { body, sole, footbed, strap, rivets, bentHoles, type Sdf } from './sdf.ts';

interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

type Box = [[number, number, number], [number, number, number]];

// ---------------------------------------------------------------- surface nets
function polygonize(f: Sdf, box: Box, h: number): MeshData {
  const [min, max] = box;
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) field[idx(i, j, k)] = f(min[0] + i * h, min[1] + j * h, min[2] + k * h);

  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          cv[c] = field[idx(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
          if (cv[c] < 0) neg++;
        }
        if (neg === 0 || neg === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          const va = cv[a], vb = cv[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += corners[a][0] + t * (corners[b][0] - corners[a][0]);
          sy += corners[a][1] + t * (corners[b][1] - corners[a][1]);
          sz += corners[a][2] + t * (corners[b][2] - corners[a][2]);
          n++;
        }
        cellVert[idx(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
      }

  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) [b, d] = [d, b];
    tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const v0 = field[idx(i, j, k)] < 0;
        if (v0 !== field[idx(i + 1, j, k)] < 0)
          quad(cellVert[idx(i, j - 1, k - 1)], cellVert[idx(i, j, k - 1)], cellVert[idx(i, j, k)], cellVert[idx(i, j - 1, k)], !v0);
        if (v0 !== field[idx(i, j + 1, k)] < 0)
          quad(cellVert[idx(i - 1, j, k - 1)], cellVert[idx(i - 1, j, k)], cellVert[idx(i, j, k)], cellVert[idx(i, j, k - 1)], !v0);
        if (v0 !== field[idx(i, j, k + 1)] < 0)
          quad(cellVert[idx(i - 1, j - 1, k)], cellVert[idx(i, j - 1, k)], cellVert[idx(i, j, k)], cellVert[idx(i - 1, j, k)], !v0);
      }

  // Project vertices onto the true zero set and take normals from the SDF gradient.
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = h * 0.25;
  for (let v = 0; v < positions.length; v += 3) {
    let x = positions[v], y = positions[v + 1], z = positions[v + 2];
    let g: [number, number, number] = [0, 1, 0];
    for (let it = 0; it < 3; it++) {
      const d = f(x, y, z);
      const gx = (f(x + e, y, z) - f(x - e, y, z)) / (2 * e);
      const gy = (f(x, y + e, z) - f(x, y - e, z)) / (2 * e);
      const gz = (f(x, y, z + e) - f(x, y, z - e)) / (2 * e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      g = [gx / gl, gy / gl, gz / gl];
      const step = Math.max(-h * 0.5, Math.min(h * 0.5, d / gl));
      x -= g[0] * step;
      y -= g[1] * step;
      z -= g[2] * step;
    }
    positions[v] = x; positions[v + 1] = y; positions[v + 2] = z;
    normals[v] = g[0]; normals[v + 1] = g[1]; normals[v + 2] = g[2];
  }

  // Fix winding against the gradient normal (robust to the quad orientation convention).
  const indices = new Uint32Array(tris);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const nx_ = normals[a] + normals[b] + normals[c];
    const ny_ = normals[a + 1] + normals[b + 1] + normals[c + 1];
    const nz_ = normals[a + 2] + normals[b + 2] + normals[c + 2];
    if (fx * nx_ + fy * ny_ + fz * nz_ < 0) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }
  return { positions, normals, indices };
}

// ---------------------------------------------------------------- GLB writer
interface NodeDef { name: string; mesh?: number; translation?: number[]; rotation?: number[]; extras?: unknown; children?: number[] }

function writeGlb(
  meshes: Array<{ name: string; data: MeshData; color: [number, number, number]; roughness: number; metallic: number }>,
  extraNodes: NodeDef[],
  sceneExtras: unknown,
): Buffer {
  const chunks: Buffer[] = [];
  let byteOffset = 0;
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const push = (arr: Float32Array | Uint32Array, target: number) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    chunks.push(buf, Buffer.alloc(pad));
    bufferViews.push({ buffer: 0, byteOffset, byteLength: buf.length, target });
    byteOffset += buf.length + pad;
    return bufferViews.length - 1;
  };
  const gltfMeshes: unknown[] = [];
  const materials: unknown[] = [];
  const nodes: NodeDef[] = [{ name: 'ReferenceClog', children: [] }];
  meshes.forEach((m, mi) => {
    const p = m.data.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p[i + a]);
        hi[a] = Math.max(hi[a], p[i + a]);
      }
    const count = p.length / 3;
    accessors.push({ bufferView: push(p, 34962), componentType: 5126, count, type: 'VEC3', min: lo, max: hi });
    const posA = accessors.length - 1;
    accessors.push({ bufferView: push(m.data.normals, 34962), componentType: 5126, count, type: 'VEC3' });
    const nrmA = accessors.length - 1;
    accessors.push({ bufferView: push(m.data.indices, 34963), componentType: 5125, count: m.data.indices.length, type: 'SCALAR' });
    const idxA = accessors.length - 1;
    materials.push({
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: m.metallic, roughnessFactor: m.roughness },
    });
    gltfMeshes.push({ name: m.name, primitives: [{ attributes: { POSITION: posA, NORMAL: nrmA }, indices: idxA, material: mi }] });
    nodes.push({ name: m.name, mesh: mi });
    nodes[0].children!.push(nodes.length - 1);
  });
  for (const n of extraNodes) {
    nodes.push(n);
    nodes[0].children!.push(nodes.length - 1);
  }
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'clog-studio tools/reference-clog' },
    scene: 0,
    scenes: [{ name: 'Reference Clog', nodes: [0], extras: sceneExtras }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

// ---------------------------------------------------------------- build
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
};

// Grid cell size per zone: fine where there are thin features (strap, rivets, vent holes), coarse on flat parts.
const t0 = Date.now();
const zones = [
  { name: 'body', h: 0.0155, f: body, box: [[-1.45, -0.03, -0.65], [1.45, 0.98, 0.65]] as Box, color: '#E8E1D1', roughness: 0.78, metallic: 0 },
  { name: 'sole', h: 0.021, f: sole, box: [[-1.47, -0.2, -0.67], [1.47, 0.22, 0.67]] as Box, color: '#E8E1D1', roughness: 0.85, metallic: 0 },
  { name: 'footbed', h: 0.024, f: footbed, box: [[-1.4, 0.0, -0.6], [1.4, 0.26, 0.6]] as Box, color: '#D9D1BF', roughness: 0.85, metallic: 0 },
  { name: 'strap', h: 0.012, f: strap, box: [[-1.55, 0.0, -0.72], [-0.15, 0.62, 0.72]] as Box, color: '#1E3D31', roughness: 0.72, metallic: 0 },
  { name: 'hardware', h: 0.008, f: rivets, box: [[-0.5, 0.2, -0.72], [-0.2, 0.56, 0.72]] as Box, color: '#2A2A2A', roughness: 0.45, metallic: 0 },
];

const built = zones.map((z) => {
  const data = polygonize(z.f, z.box, z.h);
  console.log(`${z.name.padEnd(9)} ${String(data.positions.length / 3).padStart(7)} verts ${String(data.indices.length / 3).padStart(7)} tris`);
  return { name: z.name, data, color: hex(z.color), roughness: z.roughness, metallic: z.metallic };
});

// Charm-hole anchors: +Y of each node = outward hole axis.
const holeNodes: NodeDef[] = bentHoles().map((h, i) => {
  const [nx, ny, nz] = h.n;
  // quaternion rotating +Y onto n
  const dot = ny;
  let q: number[];
  if (dot > 0.999999) q = [0, 0, 0, 1];
  else {
    const ax = [nz, 0, -nx]; // Y × n
    const s = Math.sqrt((1 + dot) * 2);
    q = [ax[0] / s, ax[1] / s, ax[2] / s, s / 2];
    const l = Math.hypot(...q);
    q = q.map((v) => v / l);
  }
  return {
    name: `charm_hole_${String(i + 1).padStart(2, '0')}`,
    translation: h.p,
    rotation: q,
    extras: { radius: h.r, source: 'procedural reference geometry (not manufacturing data)' },
  };
});

const descriptor = {
  clogStudio: {
    schema: 1,
    modelName: 'Reference Clog — procedural stand-in',
    geometrySource: 'procedural',
    accuracy: 'reference',
    calibrated: false,
    unitsLabel: 'model units (uncalibrated)',
    side: 'right',
    frame: { forward: '+x', up: '+y', outer: '+z' },
    zones: [
      { id: 'body', label: 'Main Body', meshes: ['body'], printable: true },
      { id: 'strap', label: 'Heel Strap', meshes: ['strap'], printable: true },
      { id: 'sole', label: 'Outsole', meshes: ['sole'], printable: true },
      { id: 'footbed', label: 'Footbed (interior)', meshes: ['footbed'], printable: false },
      { id: 'hardware', label: 'Rivets', meshes: ['hardware'], printable: false },
    ],
    note: 'Procedurally generated stand-in built from signed distance functions. Not derived from any real product. Dimensions, vent-hole positions and strap geometry are not manufacturing data.',
  },
};

const glb = writeGlb(built, holeNodes, descriptor);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/models/reference-clog.glb');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
console.log(`wrote ${out} (${(glb.length / 1024 / 1024).toFixed(2)} MB) in ${Date.now() - t0} ms, ${holeNodes.length} hole anchors`);
