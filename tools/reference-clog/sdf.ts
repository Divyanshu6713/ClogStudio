// Signed-distance description of the procedural REFERENCE clog.
//
// This is a stand-in product model so the studio can be built and tested before
// a real manufacturer model exists. It is NOT derived from any real product and
// its dimensions are NOT calibrated. Coordinates are "model units".
//
// Frame (right shoe): +X = toe, +Y = up, +Z = outer (lateral) side, -Z = inner.

export type Sdf = (x: number, y: number, z: number) => number;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Polynomial smooth min/max (iq).
export const sUnion = (a: number, b: number, k: number) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
};
export const sInter = (a: number, b: number, k: number) => -sUnion(-a, -b, k);
export const sSub = (a: number, b: number, k: number) => sInter(a, -b, k);

// ---------------------------------------------------------------- plan outline
// Uneven capsule between a heel circle and a (wider) forefoot circle, in XZ.
const HEEL = { x: -0.95, z: 0.03, r: 0.43 };
const FORE = { x: 0.78, z: -0.04, r: 0.56 };
const AX = FORE.x - HEEL.x;
const AZ = FORE.z - HEEL.z;
const AH = Math.hypot(AX, AZ);
const UX = AX / AH;
const UZ = AZ / AH;

export function outline2D(x: number, z: number): number {
  // local frame: py along heel→fore, px perpendicular
  const dx = x - HEEL.x;
  const dz = z - HEEL.z;
  const py = dx * UX + dz * UZ;
  const px = Math.abs(-dx * UZ + dz * UX);
  const r1 = HEEL.r;
  const r2 = FORE.r;
  const b = (r1 - r2) / AH;
  const a = Math.sqrt(1 - b * b);
  const k = -b * px + a * py;
  if (k < 0) return Math.hypot(px, py) - r1;
  if (k > a * AH) return Math.hypot(px, py - AH) - r2;
  return px * a + py * b - r1;
}

// ---------------------------------------------------------------- global bend
// Toe spring: the front of the whole shoe lifts slightly.
export const toeSpring = (x: number) => 0.1 * Math.pow(smoothstep(0.55, 1.4, x), 1.5);
export const toeSpringSlope = (x: number) => (toeSpring(x + 1e-3) - toeSpring(x - 1e-3)) / 2e-3;

// ---------------------------------------------------------------- body shell
export const WALL = 0.075;
export const FOOTBED_Y = 0.12;

function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function ellipse2D(x: number, z: number, rx: number, rz: number) {
  const k0 = Math.hypot(x / rx, z / rz);
  const k1 = Math.hypot(x / (rx * rx), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, rz) : (k0 * (k0 - 1)) / k1;
}

const rearHeight = (x: number) => 0.56 + 0.06 * smoothstep(-0.6, -1.3, x);

/** Outer skin of the upper, ignoring the foot opening and vent holes. */
export function bodyOuter(x: number, y: number, z: number): number {
  const dome = ellipsoid(x - 0.55, y, z + 0.03, 0.86, 0.8, 0.58);
  const plan = outline2D(x, z);
  const rear = sInter(plan, y - rearHeight(x), 0.05);
  let d = sUnion(dome, rear, 0.16);
  d = sInter(d, plan, 0.06);
  return d;
}

// Foot opening: plan-view ellipse, front edge (the vamp) at x ≈ 0.35.
const OPEN = { x: -0.9, z: 0.0, rx: 1.25, rz: 0.5 };

export interface Hole {
  /** point on the outer skin (unbent frame) */
  p: [number, number, number];
  /** outward axis (unbent frame) */
  n: [number, number, number];
  r: number;
}

export const HOLE_R = 0.055;
const HOLE_PLAN: Array<[number, number]> = [
  [1.0, -0.27], [1.0, -0.09], [1.0, 0.09], [1.0, 0.27],
  [0.77, -0.36], [0.77, -0.18], [0.77, 0.0], [0.77, 0.18], [0.77, 0.36],
  [0.54, -0.28], [0.54, -0.095], [0.54, 0.095], [0.54, 0.28],
];

function gradient(f: Sdf, x: number, y: number, z: number, e = 1e-3): [number, number, number] {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

/** Hole centres are found ON the generated outer surface — they are a property of this model's geometry. */
export const HOLES: Hole[] = HOLE_PLAN.map(([hx, hz]) => {
  // bisection down from above for the outer-skin height at (hx, hz)
  let lo = 0.2;
  let hi = 1.2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (bodyOuter(hx, mid, hz) > 0) hi = mid;
    else lo = mid;
  }
  const y = (lo + hi) / 2;
  return { p: [hx, y, hz], n: gradient(bodyOuter, hx, y, hz), r: HOLE_R };
});

function holeField(x: number, y: number, z: number): number {
  let d = Infinity;
  for (const h of HOLES) {
    const px = x - h.p[0];
    const py = y - h.p[1];
    const pz = z - h.p[2];
    const t = px * h.n[0] + py * h.n[1] + pz * h.n[2];
    const rx = px - t * h.n[0];
    const ry = py - t * h.n[1];
    const rz = pz - t * h.n[2];
    const radial = Math.hypot(rx, ry, rz) - h.r;
    const axial = Math.abs(t + 0.05) - 0.2; // stops well above the footbed
    d = Math.min(d, Math.max(radial, axial));
  }
  return d;
}

