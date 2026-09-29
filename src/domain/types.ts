// Design-document domain model. This is the single source of truth for a clog
// design: the UI renders it, the 3D engine renders it, exports read it.
// Nothing here references React or three.js.

export type ID = string;
export type Vec3 = [number, number, number];
/** sRGB hex, always `#RRGGBB` upper-case. */
export type Hex = string;

export const PROJECT_SCHEMA = 1 as const;

// ---------------------------------------------------------------- product model
export type ModelAccuracy =
  /** Real product geometry supplied by the manufacturer/designer (GLB/GLTF). */
  | 'product'
  /** Stand-in / uncalibrated geometry: good for workflow, not for dimensions. */
  | 'reference'
  /** Built from a single photo or sketch: visual concept only. */
  | 'concept';

export type AxisDir = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface ModelFrame {
  /** direction the toe points */
  forward: AxisDir;
  up: AxisDir;
  /** lateral (outer) side of the previewed shoe */
  outer: AxisDir;
}

export interface ZoneDef {
  id: string;
  label: string;
  /** mesh node names that belong to this zone */
  meshes: string[];
  /** whether artwork may be placed on it */
  printable: boolean;
}

export interface ProductModelRef {
  source: { kind: 'builtin'; id: 'reference-clog' } | { kind: 'uploaded'; assetId: ID };
  name: string;
  accuracy: ModelAccuracy;
  /** which physical shoe of the pair the model represents */
  side: 'left' | 'right' | 'unknown';
  frame: ModelFrame;
  zones: ZoneDef[];
  /** real-world scale; null = not calibrated → never show millimetres */
  calibration: { mmPerUnit: number; source: string } | null;
  /** size the geometry represents, if known (e.g. "EU 42") */
  sizeLabel: string | null;
  note: string;
}

// ---------------------------------------------------------------- assets
export type AssetKind = 'raster' | 'svg' | 'model';

export interface AssetMeta {
  id: ID;
  kind: AssetKind;
  /** original filename as uploaded */
  name: string;
  mime: string;
  bytes: number;
  /** SHA-256 of the ORIGINAL bytes — lets us prove the original is untouched */
  sha256: string;
  /** intrinsic pixel size (raster) or rasterised size (svg) */
  width: number | null;
  height: number | null;
  /** size of the working preview used for rendering, if one was made */
  preview: { width: number; height: number; downscaled: boolean } | null;
  warnings: string[];
  createdAt: number;
}

// ---------------------------------------------------------------- surface placement
/**
 * Artwork placed by projecting it onto the mesh surface along the surface
 * normal at an anchor point (a "decal"). Stored in MODEL space, so it is
 * independent of camera, viewport and display scaling.
 */
export interface ProjectedPlacement {
  kind: 'projected';
  zoneId: string;
  /** mesh node the anchor lies on — projection is clipped to this mesh */
  mesh: string;
  /** human-readable surface region derived from geometry, e.g. "Outer side" */
  surfaceLabel: string;
  anchor: Vec3;
  /** unit outward surface normal at the anchor */
  normal: Vec3;
  /** unit tangent that is "up" for the artwork before rotation */
  up: Vec3;
  rotationDeg: number;
  /** extent on the surface, model units */
  width: number;
  height: number;
  aspectLocked: boolean;
}

export type Placement = ProjectedPlacement;

// ---------------------------------------------------------------- layers
/** Visual preview modes. These are simulations, not factory process predictions. */
export type GraphicFinish = 'printed' | 'decal';

interface LayerBase {
  id: ID;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  placement: Placement;
  finish: GraphicFinish;
  createdAt: number;
  updatedAt: number;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: ID;
  flipX: boolean;
  flipY: boolean;
}

export type Layer = ImageLayer;
export type LayerType = Layer['type'];

// ---------------------------------------------------------------- materials
export type FoamFinish = 'matte-foam' | 'smooth-foam';

export interface ZoneMaterial {
  color: Hex;
  finish: FoamFinish;
}

// ---------------------------------------------------------------- versions
export interface DesignVersion {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** version this one was branched from */
  parentId: ID | null;
  status: 'draft' | 'final-candidate';
  favorite: boolean;
  /**
   * Pair handling. The preview currently shows the single modelled shoe;
   * `mirror` / `independent` left-shoe designs are reserved for later.
   */
  pair: { mode: 'single-preview' };
  materials: Record<string, ZoneMaterial>;
  /** bottom → top render order */
  layers: Layer[];
}

export interface Palette {
  id: ID;
  name: string;
  /** zone id → colour */
  colors: Record<string, Hex>;
}

export interface Project {
  schema: typeof PROJECT_SCHEMA;
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  model: ProductModelRef;
  /** metadata only; bytes live in the asset store */
  assets: Record<ID, AssetMeta>;
  palettes: Palette[];
  versions: DesignVersion[];
  activeVersionId: ID;
}
