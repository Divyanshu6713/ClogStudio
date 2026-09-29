// The 3D rendering engine. It owns ONE scene with ONE clog, and renders the
// design document it is given. It never edits the document: interaction code
// asks it for surface hits and then issues commands to the store.
//
// Camera presets only move the camera. Nothing about the design changes.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AssetMeta, DesignVersion, FoamFinish, ID, Layer, ProjectedPlacement } from '@/domain/types';
import type { LoadedModel } from './modelLoader';
import { buildDecalGeometry } from './decal';
import { frameVectors, v3 } from './frame';
import { modelSize, raycastModel, type SurfaceHit } from './placement';

export type CameraPresetId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'q-left' | 'q-right';

export const CAMERA_PRESETS: Array<{ id: CameraPresetId; label: string; key: string }> = [
  { id: 'front', label: 'Front', key: '1' },
  { id: 'back', label: 'Back', key: '2' },
  { id: 'left', label: 'Left', key: '3' },
  { id: 'right', label: 'Right', key: '4' },
  { id: 'top', label: 'Top', key: '5' },
  { id: 'bottom', label: 'Bottom', key: '6' },
  { id: 'q-left', label: '¾ Left', key: '7' },
  { id: 'q-right', label: '¾ Right', key: '8' },
];

/** World-space display size of the model's longest side. */
const DISPLAY_SIZE = 3;
const BACKDROP = '#E4E3DF';

const FINISH_ROUGHNESS: Record<FoamFinish, number> = { 'matte-foam': 0.82, 'smooth-foam': 0.5 };

interface LayerObj {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  placement: ProjectedPlacement | null;
  flipKey: string;
  finish: Layer['finish'];
  assetId: ID;
  coverage: number;
}

interface TextureSlot {
  texture: THREE.Texture | null;
  error: string | null;
}

export interface LayerRenderInfo {
  /** fraction of the artwork rectangle that lies on the surface */
  coverage: number;
  missingTexture: string | null;
}

