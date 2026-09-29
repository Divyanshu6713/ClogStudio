import { useProject } from '@/state/selectors';
import { useRuntime } from '@/runtime';

const ACCURACY: Record<string, string> = {
  product: 'Product model (supplied geometry)',
  reference: 'Reference stand-in (not a real product)',
  concept: 'Concept visualization',
};

export function ModelPanel() {
  const project = useProject();
  const model = useRuntime((s) => s.model);
  const ref = project.model;
  return (
    <>
      <div className="panel-head">Clog model</div>
      <div className="panel-scroll">
        <div className="section">
          <dl className="kv">
            <dt>Model</dt><dd>{ref.name}</dd>
            <dt>Accuracy</dt><dd>{ACCURACY[ref.accuracy]}</dd>
            <dt>Scale</dt><dd>{ref.calibration ? `${ref.calibration.mmPerUnit} mm / unit (${ref.calibration.source})` : 'Not calibrated — sizes shown in model units'}</dd>
            <dt>Shoe</dt><dd>{ref.side === 'unknown' ? 'Unknown side' : `${ref.side[0].toUpperCase()}${ref.side.slice(1)} shoe`}{ref.sizeLabel ? ` · ${ref.sizeLabel}` : ' · size not specified'}</dd>
            <dt>Orientation</dt><dd className="mono">toe {ref.frame.forward} · up {ref.frame.up} · outer {ref.frame.outer}</dd>
            {model && (
              <>
                <dt>Triangles</dt><dd>{model.info.triangles.toLocaleString()}</dd>
                <dt>Charm holes</dt><dd>{model.holes.length ? `${model.holes.length} anchor points from the model file` : 'None defined in the model'}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="section">
          <div className="section-title">Zones</div>
          <dl className="kv">
            {ref.zones.map((z) => (
              <div key={z.id} style={{ display: 'contents' }}>
                <dt>{z.label}</dt>
                <dd className="faint">{z.printable ? 'printable' : 'colour only'} · mesh {z.meshes.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </div>
        {(ref.note || (model && model.info.warnings.length > 0)) && (
          <div className="section">
            {ref.note && <div className="note">{ref.note}</div>}
            {model?.info.warnings.map((w) => <div key={w} className="note warn">{w}</div>)}
          </div>
        )}
        <div className="section">
          <div className="section-title">Model preparation <span className="soon-tag">Later</span></div>
          <p className="hint" style={{ marginTop: 0 }}>Admin setup for zones, printable regions, charm-hole positions, calibration and camera presets. Until then these come from the model file only — nothing is invented.</p>
        </div>
      </div>
    </>
  );
}
