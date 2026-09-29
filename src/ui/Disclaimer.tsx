import { useEffect } from 'react';

export const DISCLAIMER =
  'This preview is a digital design simulation intended for visual decision-making. Final manufactured colors, positioning, texture and finish may vary depending on materials and production methods.';

export function Disclaimer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="disc-title">
        <h2 id="disc-title">Digital visualization, not a manufacturing result</h2>
        <p>{DISCLAIMER}</p>
        <p className="muted">The physical result can differ because of:</p>
        <ul>
          <li>foam and material characteristics, surface curvature and texture</li>
          <li>printing process, ink, paint, heat and coatings</li>
          <li>emboss depth and decal thickness</li>
          <li>lighting, monitor calibration and colour management</li>
          <li>manufacturing tolerances and shoe size</li>
        </ul>
        <p className="muted">Digital colours vary between monitors, lighting environments and manufactured materials. Measurements are shown in millimetres only when the model carries real calibration data.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={onClose} autoFocus>Understood</button>
        </div>
      </div>
    </div>
  );
}