export class StudioEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 200);
  readonly controls: OrbitControls;
  private readonly display = new THREE.Group();
  private readonly ground: THREE.Mesh;
  private readonly contact: THREE.Mesh;
  private readonly key: THREE.DirectionalLight;
  private model: LoadedModel | null = null;
  private zoneMats = new Map<string, THREE.MeshStandardMaterial[]>();
  private layers = new Map<ID, LayerObj>();
  private textures = new Map<ID, TextureSlot>();
  private selection: THREE.Mesh;
  private selectedId: ID | null = null;
  private dirty = true;
  private raf = 0;
  private anim: { t0: number; dur: number; fromDir: THREE.Vector3; toDir: THREE.Vector3; fromDist: number; toDist: number; fromTarget: THREE.Vector3; toTarget: THREE.Vector3 } | null = null;
  private resizeObs: ResizeObserver;
  private lastVersion: DesignVersion | null = null;
  private lastAssets: Record<ID, AssetMeta> = {};
  /** asset loader supplied by the app (IndexedDB) */
  loadBitmap: (assetId: ID) => Promise<ImageBitmap> = () => Promise.reject(new Error('No asset loader'));
  /** called when async state the UI may show changes (textures loaded, etc.) */
  onChange: () => void = () => {};
  renderCount = 0;

  constructor(private readonly container: HTMLElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      throw new Error('WebGL is not available in this browser, so the 3D clog cannot be shown. Enable hardware acceleration or try a current Chrome, Edge, Firefox or Safari.');
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral: keeps base colours close to their sRGB values (unlike ACES/AgX hue shifts).
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.className = 'viewport-canvas';
    r.domElement.setAttribute('aria-label', '3D clog preview. Drag to orbit, scroll to zoom, right-drag to pan.');
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);

    this.scene.background = new THREE.Color(BACKDROP);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // Intensities calibrated so a camera-facing, key-lit surface renders within a few
    // RGB levels of its chosen HEX (measured: #E8E1D1 → rgb(234,227,210)).
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    this.key = new THREE.DirectionalLight(0xffffff, 0.55);
    this.key.position.set(2.5, 6, 3.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 5;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -2.6;
    sc.right = sc.top = 2.6;
    sc.near = 0.5;
    sc.far = 15;
    this.scene.add(this.key, this.key.target);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d6d0, 0.15));

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.32 }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = 0.001;
    this.contact.renderOrder = -1;
    this.scene.add(this.contact);
    this.scene.add(this.display);

    this.selection = new THREE.Mesh(new THREE.BufferGeometry(), selectionMaterial());
    this.selection.renderOrder = 10_000;
    this.selection.visible = false;

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', () => (this.anim = null));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.camera.position.set(4, 2.5, 5);
    this.controls.target.set(0, 0.5, 0);
    this.loop();
  }

  // ------------------------------------------------------------------ model
  setModel(model: LoadedModel) {
    if (this.model) this.display.remove(this.model.root);
    this.clearLayers();
    this.model = model;
    const f = frameVectors(model.info.frame);
    // Align the model's up axis with world +Y, scale to a standard display size,
    // stand it on the ground, centre it. Model-space data is untouched.
    this.display.quaternion.setFromUnitVectors(f.up, new THREE.Vector3(0, 1, 0));
    this.display.scale.setScalar(DISPLAY_SIZE / modelSize(model));
    this.display.position.set(0, 0, 0);
    this.display.updateMatrixWorld(true);
    this.display.add(model.root);
    this.display.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(model.root);
    const c = wb.getCenter(new THREE.Vector3());
    this.display.position.set(-c.x, -wb.min.y, -c.z);
    this.display.updateMatrixWorld(true);

    const footprint = new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3());
    this.contact.scale.set(footprint.x * 1.25, footprint.z * 1.35, 1);

    this.zoneMats.clear();
    for (const z of model.zones) {
      const mats: THREE.MeshStandardMaterial[] = [];
      for (const name of z.meshes) {
        const mesh = model.meshes.get(name)!;
        const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const mat = src instanceof THREE.MeshStandardMaterial ? src.clone() : new THREE.MeshStandardMaterial();
        mat.metalness = 0;
        mesh.material = mat;
        mats.push(mat);
      }
      this.zoneMats.set(z.id, mats);
    }
    model.root.add(this.selection);
    this.setPreset('q-right', false);
    this.dirty = true;
    if (this.lastVersion) this.sync(this.lastVersion, this.lastAssets, this.selectedId);
  }

  get loadedModel() {
    return this.model;
  }

  // ------------------------------------------------------------------ design sync
  /** Make the scene match the given design version. Cheap when nothing changed. */
  sync(version: DesignVersion, assets: Record<ID, AssetMeta>, selectedId: ID | null) {
    this.lastVersion = version;
    this.lastAssets = assets;
    this.selectedId = selectedId;
    const model = this.model;
    if (!model) return;

    for (const [zoneId, mats] of this.zoneMats) {
      const m = version.materials[zoneId];
      if (!m) continue;
      for (const mat of mats) {
        mat.color.set(m.color);
        mat.roughness = FINISH_ROUGHNESS[m.finish];
      }
    }

    const size = modelSize(model);
    const seen = new Set<ID>();
    version.layers.forEach((layer, order) => {
      seen.add(layer.id);
      let obj = this.layers.get(layer.id);
      if (!obj || obj.finish !== layer.finish) {
        if (obj) this.disposeLayer(layer.id);
        const mat = layer.finish === 'decal' ? new THREE.MeshPhysicalMaterial({ clearcoat: 0.8, clearcoatRoughness: 0.25, roughness: 0.4 }) : new THREE.MeshStandardMaterial();
        mat.transparent = true;
        mat.depthWrite = false;
        mat.polygonOffset = true;
        mat.metalness = 0;
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat as THREE.MeshStandardMaterial);
        mesh.receiveShadow = true;
        mesh.name = `layer:${layer.id}`;
        mesh.userData.layerId = layer.id;
        model.root.add(mesh);
        obj = { mesh, placement: null, flipKey: '', finish: layer.finish, assetId: '', coverage: 0 };
        this.layers.set(layer.id, obj);
      }
      const flipKey = `${layer.flipX}|${layer.flipY}`;
      if (obj.placement !== layer.placement || obj.flipKey !== flipKey) {
        const surface = model.surfaces.get(layer.placement.mesh);
        const built = surface ? buildDecalGeometry(surface, layer.placement, { flipX: layer.flipX, flipY: layer.flipY, lift: size * 0.0004 }) : null;
        obj.mesh.geometry.dispose();
        obj.mesh.geometry = built?.geometry ?? new THREE.BufferGeometry();
        obj.coverage = built?.coverage ?? 0;
        obj.placement = layer.placement;
        obj.flipKey = flipKey;
      }
      const mat = obj.mesh.material;
      if (layer.finish === 'printed') {
        const zm = version.materials[layer.placement.zoneId];
        mat.roughness = zm ? FINISH_ROUGHNESS[zm.finish] : 0.8;
      }
      mat.opacity = layer.opacity;
      mat.polygonOffsetFactor = -1 - order;
      mat.polygonOffsetUnits = -4 * (order + 1);
      obj.mesh.renderOrder = order + 1;
      if (obj.assetId !== layer.assetId) {
        obj.assetId = layer.assetId;
        mat.map = null;
        mat.needsUpdate = true;
      }
      const tex = this.texture(layer.assetId);
      if (tex && mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      obj.mesh.visible = layer.visible && !!tex;
    });
    for (const id of [...this.layers.keys()]) if (!seen.has(id)) this.disposeLayer(id);

    const sel = selectedId ? this.layers.get(selectedId) : undefined;
    const selLayer = version.layers.find((l) => l.id === selectedId);
    this.selection.visible = !!sel && !!selLayer?.visible;
    if (sel) {
      this.selection.geometry = sel.mesh.geometry;
      const m = this.selection.material as THREE.ShaderMaterial;
      m.polygonOffsetFactor = -2 - version.layers.length;
      m.polygonOffsetUnits = -8 * (version.layers.length + 1);
      m.uniforms.uLocked.value = selLayer?.locked ? 1 : 0;
    }
    this.dirty = true;
  }

  layerInfo(id: ID): LayerRenderInfo | null {
    const o = this.layers.get(id);
    if (!o) return null;
    const slot = this.textures.get(o.assetId);
    return { coverage: o.coverage, missingTexture: slot?.error ?? null };
  }

  private texture(assetId: ID): THREE.Texture | null {
    const slot = this.textures.get(assetId);
    if (slot) return slot.texture;
    const s: TextureSlot = { texture: null, error: null };
    this.textures.set(assetId, s);
    this.loadBitmap(assetId)
      .then((bmp) => {
        const t = new THREE.Texture(bmp);
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.needsUpdate = true;
        s.texture = t;
      })
      .catch((e) => (s.error = e instanceof Error ? e.message : String(e)))
      .finally(() => {
        if (this.lastVersion) this.sync(this.lastVersion, this.lastAssets, this.selectedId);
        this.onChange();
      });
    return null;
  }

  private disposeLayer(id: ID) {
    const o = this.layers.get(id);
    if (!o) return;
    o.mesh.removeFromParent();
    o.mesh.geometry.dispose();
    o.mesh.material.dispose();
    this.layers.delete(id);
  }

  private clearLayers() {
    for (const id of [...this.layers.keys()]) this.disposeLayer(id);
  }

  // ------------------------------------------------------------------ camera
  private presetDirection(id: CameraPresetId): THREE.Vector3 {
    const m = this.model;
    const f = m ? frameVectors(m.info.frame) : null;
    // world-space frame vectors (display applies the up alignment)
    const q = this.display.quaternion;
    const fwd = (f?.forward ?? new THREE.Vector3(1, 0, 0)).clone().applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0);
    const right = fwd.clone().cross(up).normalize();
    const eps = 0.002;
    const e25 = THREE.MathUtils.degToRad(22);
    switch (id) {
      case 'front': return fwd.clone().multiplyScalar(Math.cos(0.08)).addScaledVector(up, Math.sin(0.08)).normalize();
      case 'back': return fwd.clone().negate().multiplyScalar(Math.cos(0.08)).addScaledVector(up, Math.sin(0.08)).normalize();
      case 'right': return right.clone().multiplyScalar(Math.cos(0.05)).addScaledVector(up, Math.sin(0.05)).normalize();
      case 'left': return right.clone().negate().multiplyScalar(Math.cos(0.05)).addScaledVector(up, Math.sin(0.05)).normalize();
      case 'top': return up.clone().addScaledVector(fwd, -eps).normalize();
      case 'bottom': return up.clone().negate().addScaledVector(fwd, -eps).normalize();
      case 'q-right': return fwd.clone().add(right).normalize().multiplyScalar(Math.cos(e25)).addScaledVector(up, Math.sin(e25)).normalize();
      case 'q-left': return fwd.clone().sub(right).normalize().multiplyScalar(Math.cos(e25)).addScaledVector(up, Math.sin(e25)).normalize();
    }
  }

  /** Distance at which the whole model fits the viewport from direction d. */
  private fit(d: THREE.Vector3, target: THREE.Vector3, aspect: number): number {
    const box = this.model ? new THREE.Box3().setFromObject(this.model.root) : new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const worldUp = Math.abs(d.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = worldUp.clone().cross(d).normalize();
    const up = d.clone().cross(right).normalize();
    const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const th = tv * aspect;
    let dist = 0;
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
      const z = c.dot(d);
      dist = Math.max(dist, z + Math.abs(c.dot(right)) / th, z + Math.abs(c.dot(up)) / tv);
    }
    return dist * 1.12;
  }

  private presetTarget(): THREE.Vector3 {
    if (!this.model) return new THREE.Vector3(0, 0.5, 0);
    return new THREE.Box3().setFromObject(this.model.root).getCenter(new THREE.Vector3());
  }

  setPreset(id: CameraPresetId, animate = true) {
    const toDir = this.presetDirection(id);
    const toTarget = this.presetTarget();
    const toDist = this.fit(toDir, toTarget, this.camera.aspect);
    if (!animate) {
      this.anim = null;
      this.applyCamera(toDir, toDist, toTarget);
      return;
    }
    const fromTarget = this.controls.target.clone();
    const off = this.camera.position.clone().sub(fromTarget);
    this.anim = { t0: performance.now(), dur: 520, fromDir: off.clone().normalize(), toDir, fromDist: off.length(), toDist, fromTarget, toTarget };
  }

  resetCamera() {
    this.setPreset('q-right');
  }

  private applyCamera(dir: THREE.Vector3, dist: number, target: THREE.Vector3) {
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    this.controls.update();
    this.dirty = true;
  }

  private stepAnimation(): boolean {
    const a = this.anim;
    if (!a) return false;
    const t = Math.min(1, (performance.now() - a.t0) / a.dur);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const dir = slerpUnit(a.fromDir, a.toDir, k);
    this.applyCamera(dir, THREE.MathUtils.lerp(a.fromDist, a.toDist, k), a.fromTarget.clone().lerp(a.toTarget, k));
    if (t >= 1) this.anim = null;
    return true;
  }

  // ------------------------------------------------------------------ picking
  /** Pointer position → ray in MODEL space. */
  modelRay(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const inv = this.model ? this.model.root.matrixWorld.clone().invert() : new THREE.Matrix4();
    const origin = rc.ray.origin.clone().applyMatrix4(inv);
    const dir = rc.ray.direction.clone().transformDirection(inv);
    return { origin, dir, world: rc };
  }

  pickSurface(clientX: number, clientY: number, meshes?: string[]): SurfaceHit | null {
    if (!this.model) return null;
    const { origin, dir } = this.modelRay(clientX, clientY);
    return raycastModel(this.model, origin, dir, meshes);
  }

  /** Top-most visible, unlocked layer under the pointer that is not hidden behind the shoe. */
  pickLayer(clientX: number, clientY: number, locked: (id: ID) => boolean): ID | null {
    if (!this.model) return null;
    const { world } = this.modelRay(clientX, clientY);
    const candidates = [...this.layers.values()].filter((o) => o.mesh.visible && !locked(o.mesh.userData.layerId));
    const hits = world.intersectObjects(candidates.map((o) => o.mesh), false);
    if (!hits.length) return null;
    const surface = this.pickSurface(clientX, clientY);
    const tol = (DISPLAY_SIZE * 0.01);
    if (surface) {
      const sp = surface.point.clone().applyMatrix4(this.model.root.matrixWorld);
      const sd = sp.distanceTo(world.ray.origin);
      if (hits[0].distance > sd + tol) return null;
    }
    const near = hits.filter((h) => h.distance <= hits[0].distance + tol);
    near.sort((a, b) => b.object.renderOrder - a.object.renderOrder);
    return near[0].object.userData.layerId as ID;
  }

  setOrbitEnabled(on: boolean) {
    this.controls.enabled = on;
  }

  /** World-space point of a model-space anchor projected to viewport pixels (tests, overlays). */
  projectAnchor(anchor: [number, number, number]) {
    if (!this.model) return null;
    const p = v3(anchor).applyMatrix4(this.model.root.matrixWorld).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, inFront: p.z < 1 };
  }

  // ------------------------------------------------------------------ capture
  /**
   * Render one preset at a fixed pixel size and return a PNG data URL.
   * Uses the same scene and document state as the live view.
   */
  capture(id: CameraPresetId, width: number, height: number, transparent = false): string {
    const r = this.renderer;
    const prevSize = r.getSize(new THREE.Vector2());
    const prevRatio = r.getPixelRatio();
    const prevPos = this.camera.position.clone();
    const prevTarget = this.controls.target.clone();
    const prevAspect = this.camera.aspect;
    const prevBg = this.scene.background;
    const selVisible = this.selection.visible;
    this.selection.visible = false;
    if (transparent) this.scene.background = null;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const d = this.presetDirection(id);
    const target = this.presetTarget();
    this.camera.position.copy(target).addScaledVector(d, this.fit(d, target, this.camera.aspect));
    this.camera.lookAt(target);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    // restore the live view
    this.scene.background = prevBg;
    this.selection.visible = selVisible;
    r.setPixelRatio(prevRatio);
    r.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(prevPos);
    this.controls.target.copy(prevTarget);
    this.camera.lookAt(prevTarget);
    this.dirty = true;
    return url;
  }

  // ------------------------------------------------------------------ loop
  requestRender() {
    this.dirty = true;
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const animating = this.stepAnimation();
    const moved = this.controls.update();
    if (animating || moved || this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
      this.renderCount++;
    }
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.clearLayers();
    this.selection.removeFromParent();
    for (const s of this.textures.values()) s.texture?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function slerpUnit(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  if (dot > 0.9995) return a.clone().lerp(b, t).normalize();
  if (dot < -0.9995) {
    // opposite directions: rotate around world up
    const axis = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    return a.clone().applyAxisAngle(axis, Math.PI * t);
  }
  const th = Math.acos(dot) * t;
  const rel = b.clone().addScaledVector(a, -dot).normalize();
  return a.clone().multiplyScalar(Math.cos(th)).addScaledVector(rel, Math.sin(th));
}

function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Selection outline: a constant-width border along the artwork rectangle's edge. */
function selectionMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    uniforms: { uLocked: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uLocked;
      void main() {
        vec2 e = min(vUv, 1.0 - vUv);
        vec2 w = fwidth(vUv);
        float border = max(1.0 - smoothstep(w.x * 1.5, w.x * 3.0, e.x), 1.0 - smoothstep(w.y * 1.5, w.y * 3.0, e.y));
        vec2 c = step(e, vec2(0.08));
        float corner = c.x * c.y * (1.0 - smoothstep(w.x * 4.0, w.x * 6.0, min(e.x, e.y)));
        vec3 col = mix(vec3(0.16, 0.42, 0.95), vec3(0.55, 0.55, 0.58), uLocked);
        float a = max(border, corner) * 0.95 + 0.06;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}
