import { Copy, Download, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Lock, LockOpen, RotateCcw, Trash2 } from 'lucide-react';
import type { ImageLayer, ProjectedPlacement } from '@/domain/types';
import { downloadOriginal } from '@/assets/assetRuntime';
import { defaultPlacement, modelSize, reproject, resetOrientation } from '@/engine/placement';
import { v3 } from '@/engine/frame';
import { cmd } from '@/state/commands';
import { useProject, useSelectedLayer, useVersion } from '@/state/selectors';
import { runtime, toast, useRuntime } from '@/runtime';
import { NumberField } from '../controls/NumberField';
import { duplicate, remove } from '../actions';

export function PropertiesPanel() {
  const layer = useSelectedLayer();
  return (
    <section className="properties" aria-label="Properties">
      <div className="panel-head">Properties</div>
      <div className="panel-scroll">{layer ? <ImageProps key={layer.id} layer={layer} /> : <NoSelection />}</div>
    </section>
  );
}

function NoSelection() {
  const project = useProject();
  const version = useVersion();
  return (
    <>
      <div className="section">
        <p className="muted" style={{ margin: 0 }}>Select artwork on the clog or in Layers to edit its position, size and rotation.</p>
      </div>
      <div className="section">
        <div className="section-title">{version.name}</div>
        <dl className="kv">
          {project.model.zones.map((z) => (
            <div key={z.id} style={{ display: 'contents' }}>
              <dt>{z.label}</dt>
              <dd className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: version.materials[z.id]?.color, border: '1px solid rgb(0 0 0 / .15)' }} />
                {version.materials[z.id]?.color}
              </dd>
            </div>
          ))}
          <dt>Layers</dt>
          <dd>{version.layers.length} ({version.layers.filter((l) => !l.visible).length} hidden)</dd>
        </dl>
      </div>
    </>
  );
}

const AXES = ['X', 'Y', 'Z'] as const;