export function body(x: number, y0: number, z: number): number {
  const y = y0 - toeSpring(x);
  const outer = bodyOuter(x, y, z);
  const cavityShell = Math.max(FOOTBED_Y - y, outer + WALL);
  const opening = Math.max(ellipse2D(x - OPEN.x, z - OPEN.z, OPEN.rx, OPEN.rz), outline2D(x, z) + WALL, FOOTBED_Y + 0.02 - y);
  const cavity = Math.min(cavityShell, opening);
  let d = sSub(outer, cavity, 0.035);
  d = sSub(d, holeField(x, y, z), 0.012);
  return Math.max(d, -y);
}

// ---------------------------------------------------------------- outsole
export function sole(x: number, y0: number, z: number): number {
  const y = y0 - toeSpring(x);
  const plan = outline2D(x, z) - 0.035;
  const slab = Math.max(y - 0.05, -0.15 - y);
  let d = sInter(plan, slab, 0.045);
  // transverse tread grooves on the ground face
  const m = ((x % 0.14) + 0.14) % 0.14;
  const groove = Math.max(Math.abs(m - 0.07) - 0.017, y + 0.125, plan + 0.06);
  d = sSub(d, groove, 0.008);
  return d;
}

// ---------------------------------------------------------------- footbed (interior)
export function footbed(x: number, y0: number, z: number): number {
  const y = y0 - toeSpring(x);
  const plan = outline2D(x, z) + WALL - 0.012;
  const slab = Math.max(y - (FOOTBED_Y + 0.012), FOOTBED_Y - 0.07 - y);
  let d = sInter(plan, slab, 0.02);
  // shallow massage nubs in the forefoot area
  const gx = x - Math.round(x / 0.13) * 0.13;
  const gz = z - Math.round(z / 0.13) * 0.13;
  const nub = Math.hypot(gx, y - (FOOTBED_Y + 0.012), gz) - 0.018;
  if (x > 0.15 && x < 1.05 && plan < -0.06) d = sUnion(d, nub, 0.008);
  return d;
}

// ---------------------------------------------------------------- strap + rivets
export const PIVOT_X = -0.35;
export const PIVOT_Y = 0.42;

/** Half-width of the upper at the pivot station (found numerically, outer side). */
function halfWidthAt(x: number, sign: 1 | -1): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (outline2D(x, sign * mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
export const HALF_W_OUT = halfWidthAt(PIVOT_X, 1);
export const HALF_W_IN = halfWidthAt(PIVOT_X, -1);
const STRAP_T = 0.032; // half thickness
const STRAP_W = 0.095; // half height of the band
const STRAP_GAP = 0.03;
const STRAP_RZ = Math.max(HALF_W_OUT, HALF_W_IN) + STRAP_GAP + STRAP_T;
const STRAP_RX = PIVOT_X - (HEEL.x - HEEL.r) + 0.07;
const STRAP_TILT = (-10 * Math.PI) / 180; // back of strap sits slightly lower than the pivots

export function strap(x: number, y0: number, z: number): number {
  const yb = y0 - toeSpring(x);
  // rotate about the pivot axis (Z) so the rear of the band tilts down
  const px = x - PIVOT_X;
  const py = yb - PIVOT_Y;
  const c = Math.cos(STRAP_TILT);
  const s = Math.sin(STRAP_TILT);
  const lx = c * px - s * py;
  const ly = s * px + c * py;
  const e = ellipse2D(lx, z, STRAP_RX, STRAP_RZ);
  const qx = Math.abs(e) - STRAP_T;
  const qy = Math.abs(ly) - STRAP_W;
  const r = 0.018;
  const band2 = Math.hypot(Math.max(qx + r, 0), Math.max(qy + r, 0)) + Math.min(Math.max(qx + r, qy + r), 0) - r;
  const band = Math.max(band2, lx);
  // round tabs around each pivot
  const tabR = Math.hypot(px, py) - 0.125;
  const tabZ = Math.abs(Math.abs(z) - STRAP_RZ) - STRAP_T;
  const tab = sInter(tabR, tabZ, 0.012);
  return sUnion(band, tab, 0.05);
}

export function rivets(x: number, y0: number, z: number): number {
  const yb = y0 - toeSpring(x);
  const px = x - PIVOT_X;
  const py = yb - PIVOT_Y;
  const radial = Math.hypot(px, py);
  const az = Math.abs(z);
  const inner = Math.min(HALF_W_OUT, HALF_W_IN) - 0.03;
  const outer = STRAP_RZ + STRAP_T + 0.028;
  const mid = (inner + outer) / 2;
  const half = (outer - inner) / 2;
  const shaft = Math.max(radial - 0.045, Math.abs(az - mid) - half);
  const head = Math.max(radial - 0.07, Math.abs(az - (outer - 0.014)) - 0.014);
  return sUnion(shaft, head, 0.01) ;
}

/** Bent-frame hole anchors (what gets exported as charm_hole_* nodes). */
export function bentHoles() {
  return HOLES.map((h) => {
    const [x, y, z] = h.p;
    const slope = toeSpringSlope(x);
    const n: [number, number, number] = [h.n[0] - h.n[1] * slope, h.n[1], h.n[2]];
    const l = Math.hypot(...n);
    return { p: [x, y + toeSpring(x), z] as [number, number, number], n: n.map((v) => v / l) as [number, number, number], r: h.r };
  });
}