function ImageProps({ layer }: { layer: ImageLayer }) {
  const project = useProject();
  const model = useRuntime((s) => s.model);
  useRuntime((s) => s.renderTick);
  const p = layer.placement;
  const asset = project.assets[layer.assetId];
  const locked = layer.locked;
  const calib = project.model.calibration;
  const unit = calib ? 'mm' : 'u';
  const toDisplay = (v: number) => (calib ? v * calib.mmPerUnit : v);
  const fromDisplay = (v: number) => (calib ? v / calib.mmPerUnit : v);
  const size = model ? modelSize(model) : 1;
  const info = runtime.engine?.layerInfo(layer.id) ?? null;
  const zones = project.model.zones.filter((z) => z.printable);

  const place = (label: string, patch: Partial<ProjectedPlacement>) => cmd.updatePlacement(layer.id, `${label} ${layer.name}`, patch, { coalesce: `${label}:${layer.id}` });

  // Position: the two axes most tangent to the surface are editable; the point
  // is then projected back onto the surface along its normal.
  const n = p.normal.map(Math.abs);
  const tangentAxes = [0, 1, 2].sort((a, b) => n[a] - n[b]).slice(0, 2).sort();
  const setAxis = (axis: number, value: number) => {
    if (!model) return;
    const target = v3(p.anchor);
    target.setComponent(axis, fromDisplay(value));
    const next = reproject(model, p, target);
    if (!next) return toast('That position is off this surface. The artwork stays on its current mesh.', 'info', 3000);
    place('Move', next);
  };

  const setWidth = (w: number) => {
    const width = Math.max(fromDisplay(w), size * 0.005);
    place('Resize', p.aspectLocked ? { width, height: (width * p.height) / p.width } : { width });
  };
  const setHeight = (h: number) => {
    const height = Math.max(fromDisplay(h), size * 0.005);
    place('Resize', p.aspectLocked ? { height, width: (height * p.width) / p.height } : { height });
  };

  const moveToZone = (zoneId: string) => {
    if (!model) return;
    const d = defaultPlacement(model, zoneId, p.width / p.height);
    if (!d) return toast('No placeable surface found on that zone.', 'error');
    cmd.updatePlacement(layer.id, `Move ${layer.name} to ${zoneId}`, { ...d, width: p.width, height: p.height, rotationDeg: p.rotationDeg, aspectLocked: p.aspectLocked });
  };

  const assetAspect = asset?.width && asset?.height ? asset.width / asset.height : null;

  return (
    <>
      <div className="section">
        <div className="section-title" style={{ fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>{layer.name}</div>
        <div className="faint" style={{ fontSize: 11.5 }}>Image · {p.surfaceLabel} of {zones.find((z) => z.id === p.zoneId)?.label ?? p.zoneId}</div>
        {locked && <div className="note" style={{ marginTop: 8 }}><Lock size={12} style={{ verticalAlign: -1 }} /> Locked — unlock to edit.</div>}
        {info && info.coverage < 0.97 && info.coverage > 0 && (
          <div className="note warn" style={{ marginTop: 8 }}>
            About {Math.round((1 - info.coverage) * 100)}% of the artwork falls off this surface (edge, opening or steep curve) and is not shown.
          </div>
        )}
        {info?.missingTexture && <div className="note error" style={{ marginTop: 8 }}>Artwork image unavailable: {info.missingTexture}</div>}
      </div>

      <div className="section">
        <div className="section-title">Surface</div>
        <label className="sr-only" htmlFor="zone-sel">Zone</label>
        <select id="zone-sel" className="text-input" value={p.zoneId} disabled={locked} onChange={(e) => moveToZone(e.target.value)}>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
        </select>
        <p className="hint">Drag the artwork on the clog to move it across this zone's surface. It follows the curvature and never leaves the part it is printed on.</p>
      </div>

      <div className="section">
        <div className="section-title">Position <span className="spacer" /><span className="faint" style={{ fontWeight: 500 }}>{calib ? 'mm' : 'model units'}</span></div>
        <div className="field-row">
          {tangentAxes.map((a) => (
            <NumberField key={a} label={AXES[a]} name={`Position ${AXES[a]}`} value={toDisplay(p.anchor[a])} onChange={(v) => setAxis(a, v)} step={calib ? 0.5 : 0.005} precision={calib ? 1 : 3} disabled={locked} title="Model-space coordinate of the artwork centre, projected onto the surface" />
          ))}
        </div>
        <p className="hint" style={{ marginTop: 0 }}>Arrow keys nudge along the surface (Shift ×10).</p>
      </div>

      <div className="section">
        <div className="section-title">Size <span className="spacer" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
            <input type="checkbox" checked={p.aspectLocked} disabled={locked} onChange={(e) => place('Aspect', { aspectLocked: e.target.checked })} /> Keep ratio
          </label>
        </div>
        <div className="field-row">
          <NumberField label="W" name="Width" value={toDisplay(p.width)} onChange={setWidth} step={calib ? 0.5 : 0.005} min={0} precision={calib ? 1 : 3} unit={unit} disabled={locked} />
          <NumberField label="H" name="Height" value={toDisplay(p.height)} onChange={setHeight} step={calib ? 0.5 : 0.005} min={0} precision={calib ? 1 : 3} unit={unit} disabled={locked} />
        </div>
        <div className="toggle-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="faint" style={{ fontSize: 11.5 }}>Width ≈ {Math.round((p.width / size) * 100)}% of model length</span>
          {assetAspect && Math.abs(p.width / p.height - assetAspect) > 0.002 && (
            <button className="btn sm" disabled={locked} onClick={() => place('Restore ratio', { height: p.width / assetAspect })} title="Restore the artwork's original proportions">Original ratio</button>
          )}
        </div>
      </div>

      <div className="section">
        <div className="section-title">Rotation</div>
        <div className="slider-row">
          <input type="range" min={-180} max={180} step={1} value={p.rotationDeg} disabled={locked} aria-label="Rotation slider" onChange={(e) => place('Rotate', { rotationDeg: Number(e.target.value) })} />
          <NumberField label="°" name="Rotation degrees" value={p.rotationDeg} onChange={(v) => place('Rotate', { rotationDeg: v })} step={1} min={-180} max={180} precision={1} disabled={locked} />
        </div>
        <button className="btn sm" disabled={locked || !model} onClick={() => model && place('Reset orientation', { rotationDeg: 0, up: resetOrientation(model, p) })} title="Rotation 0° and upright relative to the shoe">
          <RotateCcw size={13} /> Reset orientation
        </button>
        <p className="hint">[ and ] rotate by 1° (Shift 15°).</p>
      </div>

      <div className="section">
        <div className="section-title">Appearance</div>
        <div className="slider-row">
          <input type="range" min={0} max={100} value={Math.round(layer.opacity * 100)} disabled={locked} aria-label="Opacity slider" onChange={(e) => cmd.updateLayer(layer.id, `Opacity ${layer.name}`, { opacity: Number(e.target.value) / 100 }, `opacity:${layer.id}`)} />
          <NumberField label="%" name="Opacity percent" value={Math.round(layer.opacity * 100)} onChange={(v) => cmd.updateLayer(layer.id, `Opacity ${layer.name}`, { opacity: v / 100 }, `opacity:${layer.id}`)} step={1} min={0} max={100} precision={0} disabled={locked} />
        </div>
        <div className="toggle-row" style={{ marginBottom: 8 }}>
          <button className="btn sm" aria-pressed={layer.flipX} disabled={locked} onClick={() => cmd.updateLayer(layer.id, `Flip ${layer.name}`, { flipX: !layer.flipX })} style={layer.flipX ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
            <FlipHorizontal2 size={13} /> Flip H
          </button>
          <button className="btn sm" aria-pressed={layer.flipY} disabled={locked} onClick={() => cmd.updateLayer(layer.id, `Flip ${layer.name}`, { flipY: !layer.flipY })} style={layer.flipY ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
            <FlipVertical2 size={13} /> Flip V
          </button>
          <button className="btn sm" disabled title="Crop and masks — not implemented yet">Crop <span className="soon-tag">Later</span></button>
        </div>
        <div className="section-title" style={{ marginTop: 4 }}>Finish preview</div>
        <div className="seg" role="group" aria-label="Finish preview">
          {(['printed', 'decal'] as const).map((f) => (
            <button key={f} aria-pressed={layer.finish === f} disabled={locked} onClick={() => cmd.updateLayer(layer.id, `Finish ${layer.name}`, { finish: f })}>
              {f === 'printed' ? 'Printed' : 'Glossy decal'}
            </button>
          ))}
        </div>
        <p className="hint">Visual simulation only — not a prediction of a factory process.</p>
      </div>

      {asset && (
        <div className="section">
          <div className="section-title">Source file</div>
          <dl className="kv">
            <dt>File</dt><dd>{asset.name}</dd>
            <dt>Pixels</dt><dd>{asset.width}×{asset.height}{asset.kind === 'svg' ? ' (SVG artboard)' : ''}</dd>
            {asset.preview?.downscaled && <><dt>Working copy</dt><dd>{asset.preview.width}×{asset.preview.height}</dd></>}
            <dt>SHA-256</dt><dd className="mono" title={asset.sha256}>{asset.sha256.slice(0, 16)}…</dd>
          </dl>
          {asset.warnings.map((w) => <div key={w} className="note warn" style={{ marginTop: 6 }}>{w}</div>)}
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => downloadOriginal(asset).catch((e) => toast(String(e.message ?? e), 'error'))}>
            <Download size={13} /> Download original
          </button>
        </div>
      )}

      <div className="section">
        <div className="toggle-row">
          <button className="btn sm" onClick={() => cmd.updateLayer(layer.id, `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, { visible: !layer.visible })}>
            {layer.visible ? <EyeOff size={13} /> : <Eye size={13} />} {layer.visible ? 'Hide' : 'Show'}
          </button>
          <button className="btn sm" onClick={() => cmd.updateLayer(layer.id, `${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`, { locked: !layer.locked })}>
            {layer.locked ? <LockOpen size={13} /> : <Lock size={13} />} {layer.locked ? 'Unlock' : 'Lock'}
          </button>
          <button className="btn sm" onClick={() => duplicate(layer.id)} title="Duplicate (Ctrl+D)"><Copy size={13} /> Duplicate</button>
          <button className="btn sm danger" disabled={locked} onClick={() => remove(layer.id)} title="Delete (Del)"><Trash2 size={13} /> Delete</button>
        </div>
      </div>
    </>
  );
}
